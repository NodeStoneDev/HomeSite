---
title: "协议总览与最小实现"
sidebar_position: 1
description: "NCP 的术语、整体流程、NSFID 编码与最小可用实现。"
---

## 1. 快速概览（Quick overview）

* **NodeStone Compass Protocol (NCP)**：一套开放的资源分发协议，设计上支持任意资源的分发。
* **NodeStone Compass 服务**：NodeStone 官方基于该协议维护的元数据源，提供 Minecraft 本体、ModLoader 及 Mod 的下载索引。
* **NodeStone BT**：基于 **BitTorrent v2（BEP-52）** 的分发机制。
* **NodeStone SDK**：官方提供的开发包，方便第三方启动器接入。

**核心术语：**

* **NSCL**（NodeStone Compass List）：元数据清单文件（`latest.json`），体积约 20 KB，包含入口索引映射与种子/直出文件获取方式。
* **NSCI**（NodeStone Compass Index）：`NSFID -> Target Hash` 的核心映射表。
* **NSFID**（NodeStone File ID）：文件唯一标识，分为 `url:<Base64>`（当前启用）和 `sha256:<Hex>`（未来预留）两种格式。

### 工作流程

启动器先从 NodeStone 官方源或镜像源下载 `latest.json`（约 20 KB），校验 minisign 签名和 `revision` 版本号后，把里面的 `nsci.raw_kv` 映射写入本地 NSCI 缓存（重复 Key 即覆盖）。

打包 MC 资源时，服务端遵循**「可变清单现场直出、不可变版本分包做种」**的原则：

* **高频变化的顶层清单（如 `version_manifest_v2.json`）**：强制采用 `delivery.integrated` 的 `raw_file` 模式内嵌直出，不生成 `.torrent` 种子，也不在客户端 `.nodestone/` 下按 Hash 持久化留存历史缓存副本，而是在请求时现场解码校验并直接交付。
* **不可变游戏版本包（`minecraft-version-<ver>`）**：每个已发布版本对应一个独立的 **BitTorrent v2（BEP-52）** 种子，直接包含该版本的 `<version>.json`、`client.jar`、该版本依赖的全部 `libraries`、对应的 `<asset_index>.json` 以及该版本关联的全部 `assets/objects` 资源文件。不同版本种子之间天然允许包含相同 URL 的公共 `libraries` 和 `assets` 文件（由于 `.torrent` 文件本身仅约 300 KB 且已在本地或瞬间拉取，公共文件的 `NSFID` 指向任意一个包含它的版本种子均可正常完成 BT / WebSeed 下载）。
* `latest.json` 的 `nsci.raw_kv` 不需要记录海量小文件，**只需收录 `version_manifest_v2.json` 和各个版本的 `<version>.json` 的 `NSFID -> Hash`**。客户端请求 `<version>.json` 时，会自动拉下该版本的种子并将里面所有的 `client.jar`、`libraries`、`<asset_index>.json` 和 `assets` 映射一次性批量展开到本地缓存。

```
预配置 (provider.urls / namespace / minisign_keys / version_manifest 的 NSFID)
 │
 ▼ 1. 拉取并校验 latest.json + minisign + revision
NSCL (latest.json)
 ├─ nsci.raw_kv : NSFID -> Hash (64-hex BT v2 InfoHash 或 raw_file 的 SHA-256)
 └─ assets.torrents : Hash -> delivery (integrated / url / magnetic)
 │
 ▼ 2. 合并至本地 NSCI 缓存 nsci_cache (重复 Key 即覆盖)
本地 NSCI 缓存 (NSFID -> Target Hash)
 │
 ├─► 请求 version_manifest_v2.json (命中 raw_file)
 │ └─ 现场从 latest.json Base64 解码并校验 SHA-256（不在 .nodestone/ 下留存历史缓存副本），直接交付返回 DirectFile(local_path)
 │
 └─► 请求 <version>.json (命中 BT v2 版本种子)
 └─ 首次拿到种子 (.nodestone/torrents/<torrenthash>.torrent) 后展开 file tree：
 提取 info.file tree 与 ns-schemes -> 路径段 RFC 3986 编码拼出官方 URL -> Base64 编码为 NSFID
 批量写入本地 NSCI 缓存 (一次性展开 client.jar、libraries、<asset_index>.json 及全部 assets)，返回 Torrent(torrent_meta)
```

这样一来，启动器下载 `<version>.json` 时，就会顺带把该版本所有的 `client.jar`、`libraries`、`<asset_index>.json` 和 `assets` 映射一次性写进本地缓存。启动器上层全程只管传入 Mojang 官方 URL，底层会自动把请求映射到对应的现场直出载荷或 BT 种子。

## 2. 最小实现（Minimal implementation）

### 1. 预配置常量

* `provider.namespace`（string）：命名空间（例如 Minecraft 本体为 `minecraft`）。
* `provider.urls`（list/string）：NSCL 文件的 HTTP(S) 源地址列表。
* `provider.minisign_keys`（list/string）：minisign 公钥列表（例如 `RWSDsxUzF3dwx5sVM6sxlIE1S2HzTJtaOtEOSKQiX6ArWc7u3hcDcaTk`）。

### 2. NodeStone File ID（NSFID）的格式

为了避免 URL 里的特殊字符（如 `?`、`&`、`=`、`%`、空格或方括号）在不同语言库里解析出不同的转义结果，URL 类型的 NSFID 在编码前必须严格执行 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）** 标准 URL 规范化：

1. **协议与主机名小写化**：将 `scheme` 与 `host` 转为小写（如 `HTTPS://Piston-Meta.Mojang.com` 转为 `https://piston-meta.mojang.com`）。
2. **移除默认端口**：去掉协议对应的默认端口（`http` 移除 `:80`，`https` 移除 `:443`）。
3. **百分号编码规范化**：对路径中除 RFC 3986 非保留字符（Unreserved Characters：`ALPHA / DIGIT / "-" / "." / "_" / "~"`）及路径分隔符 `/` 以外的字符执行 UTF-8 百分号编码，将所有百分号编码（Percent-Encoding）的十六进制字母统一转为大写（如 `%2f` 转为 `%2F`），并对所有已被多余转义的非保留字符执行百分号解码。
4. **路径段折叠**：执行 `remove_dot_segments` 折叠路径中的 `/./` 与 `/../`。

完成规范化后，统一用标准 Base64（RFC 4648，UTF-8 编码，保留末尾 `=` 填充，不换行）编码：

* **格式 1（当前启用）**：`url:<Base64(规范化后的官方源完整原始 URL)>`
  * 例如 `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` 编码后为：
    `url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u`
* **格式 2（未来预留，v0.9.0 暂不启用）**：`sha256:<此文件的 64 位小写十六进制 SHA-256 值>`

### 3. 获取与校验索引

1. **下载清单**：从 `<provider.urls[i]>/v09/<provider.namespace>/latest.json` 下载清单文件，并下载同路径下的签名文件 `latest.json.minisig`。
2. **签名校验**：用预配置的 `provider.minisign_keys` 校验 `latest.json` 文件签名，并建议同时核对签名中的 `trusted comment` 包含 `<provider.namespace>`；校验失败就换下一个源。
3. **字段校验**：把 JSON 解析为 `latest`，检查以下三项：
   * `filetype` 必须为 `"nscl/v0.9"`。
   * `namespace` 必须与 `<provider.namespace>` 一致。
   * `revision` 必须大于或等于本地已缓存的 `revision`（防止滞后的镜像源用旧版合法签名造成回滚）。
4. **写入本地 NSCI 缓存**：读取 `latest.nsci.raw_kv`，将 `NSFID -> Hash` 键值对按「重复即覆盖（Upsert）」的方式写入本地 NSCI 缓存（仅更新 `torrenthash`，保留已有的 `rel_path` 与 `orig_url`）。

### 4. 从种子 `file tree` 还原 URL 与 WebSeed 下载

BitTorrent v2 种子的 InfoHash 是 `info` 字典的 SHA-256 值（64 位小写十六进制字符串），目录结构存在 `info["file tree"]` 中。

在 NCP 中，无论是单文件种子还是跨多个官方域名的多文件种子，打包时统一把**官方源规范化后的完整主机名（`<host>[:<port>]`）作为 `info["file tree"]` 的第一级目录**，后续层级对应**百分号解码（Unescaped）后的原始 UTF-8 路径段与文件名**；协议头列表则存放在 `info["ns-schemes"]`（同时兼容顶层 `ns-schemes`，缺省为 `["https://"]`）。

1. **拼接官方 URL 与生成 NSFID**：
   设文件在 `info["file tree"]` 中的各级目录与文件名列表为 `[host_port, seg_1, seg_2, ...]`：
   * 磁盘相对路径 `rel_path` 由各级原始名称用 `/` 拼接（如 `libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`）。
   * 读取协议列表 `schemes = torrent["info"].get("ns-schemes") or torrent.get("ns-schemes") or ["https://"]`（注意：严禁回退读取 `url-list`）。
   * 将除第一级 `host_port` 外的每个路径段按 RFC 3986 规范做百分号编码（`urllib.parse.quote(seg, safe="-._~")`），再与规范化后的 `scheme`（`"https://"` 或 `"http://"`）和 `host_port.lower()` 拼接出规范化的 `orig_url`。
   * 按第 2 节规则对 `orig_url` 做 UTF-8 Base64 编码得到 `url:<Base64>` 格式的 `NSFID`，按「重复即覆盖」写入本地 NSCI 缓存：`NSFID -> (torrenthash, rel_path, orig_url)`。
2. **SDK 接管 WebSeed 下载与 BT 引擎配置**：
   * 底层 BT 引擎必须启用 **BEP-5（DHT）**、**BEP-11（PEX）** 和 **BEP-14（LSD）**。
   * 底层 BT 引擎挂载种子时，**必须禁用 BT 引擎自带的顶层多文件 BEP-19 `url-list` WebSeed**（避免引擎把 `info["name"]` 拼进域名导致请求报错）。
   * 当某个文件或分块需要用 WebSeed 辅助下载或 P2P 超时回退时，由 SDK 通过本地 HTTP 307 路由代理或引擎层 URL 拼接补丁将请求指向还原出的 `orig_url`，直接复用 BT 引擎的 BEP-52 `pieces root` / `piece layers` Merkle 树校验与落盘逻辑（详见《客户端推荐实现》第 4 节）。

```python
import base64
from urllib.parse import quote

def expand_filetree_to_nsci(torrent: dict, torrenthash: str, nsci_cache: dict):
    info = torrent["info"]
    # parse_btv2_file_tree_segments 返回形如 [["libraries.minecraft.net", "com", "mojang", ...], ...] 的路径段列表
    path_segments_list = parse_btv2_file_tree_segments(info["file tree"])
    schemes = info.get("ns-schemes") or torrent.get("ns-schemes") or ["https://"]
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

为避免 `.torrent` 种子与 `raw_file` 内嵌直出文件在调用链路上产生类型冲突，`nsGetTorrent` 的返回值明确区分为以下两种可辨识联合类型（Tagged Union / Enum）：

* `DeliveryResult::Torrent(torrent_meta)`：表示目标为标准 BT v2 种子，返回已校验并完成 `file tree` 展开的种子元数据对象（及本地 `.torrent` 路径）。
* `DeliveryResult::DirectFile(local_path)`：表示目标为 `integrated.type == "raw_file"` 的内嵌纯独立单文件，返回现场解码并校验 SHA-256 后的文件落盘路径。

**方法定义：**

* `nsGetTorrent(latest, torrenthash, target_path=None) -> DeliveryResult`：获取种子文件（或现场提取内嵌直出单文件）。
  1. 检查本地缓存 `.nodestone/torrents/<torrenthash>.torrent`，如果文件存在且 InfoHash v2 校验通过（且在本地 `torrents_state` 表中已标记 `is_expanded == 1`），直接返回 `DeliveryResult::Torrent(torrent_meta)`。
  2. 如果本地没有该 `.torrent`（或目标为 `raw_file`），按顺序检查 `latest.assets.torrents[torrenthash].delivery`（若内存中尚无 `latest` 或当前 `latest.assets.torrents` 中未找到该 `torrenthash`，则先现场拉取一次最新 `latest.json` 更新 `nsci_cache`）：
     * `delivery.integrated`：
       * 当 `integrated.type` 为 `"torrent"`（或未填）时：Base64 解码 `integrated.payload` 得到 `.torrent` 内容，校验 InfoHash v2 等于 `torrenthash` 后保存到 `.nodestone/torrents/<torrenthash>.torrent`，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
       * 当 `integrated.type` 为 `"raw_file"` 时（**协议强制约束：仅允许用于不包含任何下游子文件映射依赖的纯独立单文件，如 `version_manifest_v2.json`**）：**现场**对 `integrated.payload` 进行 Base64 解码得到目标单文件本体，校验文件整体线性 SHA-256 等于 `torrenthash` 后，直接写入调用方指定的 `target_path`（或固定的单文件临时覆写路径），返回 `DeliveryResult::DirectFile(local_path)`。**严禁在 `.nodestone/` 下按 `<torrenthash>` 持久化缓存 `raw_file` 历史副本**，以免产生额外的缓存生命周期管理负担；无需走 BT 引擎，也无需执行步骤 3。
     * `delivery.url`：通过 HTTP(S)/FTP 下载 `.torrent` 文件，校验 InfoHash v2 后保存到 `.nodestone/torrents/<torrenthash>.torrent`，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
     * `delivery.magnetic`：通过磁力链接（`xt=urn:btmh:1220<torrenthash>&tr=...`）拉取种子并校验，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。注意：支持 `delivery.magnetic` 的客户端，其 BT 引擎必须启用 BEP-5 (DHT)、BEP-11 (PEX)、BEP-14 (LSD) 并实现 BEP-52 的 `hash request` / `hashes` 扩展消息以拉取 `piece layers`。
  3. **首次获取到 `Torrent` 类型种子时**，必须按第 4 节规则遍历 `info["file tree"]` 还原出 `orig_url` 和 `NSFID`，与 `torrents_state` 的 `is_expanded = 1` 状态在同一事务内写入本地缓存数据库后再返回 `DeliveryResult::Torrent(torrent_meta)`。

* `nsGetFile(aNSFID, contextEntryNSFIDs=None, target_path=None) -> LocalFilePath`：获取单个文件。
  1. 在本地 `nsci_cache` 中查找 `aNSFID` 对应的 `(torrenthash, rel_path, orig_url)`。如果未查到，执行自愈流程（见《客户端推荐实现》第 3 节）。
  2. 调用 `res = nsGetTorrent(latest, torrenthash, target_path=target_path)`（注意：若 `torrenthash` 指向的是旧版 `raw_file`，导致步骤 2 触发了 `latest.json` 刷新并更新了 `nsci_cache` 中 `aNSFID` 的 `torrenthash`，则用更新后的新 `torrenthash` 重新提取）：
     * 若 `res` 为 `DeliveryResult::DirectFile(local_path)`，直接返回 `local_path`。
     * 若 `res` 为 `DeliveryResult::Torrent(torrent_meta)`，进入步骤 3。
  3. 从 `nsci_cache` 取出 `aNSFID` 对应的 `(rel_path, orig_url)`（注：若 `aNSFID` 恰好是首次下载的 `<version>.json` 入口文件，在步骤 1 查库时 `rel_path` 尚未填充，步骤 2 首次展开种子后 `rel_path` 与 `orig_url` 即已在 `nsci_cache` 中补齐），通过 BT v2 及 WebSeed 下载文件，校验通过后返回本地路径。
