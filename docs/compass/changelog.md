---
title: 版本历史
sidebar_position: 5
description: NodeStone Compass Protocol (NCP) 的历史版本与变更要点。
---

# 版本历史

## v0.10.0 — 2026-11-25

当前版本。这一版重新梳理了种子目录结构与 WebSeed 拼接方式：新增镜像源映射字段，删掉本地代理方案，并把打包颗粒度改回大版本全量包。

- **新增 `info["ns-mirrors"]` 镜像源映射**：`dict<string, list<string>>`，Key 为 `info["file tree"]` 第一级的官方源主机名（如 `libraries.minecraft.net`），Value 是该主机的镜像 URL 前缀列表，可把 `libraries.minecraft.net`、`resources.download.minecraft.net`、`piston-meta.mojang.com`、`piston-data.mojang.com` 映射到 BMCLAPI。与 `ns-schemes` 同放 `info` 内，受 InfoHash v2 完整性保护，也能经 BEP-9 `ut_metadata` 传输。
- **移除 C-1 本地 307 代理，统一 C-2 引擎 URL 拼接**：客户端只保留修改 BT 引擎 URL 拼接层这一条路——识别 `info["ns-schemes"]` 与 `info["ns-mirrors"]` 后跳过 `info["name"]` 层级，按首层 `<host>[:<port>]` 直接拼出官方源与镜像源的 WebSeed URL。未修改的普通 BT 客户端仍走标准 BEP-19 `url-list`（官方源）。
- **恢复大版本全量种子与可变机制**：打包颗粒度从 v0.9.0 的「一个游戏版本一个不可变种子」改回 `minecraft-1.20-full`、`minecraft-1.21-full` 这类大版本全量包。种子可变，服务端重新打包后更新 `latest.json` 并从 `assets.torrents` 移除旧 Hash。
- **拉取 `latest.json` 即淘汰过期种子**：客户端每次拉清单都删除 `nsci_cache` 与 `torrents_state` 中不在 `latest.assets.torrents` 里的 `torrenthash` 记录，磁盘上的旧 `.torrent` 异步清理。三张表之间不需要外键级联或引用计数。
- **下载前必须先进版本 Manifest**：请求任意版本前必须先取得该版本的 `<version>.json` 与 `<asset_index>.json`，因此 `nsGetFile` / `nsGetFilesBatch` 移除了 `contextEntryNSFIDs` 参数。
- **路径构造补上原因说明**：`info["file tree"]` 第一级为 `<host>[:<port>]`，后续各级是百分号解码后的原始 UTF-8 路径段——不能预编码，否则 `libtorrent` 的 `escape_path` 会把 `%` 二次转义成 `%25`，还原出的 URL 会 404。
- **路径版本号升到 `v010`**：清单路径为 `<源>/v010/<namespace>/latest.json`，`filetype` 固定为 `"nscl/v0.10"`。
- **文档表述精简**：URL 规范化与 Base64 直接引用 RFC 3986 Section 6.2.2 与 RFC 4648，删去重复罗列；去掉「协议强制约束」「零修改」「四步自愈闭环」这类修饰。
- **修正规范示例**：`PROTOCOL_SPECIFICATION.md` §4 的 `raw_file` 示例 SHA-256 更正为 `e64db0fde59206a0cf85c783e644f5e2ffd6a519dbf7d720cc9e5b0ace3d46a4`（payload `"eyJ2ZXJzaW9ucyI6W119"` 即 `{"versions":[]}`）。

## v0.9.0 — 2026-11-22

这一版把打包颗粒度从「版本核心 + 大版本 Assets」收敛为**每个游戏版本一个不可变种子**，并把 URL 还原、WebSeed 桥接与本地缓存的细节写成了可实现的规格。

- **打包颗粒度改为按游戏版本**：新的 `minecraft-version-<ver>` 种子一次性包含该版本的 `<version>.json`、`client.jar`、全部 `libraries`、对应的 `<asset_index>.json` 与全部 `assets/objects`（`.torrent` 约 300 KB）。取消按大版本聚合的 Assets 种子，彻底消除「小版本发布导致历史种子重打包」的复杂度。
- **`nsci.raw_kv` 精简为两个入口**：只收录 `version_manifest_v2.json` 与各版本 `<version>.json`。`<asset_index>.json` 不再单独收录——它作为版本种子的子文件，在展开时自动写入本地缓存。
- **`raw_file` 不留历史副本**：内嵌载荷在每次请求时现场解码、校验 SHA-256 后直接交付，不再在 `.nodestone/` 下按 Hash 持久化历史缓存副本。
- **路径转义规则明确**：`info["file tree"]` 第一级为主机名，后续层级必须是**百分号解码后的原始 UTF-8**；客户端还原 `orig_url` 时对每级路径段执行 `quote(seg, safe="-._~")`。`info["name"]` 必须是纯 ASCII 且不含 `/`。
- **`ns-schemes` 移入 `info` 字典**：`info["ns-schemes"]` 为权威值（顶层同名字段仅作兼容），使经 BEP-9 `ut_metadata` 拉取的客户端也不丢协议头，并受 InfoHash v2 完整性保护。
- **WebSeed 桥接升级为 307**：本地代理路径改为 `http://127.0.0.1:<port>/webseed/<torrenthash>/<info.name>/<rel_path>`（末尾斜杠必须保留），对路径段做解码后重新编码，再以 `307 Temporary Redirect` 指向官方源。
- **标准种子必须提供 `delivery.url`**：HTTP WebSeed 无法响应 BEP-52 `hash request`，因此客户端优先用 `.torrent` 直链拿到完整 `piece layers`；磁力链接仍是可选能力。
- **本地缓存落到 SQLite**：`.nodestone/cache/nsci.db`（WAL + `busy_timeout`），三张表 `meta_state` / `torrents_state` / `nsci_cache`，Upsert 只更新 `torrenthash`、保留已记录的 `rel_path` 与 `orig_url`，展开与 `is_expanded = 1` 在同一事务内提交。
- **路径版本号升到 `v09`**：清单路径为 `<源>/v09/<namespace>/latest.json`，`filetype` 固定为 `"nscl/v0.9"`。

## v0.8.0 — 2026-11-21

- **可变 / 不可变分离的投递策略**：高频变化的顶层入口（`version_manifest_v2.json`）强制 `raw_file` 内嵌直出，不再生成种子；不可变的版本核心包与大版本 Assets 包各自打包为 BT v2 种子。
- **`ns-schemes` 取代 `url-list`**：种子顶层不再写标准 BEP-19 `url-list`，改用 NCP 专用 `ns-schemes`，并把 `info["file tree"]` 第一级固定为官方主机名，使 URL 可无损还原。
- **NSFID 规范化收紧**：URL 类型 NSFID 编码前必须执行 RFC 3986 §6.2.2 规范化，保证不同语言实现得到同一串字节。
- **交付类型显式化**：`nsGetTorrent` 返回 `DeliveryResult::Torrent` / `DeliveryResult::DirectFile` 两种可辨识类型，避免直出文件与种子在调用链上互相污染。
- **磁力链接强制 Tracker**：`delivery.magnetic` 必须携带 `&tr=`，并要求实现 BEP-52 `hash request` / `hashes` 才能声明支持磁力。
- **新增两篇推荐实现**：[客户端推荐实现](/docs/compass/client)（批量调度、四步自愈、WebSeed 桥接、本地缓存表）与[服务端推荐实现](/docs/compass/server)（Packer 规范、NSCL 构建、minisign 发布）。

## v0.7.0 Preview — 2026-11（预览）

首个公开预览版，确定了 NSCL / NSCI / NSFID 的基本形状：一份签名清单 + 一张 `NSFID → Hash` 索引表 + BT v2 种子分发。工程细节在 v0.8.0 中补齐。

## 下一步

协议层预留但不启用的两项能力：

- **`sha256:<Hex>` 形式的 NSFID**：BT v2 的 `pieces root` 是按 16 KiB 分块的 Merkle 根，不等于文件整体 SHA-256，因此 v0.10.0 暂不启用，只保留格式。
- **正则路由表**：用于进一步压缩 `latest.json` 体积，仅作为查找入口时的匹配规则，**不作为 NSFID**；命中后写入缓存的仍必须是真实映射。
