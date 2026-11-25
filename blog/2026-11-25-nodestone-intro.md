---
slug: nodestone-intro
title: 介绍 NodeStone
authors: [nodestone]
tags: [发布]
date: 2026-11-25T10:00:00+08:00
description: NodeStone 是一个基于签名索引与 BitTorrent 的去中心化 Minecraft 分发网络：元数据只有约 100KB，客户端据此组建 Swarm，并在节点不足时自动回退到 Mojang 官方源 + BMCLAPI。
---

**NodeStone：基于签名索引与 BitTorrent 的去中心化 Minecraft 分发网络**

NodeStone 是一个开放、去中心化的 Minecraft 资源分发网络，主要用来分担传统中心化镜像站的带宽压力。它的核心结构很轻量：维护团队只负责生成并分发一个约 **100KB** 的元数据索引文件，客户端拿到索引后，基于它组建 BitTorrent Swarm 来完成游戏文件的分发。

{/* truncate */}

## 主要特性

- **混合拉取与兜底回退**：客户端通过 BT 与 HTTP 多源并发下载。当 P2P 节点不足或处于恶劣网络环境时，SDK 会自动无缝回退至 **Mojang 官方源 + BMCLAPI** 双源并发，确保下载速率不会低于传统方式。
- **去中心化与可自建**：文件传输完全依托去中心化的 BT 网络，100KB 的元数据文件也由多个镜像联合分发。从元数据生成服务（**MagneticFlux**）到客户端 SDK 全部开源，任何团队或个人都可以自行部署元数据生成服务，不存在单点故障问题。
- **校验与防滥用**：面对不可信的去中心化节点，NodeStone 通过 **EdDSA 签名元数据 + 种子强制校验 + BT 协议自带分块校验** 来保证文件完整性。同时，协议层会自动识别并屏蔽恶意刷流量的下载者或投毒上传者。
- **低门槛与全开源**：NodeStone 的元数据分发是一项纯公益服务，欢迎任何形式的 PR 和建议。网络对节点没有公网 IP 或稳定服务器的要求，普通客户端即可直接参与上传和下载。

## 关于合规性的说明

严格来讲，在客户端开启 NodeStone 的上传（做种分发官方文件）在条款上违反了 Mojang EULA。不过作为一个客观事实供参考：Mojang 已经 9 年没有管过 BMCLAPI 了。是否接入、以及是否默认开启上传，建议由各位启动器作者结合自身情况自行评估。

## 接入与参考

- **启动器开发者**：查看客户端 SDK 与接入文档，请访问 [NodeStoneDev/Compass](https://github.com/NodeStoneDev/Compass)，站内指南见[启动器接入](/docs/guides/launcher-integration)。
- **技术原理**：[元数据规范](/docs/compass/protocol)与 [MagneticFlux 架构说明](/docs/compass/overview)。
- **部署加速节点**：[专职节点部署指南](/docs/guides/self-hosted-mirror)。
- **玩家使用**：在支持 NodeStone 的启动器中把下载源选为 NodeStone 即可，详见[面向玩家的介绍](/news/nodestone-for-players)。
