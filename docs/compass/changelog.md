---
title: 版本历史
sidebar_position: 5
description: NodeStone Compass Protocol (NCP) 的历史版本与变更要点。
---

# 版本历史

## v0.8.0 — 2026-11-21

当前版本。协议从「索引怎么存」收敛到「索引怎么发布」，并把服务端与客户端两侧的工程约定写进规范。

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

- **`sha256:<Hex>` 形式的 NSFID**：BT v2 的 `pieces root` 是按 16 KiB 分块的 Merkle 根，不等于文件整体 SHA-256，因此 v0.8.0 暂不启用，只保留格式。
- **正则路由表**：用于进一步压缩 `latest.json` 体积，仅作为查找入口时的匹配规则，**不作为 NSFID**；命中后写入缓存的仍必须是真实映射。
