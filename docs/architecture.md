---
title: 总体架构
sidebar_position: 2
description: NodeStone 的分层结构：发布源、签名索引、内容寻址与节点分发、SDK 与启动器。
---

# 总体架构

NodeStone 从下往上分成四层。每一层只依赖下一层的契约，可以独立替换：镜像源可以换 CDN，客户端可以换 BT 引擎，启动器可以换 UI。

```text
┌──────────────────────────────────────────────────────────────┐
│  启动器 / 第三方客户端                                        │
│  只关心「给我这个官方 URL 对应的文件」                          │
└───────────────────────────┬──────────────────────────────────┘
                            │  nsGetFile / nsGetFilesBatch
┌───────────────────────────▼──────────────────────────────────┐
│  NodeStone SDK                                               │
│  本地 NSCI 缓存 · 批量调度 · 缓存未命中自愈 · WebSeed 302 路由  │
└───────────────────────────┬──────────────────────────────────┘
                            │  Torrent / DirectFile
┌───────────────────────────▼──────────────────────────────────┐
│  节点网络                                                     │
│  BitTorrent v2 (BEP-52) · DHT / PEX / LSD · Tracker · WebSeed  │
└───────────────────────────┬──────────────────────────────────┘
                            │  Hash → delivery
┌───────────────────────────▼──────────────────────────────────┐
│  发布层：NSCL (latest.json) + minisign 签名                   │
│  nsci.raw_kv: NSFID → Hash · assets.torrents: Hash → delivery │
└──────────────────────────────────────────────────────────────┘
```

## 发布层：一份签名清单

清单文件（NSCL）固定在 `<源>/v08/<namespace>/latest.json`，旁边是同路径的 `latest.json.minisig`。

它只包含两类信息，彼此分开存放：

- `nsci.raw_kv`：`NSFID → Hash`。只收录**入口文件**——`version_manifest_v2.json`、各版本 `<version>.json`、各 `<asset_index>.json`。
- `assets.torrents`：`Hash → delivery`。描述每个哈希怎么拿到：内嵌载荷（`integrated`）、种子直链（`url`）或磁力链接（`magnetic`）。

> 为什么不合并成一张表？因为同一份 `delivery` 常被多个 `NSFID` 共享（例如同一大版本下多个小版本共用同一个 assets 种子），分开存能让清单体积小一个数量级。详见[协议规范 §1](/docs/compass/protocol#1-为什么把-nsci-和-torrents-分开)。

## 内容层：内容寻址 + 种子

| 资源类型 | 变化特征 | 投递方式 |
| --- | --- | --- |
| `version_manifest_v2.json` | 每次发版都变，且不展开子文件 | `raw_file` 内嵌直出，不打种子 |
| `<version>.json` + `client.jar` + `libraries` | 发布后不可变 | 版本核心种子 `minecraft-core-<ver>` |
| `<asset_index>.json` + 全部 `objects` | 按大版本聚合 | 大版本 Assets 种子 `minecraft-assets-<major>` |

两条硬约束保证 URL 能被无损还原：

1. 种子 `info["file tree"]` 的**第一级目录固定为官方源主机名**（如 `piston-meta.mojang.com`、`libraries.minecraft.net`），后续层级对应 URL 路径。
2. 协议头放在种子顶层 `ns-schemes` 字段，**不使用**标准 BEP-19 `url-list`（否则普通 BT 引擎会把 `info["name"]` 拼进域名，直接 DNS 失败）。

这样「主机名 + 路径」拼回去就是原始官方 URL，再做 RFC 3986 规范化与 Base64 编码，就得到 `url:<Base64>` 形式的 **NSFID**。

## 传输层：节点网络

发布者只需保证**至少一个完整做种节点在线**（含完整 `piece layers`），其余流量由以下机制自动扩散：

- **BEP-5 DHT / BEP-11 PEX / BEP-14 LSD**：公网与局域网内快速寻址。
- **Tracker**：磁力链接冷启动时的初始 Peer 通道，`delivery.magnetic` 强制携带 `&tr=`。
- **WebSeed 兜底**：完全没有 Peer 时，SDK 通过本地 302 路由把分块请求重定向到官方源，复用 BT 引擎原生的 Range 与 Merkle 校验调度。

## 客户端层：SDK

SDK 对启动器暴露的语义只有一条：**官方 URL 进，本地文件路径出**。它负责：

- 维护本地 `NSFID → Hash` 缓存（`.nodestone/` 目录）；
- 把上百个小文件的下载请求按种子聚合、批量提交；
- 在缓存未命中时按四步自愈流程补齐（规范化重算 → 入口种子补拉 → 扫描未展开种子 → 明确报错）；
- 用本地 HTTP 302 路由桥接 WebSeed，避免手写分块与 Merkle 校验。

## 部署拓扑

```text
              ┌─────────────┐        ┌──────────────┐
   镜像源 A ──►│ 对象存储/CDN│        │  Tracker     │
              │ latest.json │        └──────┬───────┘
   镜像源 B ──►│ .minisig    │               │
              │ *.torrent   │        ┌──────▼───────┐
              └──────┬──────┘        │ Seeder 节点  │◄──┐
                     │               └──────┬───────┘   │
                     │ 拉清单               │ 分块       │ P2P
              ┌──────▼───────────────────────▼───────────┴──┐
              │  启动器（SDK）—— 同时也是上传方（做种）        │
              └──────────────────────────────────────────────┘
```

多个镜像源的**同一个种子 Hash 完全一致**，只是各自的 `delivery` 配置不同，因此镜像之间天然互为备份，客户端也可以自由切换而不会打断已下载的数据。

下一步：[协议总览与最小实现](/docs/compass/overview) → [协议规范](/docs/compass/protocol)。
