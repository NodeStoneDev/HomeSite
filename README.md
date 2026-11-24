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

仓库：[NodeStoneDev/nodestonedev.github.io](https://github.com/NodeStoneDev/nodestonedev.github.io)。
内容托管在 **Cloudflare Pages** 项目 `nodestone`，对外域名 **https://nodestone.asxz.one/**。

项目是 **Git 集成**（Cloudflare 的 GitHub App 装在 NodeStoneDev 组织上），
**往 `main` 推一次就自动构建发布**，仓库里不需要部署工作流，也不需要 `CLOUDFLARE_API_TOKEN`。

链路：

```
浏览器 → nodestone.asxz.one（asxz.one 区，CNAME → nodestone.pages.dev）
        → nodestone.pages.dev（Cloudflare Pages，证书由 Cloudflare 签发）
```

Pages 项目里的构建参数：

| 项 | 值 |
| --- | --- |
| 生产分支 | `main` |
| 框架预设 | 无 |
| 构建命令 | `npm run build` |
| 构建输出目录 | `build` |
| 根目录 | （空，即仓库根） |
| 环境变量 | `NODE_VERSION=22`（`engines` 只要求 ≥20，CI 用 22，两边保持一致） |

| 工作流 | 触发 | 动作 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | PR、非 `main` 分支 push | `npm ci` → `tsc --noEmit` → `npm run build`，只校验不发布 |

- 发布只走 Cloudflare：仓库里原来那个 `deploy.yml`（GitHub Pages）已经删了，`static/CNAME` 也删了；别再加回来，那些只对 GitHub Pages 有意义。
- 想在本地顶一份（比如临时验证产物）仍可手工上传，会在部署列表里多一条 ad-hoc 记录：

```bash
npm run build
wrangler pages deploy build --project-name=nodestone --branch=main --commit-dirty=true
```

- 改域名要三处同步，否则 sitemap/canonical 指向旧域名：

| 位置 | 当前值 |
| --- | --- |
| `docusaurus.config.ts` 的 `url` | `https://nodestone.asxz.one`（`baseUrl` 保持 `/`） |
| Cloudflare DNS（asxz.one 区） | `CNAME nodestone → nodestone.pages.dev` |
| Pages 项目 → 自定义域 | `nodestone.asxz.one` |

注意：wrangler 登录拿到的 OAuth 令牌只有 `pages:write` 和 `zone:read`，
**没有 DNS 写权限**（DNS API 返回 `10000 Authentication error`），DNS 记录只能在 Cloudflare
控制台改，或另配带 `Zone.DNS:Edit` 的 API Token。

## 内容来源

`docs/compass/` 下的四篇协议文档来自协议仓库 [Compass](../Compass)（`docs/` 目录），
正文保持一致，仅补充 front matter，以便在站点上单独成页。修改协议内容时请回到
Compass 仓库改动并同步到这里，避免两边漂移。

## 品牌

配色、字体与字标用法见 `../Brand/README.md`。站点使用 Plus Jakarta Sans（自托管于
`@fontsource-variable/plus-jakarta-sans`），主色为 `#5B6BA8`。

## 许可

站点源码与文档以 [Apache-2.0](../Compass/LICENSE) 许可发布。
