---
title: "客户端推荐实现"
sidebar_position: 3
description: "批量下载调度、缓存未命中自愈闭环、WebSeed 桥接与极简本地缓存管理。"
---

本文档在《概览与最小实现》的基础上，说明实际工程接入时推荐的批量下载调度、缓存未命中自愈闭环、WebSeed 桥接实现以及极简本地缓存管理策略。

## 1. 三条基本原则

1. **本地缓存存的必须是真实的 `NSFID -> hash` 映射**：不管是来自 `latest.json` 的入口记录，还是从种子 `file tree` 展开出来的子文件记录，Key 都必须是符合 RFC 3986 Section 6.2.2 规范的 `url:<Base64>`（或未来启用的 `sha256:<Hex>`），Value 为 64 位小写十六进制哈希。注意：第三方启动器向 NCP SDK 传入 URL 时，必须传入**未经过第三方镜像源（如 BMCLAPI）替换的 Mojang/官方源原始 URL**。
2. **种子落盘与 `file tree` 展开必须视为同一事务**：首次下载某个 `.torrent` 文件并落盘时，必须同步把它的 `file tree` 展开写入本地持久化数据库 `nsci_cache` 表，并在同一数据库事务内将 `torrents_state.is_expanded` 置为 `1`，两边都成功才算种子获取完成。
3. **`raw_file` 现场直出，不在 `.nodestone/` 中留存历史缓存**：对于 `version_manifest_v2.json` 等高频可变 `raw_file`，每次请求时直接从当前 `latest.json` 现场解码并校验 SHA-256 后交付（不在 `.nodestone/` 下按 `<torrenthash>` 持久化缓存），从而彻底省去可变单文件的缓存清理与生命周期管理。

## 2. 批量获取优化（`nsGetFilesBatch`）

启动器解析完 `<version>.json` 和 `<asset_index>.json` 后，通常要一次性下载成百上千个 `libraries` 和 `assets` 小文件。由于不同版本的种子之间允许包含相同 URL 的公共 `libraries` 和 `assets` 文件，在 `nsci_cache` 的「重复即覆盖（Upsert）」机制下，公共文件指向任意一个包含它的已展开版本种子均符合协议预期并可正常下载。

为避免逐个调用 `nsGetFile` 产生重复查库和调度开销，推荐优先实现并使用批量接口 `nsGetFilesBatch(nsfidList, contextEntryNSFIDs=None)`：

1. **批量查库**：一次性在本地 `nsci_cache` 表中查询 `nsfidList` 中所有项的 `(torrenthash, rel_path, orig_url)`。如果有任何一个 `NSFID` 未命中（或仅有入口 `torrenthash` 但 `rel_path` 尚未展开填充），先执行第 3 节的自愈流程；自愈后重新查库，若仍有未命中项则中止并报错。
2. **按目标哈希分组**：把命中的请求按 `torrenthash` 聚合为 `Map<torrenthash, List<(NSFID, rel_path, orig_url)>>`。
3. **按组批量获取与提交下载**：对每个去重后的 `torrenthash` 调用一次 `nsGetTorrent(latest, torrenthash)`：
   * 若返回 `DeliveryResult::DirectFile(local_path)`（仅针对 `raw_file` 独立单文件），直接将该组内 `NSFID` 映射至 `local_path`。
   * 若返回 `DeliveryResult::Torrent(torrent_meta)`（通常在前一步下载 `<version>.json` 时种子就已经在本地了），把该组内的目标文件列表一次性提交给 BT 引擎设置文件优先级，并配合第 4 节的 WebSeed 机制并发或按需回退拉取。
4. **交付结果**：全部完成后返回 `Map<NSFID, LocalFilePath>`，或者通过完成回调每下完一个文件通知一次上层启动器。

## 3. 缓存未命中的排查与四步自愈闭环

实际接入时，很多第三方启动器自己带有本地文件缓存（比如 `.minecraft/versions/<ver>/<ver>.json` 已经在硬盘上了）。如果用户删过 `.nodestone/` 目录、旧启动器中途刚接入 NCP SDK，或者上次展开种子时意外退出，启动器就会跳过下载 `<version>.json`，直接读本地已有的 JSON 去调 `nsGetFile` / `nsGetFilesBatch` 请求里面的 `libraries`、`<asset_index>.json` 和 `assets`，导致本地 `nsci_cache` 查不到记录。

遇到未命中时，客户端按顺序执行以下四步自愈：

### 第一步：URL 规范化重算

把未命中的 `url:<Base64>` 解码回原始 URL，严格按照 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）** 检查是否存在协议或域名大写、带了默认端口（`:80` / `:443`）、百分号编码十六进制大小写不一致（应统一为大写 `%XX`）、非保留字符被多余转义、特殊字符（如空格、方括号）未转义或路径存在 `/./`、`/../` 的问题。规范化后重新编码出 `NSFID`，再查一次本地 `nsci_cache`。

### 第二步：按上下文入口（`contextEntryNSFIDs`）调用 `nsGetFile` 补齐并展开版本种子

启动器在调用 `nsGetFile(aNSFID, contextEntryNSFIDs)` 或 `nsGetFilesBatch(nsfidList, contextEntryNSFIDs)` 下载某个版本的依赖文件时，应在 `contextEntryNSFIDs` 参数里带上当前任务的顶层入口文件 NSFID（即当前版本 `<version>.json` 的 NSFID）。

当子文件未命中时，SDK 遍历 `contextEntryNSFIDs` 中的每个 `entryNSFID`：
1. 检查 `entryNSFID` 在 `nsci_cache` 中对应的 `torrenthash` 是否已在 `torrents_state` 中标记为 `is_expanded == 1`。
2. **若未查到或未展开，直接调用 `nsGetFile(entryNSFID, contextEntryNSFIDs=None)`**：
   * 若此时 `.nodestone/` 刚被清空或服务端刚发布了新版本（导致 `entryNSFID` 自身在 `nsci_cache` 中也未命中），该次 `nsGetFile(entryNSFID, contextEntryNSFIDs=None)` 会自然进入第三步刷新 `latest.json`，将最新入口映射写入 `nsci_cache`；
   * 随后 `nsGetFile` 内部调用 `nsGetTorrent` 下载对应的版本种子，并将种子内的 `info["file tree"]` 全量展开写入 `nsci_cache`（置 `is_expanded = 1`）。
   * 注意：自愈内部调用 `nsGetFile(entryNSFID)` 时必须将 `contextEntryNSFIDs` 设为 `None`，防止递归死循环。

只要传入了 `contextEntryNSFIDs`，哪怕 `.nodestone/` 目录刚被彻底清空，这一步通过直接调用 `nsGetFile(entryNSFID)` 也能形成完整闭环，把该版本的所有子文件索引一次性补齐。

### 第三步：扫描本地未展开的种子与刷新 `latest.json`

* 如果调用方没传 `contextEntryNSFIDs`（或当前正在查找的就是 `entryNSFID` 本身）：
  1. 先扫描本地 `.nodestone/torrents/` 目录，把已经下载到本地、但在 `torrents_state` 中尚未标记 `is_expanded == 1` 的 `.torrent` 文件补跑一次 `file tree` 展开。
  2. 如果还是未命中，且距离上次拉取 `latest.json` 已经超过冷却间隔（例如 60 秒，或本地 `nsci_cache` 为空），就从 `provider.urls` 重新拉取一次最新 `revision` 的 `latest.json` 更新 `nsci_cache` 入口映射（应对 Mojang 刚刚发布新版本或 `.nodestone/` 刚被清空的场景）。

### 第四步：明确报错并由上层决定是否回退直连

如果走完前三步还是查不到（比如启动器传入了一个根本不在官方源里的第三方文件 URL），不要静默吞掉错误，应当向上层抛出带有 `(orig_url, nsfid, local_revision)` 的未命中异常，由启动器记录告警日志，并由启动器决定是中止任务还是回退到普通的 HTTPS 直连下载。

## 4. WebSeed 推荐实现（复用 BT 引擎原生调度与 BEP-52 校验）

在标准 BEP-19（HTTP/FTP Seeding）规范中，BT 引擎请求多文件种子的 WebSeed 时，会自动将末尾带 `/` 的 `url-list`、种子名 `info["name"]` 和文件树内相对路径 `rel_path` 拼接为：
`<url-list><info.name>/<rel_path>`

而在 NCP 种子中，`rel_path` 第一级目录固定为官方源主机名（如 `libraries.minecraft.net/com/mojang/...` 或 `piston-data.mojang.com/v1/...`）。如果直接在顶层 `url-list` 填入 `"https://"`，原生 BT 引擎会把 `info["name"]`（如 `minecraft-version-1.21.4`）拼到域名位置导致 DNS 解析失败。

为了**完全免去 SDK 手写 HTTP 分块 Range 请求与 BEP-52 Merkle Tree 哈希校验的复杂度**，同时 100% 复用底层 BT 引擎现成的 P2P/WebSeed 混合调度、Merkle 校验与即时做种能力，推荐客户端根据自身技术栈从以下两种实现方案中任选其一：

### 实现方案 C-1：SDK 本地极简 HTTP 307 路由代理（零 BT 引擎源码修改，通用推荐）

适用于直接引入现成第三方 BT 库（如预编译的 `libtorrent-rasterbar`、Rust `rqbit`、Go `anacrolix/torrent` 等）而不希望修改 BT 引擎源码的客户端：

1. **挂载带 `<torrenthash>` 与末尾斜杠的本地环回 WebSeed**：
   SDK 在本地环回地址启动一个极轻量的 HTTP/1.1 路由服务，在挂载 `.torrent` 时先清空种子可能携带的 `url-list`，再调用 BT 引擎 API 将 **`http://127.0.0.1:<port>/webseed/<torrenthash>/`**（**注意末尾必须带 `/`**，确保根据 BEP-19 规范无论是单文件还是多文件种子均在末尾追加路径）注册为该种子的标准 BEP-19 WebSeed（例如 `torrent_handle.add_url_seed(...)`）。
2. **剥离 `/<info.name>/` 并返回 `307 Temporary Redirect`**：
   当 BT 引擎判定某个文件或分块需要通过 WebSeed 下载时，会按照标准 BEP-19 向本地端口发起 `GET` 或 `HEAD` 请求（自动携带 `Range: bytes=<start>-<end>` 头）：
   `GET /webseed/<torrenthash>/<info.name>/<rel_path>`
   本地路由服务收到请求后**无需代理转发文件流**，只需：
   * 根据 `<torrenthash>` 查找该种子的 `ns-schemes`（默认 `"https://"`）；
   * 剥离前缀 `/webseed/<torrenthash>/<info.name>/` 提取出 `<rel_path>`，先对路径做 `unquote` 解码再按 RFC 3986 重新编码各路径段（保留第一级 `<host>[:<port>]`），拼上协议头得到官方真实直链 `orig_url`（或按需在此处通过前缀替换表映射至兼容的镜像源 URL）；
   * 立即返回 **HTTP `307 Temporary Redirect`**（严格保持原请求方法 `GET`/`HEAD` 与 `Range` 头不变）：
     `Location: https://<rel_path>`
3. **BT 引擎自动跟随重定向并完成 Merkle 校验**：
   BT 引擎内置的 WebSeed 客户端会自动携带原 `Range` 头跟随 307 重定向至 Mojang 官方 CDN 拉取数据块，并在引擎内部自动完成 BEP-52 的 `pieces root` / `piece layers` Merkle 树校验、落盘及向其他 Peer 广播做种。

```python
from http.server import BaseHTTPRequestHandler
from urllib.parse import unquote, quote

class NcpWebSeedRedirectHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    # torrent_schemes_map: dict[torrenthash, list[str]]，记录各挂载种子的 ns-schemes
    torrent_schemes_map = {}

    def _handle_redirect(self):
        # 请求路径格式: /webseed/<torrenthash>/<info.name>/<host>/<path...>
        path_only = self.path.split("?", 1)[0]
        parts = path_only.lstrip("/").split("/", 3)
        if len(parts) < 4 or parts[0] != "webseed":
            self.send_error(404, "Invalid NCP WebSeed path")
            return

        _, torrenthash, _info_name, raw_rel_path = parts
        schemes = self.torrent_schemes_map.get(torrenthash) or ["https://"]
        raw_scheme = schemes[0].strip().lower().rstrip(":/")
        scheme = f"{raw_scheme}://" if raw_scheme in ("http", "https") else "https://"

        # 将 BT 引擎发来的路径解码后按 RFC 3986 规范化编码，防止二次转义或特殊字符失配
        rel_segments = [unquote(seg) for seg in raw_rel_path.split("/")]
        host_port = rel_segments[0].strip().lower()
        encoded_path = "/".join(quote(seg, safe="-._~") for seg in rel_segments[1:])
        target_url = f"{scheme}{host_port}/{encoded_path}"

        self.send_response(307)
        self.send_header("Location", target_url)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self._handle_redirect()

    def do_HEAD(self):
        self._handle_redirect()
```

### 实现方案 C-2：BT 引擎 URL 拼接层微补丁（适合自编译 BT 引擎的官方/原生 SDK）

适用于自行编译维护底层 BT 引擎（如自编译 C++ `libtorrent-rasterbar` 或定制 Rust BT 引擎）的 SDK：

1. **识别 NCP 种子标志**：
   在 BT 引擎加载种子元数据时，检查 `info["ns-schemes"]`（或顶层 `ns-schemes`）字段是否存在（例如 `["https://"]`）。
2. **跳过 `info["name"]` 直接拼接 `scheme + rel_path`**：
   在 BT 引擎构造 BEP-19 多文件 WebSeed 请求 URL 的函数处（例如 `libtorrent::web_peer_connection` 的 URL 组装逻辑），增加分支判断：当种子开启了 NCP WebSeed 模式时，**不再拼接 `info["name"]` 目录层级**，而是直接取 `ns-schemes[0]`（如 `"https://"`）与文件在 `info["file tree"]` 中经 RFC 3986 路径段编码后的相对路径 `rel_path`（即 `<host>/<path>`）拼接为完整目标 URL。
3. **原生直连跨域名官方源**：
   补丁生效后，即便同一个多文件种子内同时包含 `piston-data.mojang.com`、`libraries.minecraft.net` 和 `resources.download.minecraft.net` 的文件，BT 引擎内置的 WebSeed 调度器也能直接向对应的官方域名发起 HTTPS `GET` / `Range` 请求并自动完成 BEP-52 Merkle 校验。

## 5. 本地缓存管理与清理设计

在 NCP v0.9.0 中，得益于两项核心设计：
1. **可变清单现场直出**：`version_manifest_v2.json` 等高频变化单文件强制使用 `delivery.integrated.type = "raw_file"` 直出，不在 `.nodestone/` 下生成种子或留存历史缓存副本；
2. **版本种子 100% 不可变且单种子仅约 300 KB**：所有生成 `.torrent` 的资源均为已发布的不可变版本全量包（`minecraft-version-<ver>`）。即便只下载或保留全部正式版的 `.torrent` 种子文件，总元数据体积也仅约 20 MB，相对于游戏本体可谓九牛一毛；且不同版本间的公共 `libraries` 和 `assets` 指向任意一个包含它的已展开种子均可正常下载（串包亦完全符合协议预期）。

因此，客户端**无需维护复杂的三表外键级联或引用计数机制**，只需采用极简的 `nsci_cache` 单主键 Upsert 表配合 `torrents_state` 状态表即可。

### 1. 数据库表结构与 Upsert 规范

建议使用 SQLite（存放在 `.nodestone/cache/nsci.db`）持久化本地缓存，连接时建议开启 `PRAGMA journal_mode = WAL;` 与 `PRAGMA busy_timeout = 5000;` 以提升并发读写稳定性：

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

-- 1. 客户端全局元数据表（记录 local_revision、last_fetched_at 等状态）
CREATE TABLE IF NOT EXISTS meta_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 2. 本地种子展开状态表（记录每个 torrenthash 的 file tree 是否已展开完成）
CREATE TABLE IF NOT EXISTS torrents_state (
    torrenthash TEXT PRIMARY KEY,
    is_expanded INTEGER NOT NULL DEFAULT 0, -- 0: 未展开, 1: file tree 已完整展开至 nsci_cache
    updated_at INTEGER NOT NULL
);

-- 3. NSCI 核心映射缓存表（单主键 Upsert，重复即覆盖）
CREATE TABLE IF NOT EXISTS nsci_cache (
    nsfid TEXT PRIMARY KEY,
    torrenthash TEXT NOT NULL,
    rel_path TEXT,
    orig_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_nsci_torrenthash ON nsci_cache(torrenthash);
```

* **刷新 `latest.json`（同步 `nsci.raw_kv`）时**：
  在同一事务中更新 `meta_state` 的 `local_revision` 并 Upsert `nsci_cache`（使用 `ON CONFLICT(nsfid) DO UPDATE` 仅更新 `torrenthash`，从而保留已展开的 `<version>.json` 原本的 `rel_path` 与 `orig_url`）：
  ```sql
  INSERT INTO nsci_cache (nsfid, torrenthash)
  VALUES (?, ?)
  ON CONFLICT(nsfid) DO UPDATE SET
      torrenthash = excluded.torrenthash;
  ```
* **展开种子 `info["file tree"]` 时**：
  将展开出的 `(nsfid, torrenthash, rel_path, orig_url)` 与 `torrents_state.is_expanded = 1` 在同一个数据库事务中原子提交：

```python
import base64
import time
from urllib.parse import quote

def expand_filetree_to_db(torrent: dict, torrenthash: str, db_conn):
    info = torrent["info"]
    path_segments_list = parse_btv2_file_tree_segments(info["file tree"])
    schemes = info.get("ns-schemes") or torrent.get("ns-schemes") or ["https://"]
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
            (torrenthash, now_ts)
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
            records
        )
```

### 2. 本地种子的常驻做种与按需重置

1. **推荐常驻保留已获取的 `.torrent` 种子**：
   由于每个正式版 `.torrent` 种子体积很小且永久不可变，推荐客户端默认常驻保留 `.nodestone/torrents/<torrenthash>.torrent` 及 `nsci_cache` 中的展开记录。这样不仅能让任何指向该种子的公共文件随时秒级命中，还能最大化 P2P 做种覆盖面。
2. **清理或重置缓存时的注意事项**：
   * 若客户端需要停止某个旧版本种子的后台做种任务以释放内存或句柄，**只需从 BT 引擎中移除该 `torrent_handle` 即可，必须保留磁盘上的 `.torrent` 文件与 `nsci_cache` 数据库记录**（因为其他版本的公共 `libraries` / `assets` 在 `nsci_cache` 中可能正指向该 `torrenthash`；保留 `.torrent` 文件即可在下次请求公共文件时直接从本地挂载种子并按需下载该单文件）。
   * **禁止单独删除单个 `.torrent` 文件或单条 `torrents_state` 记录**：若用户主动执行「清空缓存」，应整体清空 `.nodestone/torrents/` 目录并重置 `nsci.db`（`nsci_cache` 与 `torrents_state`），切勿只删磁盘 `.torrent` 文件而留存 `nsci_cache` 中的悬空指针。
