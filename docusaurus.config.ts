import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'NodeStone',
  tagline: '把 Minecraft 资源交给节点分发',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: 'https://nodestone.io',
  baseUrl: '/',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  // 开场动画需要在首帧之前就给 <html> 打标记，避免正文闪一下再被遮罩盖住
  headTags: [
    {
      tagName: 'script',
      attributes: {},
      innerHTML: `(function(){try{
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  var h = document.documentElement;
  h.classList.add('ns-intro-active');
  // 兜底：若脚本异常导致动画未结束，6 秒后强制恢复
  setTimeout(function(){ h.classList.remove('ns-intro-active'); h.classList.remove('ns-intro-reveal'); }, 6000);
}catch(e){}})();`,
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
          breadcrumbs: true,
          showLastUpdateTime: false,
        },
        blog: {
          routeBasePath: 'news',
          blogTitle: 'NodeStone 新闻',
          blogDescription: 'NodeStone 发布动态、协议版本与镜像接入公告。',
          postsPerPage: 10,
          blogSidebarTitle: '全部新闻',
          blogSidebarCount: 'ALL',
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
            copyright: `Copyright © ${new Date().getFullYear()} NodeStone`,
          },
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/nodestone-social-card.png',
    metadata: [
      {name: 'keywords', content: 'NodeStone, Minecraft, 启动器, BitTorrent v2, P2P, Compass, NCP'},
      {name: 'description', content: 'NodeStone —— 基于签名索引与 BitTorrent v2 的 Minecraft 资源分发网络。'},
    ],
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'ncp-v08',
      content: 'NodeStone Compass Protocol <b>v0.8.0</b> 已发布，<a href="/docs/compass/changelog">查看变更</a>',
      backgroundColor: '#EEF0F6',
      textColor: '#222A35',
      isCloseable: true,
    },
    navbar: {
      hideOnScroll: false,
      logo: {
        alt: 'NodeStone',
        src: 'brand/svg/nodestone-horizontal-plain-upper.svg',
        srcDark: 'brand/svg/nodestone-horizontal-plain-on-dark-upper.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guideSidebar',
          position: 'left',
          label: '文档',
        },
        {
          type: 'docSidebar',
          sidebarId: 'protocolSidebar',
          position: 'left',
          label: '协议',
        },
        {to: '/news', label: '新闻', position: 'left'},
        {
          type: 'html',
          position: 'right',
          value:
            '<a class="nav-cta" href="/docs/guides/launcher-integration">接入 NodeStone</a>',
        },
      ],
    },
    footer: {
      style: 'dark',
      logo: {
        alt: 'NodeStone',
        src: 'brand/svg/nodestone-horizontal-plain-on-dark.svg',
        height: 34,
      },
      links: [
        {
          title: '文档',
          items: [
            {label: '什么是 NodeStone', to: '/docs/intro'},
            {label: '总体架构', to: '/docs/architecture'},
            {label: '启动器接入', to: '/docs/guides/launcher-integration'},
            {label: '常见问题', to: '/docs/faq'},
          ],
        },
        {
          title: '协议',
          items: [
            {label: '协议总览', to: '/docs/compass/overview'},
            {label: '协议规范', to: '/docs/compass/protocol'},
            {label: '客户端推荐实现', to: '/docs/compass/client'},
            {label: '服务端推荐实现', to: '/docs/compass/server'},
          ],
        },
        {
          title: '更多',
          items: [
            {label: '新闻', to: '/news'},
            {label: '版本历史', to: '/docs/compass/changelog'},
            {label: '自建镜像源', to: '/docs/guides/self-hosted-mirror'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} NodeStone. 文档与协议内容以 Apache-2.0 许可发布。`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'json', 'python', 'rust', 'ini'],
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
