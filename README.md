# NodeStone 官网

NodeStone 官方网站的源码，基于 [Docusaurus 3](https://docusaurus.io/) 构建。

线上站点包含三块主要内容：

| 板块 | 路由 | 源码位置 |
| --- | --- | --- |
| 介绍 | `/` | `src/pages/index.tsx` |
| 文档 | `/docs` | `docs/` |
| 新闻 | `/news` | `blog/` |

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

## 内容来源

`docs/compass/` 下的四篇协议文档来自协议仓库 [Compass](../Compass)（`docs/` 目录），
正文保持一致，仅补充 front matter，以便在站点上单独成页。修改协议内容时请回到
Compass 仓库改动并同步到这里，避免两边漂移。

## 品牌

配色、字体与字标用法见 `../Brand/README.md`。站点使用 Plus Jakarta Sans（自托管于
`@fontsource-variable/plus-jakarta-sans`），主色为 `#5B6BA8`。

## 许可

站点源码与文档以 [Apache-2.0](../Compass/LICENSE) 许可发布。
