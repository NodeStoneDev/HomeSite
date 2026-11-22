---
title: "协议规范"
sidebar_position: 2
description: "nsci 与 torrents 分离设计、latest.json 字段表、BT v2 种子打包规范与完整示例。"
---

## 1. 为什么把 `nsci` 和 `torrents` 分开？

在 `latest.json`（NSCL）中，`nsci.raw_kv` 保存 `NSFID -> torrenthash`，而 `assets.torrents` 保存 `torrenthash -> delivery`，不把它们合并成一张表主要有四个原因：

1. **避免冗余**：`delivery` 包含下载地址或内嵌载荷，体积较大；而 `nsci` 中可能有多个 `NSFID`（例如同一个资源的不同 URL 标识或多个入口文件）指向同一个种子。分开存放可以大幅减小 `latest.json` 的体积。
2. **全局唯一且可自校验**：以**目标 Hash**（BT v2 InfoHash，或 `raw_file` 的 SHA-256）作为关联 Key，天然具备全局唯一性和校验能力。
3. **方便本地缓存管理**：本地种子直接按 `.nodestone/torrents/<torrent_hash>.torrent` 存放。客户端查到种子 Hash 后就能直接定位并校验本地种子文件，不需要再去读 `delivery`。
4. **支持多镜像源差异化投递**：NodeStone Compass 允许多个镜像源提供服务。同一个种子在不同镜像源里的 `Torrent Hash` 完全一致，但各自的 `delivery`（比如种子下载 URL、或者是否直接内嵌）可以根据源自身情况灵活配置。

## 2. NSCL（`latest.json`）字段说明

`latest.json` 的顶层及嵌套字段定义如下：

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `filetype` | `string` | 是 | 固定为 `"nscl/v0.9"`。 |
| `namespace` | `string` | 是 | 命名空间，须与客户端预配置的 `<provider.namespace>` 一致（如 `"minecraft"`）。 |
| `revision` | `integer` | 是 | 单调递增的修订号。客户端必须拒绝比本地已缓存版本更小的 `revision`。 |
| `generatedBy` | `string` | 是 | 生成该清单的节点标识，格式为 `<worker>`（如 `"compass-worker-hk-01"`）。 |
| `generateDate` | `string` | 是 | 生成时间，采用 ISO 8601 UTC 格式（如 `"2026-11-22T09:00:00Z"`）。 |
| `nsci.raw_kv` | `object` | 是 | `NSFID -> Hash` 顶层入口映射字典。v0.9.0 仅使用 `url:<Base64>`（编码前须遵循 **RFC 3986 Section 6.2.2** 规范化）作为 Key；Hash 为 64 位小写十六进制 BT v2 InfoHash（当对应项为 `raw_file` 模式时，为该目标文件的整体线性 SHA-256）。 |
| `assets.torrents` | `object` | 是 | `Hash -> { delivery }` 字典，描述每个种子或内嵌单文件的获取方式。 |
| `delivery.integrated` | `object` | 否 | 内嵌载荷：`{ "type": "torrent" \| "raw_file", "payload": "<Base64>" }`，`type` 缺省为 `"torrent"`。<br/>**强制协议约束**：`type == "raw_file"` **仅允许用于不包含任何下游子文件映射依赖的纯独立单文件**（如 `version_manifest_v2.json`），客户端在请求时**现场解码校验并交付**，不在 `.nodestone/` 下按 Hash 持久化留存历史缓存副本；严禁将 `raw_file` 用于任何需要通过 `file tree` 展开子文件索引的入口资源（如 `<version>.json`），亦严禁内嵌常规多文件种子。 |
| `delivery.url` | `list<string>` | 否 | `.torrent` 种子文件的 HTTP(S)/FTP 下载地址列表。**针对标准 BT v2 种子，服务端必须优先提供 `delivery.url`**，以确保客户端能直接获取包含完整 `piece layers` 的 `.torrent` 文件，在无 P2P Peer 环境下仅靠 WebSeed 也能完成大于 16 KiB 文件的分块校验。 |
| `delivery.magnetic` | `string` | 否 | BT v2 磁力链接（`magnet:?xt=urn:btmh:1220<64-hex>&dn=<name>&tr=<tracker_url>...`）。**协议强制要求**：磁力链接**必须携带至少一个 `&tr=`（Tracker）参数**；声明支持该字段的客户端**必须启用 BEP-5 (DHT)、BEP-11 (PEX)、BEP-14 (LSD) 并实现 BEP-52 `hash request` 扩展**。 |

## 3. 种子打包与底层协议规范

### 1. BitTorrent v2（BEP-52）、节点发现与 `hash request` 强制要求

* NCP 种子统一采用 **BitTorrent v2（BEP-52）** 格式，种子 Hash（InfoHash v2）为 Bencode 编码后 `info` 字典的 SHA-256 值（64 位小写十六进制字符串），种子顶层字典必须包含符合 BEP-52 规范的 `piece layers` 字典。
* **节点发现强制要求**：客户端底层 BT 引擎必须启用 **BEP-5（DHT）**、**BEP-11（Peer Exchange, PEX）** 和 **BEP-14（Local Service Discovery, LSD）**，以保障公网与局域网环境下的快速寻址。
* **磁力链接（`delivery.magnetic`）与 `delivery.url` 协同规范**：
  1. 服务端生成的 `delivery.magnetic` 必须包含至少一个 `&tr=<url-encoded-tracker>` 参数，确保冷启动时具备初始 Peer 发现通道。
  2. 在 BitTorrent 协议中，BEP-9（`ut_metadata`）扩展只能从 Peer 拉取 `info` 字典，**不包含顶层的 `piece layers` 与顶层附加字段**。而 BT v2 中任何大于 16 KiB（且大于 `piece length`）的文件都必须依赖 `piece layers` 来校验分块（HTTP WebSeed 无法响应 BEP-52 的 `hash request`）。因此：
     * 服务端应当为所有标准种子同时提供 `delivery.url`（完整 `.torrent` 文件）与 `delivery.magnetic`，客户端优先通过 `delivery.url` 拉取 `.torrent`；
     * 任何声明支持 `delivery.magnetic` 的客户端，其底层 BT 引擎必须完整实现 BEP-52 的 `hash request` / `hashes` 扩展消息，以便从在线 Peer 动态拉取 Merkle 树分层哈希并在校验通过后持久化保存。

### 2. 种子目录结构、路径转义与 `ns-schemes` 约定

1. **`info["file tree"]` 第一级固定为主机名，后续层级为未转义原始 UTF-8 名称**：
   无论是单文件种子还是跨多个官方域名的多文件种子，文件在 `info["file tree"]` 中的路径层级约定如下：
   * **第一级目录**：固定为官方源经 RFC 3986 Section 6.2.2 规范化后的完整主机名（`<host>[:<port>]`，全小写且不含默认端口 `:80` / `:443`）。
   * **后续各级目录与文件名**：固定为**百分号解码（Unescaped）后的原始 UTF-8 字符串**（确保 BT 引擎落盘的文件名与原始文件名一致，且在发起 BEP-19 WebSeed 请求时不会因路径已含 `%XX` 而发生二次百分号转义）。
   * **`info["name"]` 命名约束**：种子 `info["name"]` 必须为不含路径分隔符 `/` 的纯 ASCII 标识符（例如 `minecraft-version-1.21.4`），确保本地 HTTP 307 WebSeed 路由代理在剥离 `/<info.name>/` 层级时不会发生路径切分歧义。
   * **还原 URL 时的百分号编码**：客户端遍历 `info["file tree"]` 还原 `orig_url` 时，必须对除第一级主机名外的每一级路径段执行 RFC 3986 百分号编码（仅保留非保留字符 `ALPHA / DIGIT / "-" / "." / "_" / "~"` 不转义，十六进制字母大写），再与协议头和主机名拼接。注意：基于 `info["file tree"]` 展开的子文件不支持携带 Query String（`?key=value`）的动态 URL。
   * 单文件示例：`https://piston-meta.mojang.com/mc/game/version_manifest_v2.json` 在 `file tree` 中的路径为：
     `piston-meta.mojang.com/mc/game/version_manifest_v2.json`
   * 多文件跨域名示例：`https://libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar` 在 `file tree` 中的路径为：
     `libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`
2. **协议头字段 `ns-schemes`（写入 `info["ns-schemes"]` 并兼容顶层）**：
   * 为确保通过磁力链接（BEP-9 `ut_metadata` 仅传输 `info` 字典）获取元数据的客户端不会丢失协议头声明，同时使协议头受 InfoHash v2 签名保护，服务端打包时**必须将 `ns-schemes` 写入 `info["ns-schemes"]`**（推荐在种子顶层 `ns-schemes` 同步保留一份以方便外部工具快速检视，缺省为 `["https://"]`）。
   * 客户端读取顺序为：`torrent["info"].get("ns-schemes") or torrent.get("ns-schemes") or ["https://"]`。
   * 由于普通 BT 客户端如果按原生 BEP-19 解析顶层 `url-list`，会把 `info["name"]` 拼到域名位置导致无效的 HTTP 请求，因此种子顶层**禁止设置标准 `url-list`**（若第三方种子设置了 `url-list`，SDK 在挂载到底层 BT 引擎前必须将其清空并禁用引擎自带的顶层 BEP-19 WebSeed）。
   > 关于服务端生成 NSCL 清单、打包 BT v2 种子及 minisign 签名的完整工程规范，请参见《服务端推荐实现》。

## 4. `latest.json` 完整示例

以下示例中：
* `version_manifest_v2.json` 作为高频变化的纯独立单文件，采用 `"type": "raw_file"` 直出。示例载荷 `"eyJ2ZXJzaW9ucyI6W119"` 解码后为 `{"versions":[]}`（15 字节），其对应的真实线性 SHA-256 为 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`。
* `1.21.4.json` 指向不可变的 `minecraft-version-1.21.4` 版本全量种子（内含 `1.21.4.json`、`client.jar`、`libraries`、`<asset_index>.json` 及该版本全部 `assets/objects`）。
* `delivery.magnetic` 按规范携带了 `&tr=` Tracker 参数。

```json
{
  "filetype": "nscl/v0.9",
  "namespace": "minecraft",
  "revision": 1086,
  "generatedBy": "compass-worker-hk-01",
  "generateDate": "2026-11-22T09:00:00Z",
  "nsci": {
    "raw_kv": {
      "url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL3YxL3BhY2thZ2VzLzE3YzU0ZWIzM2I1ZDRhOGY5YzA0ZWIxMjM0NTY3ODkwYWJjZGVmMDEvMS4yMS40Lmpzb24=": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
    }
  },
  "assets": {
    "torrents": {
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945": {
        "delivery": {
          "integrated": {
            "type": "raw_file",
            "payload": "eyJ2ZXJzaW9ucyI6W119"
          }
        }
      },
      "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b": {
        "delivery": {
          "url": [
            "https://compass.nodestone.io/v09/minecraft/torrents/3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b.torrent"
          ],
          "magnetic": "magnet:?xt=urn:btmh:12203a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b&dn=minecraft-version-1.21.4&tr=https%3A%2F%2Ftracker.nodestone.io%2Fannounce"
        }
      }
    }
  }
}
```

> **附：当 `delivery.integrated.type == "torrent"` 时的合法 Bencode 结构对照**
> 若对单文件打包标准 BT v2 `.torrent`，其解码后的 Bencode 必须包含主机名作为 `file tree` 第一级目录，在 `info` 内包含 `meta version`（`i2e`）、`name`、`ns-schemes`、`piece length`，并在顶层包含 BEP-52 必填的 `piece layers` 字典（所有字典 Key 严格按字节序排列）：
> `d10:created by19:NodeStone Packer v213:creation datei1795264834e4:infod9:file treed22:piston-meta.mojang.comd2:mcd4:gamed23:version_manifest_v2.jsond0:d6:lengthi12450e11:pieces root32:<32-byte-merkle-root>eeeeee12:meta versioni2e4:name23:version_manifest_v2.json10:ns-schemesl8:https://e12:piece lengthi16384ee10:ns-schemesl8:https://e12:piece layersdee`
> 其前半段（至 `pieces root32:` 前 186 字节）对应的无填充 Base64 前缀为：
> `ZDEwOmNyZWF0ZWQgYnkxOTpOb2RlU3RvbmUgUGFja2VyIHYyMTM6Y3JlYXRpb24gZGF0ZWkxNzk1MjY0ODM0ZTQ6aW5mb2Q5OmZpbGUgdHJlZWQyMjpwaXN0b24tbWV0YS5tb2phbmcuY29tZDI6bWNkNDpnYW1lZDIzOnZlcnNpb25fbWFuaWZlc3RfdjIuanNvbmQwOmQ2Omxlbmd0aGkxMjQ1MGUxMTpwaWVjZXMgcm9vdDMy...`

## 5. 未来预留与演进计划

1. **`sha256:<Hex>` 格式的 NSFID**：
   目前 BT v2 `info["file tree"]` 中记录的 `pieces root` 是按 16 KiB 分块计算的 Merkle 树根哈希，并不等于文件整体的线性 SHA-256。因此在 v0.9.0 中，`latest.json` 及种子展开过程暂不使用 `sha256:` 前缀，仅在协议层预留该格式，供后续内容寻址扩展使用。
2. **正则表达式格式的 `nsci` 路由规则**：
   后续考虑在 `nsci` 下引入正则匹配表，用于进一步清理索引、减小 `latest.json` 体积。正则规则仅在查找入口时做路由匹配使用，**不作为 NSFID 使用**，命中或展开后写入本地缓存的仍必须是真实的 `NSFID -> hash` 映射。
