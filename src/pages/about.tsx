import type {ReactNode} from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import styles from './about.module.css';

type Member = {
  name: string;
  github: string;
  note: string;
};

const MEMBERS: Member[] = [
  {
    name: 'Redstix',
    github: 'Redstix',
    note: 'NodeStone 开发组',
  },
  {
    name: 'Kuinone',
    github: 'Kuinone',
    note: 'NodeStone 开发组',
  },
];

function Avatar({github}: {github: string}): ReactNode {
  return (
    <span className={styles.avatar}>
      <span className={styles.avatarFallback} aria-hidden="true">
        {github.slice(0, 1).toUpperCase()}
      </span>
      <img
        src={`https://github.com/${github}.png?size=240`}
        alt={`${github} 的 GitHub 头像`}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    </span>
  );
}

export default function About(): ReactNode {
  return (
    <Layout
      title="关于"
      description="NodeStone 由 NodeStone 开发组维护，成员：Redstix、Kuinone。">
      <Head>
        <meta name="og:title" content="关于 NodeStone" />
      </Head>

      <header className={styles.hero}>
        <div className={styles.grid} />
        <div className={styles.heroInner}>
          <p className={styles.eyebrow}>ABOUT</p>
          <h1 className={styles.title}>关于 NodeStone</h1>
          <p className={styles.lead}>
            NodeStone 是一个开源项目：用一份签名的清单描述 Minecraft 资源，把搬运交给
            BitTorrent v2 节点网络。它不托管内容，也不绑定启动器——协议、参考实现和这套文档
            都由 NodeStone 开发组维护，任何人都可以接入、自建镜像源或直接改协议。
          </p>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.section}>
          <h2 className={styles.h2}>开发组</h2>
          <p className={styles.sectionLead}>
            目前由两位维护者负责协议设计、参考实现与文档。所有讨论与改动都在 GitHub 上进行。
          </p>
          <ul className={styles.members}>
            {MEMBERS.map((m) => (
              <li key={m.github} className={styles.member}>
                <Avatar github={m.github} />
                <div className={styles.memberBody}>
                  <p className={styles.memberName}>{m.name}</p>
                  <p className={styles.memberNote}>{m.note}</p>
                  <a
                    className={styles.memberLink}
                    href={`https://github.com/${m.github}`}
                    target="_blank"
                    rel="noreferrer noopener">
                    github.com/{m.github}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>参与进来</h2>
          <div className={styles.cards}>
            <Link className={styles.card} to="/docs/compass/overview">
              <p className={styles.cardTitle}>读协议</p>
              <p className={styles.cardText}>
                从 Compass Protocol 总览开始，理解清单、索引与种子是怎么拼起来的。
              </p>
            </Link>
            <Link className={styles.card} to="/docs/guides/launcher-integration">
              <p className={styles.cardTitle}>接入客户端</p>
              <p className={styles.cardText}>
                七步把 NodeStone 接进启动器，不需要改动服务端。
              </p>
            </Link>
            <Link className={styles.card} to="/docs/guides/self-hosted-mirror">
              <p className={styles.cardTitle}>自建镜像源</p>
              <p className={styles.cardText}>
                按目录布局发布自己的索引与种子，成为网络里的一个节点。
              </p>
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
