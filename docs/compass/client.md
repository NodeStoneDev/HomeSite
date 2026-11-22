---
title: "客户端推荐实现"
sidebar_position: 3
description: "批量下载调度、缓存未命中自愈、WebSeed 桥接与本地缓存清理。"
---

本文档在《概览与最小实现》的基础上，说明实际工程接入时推荐的批量下载调度、缓存未命中自愈流程、WebSeed 桥接实现以及本地缓存清理策略。

## 1. 三条基本原则

1. **本地缓存存的必须是真实的 `NSFID -> hash` 映射**：不管是来自 `latest.json` 的入口记录，还是从种子 `file tree` 展开出来的子文件记录，Key 都必须是符合规范的 `url:<Base64>`（或未来启用的 `sha256:<Hex>`），Value 为 64 位小写十六进制哈希。注意：第三方启动器向 NCP SDK 传入 URL 时，必须传入**未经过第三方镜像源（如 BMCLAPI）替换的 Mojang/官方源原始 URL**。
2. **种子落盘与 `file tree` 展开必须视为同一事务**：首次下载某个 `.torrent` 文件并落盘时，必须同步把它的 `file tree` 展开写入本地持久化 NSCI 缓存数据库，两边都成功才算种子获取完成。（注：客户端需自行实现本地状态元数据表以持久化 `local_revision`、`last_fetched_at` 以及每个 `torrenthash` 的 `file tree` 展开完成事务标志位）。
3. **正常流程下 `nsGetFile` / `nsGetFilesBatch` 不会在本地 NSCI 未命中**：按照协议流程，请求任何子文件前，必定已经拉过 `latest.json` 并加载过对应的版本入口种子（`<version>.json` 或 `<asset_index>.json`），里面的子文件一定已经展开进了本地缓存。一旦出现未命中，说明前置流程被跳过或本地缓存状态不一致，不能静默忽略。

## 2. 批量获取优化（`nsGetFilesBatch`）

启动器解析完 `<version>.json` 和 `<asset_index>.json` 后，通常要一次性下载成百上千个 `libraries` 和 `assets` 小文件。如果逐个调用 `nsGetFile` 会产生大量重复查库和调度开销，推荐优先实现并使用批量接口 `nsGetFilesBatch(nsfidList, contextEntryNSFIDs=None)`：

1. **批量查库**：一次性在本地 NSCI 缓存中查询 `nsfidList` 中所有项的 `(torrenthash, rel_path, orig_url)`。如果有任何一个 NSFID 未命中，先执行第 3 节的自愈流程；自愈后仍有未命中项则中止并报错。
2. **按目标哈希分组**：把命中的请求按 `torrenthash` 聚合为 `Map<torrenthash, List<(NSFID, rel_path, orig_url)>>`。
3. **按组批量获取与提交下载**：对每个去重后的 `torrenthash` 调用一次 `nsGetTorrent(latest, torrenthash)`：
   * 若返回 `DeliveryResult::DirectFile(local_path)`（仅针对 `raw_file` 独立单文件），直接将该组内 `NSFID` 映射至 `local_path`。
   * 若返回 `DeliveryResult::Torrent(torrent_meta)`（通常在前一步下载 `<version>.json` 和 `<asset_index>.json` 时种子就已经在本地了），把该组内的目标文件列表一次性提交给 BT 引擎设置文件优先级，并配合第 4 节的 WebSeed 机制并发或按需回退拉取。
4. **交付结果**：全部完成后返回 `Map<NSFID, LocalFilePath>`，或者通过完成回调每下完一个文件通知一次上层启动器。

## 3. 缓存未命中的排查与四步自愈

实际接入时，很多第三方启动器自己带有本地文件缓存（比如 `.minecraft/versions/<ver>/<ver>.json` 或 `assets/indexes/<id>.json` 已经在硬盘上了）。如果用户删过 `.nodestone/` 目录、旧启动器中途刚接入 NCP SDK，或者上次展开种子时意外退出，启动器就会跳过下载 `<version>.json` 和 `<asset_index>.json`，直接读本地已有的 JSON 去调 `nsGetFile` / `nsGetFilesBatch` 请求里面的 `libraries` 和 `assets`，导致本地 NSCI 缓存查不到记录。

遇到未命中时，客户端推荐按顺序执行以下四步自愈：

### 第一步：URL 规范化重算

把未命中的 `url:<Base64>` 解码回原始 URL，严格按照 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）** 检查是否存在协议或域名大写、带了默认端口（`:80` / `:443`）、百分号编码十六进制大小写不一致（应统一为大写 `%XX`）、非保留字符被多余转义或路径存在 `/./`、`/../` 的问题。规范化后重新编码出 `NSFID`，再查一次本地 NSCI 缓存。

### 第二步：按上下文入口（`contextEntryNSFIDs`）补拉入口种子并展开

启动器在调用 `nsGetFile(aNSFID, contextEntryNSFIDs)` 或 `nsGetFilesBatch(nsfidList, contextEntryNSFIDs)` 下载某个版本的依赖文件时，推荐在 `contextEntryNSFIDs` 参数里带上当前任务的入口文件 NSFID（也就是当前版本 `<version>.json` 和 `<asset_index>.json` 的 NSFID）。

当子文件未命中时，SDK 先检查 `contextEntryNSFIDs` 里的入口种子是否已经在本地展开过；如果没有，直接调 `nsGetTorrent` 把对应的版本核心种子和大版本 Assets 种子拉下来并执行 `file tree` 展开。只要传入了 `contextEntryNSFIDs`，哪怕 `.nodestone/` 目录刚被彻底清空，这一步也能直接把所有子文件索引补齐。

### 第三步：扫描本地未展开的种子与刷新 `latest.json`

* 如果调用方没传 `contextEntryNSFIDs`，先扫描本地 `.nodestone/torrents/` 目录，把已经下载到本地、但还没在客户端本地状态表中标记完成展开的 `.torrent` 文件补跑一次 `file tree` 展开。
* 如果还是未命中，且距离上次拉取 `latest.json` 已经超过冷却间隔（例如 60 秒），就从 `provider.urls` 重新拉取一次最新 `revision` 的 `latest.json` 更新入口映射（应对 Mojang 刚刚发布新版本的场景），然后再重试一次第二步。

### 第四步：明确报错并由上层决定是否回退直连

如果走完前三步还是查不到（比如启动器传入了一个根本不在官方源里的第三方文件 URL），不要静默吞掉错误，应当向上层抛出带有 `(orig_url, nsfid, local_revision)` 的未命中异常，由启动器记录告警日志，并由启动器决定是中止任务还是回退到普通的 HTTPS 直连下载。

## 4. WebSeed 推荐实现（复用 BT 引擎原生调度与 BEP-52 校验）

在标准 BEP-19（HTTP/FTP Seeding）规范中，BT 引擎请求多文件种子的 WebSeed 时，会自动将 `url-list`、种子名 `info["name"]` 和文件树内相对路径 `rel_path` 拼接为：
`<url-list>/<info.name>/<rel_path>`

而在 NCP 种子中，`rel_path` 第一级目录固定为官方源主机名（如 `libraries.minecraft.net/com/mojang/...` 或 `piston-data.mojang.com/v1/...`）。如果直接在顶层 `url-list` 填入 `"https://"`，原生 BT 引擎会把 `info["name"]`（如 `minecraft-core-1.21.4`）拼到域名位置导致 DNS 解析失败。

为了**完全免去 SDK 手写 HTTP 分块 Range 请求与 BEP-52 Merkle Tree 哈希校验的复杂度**，同时 100% 复用底层 BT 引擎现成的 P2P/WebSeed 混合调度、Merkle 校验与即时做种能力，推荐客户端根据自身技术栈从以下两种实现方案中任选其一：

### 实现方案 C-1：SDK 本地极简 HTTP 302 路由代理（零 BT 引擎源码修改，通用推荐）

适用于直接引入现成第三方 BT 库（如预编译的 `libtorrent-rasterbar`、Rust `rqbit`、Go `anacrolix/torrent` 等）而不希望修改 BT 引擎源码的客户端：

1. **挂载本地环回 WebSeed**：
   SDK 在本地环回地址启动一个极轻量的 HTTP 路由服务（如 `http://127.0.0.1:<port>/webseed`），在挂载 `.torrent` 时先清空种子自带的 `url-list`，再调用 BT 引擎 API 将 `http://127.0.0.1:<port>/webseed` 注册为该种子的标准 BEP-19 WebSeed（例如 `torrent_handle.add_url_seed(...)`）。
2. **剥离 `/<info.name>/` 并返回 `302 Found`**：
   当 BT 引擎判定某个文件或分块需要通过 WebSeed 下载时，会按照标准 BEP-19 向本地端口发起请求（自动携带 `Range: bytes=<start>-<end>` 头）：
   `GET /webseed/<info.name>/<rel_path>`
   本地路由服务收到请求后**无需代理转发文件流**，只需剥离前缀 `/webseed/<info.name>/` 提取出 `<rel_path>`，拼上种子 `ns-schemes` 声明的协议头（默认 `"https://"`）得到官方真实直链 `orig_url`（或按需在此处通过前缀替换表映射至兼容的镜像源 URL），立即返回 **HTTP `302 Found`（或 `307 Temporary Redirect`）**：
   `Location: https://<rel_path>`
3. **BT 引擎自动跟随重定向并完成 Merkle 校验**：
   BT 引擎内置的 WebSeed 客户端会自动携带原 `Range` 头跟随 302 重定向至 Mojang 官方 CDN 拉取数据块，并在引擎内部自动完成 BEP-52 的 `pieces root` / `piece layers` Merkle 树校验、落盘及向其他 Peer 广播做种。

```python
from http.server import BaseHTTPRequestHandler, HTTPServer

class NcpWebSeedRedirectHandler(BaseHTTPRequestHandler):
    # 假设默认使用 https://，也可按 info.name 查找对应种子的 ns-schemes
    def do_GET(self):
        # 请求路径格式: /webseed/<info.name>/<host>/<path...>
        parts = self.path.lstrip("/").split("/", 2)
        if len(parts) < 3 or parts[0] != "webseed":
            self.send_error(404, "Invalid NCP WebSeed path")
            return
        _, _info_name, rel_path = parts
        target_url = f"https://{rel_path}"
        self.send_response(302)
        self.send_header("Location", target_url)
        self.send_header("Content-Length", "0")
        self.end_headers()
```

### 实现方案 C-2：BT 引擎 URL 拼接层微补丁（适合自编译 BT 引擎的官方/原生 SDK）

适用于自行编译维护底层 BT 引擎（如自编译 C++ `libtorrent-rasterbar` 或定制 Rust BT 引擎）的 SDK：

1. **识别 NCP 种子标志**：
   在 BT 引擎加载种子元数据时，检查种子顶层是否包含 `ns-schemes` 字段（例如 `["https://"]`）。
2. **跳过 `info["name"]` 直接拼接 `scheme + rel_path`**：
   在 BT 引擎构造 BEP-19 多文件 WebSeed 请求 URL 的函数处（例如 `libtorrent::web_peer_connection` 的 URL 组装逻辑），增加约 5 行分支判断：当种子开启了 NCP WebSeed 模式时，**不再拼接 `info["name"]` 目录层级**，而是直接取 `ns-schemes[0]`（如 `"https://"`）与文件在 `info["file tree"]` 中的相对路径 `rel_path`（即 `<host>/<path>`）拼接为完整目标 URL。
3. **原生直连跨域名官方源**：
   补丁生效后，即便同一个多文件种子内同时包含 `piston-data.mojang.com` 和 `libraries.minecraft.net` 的文件，BT 引擎内置的 WebSeed 调度器也能直接向对应的官方域名发起 HTTPS `GET` / `Range` 请求并自动完成 BEP-52 Merkle 校验。

## 5. 本地缓存管理与清理建议

在 NCP v0.8.0 中，服务端遵循《服务端推荐实现》的规范：**高频变化的顶层清单（如 `version_manifest_v2.json`）强制使用 `delivery.integrated.type = "raw_file"` 直出，绝不生成 `.torrent` 种子；所有生成 `.torrent` 种子的资源（版本核心包与大版本 Assets 包）均为不可变历史版本资源**。

这一架构设计带来了显著的客户端简化：**客户端无需维护复杂的「`entry` vs `derived` 引用计数归零清理机制」**——因为可变清单不产生 `.torrent` 文件和派生的 `file tree` 子记录，而不可变种子的入口即使未来从 `latest.json` 归档移出，也不影响本地已展开的缓存。

### 1. 持久化表结构与 Upsert 规范

建议使用轻量级本地数据库（如 SQLite，存放在 `.nodestone/cache/nsci.db`）持久化 NSCI 缓存。`nsci_cache` 表以 `nsfid` 作为主键（`PRIMARY KEY`），保存 `(nsfid, torrenthash, rel_path, orig_url)` 四个核心字段（注意：客户端还需自行维护本地状态元数据表以记录 `local_revision` 与每个 `torrenthash` 的展开完成事务标志位）：

```sql
CREATE TABLE IF NOT EXISTS nsci_cache (
    nsfid TEXT PRIMARY KEY,
    torrenthash TEXT NOT NULL,
    rel_path TEXT,
    orig_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_nsci_torrenthash ON nsci_cache(torrenthash);
```

* **写入 `latest.json` 的 `nsci.raw_kv` 时**：
  使用 `ON CONFLICT(nsfid) DO UPDATE` 更新 `torrenthash`，同时保留已有的 `rel_path` 和 `orig_url`（避免已展开的 `<version>.json` 在刷新 `latest.json` 时丢失 `rel_path`）：
  ```sql
  INSERT INTO nsci_cache (nsfid, torrenthash)
  VALUES (?, ?)
  ON CONFLICT(nsfid) DO UPDATE SET
      torrenthash = excluded.torrenthash;
  ```
* **展开种子 `info["file tree"]` 时**：
  将展开出的 `(nsfid, torrenthash, rel_path, orig_url)` 批量写入 `nsci_cache`：

```python
import base64

def expand_filetree_to_db(torrent: dict, torrenthash: str, db_conn):
    file_entries = parse_btv2_file_tree(torrent["info"]["file tree"])
    schemes = torrent.get("ns-schemes") or ["https://"]
    if isinstance(schemes, str):
        schemes = [schemes]

    records = []
    for rel_path in file_entries:
        for raw_scheme in schemes:
            clean = raw_scheme.strip().lower().rstrip(":/")
            scheme = f"{clean}://" if clean in ("http", "https") else "https://"
            orig_url = f"{scheme}{rel_path}"
            b64 = base64.b64encode(orig_url.encode("utf-8")).decode("ascii")
            nsfid = f"url:{b64}"
            records.append((nsfid, torrenthash, rel_path, orig_url))

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
    # 提醒：应在同一个数据库事务中将 torrenthash 标记为 is_expanded = 1 后再 commit
    db_conn.commit()
```

### 2. 本地缓存的按需与 LRU 清理

* **可变直出单文件（`raw_file`）**：如 `version_manifest_v2.json`，每次 `latest.json` 更新时，`nsci_cache` 中该 `NSFID` 对应的 `torrenthash`（即文件 SHA-256）会被原地覆盖；若本地在 `.nodestone/` 下缓存了旧版 `raw_file` 临时副本，直接覆写或删除旧副本即可。
* **不可变版本种子（`.torrent`）**：各个已发布版本的种子（版本核心种子与大版本 Assets 种子）默认随版本文件保留做种。如果用户需要控制磁盘占用，客户端可以按 **LRU（最近最少使用）策略**，或者对照启动器本地已安装的版本列表，定期清理超过指定天数未使用的旧版本做种任务、`.nodestone/torrents/<torrenthash>.torrent` 文件及 `nsci_cache` 中对应 `torrenthash` 的缓存记录（`.minecraft` 目录下的游戏本体文件仍由启动器自己管理，不受影响）。
