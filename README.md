# NodeStone 官网

NodeStone 官方网站的源码，基于 [Docusaurus 3](https://docusaurus.io/) 构建。

线上站点包含三块主要内容：

| 板块 | 路由 | 源码位置 |
| --- | --- | --- |
| 介绍 | `/` | `src/pages/index.tsx` |
| 文档 | `/docs` | `docs/` |
| 新闻 | `/news` | `blog/` |
| 关于 | `/about` | `src/pages/about.tsx` |

## 本地开发

```bash
npm install
npm start          # http://localhost:3000
npm run build      # 产物输出到 build/
npm run serve      # 预览构建产物
npm run typecheck  # TypeScript 检查
```

## 目录结构

```
docs/
  intro.md                 介绍：NodeStone 是什么、一次下载发生了什么
  architecture.md          架构：发布层 / 内容层 / 传输层 / 客户端层
  faq.md                   常见问题
  guides/                  接入与自建指南
  compass/                 Compass Protocol（NCP）规范与变更日志
blog/                      新闻（文件名为 YYYY-MM-DD-slug.md，路由为 /news/<slug>）
src/pages/                 首页
src/components/            首页之外的站点级组件（含开场动画）
src/theme/Root.tsx         全局挂载点
static/brand/              品牌资产（字标、方块、favicon 等）
```

## 部署

仓库：[NodeStoneDev/nodestonedev.github.io](https://github.com/NodeStoneDev/nodestonedev.github.io)
（GitHub Pages 的「组织站点」仓库）。推送到 `main` 即自动构建并发布。

| 工作流 | 触发 | 动作 |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | push 到 `main`、手动 | `npm ci` → `tsc --noEmit` → `npm run build` → 上传并部署到 Pages |
| `.github/workflows/ci.yml` | PR、非 `main` 分支 push | 同上但不发布 |

首次启用需要在仓库里做两件事：

1. **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**（不要选 "Deploy from a branch"）。
2. 确认组织下已允许 Actions 运行，且 `github-pages` 环境无额外的审批限制。

站点对外域名是 **`https://nodestone.asxz.one/`**，但内容仍由 GitHub Pages 托管，
只是前面挂了一层 Cloudflare DNS 的 CNAME：

```
浏览器 → nodestone.asxz.one（Cloudflare DNS，asxz.one 区）
        → CNAME → nodestonedev.github.io（GitHub Pages，证书由 GitHub 签发）
```

涉及三处，改域名时必须一起改：

| 位置 | 当前值 |
| --- | --- |
| `docusaurus.config.ts` 的 `url` | `https://nodestone.asxz.one`（`baseUrl` 保持 `/`） |
| 仓库 Settings → Pages → Custom domain | `nodestone.asxz.one`（同时把 `static/CNAME` 提进仓库，构建产物里会自动带上） |
| Cloudflare DNS（asxz.one 区） | `CNAME nodestone → nodestonedev.github.io`，**代理必须关闭（灰色云，仅 DNS）** |

代理一旦打开（橙色云），GitHub 的 Let's Encrypt 证书签发会失败；等 Pages 显示
"Certificate issued" 后再回 Pages 勾上 **Enforce HTTPS**。

注意：Cloudflare 上 `asxz.one` 的 API Token（wrangler 登录用的那个）只有 `zone:read`，
**没有 DNS 写权限**，所以 DNS 记录只能在 Cloudflare 控制台手工加，或者另配一个带
`Zone.DNS:Edit` 的 API Token。

## 内容来源

`docs/compass/` 下的四篇协议文档来自协议仓库 [Compass](../Compass)（`docs/` 目录），
正文保持一致，仅补充 front matter，以便在站点上单独成页。修改协议内容时请回到
Compass 仓库改动并同步到这里，避免两边漂移。

## 品牌

配色、字体与字标用法见 `../Brand/README.md`。站点使用 Plus Jakarta Sans（自托管于
`@fontsource-variable/plus-jakarta-sans`），主色为 `#5B6BA8`。

## 许可

站点源码与文档以 [Apache-2.0](../Compass/LICENSE) 许可发布。
