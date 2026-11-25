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
    title: '混合拉取，兜底回退',
    body: 'BT 与 HTTP 多源并发下载。P2P 节点不足或身处恶劣网络时，SDK 自动无缝回退 Mojang 官方源 + BMCLAPI 双源并发，速率不会低于传统方式。',
    to: '/docs/guides/launcher-integration',
    cta: '看接入指南',
  },
  {
    title: '去中心化，可自建',
    body: '文件传输完全依托 BT 网络，元数据也由多个镜像联合分发。从元数据生成服务 MagneticFlux 到客户端 SDK 全部开源，谁都能自建，没有单点故障。',
    to: '/docs/guides/self-hosted-mirror',
    cta: '自建镜像源',
  },
  {
    title: '校验到位，防滥用',
    body: '面对不可信节点，靠 EdDSA（minisign）签名元数据 + 种子强制校验 + BT 自带分块校验把关；协议层还会识别并屏蔽刷流量的下载者与投毒上传者。',
    to: '/docs/compass/protocol',
    cta: '看协议规范',
  },
  {
    title: '低门槛，纯公益',
    body: '元数据分发是完全公益的服务，欢迎任何 PR 与建议。节点不要求公网 IP 或稳定服务器，普通客户端开着就能参与上传和下载。',
    to: '/news/nodestone-for-players',
    cta: '玩家版介绍',
  },
];

const layers = [
  {
    tag: 'Compass',
    title: '元数据源',
    body: '官方基于协议维护的元数据源，提供 Minecraft 本体、ModLoader 与 Mod 的下载索引；入口清单 latest.json 由多个镜像联合分发。',
    to: '/docs/compass/overview',
  },
  {
    tag: 'NCP',
    title: '开放协议',
    body: 'NodeStone Compass Protocol：清单格式、NSFID 文件标识、种子打包规范与校验规则的公开约定，当前 v0.9.0，Apache-2.0。',
    to: '/docs/compass/protocol',
  },
  {
    tag: 'SDK',
    title: 'SDK 与节点',
    body: '把「传一个官方 URL、拿回一个本地文件」封装成 nsGetFile / nsGetFilesBatch，底层由 BT v2 节点（DHT / PEX / LSD）完成搬运。',
    to: '/docs/guides/launcher-integration',
  },
];

const steps = [
  {
    title: '拉取签名索引',
    body: '从官方源或任意镜像源拿到元数据索引，校验签名与 revision 后写入本地 NSCI 缓存（NSFID → Hash）。',
  },
  {
    title: '据此组建 Swarm',
    body: '客户端按索引挂载 BT v2 种子，通过 DHT / PEX / LSD 找到其他节点，下载的人越多，可用的上传方越多。',
  },
  {
    title: '多源并发搬运',
    body: 'BT 分块与 HTTP 源同时下载并逐块校验；节点不足时自动回退 Mojang 官方源 + BMCLAPI，保证速度下限。',
  },
];

const stats = [
  {value: '≈100 KB', label: '元数据索引'},
  {value: 'BT v2', label: '传输协议'},
  {value: 'EdDSA', label: '元数据签名'},
  {value: 'Apache-2.0', label: '开源许可'},
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
      description="NodeStone 是一个基于签名索引与 BitTorrent 的去中心化 Minecraft 分发网络：元数据只有约 100 KB，客户端据此组建 Swarm，并在节点不足时自动回退 Mojang 官方源 + BMCLAPI。">
      <header className={styles.hero}>
        <div className={styles.grid} aria-hidden="true" />
        <div className={styles.heroInner}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>
              <span className={styles.dot} />
              开放 · 去中心化 · 全开源
            </p>
            <h1 className={styles.title}>
              把 Minecraft 资源
              <br />
              交给<span className={styles.accent}>节点</span>分发
            </h1>
            <p className={styles.subtitle}>
              NodeStone 只生成并分发一份约 100 KB 的签名元数据索引，客户端拿到它就组建
              BitTorrent Swarm 搬运游戏文件；节点不够时自动回退 Mojang 官方源 + BMCLAPI。
              它要做的，是把中心化镜像站扛着的带宽压力，分回给每一个参与者。
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary button--lg" to="/docs/intro">
                了解 NodeStone
              </Link>
              <Link className="button button--outline button--lg" to="/docs/guides/launcher-integration">
                启动器接入
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
            <h2 className={styles.sectionTitle}>下载的人越多，可用的上传方越多</h2>
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
            <h2 className={styles.sectionTitle}>三部分组成，各管一件事</h2>
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
            <p className={styles.sectionLabel}>How it works</p>
            <h2 className={styles.sectionTitle}>一次下载，三步</h2>
            <div className={styles.steps}>
              {steps.map((s, i) => (
                <div key={s.title} className={styles.step}>
                  <span className={styles.stepNum}>{`STEP 0${i + 1}`}</span>
                  <h3 className={styles.stepTitle}>{s.title}</h3>
                  <p className={styles.stepBody}>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.sectionAlt)}>
          <div className="container">
            <div className={styles.quote}>
              <p className={styles.sectionLabel}>Protocol</p>
              <blockquote>
                「可变清单现场直出、不可变版本分包做种。」
                <br />
                高频变化的顶层清单内嵌直出，永不生成种子；已经发布的版本资源打成 BT v2
                种子长期做种。一条规则，让服务端不用清理废弃种子，客户端也不用做引用计数。
              </blockquote>
              <p className={styles.note}>
                <strong>关于合规性：</strong>严格来讲，在客户端开启上传（做种分发官方文件）在条款上违反 Mojang
                EULA；作为客观事实供参考，Mojang 已经 9 年没有管过 BMCLAPI。是否接入、是否默认开启上传，建议启动器作者结合自身情况自行评估。
              </p>
              <div className={styles.quoteLinks}>
                <Link className="button button--primary" to="/docs/compass/protocol">
                  阅读协议规范
                </Link>
                <Link className="button button--outline" to="/news/nodestone-intro">
                  开发者版介绍
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
