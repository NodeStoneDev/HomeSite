import type {ReactNode} from 'react';
import FieldCanvas from '@site/src/components/FieldCanvas';
import IntroSplash from '@site/src/components/IntroSplash';

/**
 * 全局挂载点：
 * - FieldCanvas 是常驻的 l9 磁感线波场，跨路由不重建（换页不会重播/闪断）
 * - IntroSplash 是 l1 开场字标，播完自己卸载
 * 两者写在这里而不是 Layout 里，是因为开场时 `.main-wrapper` 带着 transform，
 * 会把 position: fixed 的后代变成相对它定位。
 */
export default function Root({children}: {children: ReactNode}): ReactNode {
  return (
    <>
      <FieldCanvas />
      {children}
      <IntroSplash />
    </>
  );
}
