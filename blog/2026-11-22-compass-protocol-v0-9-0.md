---
slug: compass-protocol-v0-9-0
title: Compass Protocol v0.9.0 发布
authors: [nodestone]
tags: [协议, 发布]
date: 2026-11-22T18:30:00+08:00
description: NCP v0.9.0 把打包颗粒度改成「一个游戏版本一个不可变种子」，并厘清了路径转义、WebSeed 307 桥接与 SQLite 本地缓存的具体规格。
---

**NodeStone Compass Protocol（NCP）v0.9.0** 已于 2026-11-22 发布。上一版定下了「可变索引直出、不可变版本做种」的分工，这一版把不可变那一半的打包颗粒度彻底简化，并补上了过去只能靠实现者自行猜测的细节。

{/* truncate */}

## 一个游戏版本 = 一个种子

v0.8.0 把不可变资源拆成两类种子：版本核心种子（`minecraft-core-<ver>`）与大版本 Assets 种子（`minecraft-assets-<major>`）。实际运行下来，后者是复杂度来源——每发布一个小版本（`1.21.3` → `1.21.4`），大版本 Assets 种子就可能因为新增对象而重新打包，InfoHash 随之变化，历史种子、客户端缓存与做种任务都要跟着收拾。

v0.9.0 改成**按单个游戏版本**打包：

- 每个已发布版本对应一个 `minecraft-version-<ver>` 种子，包含该版本的 `<version>.json`、`client.jar`、该版本依赖的全部 `libraries`、对应的 `<asset_index>.json`，以及该索引关联的全部 `assets/objects`。
- `.torrent` 文件本身约 300 KB，拉取成本可以忽略；不同版本种子之间包含相同的公共 `libraries` / `assets` 文件也没关系——BT v2 中相同文件的 `pieces root` 完全一致，公共文件的 NSFID 指向任意一个已展开的版本种子都能正常下载。
- 种子一旦发布，InfoHash 永久固定，**不需要在发新版本时重打历史种子**。

连带的效果是清单更小：`nsci.raw_kv` 现在只收录 `version_manifest_v2.json` 与各版本 `<version>.json`。`<asset_index>.json` 不再单独列出，它作为版本种子的子文件，在展开 `file tree` 时自动写入客户端缓存——启动器请求 `<version>.json` 的那一刻，`client.jar`、`libraries`、`asset index` 与全部 `assets` 的映射一次性补齐。

## 路径必须能被无损还原

种子里的路径既要在磁盘上可读，又要在拼回 URL 时不出现二次转义。v0.9.0 把规则写死：

- `info["file tree"]` 第一级固定为官方源规范化后的主机名（`<host>[:<port>]`，小写、不含默认端口）。
- 后续各级目录与文件名必须是**百分号解码后的原始 UTF-8**（URL 里的 `%20` 在种子里存成空格）。
- 客户端还原 `orig_url` 时，对除主机名外的每级路径段执行 RFC 3986 编码（`quote(seg, safe="-._~")`，十六进制大写）。
- `info["name"]` 必须是纯 ASCII 且不含 `/`（如 `minecraft-version-1.21.4`），否则本地 WebSeed 代理在剥离 `/<info.name>/` 前缀时会产生切分歧义。

另外，`ns-schemes` 从种子顶层移进 `info` 字典：这样通过磁力链接 BEP-9 `ut_metadata` 拉取元数据的客户端也不会丢字段，且该字段受 InfoHash v2 完整性校验保护。顶层同名副本仅作兼容，标准 BEP-19 `url-list` 依然禁用。

## WebSeed 桥接：307 + torrenthash 前缀

无 Peer 时的兜底代理改成了 `307 Temporary Redirect`，路径固定为：

```text
http://127.0.0.1:<port>/webseed/<torrenthash>/<info.name>/<rel_path>
```

末尾斜杠必须保留（否则引擎会丢掉相对路径）。代理剥掉 `/webseed/<torrenthash>/<info.name>/` 前缀、按 torrenthash 查到该种子的 `ns-schemes`，对剩余路径段解码后重新编码，再以 `307` 跳到官方源，`Range` 头与方法原样保留。

同时明确了一条发布侧要求：**标准种子必须提供 `delivery.url`**。HTTP WebSeed 无法响应 BEP-52 的 `hash request`，客户端如果只拿到磁力链接，就可能在无 Peer 环境下拿不到 `piece layers`、无法校验大于 16 KiB 的文件。磁力链接保留为可选能力。

## 本地缓存落到 SQLite

`.nodestone/cache/nsci.db` 成为推荐的缓存实现：WAL 模式 + `busy_timeout = 5000`，三张表 `meta_state`、`torrents_state`、`nsci_cache`。两个关键约束：

- Upsert 只更新 `torrenthash`（`ON CONFLICT(nsfid) DO UPDATE SET torrenthash = excluded.torrenthash`），**保留**已有的 `rel_path` 与 `orig_url`，避免新清单覆盖掉可用的本地定位信息。
- 展开 `file tree` 与写入 `is_expanded = 1` 必须在**同一事务**内完成，避免中断后留下「以为已展开」的半成品状态。

`raw_file` 的语义也收紧了：内嵌载荷每次请求现场解码、校验整体 SHA-256 后直接交付，**不再**在 `.nodestone/` 下按 Hash 留存历史副本。

## 兼容性

清单路径升到 `<源>/v09/<namespace>/latest.json`，`filetype` 固定为 `"nscl/v0.9"`。v0.9.0 不保证与 v0.8.0 逐字段兼容（种子命名、`nsci.raw_kv` 收录范围、WebSeed 代理路径都有变化），请以 [协议规范](/docs/compass/protocol) 的字段表与[客户端推荐实现](/docs/compass/client)、[服务端推荐实现](/docs/compass/server) 为准。变更明细见[版本历史](/docs/compass/changelog)。
