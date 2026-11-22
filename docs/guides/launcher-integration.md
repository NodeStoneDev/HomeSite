---
title: 启动器接入指南
sidebar_position: 1
description: 从预配置常量到第一次成功下载：把 NodeStone 接进启动器的完整步骤。
---

# 启动器接入指南

本指南按「最短可运行路径」组织。协议细节见[协议总览](/docs/compass/overview)，工程优化见[客户端推荐实现](/docs/compass/client)。

## 0. 你需要的三样东西

| 项 | 值 |
| --- | --- |
| 命名空间 | `minecraft` |
| 清单源 | `https://compass.nodestone.io` |
| minisign 公钥 | 由源方提供（示例：`RWSDsxUzF3dwx5sVM6sxlIE1S2HzTJtaOtEOSKQiX6ArWc7u3hcDcaTk`） |

## 1. 预配置常量

```text
provider.namespace      = "minecraft"
provider.urls           = ["https://compass.nodestone.io", "https://mirror.example.com"]
provider.minisign_keys  = ["<公钥 1>", "<公钥 2>"]
```

`provider.urls` 按优先级排序，任何一个源校验失败就换下一个。

## 2. 拉取并校验清单

```text
GET <provider.urls[i]>/v09/<provider.namespace>/latest.json
GET <provider.urls[i]>/v09/<provider.namespace>/latest.json.minisig
```

依次执行四项校验，任何一项失败就换源：

1. **签名**：用 `provider.minisign_keys` 校验 `latest.json.minisig`，并检查 `trusted comment` 里包含 `<provider.namespace>`。
2. **文件类型**：`filetype == "nscl/v0.9"`。
3. **命名空间**：`namespace == provider.namespace`。
4. **防回滚**：`revision >= 本地缓存的 revision`。

通过后，把 `latest.nsci.raw_kv` 里的 `NSFID -> Hash` 按「重复即覆盖」写入本地 NSCI 缓存。

:::tip 缓存位置
本地状态统一放在 `.nodestone/` 下：NSCI 缓存是 SQLite 数据库 `.nodestone/cache/nsci.db`（WAL 模式），种子文件在 `.nodestone/torrents/<torrenthash>.torrent`。整个目录可以直接删，删了按第 6 节的自愈流程重新补齐。
:::

## 3. 拿到第一个文件：`version_manifest_v2.json`

它的 NSFID 是官方 URL 的规范化 Base64：

```text
https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
→ url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u
```

调用 `nsGetFile(nsfid)` 会命中 `raw_file` 直出：现场从 `latest.json` 里 Base64 解码内嵌载荷、校验整体 SHA-256 等于清单里的 Hash，然后直接交付本地路径。这一步**不经过 BT 引擎**，也不在 `.nodestone/` 下按 Hash 留存历史缓存副本。

## 4. 解析版本并批量下载

用上一步的 manifest 拿到某版本的 `<version>.json` URL，再 `nsGetFile` 拿到它。此时 SDK 首次挂载该版本的种子（`minecraft-version-<ver>`），会把种子 `file tree` 一次性展开：

```python
# 由种子 file tree 还原官方 URL 并生成 NSFID（协议 §4）
for segments in parse_btv2_file_tree_segments(torrent["info"]["file tree"]):
    rel_path = "/".join([segments[0].lower()] + segments[1:])
    encoded = "/".join(quote(seg, safe="-._~") for seg in segments[1:])
    orig_url = scheme + segments[0].lower() + "/" + encoded   # 如 libraries.minecraft.net/com/mojang/logging/...
    nsfid = "url:" + base64.b64encode(orig_url.encode()).decode()
    nsci_cache[nsfid] = (torrenthash, rel_path, orig_url)
```

`<version>.json` 里所有 `client.jar`、`libraries`、`<asset_index>.json` 以及该版本的 `assets/objects` 映射此刻已经**一次性**写进本地缓存，不需要再单独请求 `<asset_index>.json` 的种子。接着：

```text
nsGetFilesBatch(nsfidList, contextEntryNSFIDs=[version_json_nsfid])
  → Map<NSFID, LocalFilePath>
```

**一定要用批量接口。** 一个版本通常有几百到上万个 `libraries` / `assets` 小文件，逐个 `nsGetFile` 会把查库和调度开销放大一个数量级。

## 5. 让下载真正快起来

按[客户端推荐实现 §4](/docs/compass/client) 接入 WebSeed 307 路由：

1. 挂载种子时先清空顶层 `url-list`（必须，否则引擎会把 `info["name"]` 拼进域名），并禁用引擎自带的 BEP-19 WebSeed。
2. 起一个本地环回 HTTP 服务，注册为 BEP-19 WebSeed：`http://127.0.0.1:<port>/webseed/<torrenthash>/`（注意末尾的斜杠）。
3. 收到 `GET /webseed/<torrenthash>/<info.name>/<rel_path>` 时，剥掉 `/webseed/<torrenthash>/<info.name>/` 前缀，对剩余路径段做百分号解码再按 RFC 3986 重新编码，拼上 `info["ns-schemes"]` 得到官方直链，返回 `307 Temporary Redirect` 让引擎自己跟随。

这样分块下载、Range 对齐、Merkle 校验、向其他 Peer 回传全部复用 BT 引擎原生能力，SDK 不必手写。

## 6. 缓存未命中时怎么办

如果启动器跳过了 `<version>.json` 的直接下载（比如本地已有旧文件），就会查不到子文件映射。按顺序自愈：

1. **URL 规范化重算**：检查大小写、默认端口、`%XX` 大小写、多余转义、`/./` 与 `/../`，重新编码 NSFID 再查一次。
2. **按 `contextEntryNSFIDs` 补拉入口种子**：直接挂载对应版本的种子（`minecraft-version-<ver>`）并展开 `file tree`。
3. **扫描未展开的种子**：把 `.nodestone/torrents/` 里已下载但 `is_expanded = 0` 的种子补跑一遍；若仍失败且距上次拉取超过冷却时间（如 60 秒），刷新 `latest.json` 再重试。
4. **明确报错**：抛出携带 `(orig_url, nsfid, local_revision)` 的未命中异常，由启动器决定中止或回退到 HTTPS 直连。

:::warning 不要静默回退
未命中说明前置流程被跳过或本地状态不一致。直接吞掉错误回退直连，会把「协议接错了」伪装成「网络慢」，后续极难排查。
:::

## 7. 自检清单

- [ ] 源列表里至少有一个可用源，签名与命名空间校验通过
- [ ] `revision` 严格防回滚，不因换源而下降
- [ ] 种子落盘与 `file tree` 展开在同一事务内完成
- [ ] 传入 SDK 的是 Mojang 官方原始 URL，未被镜像替换
- [ ] 使用 `nsGetFilesBatch`，按 `torrenthash` 聚合提交
- [ ] 挂载种子前清空了 `url-list`，WebSeed 走本地 307 路由
- [ ] 未命中路径有日志与错误码，不静默回退
