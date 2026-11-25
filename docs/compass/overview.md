---
title: "协议总览与最小实现"
sidebar_position: 1
description: "NCP 的术语、整体流程、NSFID 编码与最小可用实现。"
---

## 1. 快速概览（Quick overview）

* **NodeStone Compass Protocol (NCP)**：一套开放的资源分发协议，支持通用静态资源的索引与分发。
* **NodeStone Compass 服务**：NodeStone 官方基于该协议维护的元数据源，提供 Minecraft 本体、ModLoader 及 Mod 的下载索引。
* **NodeStone BT**：基于 **BitTorrent v2（BEP-52）** 的分发机制。
* **NodeStone SDK**：官方提供的开发包，供第三方启动器接入。

**核心术语：**

* **NSCL**（NodeStone Compass List）：元数据清单文件（`latest.json`），体积约 20 KB，包含入口索引映射与种子/直出文件获取方式。
* **NSCI**（NodeStone Compass Index）：`NSFID -> Target Hash` 的映射表。
* **NSFID**（NodeStone File ID）：文件唯一标识，分为 `url:<Base64>`（当前启用）和 `sha256:<Hex>`（未来预留）两种格式。

### 工作流程

启动器先从 NodeStone 官方源或镜像源下载 `latest.json`（约 20 KB），校验 minisign 签名和 `revision` 版本号后，清理本地缓存中已不在 `latest.assets.torrents` 里的旧种子记录，再将 `nsci.raw_kv` 映射写入本地 NSCI 缓存。

打包 Minecraft 资源时，服务端采用以下划分方式：

* **顶层版本清单（如 `version_manifest_v2.json`）**：采用 `delivery.integrated` 的 `raw_file` 模式内嵌直出，不生成 `.torrent` 种子。客户端在请求时直接从 `latest.json` 解码并校验 SHA-256 后交付。
* **大版本全量包（如 `minecraft-1.20-full`、`minecraft-1.21-full`）**：按大版本将该系列所有小版本的 `<version>.json`、`<asset_index>.json`、`client.jar`、`libraries` 以及关联的 `assets/objects` 全部打包到一个 BitTorrent v2 种子中。
* **种子可变与滚动更新**：对于仍在更新的大版本（例如 `1.21-full` 已包含 `1.21.1` 和 `1.21.2`，随后 Mojang 发布了 `1.21.3`），服务端会重新打包 `1.21-full` 种子并更新 `latest.json`。客户端拉取新 `latest.json` 时，只要把本地缓存中不在 `latest.assets.torrents` 里的旧 `torrenthash` 删除即可。
* **前置拉取版本 Manifest 约定**：`latest.json` 的 `nsci.raw_kv` 仅收录 `version_manifest_v2.json`、各版本 `<version>.json` 及 `<asset_index>.json` 的 `NSFID -> Hash`。启动器在下载任意游戏版本的具体文件前，**必须先通过 SDK 请求一次该版本的 `<version>.json`（及 `<asset_index>.json`）**，由 SDK 自动拉取对应的大版本种子并将 `info["file tree"]` 中的子文件映射展开到本地缓存。

```
预配置 (provider.urls / namespace / minisign_keys / version_manifest 的 NSFID)
 │
 ▼ 1. 拉取并校验 latest.json + minisign + revision
NSCL (latest.json)
 ├─ nsci.raw_kv     : NSFID -> Hash (64-hex BT v2 InfoHash 或 raw_file 的 SHA-256)
 └─ assets.torrents : Hash -> delivery (integrated / url / magnetic)
 │
 ▼ 2. 删除本地缓存中不在 assets.torrents 里的旧 Hash，再合并 nsci.raw_kv
本地 NSCI 缓存 (NSFID -> Target Hash)
 │
 ├─► 请求 version_manifest_v2.json (命中 raw_file)
 │    └─ 从 latest.json Base64 解码并校验 SHA-256，直接返回 DirectFile(local_path)
 │
 └─► 下载某个版本前，强制先请求该版本的 <version>.json / <asset_index>.json (命中大版本种子)
      └─ 首次拿到种子 (.nodestone/torrents/<torrenthash>.torrent) 后展开 file tree：
         提取 info.file tree 与 info.ns-schemes -> 拼出官方 URL -> Base64 编码为 NSFID
         批量写入本地 NSCI 缓存，后续请求 client.jar、libraries、assets 直接命中该种子
```

## 2. 最小实现（Minimal implementation）

### 1. 预配置常量

* `provider.namespace`（string）：命名空间（例如 Minecraft 本体为 `minecraft`）。
* `provider.urls`（list/string）：NSCL 文件的 HTTP(S) 源地址列表。
* `provider.minisign_keys`（list/string）：minisign 公钥列表（例如 `RWSDsxUzF3dwx5sVM6sxlIE1S2HzTJtaOtEOSKQiX6ArWc7u3hcDcaTk`）。

### 2. NodeStone File ID（NSFID）的格式

URL 类型的 NSFID 在编码前须遵循 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）** 进行语法规范化，随后按 **RFC 4648** 进行标准 Base64 编码（UTF-8 字节流，保留末尾 `=` 填充，不换行）：

* **格式 1（当前启用）**：`url:<Base64(规范化后的官方源完整原始 URL)>`
  * 例如 `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` 编码后为：
    `url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u`
* **格式 2（未来预留，v0.10.0 暂不启用）**：`sha256:<此文件的 64 位小写十六进制 SHA-256 值>`

### 3. 获取与校验索引

1. **下载清单**：从 `<provider.urls[i]>/v010/<provider.namespace>/latest.json` 下载清单文件，并下载同路径下的签名文件 `latest.json.minisig`。
2. **签名校验**：使用预配置的 `provider.minisign_keys` 校验 `latest.json` 文件签名，并核对签名中的 `trusted comment` 包含 `<provider.namespace>`；校验失败则切换下一个源。
3. **字段校验**：将 JSON 解析为 `latest`，检查以下三项：
   * `filetype` 为 `"nscl/v0.10"`。
   * `namespace` 与 `<provider.namespace>` 一致。
   * `revision` 大于或等于本地已缓存的 `revision`。
4. **淘汰过期种子并更新本地缓存**：
   * 对比本地缓存中的 `torrenthash` 与 `latest.assets.torrents` 的 Key 集合，将不在 `latest.assets.torrents` 中的 `torrenthash` 及其关联记录从本地缓存表中全部删除（磁盘上的旧 `.torrent` 文件可异步清理）。
   * 读取 `latest.nsci.raw_kv`，将 `NSFID -> Hash` 键值对写入本地 NSCI 缓存（重复 Key 即更新 `torrenthash`）。

### 4. 从种子 `file tree` 还原 URL 与 WebSeed 下载

BitTorrent v2 种子的 InfoHash 是 `info` 字典的 SHA-256 值（64 位小写十六进制字符串），目录结构保存在 `info["file tree"]` 中。

在 NCP 种子中：
* **`info["file tree"]` 目录结构**：第一级目录固定为官方源主机名（`<host>[:<port>]`，小写且不含默认端口），后续各级目录与文件名为**百分号解码（Unescaped）后的原始 UTF-8 字符串**。
  > 注：不能将整个 URL 或文件名预先做百分号编码后作为扁平文件名存入种子，因为 BT 客户端发起 BEP-19 WebSeed 请求时会自动对文件路径执行一次 URL 路径转义（如 `libtorrent` 的 `escape_path`），预先编码会导致 `%` 被二次转义为 `%25`。
* **`info["ns-schemes"]`**：官方源协议头列表（缺省为 `["https://"]`）。
* **`info["ns-mirrors"]`**（可选）：第三方镜像源（如 BMCLAPI）的主机名替换映射表，格式为 `{ "<host>[:<port>]": ["<mirror_base_url>", ...] }`。

1. **还原官方 URL 与生成 NSFID**：
   设文件在 `info["file tree"]` 中的路径段列表为 `[host_port, seg_1, seg_2, ...]`：
   * 相对路径 `rel_path` 为各级原始名称用 `/` 拼接（如 `libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`）。
   * 读取协议列表 `schemes = torrent["info"].get("ns-schemes") or ["https://"]`。
   * 对除第一级 `host_port` 外的路径段按 RFC 3986 进行百分号编码，与 `scheme` 和 `host_port` 拼接得到官方源 `orig_url`。
   * 对 `orig_url` 进行 Base64 编码得到 `url:<Base64>` 格式的 `NSFID`，写入本地 NSCI 缓存：`NSFID -> (torrenthash, rel_path, orig_url)`。
2. **WebSeed 下载（普通 BT 客户端与 NodeStone SDK）**：
   * **普通 BT 客户端（Mojang 官方源 WebSeed）**：标准 BEP-19 客户端对多文件种子的拼接规则为 `<url-list><info.name>/<rel_path>`。当种子为单域名且以首层目录作为 `info["name"]`（或顶层 `url-list` 指向将 `/<info.name>/<host>/<path>` 307 重定向至 `https://<host>/<path>` 的无状态网关）时，普通 BT 客户端无需修改即可直接从 Mojang 官方源进行 WebSeed 下载。
   * **NodeStone SDK（修改 BT 引擎 WebSeed 拼接层，同时支持 Mojang 与 BMCLAPI）**：在 `libtorrent` 等 BT 引擎的 WebSeed URL 构造处增加分支（详见《客户端推荐实现》第 4 节）：当检测到 `info["ns-schemes"]` 时，跳过 `info["name"]`，直接用 `ns-schemes` 拼接 `https://<host>/<encoded_path>` 作为官方源 WebSeed；同时读取 `info["ns-mirrors"]`，将第一级 `<host>` 替换为对应的镜像源前缀（如 BMCLAPI 的 `https://bmclapi2.bangbang93.com/maven` 或 `/assets`），作为额外 WebSeed 并发或回退下载。

```python
import base64
from urllib.parse import quote

def expand_filetree_to_nsci(torrent: dict, torrenthash: str, nsci_cache: dict):
    info = torrent["info"]
    # parse_btv2_file_tree_segments 返回形如 [["libraries.minecraft.net", "com", "mojang", ...], ...] 的路径段列表
    path_segments_list = parse_btv2_file_tree_segments(info["file tree"])
    schemes = info.get("ns-schemes") or ["https://"]
    if isinstance(schemes, str):
        schemes = [schemes]

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
            nsci_cache[nsfid] = (torrenthash, rel_path, orig_url)
```

### 5. 核心方法定义

`nsGetTorrent` 的返回值区分为以下两种联合类型（Tagged Union / Enum）：

* `DeliveryResult::Torrent(torrent_meta)`：目标为标准 BT v2 种子，返回已完成校验并展开 `file tree` 的种子元数据对象。
* `DeliveryResult::DirectFile(local_path)`：目标为 `integrated.type == "raw_file"` 的内嵌单文件，返回解码并校验 SHA-256 后的文件落盘路径。

**方法定义：**

* `nsGetTorrent(latest, torrenthash, target_path=None) -> DeliveryResult`：获取种子文件或提取内嵌直出单文件。
  1. 检查本地 `.nodestone/torrents/<torrenthash>.torrent`，若文件存在、InfoHash v2 校验通过且已在本地 `torrents_state` 表中标记 `is_expanded == 1`，直接返回 `DeliveryResult::Torrent(torrent_meta)`。
  2. 若本地没有该 `.torrent`（或目标为 `raw_file`），按顺序检查 `latest.assets.torrents[torrenthash].delivery`（若内存中尚无 `latest` 或未找到该 `torrenthash`，先拉取一次最新 `latest.json` 更新本地缓存）：
     * `delivery.integrated`：
       * 当 `integrated.type` 为 `"torrent"`（或未填）时：Base64 解码 `integrated.payload` 得到 `.torrent` 内容，校验 InfoHash v2 等于 `torrenthash` 后保存到 `.nodestone/torrents/<torrenthash>.torrent`，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
       * 当 `integrated.type` 为 `"raw_file"` 时（仅用于无下游子文件依赖的独立单文件，如 `version_manifest_v2.json`）：对 `integrated.payload` 进行 Base64 解码得到文件内容，校验文件整体 SHA-256 等于 `torrenthash` 后写入 `target_path`（或临时路径），返回 `DeliveryResult::DirectFile(local_path)`。
     * `delivery.url`：通过 HTTP(S)/FTP 下载 `.torrent` 文件，校验 InfoHash v2 后保存到 `.nodestone/torrents/<torrenthash>.torrent`，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
     * `delivery.magnetic`：通过磁力链接（`xt=urn:btmh:1220<torrenthash>&tr=...`）拉取种子并校验，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。支持该字段的客户端需启用 BEP-5 (DHT)、BEP-11 (PEX)、BEP-14 (LSD) 并实现 BEP-52 的 `hash request` / `hashes` 消息以拉取 `piece layers`。
  3. **首次获取到 `Torrent` 类型种子时**，按第 4 节规则遍历 `info["file tree"]` 还原出 `orig_url` 和 `NSFID`，与 `torrents_state.is_expanded = 1` 在同一数据库事务内写入本地缓存后再返回 `DeliveryResult::Torrent(torrent_meta)`。

* `nsGetFile(aNSFID, target_path=None) -> LocalFilePath`：获取单个文件。
  1. 对输入的 URL 按第 2 节规范化后生成 `aNSFID`，在本地 `nsci_cache` 中查找对应的 `(torrenthash, rel_path, orig_url)`。若未查到，按《客户端推荐实现》第 3 节刷新 `latest.json` 后重查。
  2. 调用 `res = nsGetTorrent(latest, torrenthash, target_path=target_path)`：
     * 若 `res` 为 `DeliveryResult::DirectFile(local_path)`，直接返回 `local_path`。
     * 若 `res` 为 `DeliveryResult::Torrent(torrent_meta)`，进入步骤 3。
  3. 从 `nsci_cache` 取出 `aNSFID` 对应的 `rel_path`（若 `aNSFID` 是首次请求的 `<version>.json` 入口文件，步骤 2 展开种子后 `rel_path` 已写入 `nsci_cache`），交由 BT 引擎通过 P2P 及 WebSeed 下载对应文件，完成后返回本地路径。
