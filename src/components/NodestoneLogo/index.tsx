import {useId, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  CHORDS_2,
  CHORDS_3,
  INTERSECTIONS,
  LATTICE_X_HALF,
  LATTICE_X_R,
  LATTICE_X_STROKE,
  LODESTONE,
  PERIMETER,
  VERTEX_HALF,
  VERTICES,
  WORDMARK,
} from './headerGeometry';
import {
  MARK_CUBE,
  MARK_SHADOW,
  MARK_VIEWBOX,
  MARK_WORDMARK_D,
  MARK_WORDMARK_SHIFT,
} from './markGeometry';
import './nodestone-logo.css';

/**
 * 品牌图形组件：用矢量原件替代位图，三套排版共用同一份几何。
 * - `header`：十角星 + 磁石 + NODESTONE 字标（首屏与顶栏用，字标是真实文本，可逐字打字）
 * - `lattice`：45° 晶格，铺满容器当底纹
 * - `mark`：方形构图（磁石方块 + NodeStone 字标），首页大图标用
 */
export type NodestoneLogoLayout = 'header' | 'lattice' | 'mark';

/**
 * - `static`：全部定格在终态，不播动画
 * - `idle`：只跑常驻动画（磁石浮动、顶点脉动、外圈流动）
 * - `intro`：入场动画（弦线绘制、交点弹出、顶点偏转）后接常驻动画
 */
export type NodestoneLogoMode = 'static' | 'idle' | 'intro';

export type NodestoneLogoProps = {
  layout?: NodestoneLogoLayout;
  mode?: NodestoneLogoMode;
  /** 已打出的字母数；不传则整词直接显示 */
  typed?: number;
  /** 星图与磁石是否可见（打字阶段要先藏起来，免得和居中的字标挤在一起） */
  art?: boolean;
  className?: string;
  /** 给了就当作有含义的图片，用于顶栏等需要无障碍名称的位置 */
  title?: string;
};

/** 字标大写高约 0.745em（Plus Jakarta Sans ExtraBold 的 sCapHeight），用于光标高度 */
const CAP_RATIO = 0.745;

/**
 * 实际内容的外接框：星体 x128–661 / y93–625，字标 x835–2122。
 * 裁掉原画幅的大片留白后，同样高度里内容大约放大 1.3 倍，顶栏那种小尺寸才看得清。
 * 首屏与顶栏都用这个框，飞行落点才不会错位。
 */
const HEADER_BOX = {x: 110, y: 79, w: 2030, h: 560};
const HEADER_CENTER_X = HEADER_BOX.x + HEADER_BOX.w / 2;

/** 晶格单元：132×132 里放 2 个点 + 2 个交叉，与 kit 原图的半格错位一致 */
const TILE = 132;
const TILE_SCALE = 0.5;

const crossPath = (cx: number, cy: number, half: number) =>
  `M${cx - half} ${cy - half}L${cx + half} ${cy + half}M${cx - half} ${cy + half}L${cx + half} ${cy - half}`;

/** 45° 晶格底纹：用 <pattern> 平铺，密度随容器缩放，不会出现网格贴片的硬边 */
function LatticeArt({className}: {className?: string}): React.ReactNode {
  const uid = useId().replace(/:/g, '');
  const tileId = `ns-lattice-tile-${uid}`;
  return (
    <svg
      className={['ns-root', 'ns-lattice-art', className].filter(Boolean).join(' ')}
      aria-hidden="true">
      <defs>
        <pattern
          id={tileId}
          width={TILE}
          height={TILE}
          patternUnits="userSpaceOnUse"
          patternTransform={`scale(${TILE_SCALE})`}>
          <circle className="ns-bg-dot ns-t1" cx={0} cy={0} r={LATTICE_X_R} />
          <circle className="ns-bg-dot ns-t1" cx={TILE / 2} cy={TILE / 2} r={LATTICE_X_R} />
          <path
            className="ns-bg-x ns-t1"
            d={crossPath(TILE / 2, 0, LATTICE_X_HALF)}
            strokeWidth={LATTICE_X_STROKE}
            strokeLinecap="round"
          />
          <path
            className="ns-bg-x ns-t1"
            d={crossPath(0, TILE / 2, LATTICE_X_HALF)}
            strokeWidth={LATTICE_X_STROKE}
            strokeLinecap="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${tileId})`} />
    </svg>
  );
}

function MarkArt({
  className,
  title,
  cube,
}: {
  className?: string;
  title?: string;
  cube: string;
}): React.ReactNode {
  const [minX, minY, vbW, vbH] = MARK_VIEWBOX;
  const uid = useId().replace(/:/g, '');
  const shadeId = `ns-mark-shade-${uid}`;
  return (
    <svg
      className={['ns-root', 'ns-mark', className].filter(Boolean).join(' ')}
      viewBox={`${minX} ${minY} ${vbW} ${vbH}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}>
      <defs>
        <radialGradient id={shadeId} cx="50%" cy="50%" r="50%">
          <stop className="ns-shade-a" offset="0%" />
          <stop className="ns-shade-b" offset="55%" />
          <stop className="ns-shade-c" offset="100%" />
        </radialGradient>
      </defs>
      <ellipse
        cx={MARK_SHADOW.cx}
        cy={MARK_SHADOW.cy}
        rx={MARK_SHADOW.rx}
        ry={MARK_SHADOW.ry}
        fill={`url(#${shadeId})`}
      />
      <image
        x={MARK_CUBE.x}
        y={MARK_CUBE.y}
        width={MARK_CUBE.w}
        height={MARK_CUBE.h}
        href={cube}
        preserveAspectRatio="xMidYMid meet"
      />
      <g transform={`translate(0 ${MARK_WORDMARK_SHIFT})`}>
        <path className="ns-mark-word" d={MARK_WORDMARK_D} />
      </g>
    </svg>
  );
}

function HeaderArt({
  mode,
  typed,
  art,
  className,
  title,
  cube,
}: {
  mode: NodestoneLogoMode;
  typed?: number;
  art: boolean;
  className?: string;
  title?: string;
  cube: string;
}): React.ReactNode {
  const textRef = useRef<SVGTextElement>(null);
  const [typedWidth, setTypedWidth] = useState(0);

  const word = WORDMARK.text;
  const typing = typed !== undefined && typed < word.length;
  const shown = typed === undefined ? word : word.slice(0, typed);

  // 打字阶段字标要跟着已打出的字居中：靠实测宽度算位移，字体就绪后再量一次
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) {
      return;
    }
    let alive = true;
    const measure = () => {
      if (!alive) {
        return;
      }
      try {
        setTypedWidth(el.getComputedTextLength());
      } catch {
        // 不支持 SVG 文本测量的环境下退化为左对齐，不影响最终定格
      }
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [shown]);

  // 打字时整词居中；打完回到 kit 的原位，保证终帧与顶栏完全同框
  const shift = typing ? HEADER_CENTER_X - (WORDMARK.x + typedWidth / 2) : 0;
  const cap = WORDMARK.size * CAP_RATIO;
  const artClass = art ? '' : ' ns-hidden';

  return (
    <svg
      className={['ns-root', 'ns-header', `ns-mode-${mode}`, className].filter(Boolean).join(' ')}
      viewBox={`${HEADER_BOX.x} ${HEADER_BOX.y} ${HEADER_BOX.w} ${HEADER_BOX.h}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}>
      <g className={`ns-star${artClass}`}>
        <g className="ns-perim">
          {PERIMETER.map(([x1, y1, x2, y2], i) => (
            <line
              key={`p${i}`}
              className="ns-perim-line"
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={1.39}
              strokeLinecap="round"
            />
          ))}
        </g>
        <g className="ns-chords">
          {CHORDS_2.map(([x1, y1, x2, y2, len, idx], i) => (
            <line
              key={`c2-${i}`}
              className="ns-chord-2"
              style={{'--ns-len': String(len), '--ns-idx': String(idx)} as CSSProperties}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={1.22}
              strokeLinecap="round"
            />
          ))}
          {CHORDS_3.map(([x1, y1, x2, y2, len, idx], i) => (
            <line
              key={`c3-${i}`}
              className="ns-chord-3"
              style={{'--ns-len': String(len), '--ns-idx': String(idx)} as CSSProperties}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              strokeWidth={1.68}
              strokeLinecap="round"
            />
          ))}
        </g>
        <g className="ns-intersections">
          {INTERSECTIONS.map(([cx, cy, r, idx], i) => (
            <circle
              key={`i${i}`}
              className="ns-int-dot"
              style={{'--ns-idx': String(idx)} as CSSProperties}
              cx={cx}
              cy={cy}
              r={r}
            />
          ))}
        </g>
        <g className="ns-vertices">
          {VERTICES.map(([idx, dx, dy, cx, cy]) => (
            <g
              key={`v${idx}`}
              className="ns-vertex"
              style={
                {
                  '--ns-idx': String(idx),
                  '--ns-dx': `${dx}px`,
                  '--ns-dy': `${dy}px`,
                } as CSSProperties
              }>
              <path
                d={crossPath(cx, cy, VERTEX_HALF)}
                strokeWidth={2.78}
                strokeLinecap="round"
              />
            </g>
          ))}
        </g>
      </g>
      <g className={`ns-lodestone${artClass}`}>
        <image
          x={LODESTONE.x}
          y={LODESTONE.y}
          width={LODESTONE.w}
          height={LODESTONE.h}
          href={cube}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
      <g
        className={`ns-wordmark-group${typing ? ' ns-typing' : ''}`}
        style={{transform: `translateX(${shift.toFixed(2)}px)`}}>
        <text
          ref={textRef}
          className="ns-wordmark"
          x={WORDMARK.x}
          y={WORDMARK.y}
          fontSize={WORDMARK.size}
          letterSpacing={WORDMARK.spacing}
          fontWeight={800}>
          {shown}
        </text>
        {typing && (
          <rect
            className="ns-caret"
            x={WORDMARK.x + typedWidth + 24}
            y={WORDMARK.y - cap}
            width={17}
            height={cap + 16}
            rx={6}
          />
        )}
      </g>
    </svg>
  );
}

export default function NodestoneLogo({
  layout = 'header',
  mode = 'static',
  typed,
  art = true,
  className,
  title,
}: NodestoneLogoProps): React.ReactNode {
  const cube = useBaseUrl('/brand/png/lodestone-crisp.png');

  if (layout === 'mark') {
    return <MarkArt className={className} title={title} cube={cube} />;
  }

  if (layout === 'lattice') {
    return <LatticeArt className={className} />;
  }

  return (
    <HeaderArt
      mode={mode}
      typed={typed}
      art={art}
      className={className}
      title={title}
      cube={cube}
    />
  );
}
