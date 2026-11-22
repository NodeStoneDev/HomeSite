---
title: 自建镜像源
sidebar_position: 2
description: 部署一个 NodeStone 镜像源：目录布局、清单构建、签名发布与做种运维。
---

# 自建镜像源

NodeStone 允许多个源同时提供服务。同一个种子在**任何镜像源**里的 Hash 完全一致，所以镜像之间天然可以互补、互为备份；差别只在于各自的 `delivery` 怎么配（种子直链在哪、是否内嵌、Tracker 有哪些）。

工程细节以[服务端推荐实现](/docs/compass/server)为准，本文只讲部署顺序与常见坑。

## 1. 目录布局

```text
<源根>/
└── v08/
    └── minecraft/
        ├── latest.json
        ├── latest.json.minisig
        └── torrents/
            ├── <torrenthash>.torrent
            └── <torrenthash>.torrent
```

版本号 `v08` 是协议路径的一部分（对应 `filetype: "nscl/v0.8"`），不要改动；`<namespace>` 与清单里的 `namespace` 必须一致。

## 2. 构建顺序

1. **抓上游、算哈希**：拉取 Mojang 元数据，真实下载并校验原始字节，计算每个文件的哈希。
2. **打包 BT v2 种子**（NodeStone Packer）：
   - `info["meta version"] = 2`，字典 Key 严格按字节序排序；
   - `info["file tree"]` 第一级目录 = 官方源主机名（小写、无默认端口）；
   - 顶层写 `ns-schemes`，**不要**写 BEP-19 `url-list`；
   - 写 `announce` / `announce-list`。
3. **组装 `latest.json`**：`nsci.raw_kv` 只收入口文件映射；`assets.torrents` 写各 Hash 的 `delivery`。
4. **签名**：`minisign -S -s <私钥> -m latest.json`，`trusted comment` 建议写 `namespace:<ns> revision:<n> date:<iso8601>`。
5. **发布**：**先上传种子**，确认 Seeder 已挂载并处于做种状态，再原子替换 `latest.json` 与 `latest.json.minisig`。

:::danger 顺序不能反
清单一旦指向一个还没上传完或没有做种者的种子，客户端就会拿到 404 或永久 0 速率。先种子、后清单。
:::

## 3. 资源分类红线

| 资源 | 必须 | 禁止 |
| --- | --- | --- |
| `version_manifest_v2.json` 等高频变化、无子文件依赖的顶层入口 | `delivery.integrated.type = "raw_file"`，Hash = 文件整体 SHA-256 | 打种子 |
| `<version>.json`、`<asset_index>.json` 等需要展开子文件索引的入口 | 打包进 BT v2 种子 | 使用 `raw_file` |
| 已发布不可变的 `client.jar`、`libraries`、`assets` | 按版本核心种子 / 大版本 Assets 种子打包 | 每次发版重建 |

## 4. 命名空间与修订号

- `namespace` 一经发布不要更改，客户端会把它与本地预配置比对。
- `revision` **必须严格单调递增**，建议用构建流水号；客户端会拒绝更小的 `revision`，这是防回滚的唯一手段。
- `generatedBy` 写构建节点标识（如 `compass-worker-hk-01`），`generateDate` 用 ISO 8601 UTC。

## 5. 做种与 Tracker

- 每个新种子发布前，至少一个 Seeder 必须挂载**完整**种子（包含完整 `piece layers`）并在线。
- `delivery.magnetic` **必须**至少带一个 `&tr=` Tracker，形如：
  `magnet:?xt=urn:btmh:1220<64-hex>&dn=<name>&tr=<url-encoded-tracker>`
- 支持磁力的客户端必须启用 DHT / PEX / LSD，并实现 BEP-52 的 `hash request` / `hashes`，否则拿不到 `piece layers`，大文件无法校验。

## 6. 上线自检

- [ ] `latest.json` 能通过 minisign 校验，`trusted comment` 含命名空间
- [ ] `filetype` / `namespace` / `revision` / `generatedBy` / `generateDate` 齐全
- [ ] 所有 `assets.torrents` 的 Hash 都能在 `torrents/` 找到对应文件（或内嵌载荷可解码）
- [ ] 抽样的 `NSFID` 解码后与种子 `file tree` 拼出的 URL 完全一致
- [ ] Seeder 在线，Tracker 可 announce，磁力链接可拉到元数据
- [ ] 换一个源地址访问，签名与内容一致（镜像一致性）
