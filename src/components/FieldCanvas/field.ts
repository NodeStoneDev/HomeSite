/**
 * 磁感线波场的数学部分：纯函数，不含 DOM，方便单独调参与截图比对。
 *
 * 世界观：45° 斜置的方格网是一张平静的水面，格点就是水面上的取样点。
 * 风向决定浪往哪走；浪到的地方，格点上的「·」长出两条 45° 对角线变成「×」。
 * 因为一切都是连续函数（高度 → 振幅 → 臂长），所以「·」到「×」的中间态
 * 天然存在，浪看起来就是平滑推过去的，而不是一帧一帧地翻面。
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** 一列行波：k 是波数向量，ω 是角频率（保证相速度恒定，不会越走越快） */
export type Swell = {
  kx: number;
  ky: number;
  omega: number;
  weight: number;
  phase: number;
};

function swell(
  dirDeg: number,
  wavelength: number,
  speed: number,
  weight: number,
  phase: number,
): Swell {
  const k = TAU / wavelength;
  const a = dirDeg * DEG;
  return {kx: Math.cos(a) * k, ky: Math.sin(a) * k, omega: k * speed, weight, phase};
}

/**
 * 三层叠加，权重和为 1，所以高度场 h ∈ [-1, 1]：
 * - 主涌浪：斜向扫过，决定「浪」的读法
 * - 交叉涌：换个方向插进来，让水面不至于像规则条纹
 * - 细碎波纹：只影响浪尖的碎度，看不出来最好
 */
const SWELLS: Swell[] = [
  swell(128, 460, 55, 0.55, 0),
  swell(34, 272, 62, 0.28, 1.7),
  swell(-12, 170, 70, 0.17, 4.1),
];

/** 阵风包络：浪是成片扫过的，不是整屏一起呼吸 */
const GUST = swell(74, 1150, 16, 1, 2.3);
const GUST_FLOOR = 0.42;

/**
 * 浪尖窗口：高度低于 CREST_LOW 的地方保持圆点，到 CREST_HIGH 完全变成 ×。
 * 0.24 / 0.52 是量出来的：任何时刻约一成三的格点长成 ×，
 * 连起来是一条条斜向的浪脊，谷里留白，不会糊成一片。
 */
export const CREST_LOW = 0.24;
export const CREST_HIGH = 0.52;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Hermite 平滑，保证一阶导连续——「·」开始长臂的那一刻不会有折角 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 水面高度，h ∈ [-1, 1] */
export function heightAt(x: number, y: number, t: number): number {
  let h = 0;
  for (let i = 0; i < SWELLS.length; i += 1) {
    const s = SWELLS[i];
    h += s.weight * Math.sin(s.kx * x + s.ky * y - s.omega * t + s.phase);
  }
  return h;
}

/** 阵风包络，∈ [GUST_FLOOR, 1] */
export function gustAt(x: number, y: number, t: number): number {
  const g = Math.sin(GUST.kx * x + GUST.ky * y - GUST.omega * t + GUST.phase);
  return GUST_FLOOR + (1 - GUST_FLOOR) * (0.5 + 0.5 * g);
}

/**
 * 某个格点此刻的浪尖程度 0..1。
 * 只取波峰（`max(0, h)`）再乘阵风：风小的海面就是平的，不会到处长 ×。
 * @param wind 起风进度（开场时从 0 涨到 1，第一帧是镜面）
 * @param bump 光标磁吸造成的额外隆起（高斯鼓包，0..1）
 */
export function crestAt(x: number, y: number, t: number, wind: number, bump: number): number {
  const h = Math.max(0, heightAt(x, y, t));
  const amp = h * gustAt(x, y, t) * wind + bump;
  return smoothstep(CREST_LOW, CREST_HIGH, amp);
}
