import {useCallback, useEffect, useRef, useState} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

/** 开场动画阶段：空白 → 打字机 → 完整字标 → 飞到顶栏左上角 → 卸载 */
type Phase = 'boot' | 'typing' | 'logo' | 'fly' | 'done';

const WORD = 'NODESTONE';
const CHAR_MS = 88;
const BOOT_MS = 520;
const HOLD_MS = 420;
const LOGO_MS = 620;
const FLY_MS = 940;

export default function IntroSplash(): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('boot');
  const [typed, setTyped] = useState('');
  const [flyTransform, setFlyTransform] = useState<string>('');
  const boxRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);

  const lightLockup = useBaseUrl('/brand/svg/nodestone-horizontal-plain-upper.svg');
  const darkLockup = useBaseUrl('/brand/svg/nodestone-horizontal-plain-on-dark-upper.svg');

  const finish = useCallback(() => {
    const html = document.documentElement;
    html.classList.remove('ns-intro-active');
    html.classList.remove('ns-intro-reveal');
    setPhase('done');
  }, []);

  const startFly = useCallback(() => {
    const html = document.documentElement;
    // 正文与网格此刻开始交叉淡入淡出
    html.classList.add('ns-intro-reveal');

    const box = boxRef.current;
    const logos = Array.from(
      document.querySelectorAll<HTMLElement>('.navbar__logo'),
    );
    const target = logos.find((el) => el.getBoundingClientRect().width > 0);

    if (!box || !target) {
      finish();
      return;
    }

    const from = box.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const scale = to.height / from.height;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);

    setFlyTransform(
      `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`,
    );
    setPhase('fly');
    timers.current.push(window.setTimeout(finish, FLY_MS + 160));
  }, [finish]);

  // 阶段调度
  useEffect(() => {
    const html = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!html.classList.contains('ns-intro-active') || reduced) {
      finish();
      return;
    }

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    const typingEnd = BOOT_MS + WORD.length * CHAR_MS + HOLD_MS;
    at(BOOT_MS, () => setPhase('typing'));
    at(typingEnd, () => setPhase('logo'));
    at(typingEnd + LOGO_MS, startFly);

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [finish, startFly]);

  // 打字机
  useEffect(() => {
    if (phase !== 'typing') {
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(WORD.slice(0, i));
      if (i >= WORD.length) {
        window.clearInterval(id);
      }
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === 'done') {
    return null;
  }

  return (
    <div className={styles.splash} data-phase={phase} aria-hidden="true">
      <div className={styles.grid} />
      <div className={styles.stage}>
        <div
          ref={boxRef}
          className={styles.lockup}
          style={flyTransform ? {transform: flyTransform} : undefined}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform') {
              finish();
            }
          }}>
          <img className={styles.artLight} src={lightLockup} alt="" />
          <img className={styles.artDark} src={darkLockup} alt="" />
          <span className={styles.typed}>
            {typed}
            <i className={styles.caret} />
          </span>
        </div>
      </div>
    </div>
  );
}
