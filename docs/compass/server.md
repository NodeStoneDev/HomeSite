---
title: "服务端推荐实现"
sidebar_position: 4
description: "资源分类与投递策略、Packer 打包规范、URL 规范化与 NSFID 生成、NSCL 构建与发布流程。"
---

本文档说明服务端打包（Packer）、大版本可变种子组织策略、WebSeed 字段（`info["ns-schemes"]` 与 `info["ns-mirrors"]`）写入规范以及 NSCL（`latest.json`）清单构建发布流程。

## 1. 资源分类与打包策略

服务端在构建 `minecraft` 命名空间的分发索引时，将资源划分为「顶层单文件清单」与「大版本全量种子」两类：

### 1. 顶层单文件清单（使用 `raw_file` 内嵌直出）

* **适用对象**：URL 固定、内容随版本发布高频更新、且自身不需要展开下游子文件映射的顶层入口文件（如 Mojang 的 `version_manifest_v2.json`）。
* **打包方式**：
  1. 使用 `delivery.integrated.type = "raw_file"` 将文件本体 Base64 编码后内嵌在 `latest.json` 中，不为其生成 `.torrent` 种子。
  2. 该条目在 `nsci.raw_kv` 中的 Value（Hash）为该文件本体的 64 位小写十六进制整体 SHA-256。
  3. 任何需要通过种子 `info["file tree"]` 展开下游子文件映射的入口文件（如 `<version>.json`、`<asset_index>.json`），不能使用 `raw_file`，应打入对应的大版本 BT v2 种子中。

### 2. 大版本全量种子（如 `minecraft-1.20-full`、`minecraft-1.21-full`）与可变更新

同一大版本（如 `1.20.x` 或 `1.21.x`）下的各个小版本之间共享绝大多数 `libraries` 和 `assets/objects`。为提高同一大版本玩家群体的 P2P 做种共享率并简化分包结构，服务端按**大版本**将所有文件打包到一个全量 **BitTorrent v2（BEP-52）** 种子中：

* **打包范围（`minecraft-<major>-full`）**：
  * 包含该大版本下所有已发布小版本（例如 `1.21`、`1.21.1`、`1.21.2`、`1.21.3`、`1.21.4` 等）的 `<version>.json`、`<asset_index>.json`、`client.jar`、全部依赖的 `libraries` 以及全部关联的 `assets/objects` 资源文件。
  * 在 `latest.json` 的 `nsci.raw_kv` 中，将该大版本下所有小版本的 `<version>.json` 和 `<asset_index>.json` 的 `NSFID` 均指向该大版本全量种子的 InfoHash v2。
* **仍在更新的大版本种子可变机制**：
  * 对于已停止更新的历史大版本（如 `1.12-full`、`1.20-full`），种子内容与 InfoHash v2 保持固定。
  * 对于仍在更新的大版本（例如 `minecraft-1.21-full` 原本包含 `1.21.1` 和 `1.21.2`，随后 Mojang 发布了 `1.21.3`）：
    1. 服务端将 `1.21.3` 新增或变更的 `<version>.json`、`<asset_index>.json`、`client.jar`、`libraries`、`assets/objects` 并入 `1.21` 大版本目录树，重新生成新的 `minecraft-1.21-full` 种子（得到新的 InfoHash v2 `torrenthash_new`）；
    2. 在新发布的 `latest.json` 中，将 `1.21.1`、`1.21.2`、`1.21.3` 等所有归属 `1.21` 大版本的入口 manifest（`<version>.json` 与 `<asset_index>.json`）在 `nsci.raw_kv` 中统一指向 `torrenthash_new`；
    3. 从 `latest.assets.torrents` 中移除已被替代的旧种子 `torrenthash_old`，只保留 `torrenthash_new`。客户端拉取新 `latest.json` 时会自动识别并清除本地缓存中不在 `assets.torrents` 里的 `torrenthash_old`。

## 2. BT v2 种子打包规范（Packer 规范）

服务端打包器（NodeStone Packer）生成 `.torrent` 文件时，须遵循以下规范：

1. **BitTorrent v2（BEP-52）基础格式**：
   * `info["meta version"]` 设为整数 `2`（`i2e`）。
   * `info["name"]` 设为大版本包标识符（如 `minecraft-1.20-full`、`minecraft-1.21-full`），不含路径分隔符 `/`。
   * 种子顶层字典必须包含 `piece layers` 字典（即使所有文件均小于或等于 `piece length`，也须写入空字典 `12:piece layersde`）。
   * 种子唯一标识（`torrenthash`）为 Bencode 编码后 `info` 字典的 SHA-256 值（64 位小写十六进制字符串）。
   * Bencode 字典的所有 Key 按原始字节序（Lexicographical Order）排序。
2. **`info["file tree"]` 目录结构**：
   * 文件在 `info["file tree"]` 中的**第一级目录固定为官方源经 RFC 3986 Section 6.2.2 规范化后的完整主机名（`<host>[:<port>]`，小写且不含默认端口 `:80` / `:443`）**。
   * **后续各级目录与文件名存储百分号解码（Unescaped）后的原始 UTF-8 字符串**（不能将完整 URL 或百分号编码后的文件名直接作为扁平文件名写入，否则 BT 客户端发起 WebSeed 请求时会对 `%` 执行二次转义）。
   * 示例 1：`https://piston-meta.mojang.com/v1/packages/17c54eb33b5d4a8f9c04eb1234567890abcdef01/1.21.4.json`
     在 `file tree` 中的层级为：`piston-meta.mojang.com` -> `v1` -> `packages` -> `17c54eb33b5d4a8f9c04eb1234567890abcdef01` -> `1.21.4.json`。
   * 示例 2：`https://libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`
     在 `file tree` 中的层级为：`libraries.minecraft.net` -> `com` -> `mojang` -> `logging` -> `1.1.1` -> `logging-1.1.1.jar`。
   * 示例 3：`https://resources.download.minecraft.net/ab/ab1234567890abcdef1234567890abcdef123456`
     在 `file tree` 中的层级为：`resources.download.minecraft.net` -> `ab` -> `ab1234567890abcdef1234567890abcdef123456`。
3. **WebSeed 信息写入规范（`info["ns-schemes"]`、`info["ns-mirrors"]` 与 `url-list`）**：
   * **`info["ns-schemes"]`**：在 `info` 字典内写入官方源协议头列表（如 `["https://"]`）。
   * **`info["ns-mirrors"]`**：在 `info` 字典内写入第三方镜像源（如 BMCLAPI）的主机名替换映射字典（`dict<string, list<string>>`，Key 为 `file tree` 第一级主机名，Value 为镜像源目标 URL 前缀列表，末尾不带 `/`）。将 `ns-schemes` 与 `ns-mirrors` 放入 `info` 字典可确保磁力链接（BEP-9 `ut_metadata`）客户端也能完整获取 WebSeed 配置。
     ```json
     "ns-mirrors": {
       "libraries.minecraft.net": ["https://bmclapi2.bangbang93.com/maven"],
       "piston-data.mojang.com": ["https://bmclapi2.bangbang93.com"],
       "piston-meta.mojang.com": ["https://bmclapi2.bangbang93.com"],
       "resources.download.minecraft.net": ["https://bmclapi2.bangbang93.com/assets"]
     }
     ```
   * **顶层 `url-list`（可选）**：若服务端部署了将 `/<info.name>/<host>/<subpath>` 307 重定向至 `https://<host>/<subpath>` 的无状态 WebSeed 端点（如 `https://webseed.nodestone.io/`），可将其写入种子顶层 `url-list`，使未集成 NCP 引擎补丁的普通 BT 客户端也能无需禁用 WebSeed 直接从 Mojang 官方源下载；若未部署该端点，则顶层不写入 `url-list`。
4. **Tracker、`.torrent` 直链与做种节点（Seeder）部署**：
   * 种子顶层写入 `announce` 及 `announce-list`（填入官方或镜像源的 Tracker 地址）。
   * 服务端将完整 `.torrent` 文件发布至 CDN 并在 `delivery.url` 中提供直链，同时在发布前确保 Seeder 节点已挂载该完整种子（含 `piece layers`）并处于做种状态。

## 3. URL 规范化与 NSFID 生成

服务端在生成 `nsci.raw_kv` 中的 `NSFID` 时，须与客户端及 `info["file tree"]` 还原逻辑保持一致：

1. 对官方原始 URL 按 **RFC 3986 Section 6.2.2** 进行语法规范化，确保种子 `info["file tree"]` 中的路径段与 `info["ns-schemes"]`、第一级主机名拼接出的 `orig_url` 与该规范化 URL 一致。
2. 将规范化后的 URL 按 **RFC 4648** 进行标准 Base64 编码（UTF-8 字节流，保留末尾 `=` 填充，不换行），加上 `url:` 前缀得到 `NSFID`。

## 4. NSCL（`latest.json`）构建与发布流程

每次服务端检测到上游资源更新（例如 Mojang 发布新小版本，导致 `version_manifest_v2.json` 更新并重新打包了对应大版本的 `minecraft-<major>-full` 种子）时，按以下流程构建并发布 `latest.json`：

1. **组装 `assets.torrents`**：
   * 为 `version_manifest_v2.json` 计算文件整体 SHA-256，生成 `delivery.integrated`（`"type": "raw_file"`，`"payload"` 为文件 Base64）。
   * 为当前有效的大版本全量种子写入 `delivery.url`（`.torrent` 文件的 CDN/镜像直链列表）和 `delivery.magnetic`（格式为 `magnet:?xt=urn:btmh:1220<torrenthash>&dn=<url-encoded-name>&tr=<url-encoded-tracker>`，包含至少一个 `&tr=` 参数）。
   * 移除已被新大版本种子替代的旧种子 Hash。
2. **组装 `nsci.raw_kv`**：
   * 收录顶层清单（`version_manifest_v2.json`）、各版本 `<version>.json` 及 `<asset_index>.json` 的 `NSFID -> Hash` 映射，保持 `latest.json` 体积在 20 KB 左右。
3. **递增 `revision` 与填写元数据**：
   * `filetype` 设为 `"nscl/v0.10"`。
   * `namespace` 设为当前命名空间（如 `"minecraft"`）。
   * `revision` 在上一版已发布清单的基础上单调递增。
   * 填写构建节点标识 `generatedBy` 与 UTC 时间戳 `generateDate`（ISO 8601 格式）。
4. **minisign 签名与发布**：
   * 使用服务端私钥对生成的 `latest.json` 进行 minisign 签名，生成 `latest.json.minisig`（推荐在 `trusted comment` 中写入 `namespace:<namespace> revision:<revision> date:<generateDate>`）。
   * 先将新增或更新的 `.torrent` 文件同步至对象存储/CDN 并通知 Seeder 挂载做种，确认可访问后，再将 `latest.json` 与 `latest.json.minisig` 发布到 `/v010/<namespace>/` 路径下（并在后台清理服务端已淘汰的旧 `.torrent` 做种任务）。
