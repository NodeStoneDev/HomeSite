import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import NodestoneLogo from '@site/src/components/NodestoneLogo';
import styles from './index.module.css';

type Feature = {
  title: string;
  body: string;
  to: string;
  cta: string;
};

const features: Feature[] = [
  {
    title: '索引轻量',
    body: '一份约 20 KB 的签名清单就是全部入口。只记录 version_manifest 与各版本 JSON 的映射，client.jar、libraries、assets 交给版本种子一次性展开。',
    to: '/docs/architecture',
    cta: '看架构',
  },
  {
    title: '节点互助',
    body: '基于 BitTorrent v2（BEP-52）分发，DHT / PEX / LSD 自动寻址。下载的人越多，可用的上传方越多。',
    to: '/docs/compass/protocol',
    cta: '看协议',
  },
  {
    title: '可校验的信任链',
    body: 'minisign 签名 + 单调递增 revision 防回滚 + 内容寻址 + 分块 Merkle 树校验，镜像再野也改不了内容。',
    to: '/docs/compass/server',
    cta: '看发布规范',
  },
  {
    title: '启动器友好',
    body: '官方 URL 进、本地路径出。批量接口按种子聚合上百个小文件，缓存未命中还有四步自愈。',
    to: '/docs/guides/launcher-integration',
    cta: '看接入指南',
  },
];

const layers = [
  {
    tag: 'Compass',
    title: '发布层',
    body: '官方元数据源与镜像源。latest.json + minisign 签名，原子发布，revision 单调递增。',
    to: '/docs/compass/overview',
  },
  {
    tag: 'NCP',
    title: '协议层',
    body: 'NSFID 文件标识、种子打包规范、可变直出与不可变做种的分工边界。',
    to: '/docs/compass/protocol',
  },
  {
    tag: 'Nodes',
    title: '传输层',
    body: 'BT v2 节点网络承担流量，本地 307 WebSeed 路由在无 Peer 时用官方源兜底。',
    to: '/docs/compass/client',
  },
];

const stats = [
  {value: '20 KB', label: '清单体积'},
  {value: '64 hex', label: '内容寻址哈希'},
  {value: 'v0.9.0', label: '当前协议版本'},
  {value: 'Apache-2.0', label: '开放许可'},
];

function FeatureCard({feature}: {feature: Feature}): ReactNode {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>{feature.title}</h3>
      <p className={styles.cardBody}>{feature.body}</p>
      <Link className={styles.cardLink} to={feature.to}>
        {feature.cta} →
      </Link>
    </div>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="NodeStone —— 把 Minecraft 资源交给节点分发"
      description="NodeStone 是一套面向 Minecraft 生态的开源资源分发网络：轻量签名索引 + BitTorrent v2 内容分发 + 节点互助。">
      <header className={styles.hero} data-ns-hero="">
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>
              <span className={styles.dot} />
              Compass Protocol v0.9.0 已发布
            </p>
            <h1 className={styles.title}>
              把 Minecraft 资源
              <br />
              交给<span className={styles.accent}>节点</span>分发
            </h1>
            <p className={styles.subtitle}>
              NodeStone 用一份约 20 KB 的签名清单描述整个资源索引，把游戏本体、ModLoader
              与 Mod 的搬运交给 BitTorrent v2 节点网络。启动器只要传一个官方 URL，就能拿回一个校验过的本地文件。
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary button--lg" to="/docs/intro">
                开始了解
              </Link>
              <Link className="button button--outline button--lg" to="/docs/guides/launcher-integration">
                接入指南
              </Link>
            </div>
            <dl className={styles.stats}>
              {stats.map((s) => (
                <div key={s.label} className={styles.stat}>
                  <dt className={styles.statLabel}>{s.label}</dt>
                  <dd className={styles.statValue}>{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className={styles.heroArt}>
            <NodestoneLogo
              layout="mark"
              title="NodeStone 徽标：磁石方块与 NodeStone 字标"
              className={styles.mark}
            />
          </div>
        </div>
      </header>

      <main>
        <section className={styles.section}>
          <div className="container">
            <p className={styles.sectionLabel}>Why NodeStone</p>
            <h2 className={styles.sectionTitle}>索引很小，网络很大</h2>
            <div className={styles.cards}>
              {features.map((f) => (
                <FeatureCard key={f.title} feature={f} />
              ))}
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.sectionAlt)}>
          <div className="container">
            <p className={styles.sectionLabel}>Structure</p>
            <h2 className={styles.sectionTitle}>三层结构，各管一件事</h2>
            <div className={styles.layers}>
              {layers.map((l, i) => (
                <Link key={l.title} className={styles.layer} to={l.to}>
                  <span className={styles.layerIndex}>{`0${i + 1}`}</span>
                  <span className={styles.layerTag}>{l.tag}</span>
                  <h3 className={styles.layerTitle}>{l.title}</h3>
                  <p className={styles.layerBody}>{l.body}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.quote}>
              <p className={styles.sectionLabel}>Protocol</p>
              <blockquote>
                「可变索引直出、不可变版本打包做种。」
                <br />
                高频变化的顶层清单内嵌直出，永不生成种子；已经发布的版本资源打成 BT v2
                种子长期做种。一条规则，让服务端不用清理废弃种子，客户端也不用做引用计数。
              </blockquote>
              <div className={styles.quoteLinks}>
                <Link className="button button--primary" to="/docs/compass/protocol">
                  阅读协议规范
                </Link>
                <Link className="button button--outline" to="/docs/compass/server">
                  服务端推荐实现
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
