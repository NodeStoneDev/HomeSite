import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const sidebars: SidebarsConfig = {
  guideSidebar: [
    {
      type: 'category',
      label: '开始了解',
      collapsible: false,
      items: ['intro', 'architecture', 'faq'],
    },
    {
      type: 'category',
      label: '指南',
      collapsible: false,
      items: ['guides/launcher-integration', 'guides/self-hosted-mirror'],
    },
  ],
  protocolSidebar: [
    {
      type: 'category',
      label: 'Compass Protocol (NCP)',
      collapsible: false,
      items: [
        'compass/overview',
        'compass/protocol',
        'compass/client',
        'compass/server',
        'compass/changelog',
      ],
    },
  ],
};

export default sidebars;
