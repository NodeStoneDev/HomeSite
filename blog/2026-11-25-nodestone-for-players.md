---
slug: nodestone-for-players
title: 为广大玩家介绍 NodeStone
authors: [nodestone]
tags: [发布]
date: 2026-11-25T11:00:00+08:00
description: NodeStone 是一个开源、公益的 Minecraft 下载加速网络——在启动器里把下载源切过去，就能靠 P2P 把游戏文件拉得更快、更稳。
---

**NodeStone：开源、公益的 Minecraft 下载网络**

NodeStone 是一个开放的 Minecraft 下载加速网络。只要在支持它的启动器里把下载源切到 NodeStone，就能直接用。

{/* truncate */}

它和普通镜像站不太一样，整个网络只靠一个约 **100KB** 的索引文件来运转：启动器拿到这个小文件后，会自动连入 BitTorrent（P2P）网络，和其他人一起互相传数据。

- **速度只会更快，不会更慢**：NodeStone 会同时结合 BT 和 HTTP 源来拉取文件。哪怕遇到冷门版本或者周围节点很少的极端情况，它也会自动回退到 Mojang 官方源 + BMCLAPI 一起下，保证下载速度的下限。
- **不容易整体崩溃**：因为文件分发是去中心化的，索引文件本身也有多个镜像在同时提供，所以很难出现「某台服务器一崩，大家就都下不了游戏」的情况。
- **文件安全有保障**：虽然节点来自四面八方，但索引文件经过了数字签名，加上种子和 BT 协议自带的强校验，下到的文件损坏了或者被动手脚了都会被直接拦下，不用担心下到假文件。
- **顺手帮别人加速**：NodeStone 从头到尾都是开源的纯公益项目。你不需要有公网 IP 或服务器，开着 NodeStone 下游戏时就在参与分享；协议本身也会自动防着恶意刷流量的节点，不用担心被白嫖带宽。

## 相关链接

- **普通玩家**：直接在你的启动器里打开 NodeStone 开关，或换用支持 NodeStone 的启动器即可。
- **想专门帮大家加速**：如果你有闲置的服务器或宽带想做贡献，可以看[节点部署说明](/docs/guides/self-hosted-mirror)。
- **想了解具体原理**：[原理介绍](/docs/intro)与[总体架构](/docs/architecture)。
- **想看技术细节**：[面向开发者的介绍](/news/nodestone-intro)。
- **项目主页**：[NodeStoneDev/Compass](https://github.com/NodeStoneDev/Compass)。
