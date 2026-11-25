---
title: "客户端推荐实现"
sidebar_position: 3
description: "批量下载调度、缓存未命中处理、WebSeed URL 拼接层修改与可变种子缓存清理。"
---

本文档在《概览与最小实现》的基础上，说明客户端接入时的调用约定、批量下载调度、未命中处理、BT 引擎 WebSeed 适配（基于 `libtorrent` 等引擎的 URL 拼接修改）以及可变种子缓存清理实现。

## 1. 调用约定与缓存生命周期

1. **传入官方源原始 URL**：启动器向 NCP SDK 请求文件时，应传入未经过第三方镜像源（如 BMCLAPI）替换的 Mojang 官方源原始 URL，SDK 内部按 RFC 3986 Section 6.2.2 规范化后计算 `url:<Base64>` 格式的 `NSFID`。
2. **下载任意版本前强制先请求该版本的入口 Manifest**：
   由于部分启动器自身带有本地文件缓存（如 `.minecraft/versions/<ver>/<ver>.json` 已在磁盘上），有时会跳过 manifest 直接请求具体的库或资源文件。为保持缓存索引一致并支持大版本可变种子更新，**启动器在下载某个游戏版本的具体资源文件前，必须先通过 SDK 请求一次该版本的 `<version>.json`（以及 `<asset_index>.json`）**。
   * 这样可以确保该版本对应的大版本种子（如 `minecraft-1.21-full`）在下载子文件前必定已完成拉取和 `file tree` 展开；
   * SDK 无需接收额外的入口上下文参数，也无需在子文件未命中时回溯推导入口文件。
3. **每次拉取 `latest.json` 时清理过期种子引用**：
   大版本种子（如 `minecraft-1.21-full`）在 Mojang 发布新小版本（如 `1.21.3`）时会重新打包并生成新的 `torrenthash`。客户端每次拉取新 `latest.json` 时，先将本地缓存数据库中不在 `latest.assets.torrents` 里的 `torrenthash` 记录全部删除，再写入新的 `nsci.raw_kv`。下一次启动器按规定前置请求版本 manifest 时，就会自动拉取并展开更新后的大版本种子。
4. **种子落盘与 `file tree` 展开在同一事务内提交**：首次下载某个 `.torrent` 文件并落盘时，同步将其 `info["file tree"]` 展开写入本地数据库 `nsci_cache` 表，并在同一事务内将 `torrents_state.is_expanded` 置为 `1`。

## 2. 批量获取（`nsGetFilesBatch`）

启动器先调用 `nsGetFile` 获取 `<version>.json` 与 `<asset_index>.json`（此时对应的大版本全量种子已下载并展开到 `nsci_cache`），解析出该版本所需的成百上千个 `libraries` 和 `assets` 后，调用批量接口 `nsGetFilesBatch(nsfidList)`：

1. **批量查库**：一次性在本地 `nsci_cache` 表中查询 `nsfidList` 中所有项的 `(torrenthash, rel_path, orig_url)`。若有未命中项，按第 3 节处理；若仍有未命中项则报错或交由启动器回退直连。
2. **按目标哈希分组**：将命中的请求按 `torrenthash` 聚合为 `Map<torrenthash, List<(NSFID, rel_path, orig_url)>>`。
3. **按组提交下载**：对每个 `torrenthash` 调用 `nsGetTorrent(latest, torrenthash)`：
   * 若返回 `DeliveryResult::DirectFile(local_path)`，直接映射至 `local_path`。
   * 若返回 `DeliveryResult::Torrent(torrent_meta)`，将该组内的目标文件列表一次性提交给 BT 引擎设置文件下载优先级（只下载当前版本所需的文件，种子内其他小版本的文件优先级设为不下载），由 BT 引擎通过 P2P 与 WebSeed 下载并校验。
4. **交付结果**：完成后返回 `Map<NSFID, LocalFilePath>`，或通过回调逐个通知上层启动器。

## 3. 缓存未命中的处理

在遵循“下载版本前先请求版本 manifest”的前提下，下载子文件时对应的大版本种子均已展开在 `nsci_cache` 中。当 `nsGetFile` 或 `nsGetFilesBatch` 查库未命中时（例如首次请求刚发布的版本 manifest，或上次展开种子时进程异常退出），按以下步骤处理：

1. **检查本地未展开的种子**：扫描 `.nodestone/torrents/` 目录，若存在已落盘但在 `torrents_state` 中 `is_expanded == 0` 的 `.torrent` 文件，补跑一次 `file tree` 展开后再查库。
2. **刷新 `latest.json`**：若仍未命中，且距离上次拉取 `latest.json` 已超过冷却时间（如 60 秒，或本地缓存为空），从 `provider.urls` 重新拉取一次 `latest.json`（执行过期 `torrenthash` 清理并更新 `nsci.raw_kv` 入口映射），然后重新查库。
3. **返回未命中错误**：若上述步骤后仍查不到（例如启动器传入了不在官方源内的第三方自定义文件 URL），向上层抛出包含 `(orig_url, nsfid, local_revision)` 的未命中错误，由启动器记录日志并回退至普通 HTTPS 直连下载。

## 4. WebSeed 实现（修改 BT 引擎 URL 拼接层，支持 Mojang 与 BMCLAPI）

### 1. 标准 BEP-19 拼接机制与跨域名种子的适配

在标准 BEP-19（HTTP/FTP Seeding）实现（如原生 `libtorrent-rasterbar`）中：
* BT 客户端从 `url-list` 中解析目标服务器主机名，并在多文件种子模式下将请求路径拼接为：
  `<url-list>/<info["name"]>/<file_tree_rel_path>`
* 同时，BT 客户端会对 `<file_tree_rel_path>` 自动执行一次 URL 路径编码（如 `libtorrent::escape_path`）。因此种子 `info["file tree"]` 内必须存储未转义的原始路径段与文件名，不能预先做 URL 编码，否则 `%` 会被二次编码为 `%25`。

对于 `minecraft-1.20-full`、`minecraft-1.21-full` 这类包含多个 Mojang 官方域名（`piston-meta.mojang.com`、`piston-data.mojang.com`、`libraries.minecraft.net`、`resources.download.minecraft.net`）的多文件种子，`info["file tree"]` 的第一级目录固定为官方源主机名 `<host>[:<port>]`。

为了让 BT 引擎原生支持跨域名 Mojang 官方源 WebSeed 以及存放在 `info["ns-mirrors"]` 中的 BMCLAPI 镜像源 WebSeed（无需在本地启动额外的 HTTP 代理服务），NodeStone SDK 直接修改底层 BT 引擎（如 `libtorrent`）的 WebSeed URL 组装逻辑。

### 2. BT 引擎（`libtorrent` 等）URL 拼接层修改说明

在自编译维护的 `libtorrent-rasterbar`（或 Rust / Go BT 引擎）中，对种子元数据解析与 `web_peer_connection` 请求构造处做如下调整：

1. **解析 `info["ns-schemes"]` 与 `info["ns-mirrors"]`**：
   在加载种子 `info` 字典时（如 `torrent_info::parse_info_section`），读取：
   * `info["ns-schemes"]`：官方源协议头列表（缺省 `["https://"]`）。
   * `info["ns-mirrors"]`：主机名到镜像源前缀列表的映射字典（如 `"libraries.minecraft.net" -> ["https://bmclapi2.bangbang93.com/maven"]`）。
2. **跳过 `info["name"]` 并按文件首层目录 `<host>` 生成官方源与镜像源 WebSeed URL**：
   在构造多文件 WebSeed 请求 URL 时，当种子包含 `info["ns-schemes"]` 或 `info["ns-mirrors"]` 时，**不再拼接 `info["name"]` 目录层级**，而是将该文件在 `info["file tree"]` 中的路径拆分为第一级主机名 `<host>` 和后续子路径 `<subpath>`（经引擎自带 `escape_path` 编码）：
   * **Mojang 官方源 WebSeed URL**：取 `ns-schemes` 中的协议头，直接拼接为 `<scheme><host>/<escaped_subpath>`（例如 `https://libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`）。
   * **BMCLAPI 镜像源 WebSeed URL**：在 `info["ns-mirrors"]` 中查找 Key 为 `<host>` 的镜像前缀列表，对每个 `<mirror_prefix>`（去除末尾 `/`）拼接为 `<mirror_prefix>/<escaped_subpath>`（例如 `https://bmclapi2.bangbang93.com/maven/com/mojang/logging/1.1.1/logging-1.1.1.jar`）。
3. **复用引擎原生 Range 调度与 BEP-52 Merkle 校验**：
   通过上述 URL 构造逻辑，BT 引擎内置的 WebSeed 连接器可直接向 Mojang 官方 CDN 及 BMCLAPI 镜像源发起带 `Range: bytes=<start>-<end>` 的 HTTP/HTTPS 请求，并在引擎内部自动完成 BEP-52 的 `pieces root` / `piece layers` Merkle 树校验、落盘及向其他 P2P 节点做种。

以下 Python 函数展示了引擎根据 `info["ns-schemes"]` 与 `info["ns-mirrors"]` 为种子内任意文件生成 WebSeed URL 列表的等价逻辑：

```python
from urllib.parse import quote

def build_file_webseed_urls(info: dict, file_tree_segments: list[str]) -> list[str]:
    """
    根据种子的 info['ns-schemes'] 与 info['ns-mirrors']，
    为 file_tree 中的单个文件（segments = [host_port, seg_1, seg_2, ...]）生成全部 WebSeed URL（官方源 + BMCLAPI 等镜像源）。
    """
    host_port = file_tree_segments[0].strip().lower()
    encoded_subpath = "/".join(quote(seg, safe="-._~") for seg in file_tree_segments[1:])

    urls = []

    # 1. 拼接 Mojang 官方源 WebSeed URL
    schemes = info.get("ns-schemes") or ["https://"]
    if isinstance(schemes, str):
        schemes = [schemes]
    for raw_scheme in schemes:
        clean = raw_scheme.strip().lower().rstrip(":/")
        scheme = f"{clean}://" if clean in ("http", "https") else "https://"
        urls.append(f"{scheme}{host_port}/{encoded_subpath}")

    # 2. 拼接 info['ns-mirrors'] 中的 BMCLAPI 等镜像源 WebSeed URL
    mirrors_map = info.get("ns-mirrors") or {}
    if isinstance(mirrors_map, dict):
        mirror_prefixes = mirrors_map.get(host_port) or []
        if isinstance(mirror_prefixes, str):
            mirror_prefixes = [mirror_prefixes]
        for prefix in mirror_prefixes:
            clean_prefix = prefix.strip().rstrip("/")
            if clean_prefix:
                urls.append(f"{clean_prefix}/{encoded_subpath}")

    return urls
```

## 5. 本地缓存结构与可变种子清理

### 1. 数据库表结构

建议使用 SQLite（存放在 `.nodestone/cache/nsci.db`）持久化本地缓存：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

-- 1. 客户端全局元数据表（记录 local_revision、last_fetched_at 等状态）
CREATE TABLE IF NOT EXISTS meta_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. 本地种子展开状态表（记录每个 torrenthash 的 file tree 是否已展开）
CREATE TABLE IF NOT EXISTS torrents_state (
    torrenthash TEXT PRIMARY KEY,
    is_expanded INTEGER NOT NULL DEFAULT 0, -- 0: 未展开, 1: file tree 已展开至 nsci_cache
    updated_at INTEGER NOT NULL
);

-- 3. NSCI 映射缓存表
CREATE TABLE IF NOT EXISTS nsci_cache (
    nsfid TEXT PRIMARY KEY,
    torrenthash TEXT NOT NULL,
    rel_path TEXT,
    orig_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_nsci_torrenthash ON nsci_cache(torrenthash);
```

### 2. 拉取 `latest.json` 时的缓存清理与更新

每次拉取并校验通过新的 `latest.json` 时，在同一个数据库事务中执行以下两步：
1. **删除不在 `latest.assets.torrents` 中的旧种子缓存记录**：
   当某个仍在更新的大版本种子（如 `minecraft-1.21-full`）因 Mojang 发布 `1.21.3` 而被服务端重新打包替换后，旧种子的 Hash 不再出现在 `latest.assets.torrents` 中。直接通过 `NOT IN` 将旧 Hash 从 `nsci_cache` 和 `torrents_state` 中删除，即可一次性清除该旧种子的所有入口和已展开的子文件引用。
2. **写入最新的 `nsci.raw_kv` 入口映射**：
   将 `latest.nsci.raw_kv` 按 Upsert 写入 `nsci_cache`（保留未变种子的已有 `rel_path` 与 `orig_url`）。

```python
import time

def sync_latest_to_db(latest: dict, db_conn):
    active_hashes = list((latest.get("assets", {}).get("torrents") or {}).keys())
    raw_kv = latest.get("nsci", {}).get("raw_kv") or {}
    now_ts = int(time.time())

    with db_conn:
        # 1. 清除本地缓存中所有不在最新 assets.torrents 里的旧 torrenthash 记录
        if active_hashes:
            placeholders = ",".join("?" for _ in active_hashes)
            db_conn.execute(
                f"DELETE FROM nsci_cache WHERE torrenthash NOT IN ({placeholders})",
                active_hashes,
            )
            db_conn.execute(
                f"DELETE FROM torrents_state WHERE torrenthash NOT IN ({placeholders})",
                active_hashes,
            )
        else:
            db_conn.execute("DELETE FROM nsci_cache")
            db_conn.execute("DELETE FROM torrents_state")

        # 2. 更新顶层入口映射 nsci.raw_kv
        db_conn.executemany(
            """
            INSERT INTO nsci_cache (nsfid, torrenthash)
            VALUES (?, ?)
            ON CONFLICT(nsfid) DO UPDATE SET
                torrenthash = excluded.torrenthash
            """,
            list(raw_kv.items()),
        )

        # 3. 更新 revision 与拉取时间
        db_conn.executemany(
            """
            INSERT INTO meta_state (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            [
                ("local_revision", str(latest["revision"])),
                ("last_fetched_at", str(now_ts)),
            ],
        )
```

### 3. 展开种子 `info["file tree"]` 与异步清理磁盘旧种子

* **展开种子写入数据库**：
  首次获取到某个 `.torrent` 文件时，将展开出的 `(nsfid, torrenthash, rel_path, orig_url)` 与 `torrents_state.is_expanded = 1` 在同一事务中提交：

```python
import base64
import time
from urllib.parse import quote

def expand_filetree_to_db(torrent: dict, torrenthash: str, db_conn):
    info = torrent["info"]
    path_segments_list = parse_btv2_file_tree_segments(info["file tree"])
    schemes = info.get("ns-schemes") or ["https://"]
    if isinstance(schemes, str):
        schemes = [schemes]

    records = []
    for segments in path_segments_list:
        host_port = segments[0].strip().lower()
        rel_path = "/".join([host_port] + segments[1:])
        encoded_path = "/".join(quote(seg, safe="-._~") for seg in segments[1:])
        for raw_scheme in schemes:
            clean = raw_scheme.strip().lower().rstrip(":/")
            scheme = f"{clean}://" if clean in ("http", "https") else "https://"
            orig_url = f"{scheme}{host_port}/{encoded_path}"
            b64 = base64.b64encode(orig_url.encode("utf-8")).decode("ascii")
            nsfid = f"url:{b64}"
            records.append((nsfid, torrenthash, rel_path, orig_url))

    now_ts = int(time.time())
    with db_conn:
        db_conn.execute(
            """
            INSERT INTO torrents_state (torrenthash, is_expanded, updated_at)
            VALUES (?, 1, ?)
            ON CONFLICT(torrenthash) DO UPDATE SET
                is_expanded = 1,
                updated_at = excluded.updated_at
            """,
            (torrenthash, now_ts),
        )
        db_conn.executemany(
            """
            INSERT INTO nsci_cache (nsfid, torrenthash, rel_path, orig_url)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(nsfid) DO UPDATE SET
                torrenthash = excluded.torrenthash,
                rel_path = excluded.rel_path,
                orig_url = excluded.orig_url
            """,
            records,
        )
```

* **磁盘种子文件的异步清理**：
  数据库中的旧 `torrenthash` 在拉取 `latest.json` 时已同步清除；至于磁盘 `.nodestone/torrents/` 目录下对应的旧 `<torrenthash>.torrent` 文件以及 BT 引擎中挂载的旧任务，无需阻塞清单拉取流程，由客户端在后台空闲或启动时异步扫描 `.nodestone/torrents/`，将文件名不在当前 `torrents_state`（或 `latest.assets.torrents`）中的 `.torrent` 文件卸载并删除即可。
