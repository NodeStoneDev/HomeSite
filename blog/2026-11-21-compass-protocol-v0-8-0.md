---
slug: compass-protocol-v0-8-0
title: Compass Protocol v0.8.0 发布
authors: [nodestone]
tags: [协议, 发布]
date: 2026-11-21T18:30:00+08:00
description: NCP v0.8.0 确定了可变/不可变的投递分工、用 ns-schemes 取代 url-list，并把客户端与服务端的工程约定写进规范。
---

**NodeStone Compass Protocol（NCP）v0.8.0** 已于 2026-11-21 发布。这一版没有推翻旧结构，但把过去分散在各处的工程约定收拢成了可执行的红线。

{/* truncate */}

## 一条规则定下投递分工

> 可变索引直出、不可变版本打包做种。

- 高频变化的顶层入口（`version_manifest_v2.json`）强制走 `delivery.integrated.type = "raw_file"`，把文件本体内嵌进 `latest.json`，**不再生成 `.torrent`**。
- 已发布的不可变资源（`<version>.json`、`client.jar`、`libraries`、`assets`）按颗粒度打包成 BT v2 种子长期做种。

这一条带来的简化是连锁的：服务端不必清理每次发版产生的废弃种子，客户端也不必维护「入口 vs 派生」的引用计数。

## 三个技术变更

1. **`ns-schemes` 取代 `url-list`。** 种子 `info["file tree"]` 第一级固定为官方主机名，协议头放在顶层 `ns-schemes`。标准 BEP-19 `url-list` 被禁用——否则普通 BT 引擎会把 `info["name"]` 拼进域名位置，直接 DNS 失败。
2. **NSFID 规范化收紧。** `url:<Base64>` 编码前必须执行 RFC 3986 §6.2.2 规范化：协议与主机小写、去默认端口、`%XX` 统一大写、折叠 `/./` 与 `/../`。不同语言实现必须得到同一串字节。
3. **交付类型显式化。** `nsGetTorrent` 明确返回 `DeliveryResult::Torrent` 或 `DeliveryResult::DirectFile`，避免内嵌直出文件与种子在调用链上互相污染。

## 磁力链接成为有门槛的能力

`delivery.magnetic` 必须携带至少一个 `&tr=` Tracker 参数。更关键的是：BEP-9 `ut_metadata` 只能拉 `info` 字典，拉不到 `piece layers`；而 BT v2 中任何大于 16 KiB 的文件都依赖 `piece layers` 校验。因此**声明支持磁力的客户端，其 BT 引擎必须实现 BEP-52 的 `hash request` / `hashes` 扩展**。

## 两篇新文档

- [客户端推荐实现](/docs/compass/client)：批量下载调度、缓存未命中四步自愈、WebSeed 302 路由（零 BT 引擎改动）、本地缓存表结构与 Upsert 规范。
- [服务端推荐实现](/docs/compass/server)：Packer 打包规范、NSCL 构建流程、minisign 签名与「先种子后清单」的原子发布顺序。

## 兼容性

v0.8.0 与 v0.7.0 Preview 在清单形状上兼容，但不保证逐字段兼容——请以 [协议规范](/docs/compass/protocol) 的字段表为准。变更明细见[版本历史](/docs/compass/changelog)。
