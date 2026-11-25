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
GET <provider.urls[i]>/v010/<provider.namespace>/latest.json
GET <provider.urls[i]>/v010/<provider.namespace>/latest.json.minisig
```

依次执行四项校验，任何一项失败就换源：

1. **签名**：用 `provider.minisign_keys` 校验 `latest.json.minisig`，并检查 `trusted comment` 里包含 `<provider.namespace>`。
2. **文件类型**：`filetype == "nscl/v0.10"`。
3. **命名空间**：`namespace == provider.namespace`。
4. **防回滚**：`revision >= 本地缓存的 revision`。

通过后先清理、再写入：删除本地缓存中不在 `latest.assets.torrents` 里的 `torrenthash` 记录（大版本种子会被重打包，旧 Hash 已失效），然后把 `latest.nsci.raw_kv` 里的 `NSFID -> Hash` 按「重复即覆盖」写进本地 NSCI 缓存。磁盘上的旧 `.torrent` 可以异步删除，三张表之间不需要外键级联或引用计数。

:::tip 缓存位置
本地状态统一放在 `.nodestone/` 下：NSCI 缓存是 SQLite 数据库 `.nodestone/cache/nsci.db`（WAL 模式），种子文件在 `.nodestone/torrents/<torrenthash>.torrent`。整个目录可以直接删，删了按第 6 节的未命中处理流程重新补齐。
:::

## 3. 拿到第一个文件：`version_manifest_v2.json`

它的 NSFID 是官方 URL 的规范化 Base64：

```text
https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
→ url:aHR0cHM6Ly9waXN0b24tbWV0YS5tb2phbmcuY29tL21jL2dhbWUvdmVyc2lvbl9tYW5pZmVzdF92Mi5qc29u
```

调用 `nsGetFile(nsfid)` 会命中 `raw_file` 直出：现场从 `latest.json` 里 Base64 解码内嵌载荷、校验整体 SHA-256 等于清单里的 Hash，然后直接交付本地路径。这一步**不经过 BT 引擎**，也不在 `.nodestone/` 下按 Hash 留存历史缓存副本。

## 4. 解析版本并批量下载

用上一步的 manifest 拿到某版本的 `<version>.json` URL，再 `nsGetFile` 拿到它。此时 SDK 首次挂载该版本所属的大版本种子（如 `minecraft-1.21-full`），会把种子 `file tree` 一次性展开：

```python
# 由种子 file tree 还原官方 URL 并生成 NSFID（协议 §4）
for segments in parse_btv2_file_tree_segments(torrent["info"]["file tree"]):
    rel_path = "/".join([segments[0].lower()] + segments[1:])
    encoded = "/".join(quote(seg, safe="-._~") for seg in segments[1:])
    orig_url = scheme + segments[0].lower() + "/" + encoded   # 如 libraries.minecraft.net/com/mojang/logging/...
    nsfid = "url:" + base64.b64encode(orig_url.encode()).decode()
    nsci_cache[nsfid] = (torrenthash, rel_path, orig_url)
```

`<version>.json` 与 `<asset_index>.json` 都要**在下载具体文件之前**通过 `nsGetFile` 请求一次。两个入口都命中同一个大版本种子，种子拉下来并展开后，`client.jar`、`libraries`、以及全部 `assets/objects` 的映射就都写进本地缓存了。这条「先请求版本 Manifest」的约定是强制的——启动器本地即使已有 `<version>.json` 也必须走一次 SDK，否则对应的大版本种子不会展开。接着：

```text
nsGetFilesBatch(nsfidList)
  → Map<NSFID, LocalFilePath>
```

**一定要用批量接口。** 一个版本通常有几百到上万个 `libraries` / `assets` 小文件，逐个 `nsGetFile` 会把查库和调度开销放大一个数量级。

## 5. 让下载真正快起来

按[客户端推荐实现 §4](/docs/compass/client) 修改 BT 引擎的 WebSeed URL 拼接层：

1. 加载种子 `info` 时读取 `info["ns-schemes"]`（官方源协议头，缺省 `["https://"]`）与 `info["ns-mirrors"]`（主机名 → 镜像 URL 前缀列表）。
2. 构造 WebSeed 请求时**跳过 `info["name"]` 层级**，把文件路径拆成第一级主机名 `<host>[:<port>]` 与后续子路径 `<subpath>`，用引擎自带的 `escape_path` 对子路径编码。
3. 官方源 URL 拼成 `<scheme><host>/<escaped_subpath>`；镜像源对 `info["ns-mirrors"][<host>]` 里的每个前缀拼成 `<mirror_prefix>/<escaped_subpath>`，作为额外 WebSeed 并发或回退下载。

这样分块下载、Range 对齐、Merkle 校验、向其他 Peer 回传全部复用 BT 引擎原生能力，SDK 不必手写，也不需要额外起本地代理。展开 `file tree` 计算 NSFID 时仍然只用 `info["ns-schemes"]` 还原官方源 URL，镜像只影响下载链路。

:::tip 普通 BT 客户端
未打补丁的客户端不认 `info["ns-mirrors"]`。若源方部署了把 `/<info.name>/<host>/<subpath>` 307 重定向到官方源的无状态网关（如 `https://webseed.nodestone.io/`），种子顶层会有 `url-list` 指向它；没有该端点时顶层不写 `url-list`。
:::

## 6. 缓存未命中时怎么办

如果启动器跳过了前置的版本 Manifest 请求（比如本地已有旧文件就不再走 SDK），子文件映射就不会展开，查库必然未命中。按顺序处理：

1. **补跑未展开的种子**：扫描 `.nodestone/torrents/`，把已落盘但 `torrents_state.is_expanded = 0` 的种子展开一次 `file tree`，再查库。
2. **刷新 `latest.json`**：若仍未命中且距上次拉取超过冷却时间（如 60 秒，或本地缓存为空），重新拉一次 `latest.json`（清理过期 `torrenthash` 并更新 `raw_kv` 入口映射），再查库。
3. **明确报错**：抛出携带 `(orig_url, nsfid, local_revision)` 的未命中异常，由启动器决定中止或回退到 HTTPS 直连。

:::warning 不要静默回退
未命中说明前置流程被跳过或本地状态不一致。直接吞掉错误回退直连，会把「协议接错了」伪装成「网络慢」，后续极难排查。
:::

## 7. 自检清单

- [ ] 源列表里至少有一个可用源，签名与命名空间校验通过
- [ ] 拉取 `latest.json` 后清理了不在 `assets.torrents` 里的旧 `torrenthash`
- [ ] `revision` 严格防回滚，不因换源而下降
- [ ] 下载具体文件前先请求了该版本的 `<version>.json` 与 `<asset_index>.json`
- [ ] 种子落盘与 `file tree` 展开在同一事务内完成
- [ ] 传入 SDK 的是 Mojang 官方原始 URL，未被镜像替换
- [ ] 使用 `nsGetFilesBatch`，按 `torrenthash` 聚合提交
- [ ] 引擎的 WebSeed 拼接层读取了 `info["ns-schemes"]` 与 `info["ns-mirrors"]`，并跳过 `info["name"]` 层级
- [ ] 未命中路径有日志与错误码，不静默回退
