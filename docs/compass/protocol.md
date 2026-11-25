---
title: "协议规范"
sidebar_position: 2
description: "nsci 与 torrents 分离设计、latest.json 字段表、BT v2 种子打包规范与完整示例。"
---

## 1. 为什么把 `nsci` 和 `torrents` 分开？

在 `latest.json`（NSCL）中，`nsci.raw_kv` 保存 `NSFID -> torrenthash`，而 `assets.torrents` 保存 `torrenthash -> delivery`，分为两张映射表主要有四个原因：

1. **避免冗余**：`delivery` 包含下载地址或内嵌载荷，体积较大；而在大版本合包策略下（例如 `1.21.1`、`1.21.2`、`1.21.3` 等小版本的 `<version>.json` 与 `<asset_index>.json` 均指向同一个 `minecraft-1.21-full` 种子），`nsci` 中有大量 `NSFID` 指向同一个种子 Hash。分开存放可以显著减小 `latest.json` 的体积。
2. **哈希唯一与校验**：以目标 Hash（BT v2 InfoHash，或 `raw_file` 的 SHA-256）作为关联 Key，具备唯一性和自校验能力。
3. **简化本地缓存与淘汰清理**：本地种子按 `.nodestone/torrents/<torrenthash>.torrent` 存放。每次拉取新 `latest.json` 时，客户端只需对比本地缓存中的 `torrenthash` 是否仍在 `assets.torrents` 字典中，即可直接删除已淘汰的可变种子缓存记录。
4. **支持多镜像源差异化投递**：NodeStone Compass 允许多个镜像源提供服务。同一个种子在不同镜像源里的 `torrenthash` 完全一致，但各自的 `delivery`（如种子下载 URL 或是否内嵌）可根据源自身情况配置。

## 2. NSCL（`latest.json`）字段说明

`latest.json` 的顶层及嵌套字段定义如下：

| 字段 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `filetype` | `string` | 是 | 固定为 `"nscl/v0.10"`。 |
| `namespace` | `string` | 是 | 命名空间，须与客户端预配置的 `<provider.namespace>` 一致（如 `"minecraft"`）。 |
| `revision` | `integer` | 是 | 单调递增的修订号。客户端不接受比本地已缓存版本更小的 `revision`。 |
| `generatedBy` | `string` | 是 | 生成该清单的节点标识，格式为 `<worker>`（如 `"compass-worker-hk-01"`）。 |
| `generateDate` | `string` | 是 | 生成时间，采用 ISO 8601 UTC 格式（如 `"2026-11-25T02:00:00Z"`）。 |
| `nsci.raw_kv` | `object` | 是 | `NSFID -> Hash` 入口映射字典。v0.10.0 使用 `url:<Base64>`（编码前遵循 **RFC 3986 Section 6.2.2** 规范化，再按 **RFC 4648** Base64 编码）作为 Key；Hash 为 64 位小写十六进制 BT v2 InfoHash（当对应项为 `raw_file` 模式时，为该目标文件的整体 SHA-256）。 |
| `assets.torrents` | `object` | 是 | `Hash -> { delivery }` 字典，描述当前有效种子或内嵌单文件的获取方式。客户端每次拉取 `latest.json` 时，应将本地缓存中不在 `assets.torrents` 里的旧 `Hash` 记录删除。 |
| `delivery.integrated` | `object` | 否 | 内嵌载荷：`{ "type": "torrent" \| "raw_file", "payload": "<Base64>" }`，`type` 缺省为 `"torrent"`。<br/>`type == "raw_file"` 仅用于无下游子文件依赖的独立单文件（如 `version_manifest_v2.json`），客户端请求时直接解码校验并交付，不用于需要通过 `file tree` 展开子文件映射的入口资源（如 `<version>.json` 或 `<asset_index>.json`）。 |
| `delivery.url` | `list<string>` | 否 | `.torrent` 种子文件的 HTTP(S)/FTP 下载地址列表。服务端应优先为标准 BT v2 种子提供 `delivery.url`，使客户端能直接获取包含完整 `piece layers` 的 `.torrent` 文件，在无 P2P Peer 时仅靠 WebSeed 也能完成大于 16 KiB 文件的分块校验。 |
| `delivery.magnetic` | `string` | 否 | BT v2 磁力链接（`magnet:?xt=urn:btmh:1220<64-hex>&dn=<name>&tr=<tracker_url>...`），应包含至少一个 `&tr=`（Tracker）参数。使用磁力链接的客户端需启用 BEP-5 (DHT)、BEP-11 (PEX)、BEP-14 (LSD) 并实现 BEP-52 `hash request` 扩展。 |

## 3. 种子打包与底层协议规范

### 1. BitTorrent v2（BEP-52）、节点发现与 `hash request`

* NCP 种子采用 **BitTorrent v2（BEP-52）** 格式，种子 Hash（InfoHash v2）为 Bencode 编码后 `info` 字典的 SHA-256 值（64 位小写十六进制字符串），种子顶层字典包含符合 BEP-52 规范的 `piece layers` 字典。
* **节点发现**：客户端底层 BT 引擎需启用 **BEP-5（DHT）**、**BEP-11（Peer Exchange, PEX）** 和 **BEP-14（Local Service Discovery, LSD）**。
* **磁力链接（`delivery.magnetic`）与 `delivery.url`**：
  1. 服务端生成的 `delivery.magnetic` 包含至少一个 `&tr=<url-encoded-tracker>` 参数。
  2. BEP-9（`ut_metadata`）扩展仅从 Peer 拉取 `info` 字典，不包含顶层的 `piece layers`。而 BT v2 中大于 16 KiB（且大于 `piece length`）的文件依赖 `piece layers` 校验分块（HTTP WebSeed 不响应 BEP-52 的 `hash request`）。因此服务端应同时提供 `delivery.url`（完整 `.torrent` 文件）与 `delivery.magnetic`，客户端优先通过 `delivery.url` 拉取 `.torrent`；使用 `delivery.magnetic` 的客户端需实现 BEP-52 `hash request` / `hashes` 扩展消息。

### 2. 种子目录结构（`info["file tree"]`）

无论是单文件种子还是跨多个官方域名的多文件大版本种子，文件在 `info["file tree"]` 中的路径层级规定如下：

* **第一级目录**：固定为官方源经 RFC 3986 Section 6.2.2 规范化后的完整主机名（`<host>[:<port>]`，小写且不含默认端口 `:80` / `:443`）。
* **后续各级目录与文件名**：固定为**百分号解码（Unescaped）后的原始 UTF-8 字符串**。
  * **原因说明**：主流 BT 客户端（如 `libtorrent`）在发起 BEP-19 WebSeed 请求时，会对种子内的文件路径自动调用一次 URL 路径编码函数（如 `escape_path`，对除 `/ - _ . ~ ! * ( ) ; ? : @ = & , $ A-Za-z0-9` 以外的字符包括 `%` 进行转义）。如果把文件名或完整 URL 预先做百分号编码（如包含 `%2F`、`%20`）存入 `info["file tree"]`，BT 客户端发起 WebSeed 请求时会把 `%` 二次转义为 `%25`（变成 `%252F`、`%2520`），导致 HTTP 请求 404。因此必须按原始目录层级和未转义文件名存入 `info["file tree"]`。
* **还原 URL**：客户端遍历 `info["file tree"]` 还原 `orig_url` 时，对除第一级主机名外的每级路径段按 RFC 3986 进行百分号编码后，与协议头和主机名拼接（不支持含 `?key=value` Query String 的动态 URL）。
* **路径示例**：
  * `https://piston-meta.mojang.com/v1/packages/17c54eb33b5d4a8f9c04eb1234567890abcdef01/1.21.4.json` 在 `file tree` 中的路径为：
    `piston-meta.mojang.com/v1/packages/17c54eb33b5d4a8f9c04eb1234567890abcdef01/1.21.4.json`
  * `https://libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar` 在 `file tree` 中的路径为：
    `libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`
  * `https://resources.download.minecraft.net/ab/ab1234567890abcdef1234567890abcdef123456` 在 `file tree` 中的路径为：
    `resources.download.minecraft.net/ab/ab1234567890abcdef1234567890abcdef123456`

### 3. WebSeed 字段规范（`info["ns-schemes"]`、`info["ns-mirrors"]` 与 `url-list`）

为了确保通过磁力链接（BEP-9 `ut_metadata` 仅传输 `info` 字典）获取元数据的客户端也能拿到完整的 WebSeed 配置，且配置受 InfoHash v2 校验保护，NCP 的官方源协议头与第三方镜像源（如 BMCLAPI）WebSeed 映射信息统一存放在 **`info` 字典内部**：

1. **`info["ns-schemes"]`（官方源协议头列表）**：
   * 类型：`list<string>`（Bencode 列表），缺省为 `["https://"]`。
   * 用途：声明将 `info["file tree"]` 中的 `<host>/<path>` 还原为官方源 WebSeed URL 时使用的协议头（即 `<scheme><host>/<escaped_path>`）。
2. **`info["ns-mirrors"]`（BMCLAPI 等镜像源 WebSeed 映射字典）**：
   * 类型：`dict<string, list<string>>`（Bencode 字典，Key 为 `info["file tree"]` 第一级目录中的官方源主机名 `<host>[:<port>]`，Value 为对应镜像源的目标 URL 前缀列表，末尾不带 `/`）。
   * 用途：由于 BMCLAPI 等镜像源并非简单的域名 1:1 替换，而是将不同 Mojang 域名映射到不同子路径（如 `libraries.minecraft.net` 映射至 `/maven`，`resources.download.minecraft.net` 映射至 `/assets`），普通 BEP-19 拼接无法直接表达。将该映射表存入 `info["ns-mirrors"]` 后，NodeStone SDK（及集成 NCP WebSeed 补丁的 BT 引擎）在请求文件 `<host>/<subpath>` 时，可将 `<host>` 替换为 `info["ns-mirrors"][<host>]` 中的每个镜像前缀，拼接出 `<mirror_prefix>/<escaped_subpath>` 作为额外 WebSeed 并发或回退下载。
   * Minecraft 命名空间下的 `info["ns-mirrors"]` 结构（JSON 表示）：
     ```json
     "ns-mirrors": {
       "libraries.minecraft.net": [
         "https://bmclapi2.bangbang93.com/maven"
       ],
       "piston-data.mojang.com": [
         "https://bmclapi2.bangbang93.com"
       ],
       "piston-meta.mojang.com": [
         "https://bmclapi2.bangbang93.com"
       ],
       "resources.download.minecraft.net": [
         "https://bmclapi2.bangbang93.com/assets"
       ]
     }
     ```
   * 注意：`info["ns-mirrors"]` 仅用于 WebSeed 下载加速，客户端在展开 `info["file tree"]` 生成本地 `NSFID` 索引时，只使用 `info["ns-schemes"]` 还原官方源 URL 计算 `NSFID`。
3. **顶层 `url-list` 与普通 BT 客户端的 WebSeed 兼容**：
   * 根据标准 BEP-19 规范，未修改的普通 BT 客户端请求多文件种子 WebSeed 时，固定将顶层 `url-list`、种子名 `info["name"]` 和文件相对路径拼接为 `<url-list>/<info.name>/<host>/<subpath>`，并向 `url-list` 所在主机发起 HTTP 请求。
   * 若种子仅包含单一域名且以该域名下的公共首层目录作为 `info["name"]`（例如 `url-list` 为 `https://piston-meta.mojang.com/`，`info["name"]` 为 `v1`），普通 BT 客户端可不经任何中介直接拼出 Mojang 官方源 URL。
   * 对于跨多个域名的 `minecraft-1.21-full` 等大版本合包种子：
     * **NodeStone SDK（修改 WebSeed 拼接层后的 `libtorrent` 等 BT 引擎）**：直接读取 `info["ns-schemes"]` 与 `info["ns-mirrors"]`，跳过 `info["name"]` 层级，在本地直接拼出 Mojang 官方源 URL 与 BMCLAPI 镜像源 URL 发起 WebSeed 请求（忽略顶层 `url-list`）。
     * **未修改的普通 BT 客户端**：若服务端在种子顶层 `url-list` 中填入支持将 `/<info.name>/<host>/<subpath>` 307 重定向至 `https://<host>/<subpath>` 的 WebSeed 端点（如 `https://webseed.nodestone.io/`），普通 BT 客户端无需禁用 WebSeed 即可通过 Mojang 官方源完成 WebSeed 下载（仅不支持读取 `info["ns-mirrors"]` 的 BMCLAPI 源）；若服务端未部署该重定向端点，则顶层不写 `url-list`。

## 4. `latest.json` 完整示例

以下示例中：
* `version_manifest_v2.json` 采用 `"type": "raw_file"` 内嵌直出。示例载荷 `"eyJ2ZXJzaW9ucyI6W119"` 解码后为 `{"versions":[]}`（15 字节），其对应的 SHA-256 为 `e64db0fde59206a0cf85c783e644f5e2ffd6a519dbf7d720cc9e5b0ace3d46a4`。
* `1.21.3.json` 与 `1.21.4.json`（及该大版本下的 `<asset_index>.json`）共同指向大版本全量种子 `minecraft-1.21-full`（Hash 为 `3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b`）。当后续 Mojang 发布 `1.21.5` 时，服务端重新打包 `minecraft-1.21-full` 并替换该 Hash，客户端拉取新 `latest.json` 后自动清理不在 `assets.torrents` 中的旧 Hash。

```json
{
  "filetype": "nscl/v0.10",
  "namespace": "minecraft",
  "revision": 1090,
  "generatedBy": "compass-worker-hk-01",
  "generateDate": "2026-11-25T02:00:00Z",
  "nsci": {
    "raw_kv": {
      "url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u": "e64db0fde59206a0cf85c783e644f5e2ffd6a519dbf7d720cc9e5b0ace3d46a4",
      "url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL3YxL3BhY2thZ2VzL2EzZjFiMmM0ZDVlNmY3MDg5MWIyYzNkNGU1ZjZhN2I4YzlkMGUxZjIvMS4yMS4zLmpzb24=": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b",
      "url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL3YxL3BhY2thZ2VzLzE3YzU0ZWIzM2I1ZDRhOGY5YzA0ZWIxMjM0NTY3ODkwYWJjZGVmMDEvMS4yMS40Lmpzb24=": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
    }
  },
  "assets": {
    "torrents": {
      "e64db0fde59206a0cf85c783e644f5e2ffd6a519dbf7d720cc9e5b0ace3d46a4": {
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
            "https://compass.nodestone.io/v010/minecraft/torrents/3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b.torrent"
          ],
          "magnetic": "magnet:?xt=urn:btmh:12203a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b&dn=minecraft-1.21-full&tr=https%3A%2F%2Ftracker.nodestone.io%2Fannounce"
        }
      }
    }
  }
}
```

> **附：包含 `info["ns-mirrors"]` 与 `info["ns-schemes"]` 的 BT v2 `.torrent` Bencode 结构对照**
> 标准 BT v2 `.torrent` 的 `info` 字典内包含以主机名为第一级目录的 `file tree`、`meta version`（`i2e`）、`name`、`ns-mirrors`、`ns-schemes`、`piece length`，顶层包含 `piece layers` 字典（所有字典 Key 按字节序排列）：
> `d10:created by19:NodeStone Packer v213:creation datei1795264834e4:infod9:file treed22:piston-meta.mojang.comd2:v1d8:packagesd40:17c54eb33b5d4a8f9c04eb1234567890abcdef01d11:1.21.4.jsond0:d6:lengthi28540e11:pieces root32:<32-byte-merkle-root>eeeeeee12:meta versioni2e4:name19:minecraft-1.21-full10:ns-mirrorsd23:libraries.minecraft.netl37:https://bmclapi2.bangbang93.com/mavene22:piston-data.mojang.coml31:https://bmclapi2.bangbang93.come22:piston-meta.mojang.coml31:https://bmclapi2.bangbang93.come32:resources.download.minecraft.netl38:https://bmclapi2.bangbang93.com/assetsee10:ns-schemesl8:https://e12:piece lengthi16384ee12:piece layersdee`
> 其前半段（至 `pieces root32:` 前 219 字节）对应的 Base64 前缀为：
> `ZDEwOmNyZWF0ZWQgYnkxOTpOb2RlU3RvbmUgUGFja2VyIHYyMTM6Y3JlYXRpb24gZGF0ZWkxNzk1MjY0ODM0ZTQ6aW5mb2Q5OmZpbGUgdHJlZWQyMjpwaXN0b24tbWV0YS5tb2phbmcuY29tZDI6djFkODpwYWNrYWdlc2Q0MDoxN2M1NGViMzNiNWQ0YThmOWMwNGViMTIzNDU2Nzg5MGFiY2RlZjAxZDExOjEuMjEuNC5qc29uZDA6ZDY6bGVuZ3RoaTI4NTQwZTExOnBpZWNlcyByb290MzI6...`

## 5. 未来预留与演进计划

1. **`sha256:<Hex>` 格式的 NSFID**：
   BT v2 `info["file tree"]` 中记录的 `pieces root` 是按 16 KiB 分块计算的 Merkle 树根哈希，不等于文件整体的线性 SHA-256。因此在 v0.10.0 中，`latest.json` 及种子展开过程暂不使用 `sha256:` 前缀，仅在协议层预留该格式。
2. **正则表达式格式的 `nsci` 路由规则**：
   后续考虑在 `nsci` 下引入正则匹配表以进一步减小 `latest.json` 体积。正则规则仅在查找入口时做路由匹配使用，不作为 NSFID 使用，命中或展开后写入本地缓存的仍是具体的 `NSFID -> hash` 映射。
