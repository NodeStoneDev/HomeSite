import {useEffect, useRef} from 'react';
import {crestAt, smoothstep} from './field';
import './field.css';

/**
 * 磁感线波场 —— 全站唯一的 l9 背景层。
 *
 * 只有一份、挂在 Root 里、跨路由不重建：
 * 1. 开场遮罩（IntroSplash）与页面正文都只是它的观众，波场自己一直在跑，
 *    所以从加载动画切到首页时相位不会重置，「无缝」是结构保证而不是动画凑出来的。
 * 2. 用 Canvas 2D 而不是 SVG：每帧要按波形重算两千个格点的臂长/透明度，
 *    SVG 那边就是两千次 DOM 属性写入，撑不住 60fps。
 * 3. 图层固定、内容滚动 → 天然视差，首页 hero 那块「窗」才有深度。
 */

/** 相邻格点间距（CSS px）。点与 × 交替，同族点距 = PITCH × √2 */
const PITCH_DESKTOP = 44;
const PITCH_MOBILE = 36;

/** 「·」的半径 */
const DOT_R = 2.15;
/** 「×」单臂半长（圆头笔帽还要往外扩 ARM_W / 2） */
const ARM_HALF = 6.6;
const ARM_W = 1.5;

/** 磁吸影响半径（高斯 σ） */
const MAGNET_SIGMA = 92;
/** 磁吸强度：隆起叠加到高度场上的量，压低一点，只做「微」隆起 */
const MAGNET_STRENGTH = 0.62;

const DPR_CAP = 1.5;
const TAU = Math.PI * 2;

type RGB = [number, number, number];

const FALLBACK_DOT: RGB = [107, 120, 140];
const FALLBACK_CREST: RGB = [91, 107, 168];

function parseHex(raw: string, fallback: RGB): RGB {
  const v = raw.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) {
    return fallback;
  }
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a.toFixed(3)})`;

/** 臂长的四个透明度档：同一个 Path2D 里 stroke 宽度/颜色必须一致，只能分档批量画 */
const ARM_TIERS = [0.24, 0.46, 0.66, 0.82];

export default function FieldCanvas(): React.ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const ctx = canvas.getContext('2d', {alpha: true});
    if (!ctx) {
      return undefined;
    }

    const started = performance.now();
    let width = 0;
    let height = 0;
    let pitch = PITCH_DESKTOP;
    let dpr = 1;

    let dotColor: RGB = FALLBACK_DOT;
    let crestColor: RGB = FALLBACK_CREST;

    // 光标磁吸：目标位置来自 pointermove，实际位置每帧缓动追过去，避免抖动
    let pointerX = -9999;
    let pointerY = -9999;
    let followX = -9999;
    let followY = -9999;
    let magnetOn = 0;

    const readTokens = () => {
      const cs = getComputedStyle(document.documentElement);
      dotColor = parseHex(cs.getPropertyValue('--ns-field-dot'), FALLBACK_DOT);
      crestColor = parseHex(cs.getPropertyValue('--ns-field-crest'), FALLBACK_CREST);
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      pitch = width < 700 ? PITCH_MOBILE : PITCH_DESKTOP;
      dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    // 每帧复用的缓冲，避免每帧分配上千个小数组
    const dots: number[] = [];
    const glows: number[] = [];
    const arms: number[][] = ARM_TIERS.map(() => []);

    let raf = 0;
    let lastDraw = 0;

    const draw = (now: number) => {
      raf = window.requestAnimationFrame(draw);
      if (document.hidden || now - lastDraw < 15) {
        return;
      }
      lastDraw = now;

      const t = (now - started) / 1000;
      // 起风：第一帧是平静水面，然后风慢慢起来
      const wind = smoothstep(0.1, 1.5, t);
      // 整体淡入，别让波场在第一帧硬切进来
      const fade = smoothstep(0, 0.65, t);

      followX += (pointerX - followX) * 0.26;
      followY += (pointerY - followY) * 0.26;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      dots.length = 0;
      glows.length = 0;
      for (let i = 0; i < arms.length; i += 1) {
        arms[i].length = 0;
      }

      const half = Math.SQRT1_2; // cos45 = sin45
      const unit = half * pitch; // 相邻格点在世界坐标里的投影长度
      const span = 2 * unit;

      // 视口在 45° 斜置晶格里的坐标范围（格点 = 整数对 i, j）
      const iMin = -1;
      const iMax = Math.ceil((width + height) / span) + 1;
      const jMin = Math.floor(-width / span) - 1;
      const jMax = Math.ceil(height / span) + 1;

      const sigma2 = 2 * MAGNET_SIGMA * MAGNET_SIGMA;
      const dotR = DOT_R;

      for (let i = iMin; i <= iMax; i += 1) {
        for (let j = jMin; j <= jMax; j += 1) {
          const x = (i - j) * unit;
          const y = (i + j) * unit;

          let bump = 0;
          if (magnetOn > 0.01) {
            const dx = x - followX;
            const dy = y - followY;
            const d2 = dx * dx + dy * dy;
            if (d2 < 90000) {
              bump = MAGNET_STRENGTH * magnetOn * Math.exp(-d2 / sigma2);
            }
          }

          const a = crestAt(x, y, t, wind, bump);
          const parity = (i + j) & 1;

          // 让点与 × 交替：同色相的点阵 + 交错长出来的 ×
          const r = dotR * (1 - 0.34 * a) * (parity ? 1 : 0.86);
          dots.push(x, y, r);

          if (a > 0.006) {
            const armHalf = ARM_HALF * a;
            if (armHalf > 0.55) {
              const tier = a < 0.34 ? 0 : a < 0.58 ? 1 : a < 0.8 ? 2 : 3;
              const bucket = arms[tier];
              bucket.push(x, y, armHalf);
            }
            if (a > 0.82) {
              glows.push(x, y);
            }
          }
        }
      }

      // 1) 圆点：一次 fill 画完
      ctx.beginPath();
      for (let n = 0; n < dots.length; n += 3) {
        const x = dots[n];
        const y = dots[n + 1];
        const r = dots[n + 2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      ctx.fillStyle = rgba(dotColor, 0.62 * fade);
      ctx.fill();

      // 2) 浪尖辉光：先铺一层很淡的底，再叠 ×
      if (glows.length > 0) {
        ctx.beginPath();
        for (let n = 0; n < glows.length; n += 2) {
          const x = glows[n];
          const y = glows[n + 1];
          ctx.moveTo(x + 7, y);
          ctx.arc(x, y, 7, 0, TAU);
        }
        ctx.fillStyle = rgba(crestColor, 0.055 * fade);
        ctx.fill();
      }

      // 3) ×：按软硬程度分四档批量 stroke
      ctx.lineCap = 'round';
      ctx.lineWidth = ARM_W;
      for (let tier = 0; tier < arms.length; tier += 1) {
        const bucket = arms[tier];
        if (bucket.length === 0) {
          continue;
        }
        ctx.beginPath();
        for (let n = 0; n < bucket.length; n += 3) {
          const x = bucket[n];
          const y = bucket[n + 1];
          const h = bucket[n + 2];
          ctx.moveTo(x - h, y - h);
          ctx.lineTo(x + h, y + h);
          ctx.moveTo(x - h, y + h);
          ctx.lineTo(x + h, y - h);
        }
        ctx.strokeStyle = rgba(mix(dotColor, crestColor, ARM_TIERS[tier]), (0.38 + tier * 0.15) * fade);
        ctx.stroke();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (magnetOn < 1) {
        // 第一次出现时从 0 淡入，别突然冒出一个鼓包
        followX = pointerX;
        followY = pointerY;
      }
      magnetOn = 1;
    };
    const onPointerLeave = () => {
      magnetOn = 0;
    };

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        readTokens();
      }, 120);
    };

    readTokens();
    resize();
    raf = window.requestAnimationFrame(draw);

    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointerMove, {passive: true});
    document.addEventListener('pointerleave', onPointerLeave);

    // 主题切换（Docusaurus 把 data-theme 写在 <html> 上）要换配色
    const themeObserver = new MutationObserver(() => {
      readTokens();
    });
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      themeObserver.disconnect();
    };
  }, []);

  return (
    <div className="ns-field" data-ns-field="" aria-hidden="true">
      <canvas ref={canvasRef} className="ns-field__canvas" />
    </div>
  );
}
