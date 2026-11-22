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

站点地址由 `docusaurus.config.ts` 的 `url` / `baseUrl` 决定，当前为
`https://nodestonedev.github.io/`。若日后绑定自定义域名（如 `nodestone.io`），需要同时：

- 在 Pages 设置里填写 Custom domain，并把 `static/CNAME` 提进仓库；
- 把 `url` 改成 `https://nodestone.io`（`baseUrl` 保持 `/`），否则 sitemap 与 canonical 会指向旧域名。

## 内容来源

`docs/compass/` 下的四篇协议文档来自协议仓库 [Compass](../Compass)（`docs/` 目录），
正文保持一致，仅补充 front matter，以便在站点上单独成页。修改协议内容时请回到
Compass 仓库改动并同步到这里，避免两边漂移。

## 品牌

配色、字体与字标用法见 `../Brand/README.md`。站点使用 Plus Jakarta Sans（自托管于
`@fontsource-variable/plus-jakarta-sans`），主色为 `#5B6BA8`。

## 许可

站点源码与文档以 [Apache-2.0](../Compass/LICENSE) 许可发布。
