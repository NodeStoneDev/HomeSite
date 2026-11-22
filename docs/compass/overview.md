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

启动器先从 NodeStone 官方源或镜像源下载 `latest.json`（约 20 KB），校验 minisign 签名和 `revision` 版本号后，把里面的 `nsci` 映射写入本地缓存。

打包 MC 资源时，服务端遵循**「可变索引直出、不可变版本打包做种」**的原则：

* **高频变化的顶层清单（如 `version_manifest_v2.json`）**：强制采用 `delivery.integrated` 的 `raw_file` 模式内嵌直出，不生成 `.torrent` 种子，从而避免客户端频繁拉取新种子与清理过期做种任务。
* **不可变的版本核心包**（`<version>.json`、`client.jar`、`libraries`）和**大版本资源包**（如 `assets-1.20`、`assets-1.21`，包含对应的 `<asset_index>.json` 及全部关联 `objects`）：拆成独立的 BT v2 种子。
* `latest.json` 的 `nsci.raw_kv` 不需要记录海量小文件，只需收录 `version_manifest_v2.json`、各版本 `<version>.json` 以及各 `<asset_index>.json` 的 `NSFID -> Hash`。
* 同一大版本下的多个小版本（如 `1.21.1` ~ `1.21.4`）在 `nsci` 中，它们的 `<asset_index>.json` 自然指向同一个 `assets-1.21` 种子 Hash。客户端不需要关心底层怎么拆包，照常按流程请求 `<version>.json` 和 `<asset_index>.json` 的 NSFID，就能自动拉下对应的种子并把里面的子文件索引批量展开到本地缓存。

```
预配置 (provider.urls / namespace / minisign_keys / version_manifest 的 NSFID)
 │
 ▼ 1. 拉取并校验 latest.json + minisign + revision
NSCL (latest.json)
 ├─ nsci.raw_kv : NSFID -> Hash (64-hex BT v2 InfoHash 或 raw_file 的 SHA-256)
 └─ assets.torrents : Hash -> delivery (integrated / url / magnetic)
 │
 ▼ 2. 合并至本地 NSCI 缓存（重复 Key 即覆盖）
本地 NSCI 缓存 (NSFID -> Hash)
 │
 ├─► 请求 version_manifest_v2.json (命中 raw_file)
 │    └─ Base64 解码并校验文件 SHA-256 后直接落盘返回 DirectFile(local_path)
 │
 └─► 请求 <version>.json 或 <asset_index>.json (命中 BT v2 种子)
      └─ 首次拿到种子 (.nodestone/torrents/<torrenthash>.torrent) 后展开 file tree：
         提取 info.file tree 与 ns-schemes -> 拼出官方 URL -> Base64 编码为 NSFID
         批量写入本地 NSCI 缓存，返回 Torrent(torrent_meta)
```

这样一来，启动器下载 `<version>.json` 和 `<asset_index>.json` 时，就会顺带把该版本所有的 `client.jar`、`libraries` 和 `assets` 映射写进本地缓存。启动器上层全程只管传入 Mojang 官方 URL，底层会自动把请求映射到对应的直出载荷或 BT 种子。

## 2. 最小实现（Minimal implementation）

### 1. 预配置常量

* `provider.namespace`（string）：命名空间（例如 Minecraft 本体为 `minecraft`）。
* `provider.urls`（list/string）：NSCL 文件的 HTTP(S) 源地址列表。
* `provider.minisign_keys`（list/string）：minisign 公钥列表（例如 `RWSDsxUzF3dwx5sVM6sxlIE1S2HzTJtaOtEOSKQiX6ArWc7u3hcDcaTk`）。

### 2. NodeStone File ID（NSFID）的格式

为了避免 URL 里的特殊字符（如 `?`、`&`、`=`、`%`）在不同语言库里解析出不同的转义结果，URL 类型的 NSFID 在编码前必须严格执行 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）** 标准 URL 规范化：

1. **协议与主机名小写化**：将 `scheme` 与 `host` 转为小写（如 `HTTPS://Piston-Meta.Mojang.com` 转为 `https://piston-meta.mojang.com`）。
2. **移除默认端口**：去掉协议对应的默认端口（`http` 移除 `:80`，`https` 移除 `:443`）。
3. **百分号编码规范化**：将所有百分号编码（Percent-Encoding）的十六进制字母统一转为大写（如 `%2f` 转为 `%2F`），并对所有非保留字符（Unreserved Characters：`ALPHA / DIGIT / "-" / "." / "_" / "~"`）执行百分号解码。
4. **路径段折叠**：执行 `remove_dot_segments` 折叠路径中的 `/./` 与 `/../`。

完成规范化后，统一用标准 Base64（RFC 4648，UTF-8 编码，保留末尾 `=` 填充，不换行）编码：

* **格式 1（当前启用）**：`url:<Base64(规范化后的官方源完整原始 URL)>`
  * 例如 `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` 编码后为：
    `url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u`
* **格式 2（未来预留，v0.8.0 暂不启用）**：`sha256:<此文件的 64 位小写十六进制 SHA-256 值>`

### 3. 获取与校验索引

1. **下载清单**：从 `<provider.urls[i]>/v08/<provider.namespace>/latest.json` 下载清单文件，并下载同路径下的签名文件 `latest.json.minisig`。
2. **签名校验**：用预配置的 `provider.minisign_keys` 校验 `latest.json` 文件签名，并建议同时核对签名中的 `trusted comment` 包含 `<provider.namespace>`；校验失败就换下一个源。
3. **字段校验**：把 JSON 解析为 `latest`，检查以下三项：
   * `filetype` 必须为 `"nscl/v0.8"`。
   * `namespace` 必须与 `<provider.namespace>` 一致。
   * `revision` 必须大于或等于本地已缓存的 `revision`（防止滞后的镜像源用旧版合法签名造成回滚）。
4. **写入本地 NSCI 缓存**：读取 `latest.nsci.raw_kv`，将 `NSFID -> Hash` 键值对按「重复即覆盖」的方式写入本地 NSCI 缓存。

### 4. 从种子 `file tree` 还原 URL 与 WebSeed 下载

BitTorrent v2 种子的 InfoHash 是 `info` 字典的 SHA-256 值（64 位小写十六进制字符串），目录结构存在 `info["file tree"]` 中。

在 NCP 中，无论是单文件种子还是跨多个 Mojang 域名的多文件种子，打包时统一把**官方源的完整主机名（`<host>[:<port>]`）作为 `info["file tree"]` 的第一级目录**，后续层级对应 URL 路径；协议头则放在种子顶层的 `ns-schemes` 字段中（缺省为 `["https://"]`）。

1. **拼接官方 URL 与生成 NSFID**：
   设文件在 `info["file tree"]` 中的相对路径为 `rel_path`（由各级字典 Key 用 `/` 拼接，如 `libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`），读取协议列表 `schemes = torrent.get("ns-schemes") or ["https://"]`（注意：严禁回退读取 `url-list`）。
   对每个 `scheme`（规范化为 `"https://"` 或 `"http://"`），直接拼接：
   `orig_url = scheme + rel_path`
   按第 2 节规则对 `orig_url` 做 UTF-8 Base64 编码得到 `url:<Base64>` 格式的 `NSFID`，写入本地 NSCI 缓存（`NSFID -> torrenthash`），同时记录 `(torrenthash, NSFID) -> (rel_path, orig_url)` 供后续提取文件和 WebSeed 下载使用。
2. **SDK 接管 WebSeed 下载与 BT 引擎配置**：
   * 底层 BT 引擎必须启用 **BEP-5（DHT）**、**BEP-11（PEX）** 和 **BEP-14（LSD）**。
   * 底层 BT 引擎挂载种子时，**必须禁用 BT 引擎自带的多文件 BEP-19 `url-list` WebSeed**（避免引擎把 `info["name"]` 拼进域名导致请求报错）。
   * 当某个文件或分块需要用 WebSeed 辅助下载或 P2P 超时回退时，直接由客户端/SDK 请求该文件还原出的 `orig_url` 并结合 BT v2 的 `pieces root` / `piece layers` 校验落盘（关于 SDK 接管 WebSeed 的分块对齐与 Merkle 树校验细则，将在后续版本专项规范中深入定义）。

```python
import base64

def expand_filetree_to_nsci(torrent: dict, torrenthash: str, local_nsci: dict, file_locator: dict):
    file_entries = parse_btv2_file_tree(torrent["info"]["file tree"])
    schemes = torrent.get("ns-schemes") or ["https://"]
    if isinstance(schemes, str):
        schemes = [schemes]

    for rel_path in file_entries:
        for raw_scheme in schemes:
            clean = raw_scheme.strip().lower().rstrip(":/")
            scheme = f"{clean}://" if clean in ("http", "https") else "https://"
            orig_url = f"{scheme}{rel_path}"
            b64 = base64.b64encode(orig_url.encode("utf-8")).decode("ascii")
            nsfid = f"url:{b64}"
            local_nsci[nsfid] = torrenthash
            file_locator[(torrenthash, nsfid)] = (rel_path, orig_url)
```

### 5. 核心方法定义

为避免 `.torrent` 种子与 `raw_file` 内嵌直出文件在调用链路上产生类型冲突，`nsGetTorrent` 的返回值明确区分为以下两种可辨识联合类型（Tagged Union / Enum）：

* `DeliveryResult::Torrent(torrent_meta)`：表示目标为标准 BT v2 种子，返回已校验并完成 `file tree` 展开的种子元数据对象（及本地 `.torrent` 路径）。
* `DeliveryResult::DirectFile(local_path)`：表示目标为 `integrated.type == "raw_file"` 的内嵌纯独立单文件，返回已校验 SHA-256 并落盘后的目标文件本地路径。

**方法定义：**

* `nsGetTorrent(latest, torrenthash) -> DeliveryResult`：获取种子文件（或内嵌直出单文件）。
  1. 检查本地缓存 `.nodestone/torrents/<torrenthash>.torrent`，如果文件存在且 InfoHash v2 校验通过（且在本地状态中已标记完成 `file tree` 展开），直接返回 `DeliveryResult::Torrent(torrent_meta)`。
  2. 如果本地没有，按顺序检查 `latest.assets.torrents[torrenthash].delivery`：
     * `delivery.integrated`：
       * 当 `integrated.type` 为 `"torrent"`（或未填）时：Base64 解码 `integrated.payload` 得到 `.torrent` 内容，校验 InfoHash v2 等于 `torrenthash` 后保存到本地，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
       * 当 `integrated.type` 为 `"raw_file"` 时（**协议强制约束：仅允许用于不包含任何下游子文件映射依赖的纯独立单文件，如 `version_manifest_v2.json`**）：Base64 解码 `integrated.payload` 直接得到目标单文件本体，校验文件整体线性 SHA-256 等于 `torrenthash` 后直接落盘，返回 `DeliveryResult::DirectFile(local_path)`，无需走 BT 引擎，也无需执行步骤 3。
     * `delivery.url`：通过 HTTP(S)/FTP 下载 `.torrent` 文件，校验 InfoHash v2 后保存到本地，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。
     * `delivery.magnetic`：通过磁力链接（`xt=urn:btmh:1220<torrenthash>&tr=...`）拉取种子并校验，按步骤 3 展开 `file tree` 后返回 `DeliveryResult::Torrent(torrent_meta)`。注意：支持 `delivery.magnetic` 的客户端，其 BT 引擎必须启用 BEP-5 (DHT)、BEP-11 (PEX)、BEP-14 (LSD) 并实现 BEP-52 的 `hash request` / `hashes` 扩展消息以拉取 `piece layers`。
  3. **首次获取到 `Torrent` 类型种子时**，必须按第 4 节规则遍历 `info["file tree"]` 还原出 `orig_url` 和 `NSFID`，同步写入本地 NSCI 缓存后再返回 `DeliveryResult::Torrent(torrent_meta)`。

* `nsGetFile(aNSFID, contextEntryNSFIDs=None) -> LocalFilePath`：获取单个文件。
  1. 查本地 NSCI 缓存拿到 `torrenthash`。如果没查到，报错或进入自愈流程（关于未命中的自愈与批量下载优化，见《客户端推荐实现》）。
  2. 调用 `res = nsGetTorrent(latest, torrenthash)`：
     * 若 `res` 为 `DeliveryResult::DirectFile(local_path)`，直接返回 `local_path`。
     * 若 `res` 为 `DeliveryResult::Torrent(torrent_meta)`，进入步骤 3。
  3. 根据 `(torrenthash, aNSFID)` 找到种子内的 `rel_path` 和 `orig_url`，通过 BT v2 及 SDK 接管的 WebSeed 下载文件，校验通过后返回本地路径。
