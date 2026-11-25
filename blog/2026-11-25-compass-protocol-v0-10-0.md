---
slug: compass-protocol-v0-10-0
title: Compass Protocol v0.10.0 发布
authors: [nodestone]
tags: [协议, 发布]
date: 2026-11-25T14:00:00+08:00
description: NCP v0.10.0 新增 info["ns-mirrors"] 镜像源映射，删掉本地 307 代理改为引擎 URL 拼接，并把打包颗粒度改回大版本全量包。
---

**NodeStone Compass Protocol（NCP）v0.10.0** 已于 2026-11-25 发布。v0.9.0 把种子拆到「一个游戏版本一个」之后，实际运行暴露出两个问题：种子数量随版本线性增长，而 WebSeed 那条路为了实现镜像加速，不得不在本地起一个 HTTP 代理。这一版把这两件事一起解决。

{/* truncate */}

## 打包颗粒度回到大版本

v0.9.0 用 `minecraft-version-<ver>` 换掉了「版本核心 + 大版本 Assets」，好处是种子不可变、发版不用重打历史种子，代价是每个小版本都要单独拉一份约 300 KB 的 `.torrent`。v0.10.0 改回大版本全量包：

- 一个 `minecraft-1.21-full` 种子包含该大版本下所有小版本的 `<version>.json`、`<asset_index>.json`、`client.jar`、`libraries` 与关联的 `assets/objects`。
- 种子因此变成**可变**的。`1.21.3` 发布后，服务端重打 `1.21-full`、更新 `latest.json`，并从 `assets.torrents` 里移除旧 Hash。
- 客户端不需要关心「哪些种子变了」。每次拉 `latest.json` 后，把 `nsci_cache` 与 `torrents_state` 中不在 `latest.assets.torrents` 里的 `torrenthash` 记录删掉即可，磁盘上的旧 `.torrent` 异步清理。三张表之间不需要外键级联，也不需要引用计数。

顺带一个新约束：`nsci.raw_kv` 现在收录 `version_manifest_v2.json`、各版本 `<version>.json` **以及** `<asset_index>.json`，并且**下载任意版本前必须先请求该版本的 `<version>.json` 与 `<asset_index>.json`**。这一步的作用是先把大版本种子拉下来、把 `file tree` 展开进本地缓存，之后的 `client.jar`、`libraries`、`assets` 才能直接命中。因为这条约定成了强制流程，`nsGetFile` / `nsGetFilesBatch` 的 `contextEntryNSFIDs` 参数被移除了。

## info["ns-mirrors"]：把镜像映射写进种子

v0.9.0 的镜像加速靠一个本地 HTTP 307 环回代理（C-1 方案）：SDK 起服务、清空 `url-list`、把自己注册成 WebSeed，收到请求再剥前缀、解码、重编码、跳转到官方源或镜像源。这方案对引擎零侵入，但多了一个常驻进程、一层多余的请求往返，以及一套必须自己维护的路径切分逻辑。

v0.10.0 删掉 C-1，只保留修改引擎 URL 拼接层的 C-2 方案。配套的新字段是 `info["ns-mirrors"]`：

```json
"ns-mirrors": {
  "libraries.minecraft.net": ["https://bmclapi2.bangbang93.com/maven"],
  "piston-data.mojang.com": ["https://bmclapi2.bangbang93.com"],
  "piston-meta.mojang.com": ["https://bmclapi2.bangbang93.com"],
  "resources.download.minecraft.net": ["https://bmclapi2.bangbang93.com/assets"]
}
```

BMCLAPI 这类镜像不是域名 1:1 替换，而是按域名映射到不同子路径（`libraries.minecraft.net` 对应 `/maven`，`resources.download.minecraft.net` 对应 `/assets`），标准 BEP-19 的 `<url-list>/<info.name>/<rel_path>` 拼法表达不了。所以映射表直接放进 `info`：Key 是 `file tree` 第一级的官方源主机名，Value 是镜像 URL 前缀列表。

放进 `info` 而不是顶层有两个理由：`info` 受 InfoHash v2 完整性保护，且通过磁力链接 BEP-9 `ut_metadata` 拉元数据的客户端也能拿到完整配置。

引擎侧的行为变成：读 `info["ns-schemes"]` 与 `info["ns-mirrors"]`，**跳过** `info["name"]` 这一级，按首层 `<host>[:<port>]` 直接拼出官方源 URL 与各镜像源 URL，交给引擎原生的 Range 与 Merkle 校验调度。展开 `file tree` 计算 NSFID 时仍然只用官方源 URL，镜像只影响下载走哪条链路。

普通 BT 客户端不受影响：服务端若部署了把 `/<info.name>/<host>/<subpath>` 307 重定向到官方源的无状态网关（如 `https://webseed.nodestone.io/`），可以把网关写进顶层 `url-list`；没部署就不写，客户端按标准 BEP-19 行为处理。

## file tree 为什么不能预编码

这一版把 v0.9.0 里「必须是百分号解码后的原始 UTF-8」改成了带原因说明的表述，因为这条规则此前容易被理解成实现细节而非硬约束。

`info["file tree"]` 第一级是官方源主机名 `<host>[:<port>]`，后续各级是原始 UTF-8 路径段。主流 BT 客户端（如 `libtorrent`）发起 BEP-19 WebSeed 请求时会对文件路径调用一次 `escape_path`，`%` 也在被转义之列。如果预先把路径写成 `%2F`、`%20`，引擎会把它二次转义成 `%252F`、`%2520`，请求直接 404。所以种子里必须存原始层级与未转义文件名，编码只在还原 URL 时做一次。

## 兼容性

清单路径升到 `<源>/v010/<namespace>/latest.json`，`filetype` 固定为 `"nscl/v0.10"`。v0.10.0 不保证与 v0.9.0 兼容：种子命名（`minecraft-version-<ver>` → `minecraft-<major>-full`）、种子可变性、WebSeed 方案（C-1 → C-2）、`nsGetFile` 签名都有变化。请以 [协议规范](/docs/compass/protocol) 的字段表与[客户端推荐实现](/docs/compass/client)、[服务端推荐实现](/docs/compass/server) 为准，变更明细见[版本历史](/docs/compass/changelog)。
