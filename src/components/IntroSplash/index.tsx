import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import NodestoneLogo from '@site/src/components/NodestoneLogo';
import styles from './styles.module.css';

/** 开场动画阶段：底纹 → 打字机 → 星图入场 → 飞到顶栏左上角 → 卸载 */
type Phase = 'boot' | 'typing' | 'logo' | 'fly' | 'done';

const WORD_LENGTH = 9; // NODESTONE
const CHAR_MS = 90;
const BOOT_MS = 480;
const HOLD_MS = 300;
const LOGO_MS = 1350;
const FLY_MS = 900;

type SavedStyle = {el: HTMLElement; css: string};

export default function IntroSplash(): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('boot');
  const [typed, setTyped] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [flyTransform, setFlyTransform] = useState('');

  const boxRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const saved = useRef<SavedStyle[]>([]);
  const mainRef = useRef<HTMLElement | null>(null);

  /** 把某个元素的 style 属性原样存下来，收尾时恢复 */
  const stash = (el: HTMLElement | null) => {
    if (el && !saved.current.some((s) => s.el === el)) {
      saved.current.push({el, css: el.getAttribute('style') || ''});
    }
  };

  const restore = useCallback(() => {
    saved.current.forEach(({el, css}) => {
      if (css) {
        el.setAttribute('style', css);
      } else {
        el.removeAttribute('style');
      }
    });
    saved.current = [];
    document.body?.style.removeProperty('overflow');
    document.getElementById('ns-intro-boot')?.remove();
  }, []);

  const finish = useCallback(() => {
    restore();
    setPhase('done');
  }, [restore]);

  const startFly = useCallback(() => {
    // 正文与底纹此刻交叉淡入淡出
    setRevealed(true);
    const main = mainRef.current;
    if (main) {
      main.style.opacity = '1';
      main.style.transform = 'none';
    }

    const box = boxRef.current;
    const logos = Array.from(document.querySelectorAll<HTMLElement>('.navbar__logo'));
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
    timers.current.push(window.setTimeout(finish, FLY_MS + 220));
  }, [finish]);

  // 遮罩就位 + 隐藏正文（遮罩本身不透明，正文此时在下面，只为浮现时能淡入）
  useLayoutEffect(() => {
    // <head> 里的内联脚本正常会在首帧前注入这条样式；没有（被 CSP 拦掉等）就自己补上
    if (!document.getElementById('ns-intro-boot')) {
      const style = document.createElement('style');
      style.id = 'ns-intro-boot';
      style.textContent = '[data-ns-splash]{display:flex!important}';
      document.head.appendChild(style);
    }

    const main = document.querySelector<HTMLElement>('.main-wrapper');
    const logo = document.querySelector<HTMLElement>('.navbar__logo');
    mainRef.current = main;
    stash(main);
    stash(logo);
    if (main) {
      main.style.opacity = '0';
      main.style.transform = 'translateY(10px)';
    }
    if (logo) {
      logo.style.opacity = '0';
    }
    document.body.style.overflow = 'hidden';

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      restore();
    };
  }, [restore]);

  // 阶段调度
  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const typingEnd = BOOT_MS + WORD_LENGTH * CHAR_MS + HOLD_MS;
    at(BOOT_MS, () => setPhase('typing'));
    at(typingEnd, () => setPhase('logo'));
    at(typingEnd + LOGO_MS, startFly);
  }, [startFly]);

  // 打字机
  useEffect(() => {
    if (phase !== 'typing') {
      return;
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= WORD_LENGTH) {
        window.clearInterval(id);
      }
    }, CHAR_MS);
    return () => window.clearInterval(id);
  }, [phase]);

  if (phase === 'done') {
    return null;
  }

  const starShown = phase === 'logo' || phase === 'fly';

  return (
    <div
      className={styles.splash}
      data-ns-splash=""
      data-phase={phase}
      data-reveal={revealed ? 'true' : 'false'}
      aria-hidden="true">
      <NodestoneLogo layout="lattice" className={styles.grid} />
      <div className={styles.stage}>
        <div
          ref={boxRef}
          className={styles.lockup}
          style={flyTransform ? {transform: flyTransform} : undefined}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform' && e.target === boxRef.current) {
              finish();
            }
          }}>
          <NodestoneLogo
            layout="header"
            mode={starShown ? 'intro' : 'static'}
            typed={typed}
            art={starShown}
            className={styles.art}
          />
        </div>
      </div>
    </div>
  );
}
