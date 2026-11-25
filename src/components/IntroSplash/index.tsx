import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import NodestoneLogo from '@site/src/components/NodestoneLogo';
import styles from './styles.module.css';

/** 开场动画阶段：起风 → 打字机 → 星图入场 → 飞到顶栏左上角 → 卸载 */
type Phase = 'boot' | 'typing' | 'logo' | 'fly' | 'done';

const WORD_LENGTH = 9; // NODESTONE
const CHAR_MS = 90;
const BOOT_MS = 480;
/** 褪掉遮罩纸色的时刻：波场第一帧已经画上，越早越像「背景本来就在那儿」 */
const PAPER_MS = 160;
const HOLD_MS = 300;
const LOGO_MS = 1350;
const FLY_MS = 900;

/**
 * 开场期间要藏起来的外壳。它们是各自独立的兄弟节点，得一起藏、一起淡入，
 * 否则透明遮罩下面会露出顶栏、公告条和页脚。
 */
const APP_SELECTOR = '.navbar, .main-wrapper, .footer, [class*="announcementBar"]';

type SavedStyle = {el: HTMLElement; css: string};

export default function IntroSplash(): React.ReactNode {
  const [phase, setPhase] = useState<Phase>('boot');
  const [typed, setTyped] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [bootCleared, setBootCleared] = useState(false);
  const [flyTransform, setFlyTransform] = useState('');

  const boxRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const saved = useRef<SavedStyle[]>([]);
  const appNodes = useRef<HTMLElement[]>([]);

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
    // 正文与波场此刻交叉淡入淡出：正文浮起来，波场退到「窗外」的浓度
    setRevealed(true);
    const nodes = appNodes.current;
    nodes.forEach((el) => {
      // 交回 CSS 里的过渡曲线，正文是「浮现」，不是瞬间出现
      el.style.transition = '';
      el.style.opacity = '1';
    });
    const main = nodes.find((el) => el.classList.contains('main-wrapper'));
    if (main) {
      main.style.transform = 'none';
      // 让首页的分层浮现从这一刻开始计时（纯属性，不碰 <html class>）
      main.setAttribute('data-ns-reveal', 'true');
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

  // 遮罩就位 + 藏起外壳（遮罩此刻还是不透明的纸色，避免首屏闪出正文；
  // 等波场画上第一帧后再把纸色褪掉，波场就自然「显影」出来）
  useLayoutEffect(() => {
    // <head> 里的内联脚本正常会在首帧前注入这条样式；没有（被 CSP 拦掉等）就自己补上
    if (!document.getElementById('ns-intro-boot')) {
      const style = document.createElement('style');
      style.id = 'ns-intro-boot';
      style.textContent = '[data-ns-splash]{display:flex!important}';
      document.head.appendChild(style);
    }

    const nodes = Array.from(document.querySelectorAll<HTMLElement>(APP_SELECTOR));
    appNodes.current = nodes;
    nodes.forEach((el) => {
      stash(el);
      // 藏起来这一步必须是瞬时的：否则遮罩下面能看见正文自己慢慢淡出
      el.style.transition = 'none';
      el.style.opacity = '0';
    });
    const main = nodes.find((el) => el.classList.contains('main-wrapper'));
    if (main) {
      main.style.transform = 'translateY(10px)';
    }
    const logo = document.querySelector<HTMLElement>('.navbar__logo');
    stash(logo);
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
    // 纸色先褪（露出 l9），打字机随后才开始（l1）
    at(PAPER_MS, () => setBootCleared(true));
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
      data-boot={bootCleared ? 'clear' : 'sealed'}
      data-reveal={revealed ? 'true' : 'false'}
      aria-hidden="true">
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
