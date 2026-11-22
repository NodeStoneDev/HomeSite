---
title: "服务端推荐实现"
sidebar_position: 4
description: "资源分类与投递策略、Packer 打包规范、URL 规范化与 NSFID 生成、NSCL 构建与发布流程。"
---

本文档将服务端打包（Packer）、NSCL（`latest.json`）清单生成、可变/不可变资源投递策略以及签名发布要求统一收拢，作为 NodeStone Compass 官方源与第三方镜像源构建服务端的工程规范。

## 1. 资源分类与投递策略（可变清单 vs 不可变版本种子）

服务端在构建某个命名空间（以 `minecraft` 为例）的分发索引时，必须严格区分**「高频可变顶层入口文件」**与**「不可变版本资源包」**，采用不同的投递策略：

### 1. 高频变化的纯独立单文件（强制使用 `raw_file`）

* **适用对象**：URL 固定不变、但内容随每次版本发布而更新、且**自身不需要展开任何下游子文件 NSCI 映射**的顶层入口文件（例如 Mojang 的 `version_manifest_v2.json`）。
* **投递要求**：
  1. 服务端**必须**使用 `delivery.integrated.type = "raw_file"` 直接将文件本体进行 Base64 编码后内嵌在 `latest.json` 中。
  2. 该条目在 `nsci.raw_kv` 中的 Value（Hash）为**该文件本体的 64 位小写十六进制整体线性 SHA-256**。
  3. **禁止为高频变化文件生成 `.torrent` 种子**：这样可以彻底避免服务端每次更新都产生新的废弃 `.torrent` 和做种任务，同时让客户端每次请求时直接从 `latest.json` 现场解码交付，无需在 `.nodestone/` 下管理任何历史缓存副本的生命周期。
  4. **禁止将 `raw_file` 用于含子文件依赖的入口**：任何承担「通过 `info["file tree"]` 展开下游子文件索引」职责的入口文件（如 `<version>.json`），**严禁**使用 `raw_file` 投递，必须打包在对应的 BT v2 种子中。

### 2. 已发布的不可变游戏版本资源（按版本独立制作 BT v2 种子）

已发布的游戏版本文件（`<version>.json`、`client.jar`、`libraries`、`<asset_index>.json`、`assets/objects`）内容一旦发布即固定不变。为了彻底消除「大版本聚合 Assets 种子随小版本发布而频繁重打包变动」带来的协议与客户端缓存复杂度，服务端应按**单个游戏版本**打包为独立的不可变 **BitTorrent v2（BEP-52）** 种子：

* **版本全量种子（`minecraft-version-<ver>`）**：
  * 包含该版本的 `<version>.json`、`client.jar`、该版本依赖的全部 `libraries` 文件、该版本对应的 `<asset_index>.json`（如 `19.json`）以及该索引关联的全部 `assets/objects` 资源文件。
  * 在 `latest.json` 的 `nsci.raw_kv` 中，**只需将该版本 `<version>.json` 的 `NSFID` 指向该种子的 InfoHash v2**（`<asset_index>.json` 已作为子文件包含在该版本种子的 `info["file tree"]` 中，客户端展开版本种子时会自动将其索引写入 `nsci_cache`，无需在 `latest.json` 中重复收录）。
  * 不同版本的 `minecraft-version-<ver>` 种子天然包含相同 URL 的公共 `libraries` 与 `assets/objects` 文件（在 BitTorrent v2 中，相同文件的 `pieces root` 完全一致；且客户端 `nsci_cache` 将公共文件指向任意一个已展开的版本种子均可正常通过 BT / WebSeed 完成下载）。
  * **版本种子永久不可变**：每个游戏版本的 `.torrent` 种子一旦生成发布，其 InfoHash v2 永久固定，服务端无需在发布新小版本时重打历史种子。

## 2. BT v2 种子打包规范（Packer 规范）

服务端打包器（NodeStone Packer）生成 `.torrent` 文件时，必须遵循以下底层规范：

1. **纯正 BitTorrent v2（BEP-52）格式**：
   * `info["meta version"]` 必须固定为整数 `2`（`i2e`）。
   * `info["name"]` 必须为不含路径分隔符 `/` 的纯 ASCII 标识符（例如 `minecraft-version-1.21.4`）。
   * 种子顶层字典**必须**包含 `piece layers` 字典（即使种子内所有文件均小于或等于 `piece length`，也必须写入空字典 `12:piece layersde`）。
   * 种子唯一标识（`torrenthash`）为 Bencode 编码后 `info` 字典的 SHA-256 值（64 位小写十六进制字符串）。
   * Bencode 字典的所有 Key 必须严格按照原始字节序（Lexicographical Order）排序。
2. **`info["file tree"]` 目录结构与原始 UTF-8 路径段约定**：
   * 无论是单文件种子还是跨多个官方域名的多文件种子，文件在 `info["file tree"]` 中的**第一级目录固定为官方源经 RFC 3986 Section 6.2.2 规范化后的完整主机名（`<host>[:<port>]`，小写且不含默认端口 `:80` / `:443`）**。
   * **后续目录层级与文件名必须存储百分号解码（Unescaped）后的原始 UTF-8 字符串**（例如 URL 路径中的 `%20` 在 `file tree` 中必须还原为空格 `' '`），以确保 BT 引擎落盘的文件名与真实文件名一致，并防止 BEP-19 WebSeed 请求时发生二次百分号编码。
   * 示例 1：`https://piston-meta.mojang.com/v1/packages/17c54eb33b5d4a8f9c04eb1234567890abcdef01/1.21.4.json`
     在 `file tree` 中的层级为：`piston-meta.mojang.com` -> `v1` -> `packages` -> `17c54eb33b5d4a8f9c04eb1234567890abcdef01` -> `1.21.4.json`。
   * 示例 2：`https://libraries.minecraft.net/com/mojang/logging/1.1.1/logging-1.1.1.jar`
     在 `file tree` 中的层级为：`libraries.minecraft.net` -> `com` -> `mojang` -> `logging` -> `1.1.1` -> `logging-1.1.1.jar`。
   * 示例 3：`https://resources.download.minecraft.net/ab/ab1234567890abcdef1234567890abcdef123456`
     在 `file tree` 中的层级为：`resources.download.minecraft.net` -> `ab` -> `ab1234567890abcdef1234567890abcdef123456`。
3. **协议头字段 `info["ns-schemes"]` 与禁用 `url-list`**：
   * **必须在 `info["ns-schemes"]` 中写入协议头列表**（例如 `["https://"]`），并推荐在种子顶层字典 `ns-schemes` 同步写入相同列表。将 `ns-schemes` 放入 `info` 字典内可确保通过磁力链接（BEP-9 `ut_metadata`）拉取元数据的客户端不会丢失该字段，且受 InfoHash v2 完整性校验保护。
   * **禁止在种子顶层写入标准 BEP-19 `url-list` 字段**：防止第三方普通 BT 引擎将 `info["name"]` 拼接到域名中向官方源发起错误请求。
4. **Tracker、`.torrent` 直链与做种节点（Seeder）部署**：
   * 种子顶层应写入 `announce` 及 `announce-list`（填入官方或镜像源的高可用 Tracker 地址）。
   * 服务端必须将完整 `.torrent` 文件发布至 CDN 并在 `delivery.url` 中提供直链，同时在发布前确保官方/镜像 Seeder 节点已挂载该完整种子（含完整的 `piece layers`）并处于活动做种状态。这样既能保证客户端通过 `delivery.url` 直接拿到 `piece layers` 走 WebSeed 校验下载，也能保证使用 `delivery.magnetic` 的客户端通过 BEP-9（`ut_metadata`）和 BEP-52（`hash request`）拉取完整元数据与 Merkle 分层哈希。

## 3. URL 规范化与 NSFID 生成规范

服务端在生成 `nsci.raw_kv` 中的 `NSFID` 时，必须与客户端以及 `info["file tree"]` 还原逻辑保持 100% 一致：

1. 对官方原始 URL 执行 **RFC 3986 Section 6.2.2（Syntax-Based Normalization）**：
   * `scheme` 和 `host` 转为小写；
   * 移除默认端口（`http` 的 `:80`、`https` 的 `:443`）；
   * 对路径段中除 RFC 3986 非保留字符（`ALPHA / DIGIT / "-" / "." / "_" / "~"`）以外的字符执行 UTF-8 百分号编码，所有百分号编码的十六进制字符统一转为大写（`%XX`），并解码所有被多余转义的非保留字符；
   * 折叠路径中的 `/./` 与 `/../`。
2. 确保种子 `info["file tree"]` 中的原始路径段在对每级路径段做 `quote(seg, safe="-._~")` 并与 `ns-schemes`、第一级主机名拼接后，得到的 `orig_url` 恰好等于上述规范化后的 URL。
3. 将规范化后的 URL 按 UTF-8 字节流进行标准 Base64 编码（RFC 4648，保留末尾 `=` 填充，不换行），加上 `url:` 前缀得到 `NSFID`。

## 4. NSCL（`latest.json`）构建与发布流程

每次服务端检测到上游资源更新（例如 Mojang 发布新版本导致 `version_manifest_v2.json` 变化并新增了该版本的种子）时，按以下原子流程构建并发布 `latest.json`：

1. **组装 `assets.torrents`**：
   * 为 `version_manifest_v2.json` 计算文件整体线性 SHA-256，生成 `delivery.integrated`（`"type": "raw_file"`，`"payload"` 为文件 Base64）。
   * 为所有已打包的游戏版本种子写入 `delivery.url`（`.torrent` 文件的 CDN/镜像直链列表）和 `delivery.magnetic`。
   * **磁力链接强制格式**：`delivery.magnetic` 必须符合 `magnet:?xt=urn:btmh:1220<torrenthash>&dn=<url-encoded-name>&tr=<url-encoded-tracker-1>&tr=<url-encoded-tracker-2>`，**必须携带至少一个可用的 `&tr=` 参数**。
2. **组装 `nsci.raw_kv`**：
   * 仅收录顶层清单（`version_manifest_v2.json`）与各版本 `<version>.json` 的 `NSFID -> Hash` 映射，保持 `latest.json` 体积轻量（约 20 KB）。
3. **递增 `revision` 与填写元数据**：
   * `filetype` 固定设为 `"nscl/v0.9"`。
   * `namespace` 设为当前命名空间（如 `"minecraft"`）。
   * `revision` 必须在上一版已发布清单的基础上**严格单调递增**（例如 `+1` 或使用单调递增的构建流水号）。
   * 填写当前构建节点标识 `generatedBy` 与 UTC 时间戳 `generateDate`（ISO 8601 格式）。
4. **minisign 签名与原子发布**：
   * 使用服务端私钥对生成的 `latest.json` 进行 minisign 签名，生成 `latest.json.minisig`。
   * 推荐在 minisign 的受信任注释（`trusted comment`）中写入 `namespace:<namespace> revision:<revision> date:<generateDate>`，防止跨命名空间重放。
   * **先上传种子，后更新清单**：必须先将新增的 `.torrent` 文件同步至对象存储/CDN 并通知 Seeder 挂载做种，确认可访问后，再将 `latest.json` 与 `latest.json.minisig` 原子替换发布到 `/v09/<namespace>/` 路径下。
