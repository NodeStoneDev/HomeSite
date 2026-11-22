---
title: 什么是 NodeStone
sidebar_position: 1
slug: /intro
description: NodeStone 是一套面向 Minecraft 生态的开源资源分发网络：轻量签名索引 + BitTorrent v2 内容分发 + 节点互助。
---

# 什么是 NodeStone

**NodeStone 是一套面向 Minecraft 生态的开源资源分发网络。** 它把游戏本体、ModLoader 与 Mod 的下载索引压缩成一份约 20 KB 的签名清单，把实际文件交给 BitTorrent v2 的节点网络去搬运，并给启动器留下一组「照着调就能跑」的接口。

一个游戏版本动辄几百 MB、上万个小文件；原作者 CDN 在高峰期经常只有几十 KB/s；第三方镜像源既要扛全量流量，又常常因为搬运动辄数 GB 的资源而难以维持。NodeStone 的思路是把「索引」和「内容」彻底分开：

- **索引很小**：一份清单就够，几秒拉完，可以随便镜像。
- **内容按哈希寻址**：同一个文件全网只有一种身份，谁有就谁给，天然可校验、可缓存、可去重。
- **节点互助**：下载的人越多，可用的上传方就越多，而不是越挤越慢。

## 它由三部分组成

| 组成 | 说明 | 对应文档 |
| --- | --- | --- |
| **Compass 服务** | NodeStone 官方基于协议维护的元数据源，提供 Minecraft 本体、ModLoader 及 Mod 的下载索引（`latest.json`，约 20 KB） | [协议总览](/docs/compass/overview) |
| **NCP 协议** | NodeStone Compass Protocol —— 描述清单格式、文件标识（NSFID）、种子打包规范与校验规则的开放协议，当前版本 **v0.9.0**，Apache-2.0 | [协议规范](/docs/compass/protocol) |
| **SDK 与节点** | 官方开发包，把「传一个官方 URL、拿回一个本地文件」封装成 `nsGetFile` / `nsGetFilesBatch` 两个调用；底层由 BitTorrent v2 节点（DHT / PEX / LSD）与 WebSeed 兜底完成搬运 | [启动器接入](/docs/guides/launcher-integration) |

## 一次下载发生了什么

```text
启动器                            NodeStone SDK                       节点网络
  │                                    │                                 │
  │  解析 <version>.json / assets       │                                 │
  │───────────────────────────────────►│                                 │
  │  nsGetFilesBatch(NSFID 列表)        │  查本地 NSCI 缓存 (NSFID→Hash)   │
  │                                    │────────┐                        │
  │                                    │◄───────┘ 命中 → 得到种子 Hash    │
  │                                    │  挂载种子 + 本地 WebSeed 路由     │
  │                                    │────────────────────────────────►│ 分块
  │                                    │◄────────────────────────────────│ 校验
  │◄───────────────────────────────────│  返回 Map<NSFID, 本地路径>        │
```

启动器上层的调用方式几乎不变：**你已经拿到的 Mojang 官方 URL，原样传进去即可**，底层会自动把它映射到签名索引里的条目、BT v2 种子或内嵌直出载荷。

## 五条设计原则

1. **索引轻量、内容沉重。** `latest.json` 只记录入口级的 `NSFID -> Hash` 映射，实际文件清单由种子展开，所以清单能稳定维持在几十 KB。
2. **一切可校验。** 清单用 minisign 签名，`revision` 单调递增防回滚；索引以目标哈希为键；分块由 BEP-52 Merkle 树校验。
3. **可变的东西直出，不可变的东西做种。** 例如 `version_manifest_v2.json` 每次发版都变，就内嵌进清单直出；`client.jar`、`libraries`、`assets` 永不改变，就打包成种子长期做种。
4. **协议只约束「是什么」，不约束「怎么做」。** 客户端可以用任意 BT 引擎，服务端可以放在任意 CDN、任意镜像源。
5. **失败要能被解释。** 缓存未命中、索引缺失、镜像滞后都有明确的排查顺序和错误语义，不会静默吞掉。

## 从哪里开始

- 想搞清楚整体结构 → [总体架构](/docs/architecture)
- 想在启动器里接入 → [启动器接入指南](/docs/guides/launcher-integration)
- 想自己架一个镜像源 → [自建镜像源](/docs/guides/self-hosted-mirror)
- 想读协议原文 → [协议总览与最小实现](/docs/compass/overview)
- 想知道最近改了什么 → [新闻](/news) · [版本历史](/docs/compass/changelog)
