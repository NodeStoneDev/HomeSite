---
title: 常见问题
sidebar_position: 3
description: 关于 NodeStone 与 Compass 协议最常见的疑问。
---

# 常见问题

## NodeStone 是一个启动器吗？

NodeStone 首先是**分发网络与协议**：一套签名的元数据源（Compass）、一套开放的传输协议（NCP）、一个供启动器接入的 SDK。任何人都可以在自己的启动器里接入 NodeStone 源，也可以只架一个镜像源供现有启动器使用。

## 和普通镜像源（如 BMCLAPI 那类）有什么区别？

| | 传统镜像源 | NodeStone |
| --- | --- | --- |
| 流量 | 全部由镜像站承担 | 由参与下载的节点分担，WebSeed 只在无 Peer 时兜底 |
| 一致性 | 各镜像文件可能不同步 | 索引以哈希为键，镜像之间同一个种子 Hash 完全一致 |
| 信任 | 靠 HTTPS 与站点信誉 | 清单 minisign 签名 + `revision` 防回滚 + 文件哈希逐块校验 |
| 清单体积 | 通常数千至上万条完整条目 | 约 20 KB，只收入口级映射 |

需要注意一个细节：**接入 NCP SDK 时传入的必须是 Mojang 官方原始 URL**，不要传已经被第三方镜像源替换过的地址，否则 NSFID 对不上。

## 客户端一定要跑 BitTorrent 吗？

不。协议在传输上只要求「能按 BEP-52 校验分块」。

- 有现成 BT 引擎（`libtorrent-rasterbar`、`rqbit`、`anacrolix/torrent` 等）：按[客户端推荐实现](/docs/compass/client)里的 C-1 方案，用本地 302 路由桥接 WebSeed，零引擎改动。
- 不想引入 BT 引擎：按 C-2 方案自己实现 Range 请求与 Merkle 校验，SDK 里已经定义了分块对齐规则。

## 为什么有的文件没有种子？

`version_manifest_v2.json` 这类**高频变化的顶层入口文件**故意不打种子。每次发版都生成新种子会产生大量废弃做种任务，也会逼客户端做引用计数清理。协议因此强制这类文件走 `raw_file` 直出，把载荷内嵌进 `latest.json`。

反过来说，`raw_file` **不能**用于需要展开子文件索引的入口（`<version>.json`、`<asset_index>.json`），那是协议红线。

## `latest.json` 才 20 KB，够用吗？

够。因为它只存入口映射；某个版本需要哪些 `libraries`、哪些 `assets` 对象，都由该版本的种子在 `file tree` 里展开后写回本地缓存。客户端请求 `<version>.json` 的那一刻，整条依赖链的映射就补齐了。

## 版本回滚怎么办？

清单带单调递增的 `revision`，客户端必须拒绝比本地缓存更小的 `revision`。这样即使某个镜像源被替换成旧版（签名依然合法），也无法把客户端降级。

## 协议现在稳定吗？

当前是 **v0.8.0**。已经在用的部分（`url:<Base64>` 形式的 NSFID、BT v2 打包、minisign 发布）按稳定接口对待；明确标注「未来预留」的部分（`sha256:<Hex>` 形式的 NSFID、正则路由表）不保证兼容。变更记录见[版本历史](/docs/compass/changelog)。

## 我可以自己架镜像源吗？

可以，协议就是为此设计的：同一份清单与种子可以放到多个源，客户端按 `provider.urls` 顺序尝试。做法见[自建镜像源](/docs/guides/self-hosted-mirror)。

## 用什么许可证？

协议文档与规范以 Apache-2.0 发布，允许商用与二次实现。
