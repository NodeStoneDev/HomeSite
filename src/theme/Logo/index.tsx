import React from 'react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {useThemeConfig} from '@docusaurus/theme-common';
import NodestoneLogo from '@site/src/components/NodestoneLogo';

/**
 * 覆写主题自带的 Logo：不再渲染位图 `.svg`，直接用品牌矢量组件。
 *
 * 顶栏与首屏开场动画用的是同一个组件、同一份几何，所以开场动画飞向
 * 左上角时，落点就是顶栏真实渲染的那一份，缩放不会出现偏差。
 */

type LogoProps = {
  className?: string;
  imageClassName?: string;
  titleClassName?: string;
};

export default function Logo({
  className,
  imageClassName,
  titleClassName,
}: LogoProps): React.ReactNode {
  const {
    navbar: {title: navbarTitle, logo},
  } = useThemeConfig();
  const to = useBaseUrl(logo?.href || '/');

  return (
    <Link to={to} className={className} {...(logo?.target && {target: logo.target})}>
      <span className={imageClassName}>
        <NodestoneLogo layout="header" mode="idle" title={logo?.alt || 'NodeStone'} />
      </span>
      {navbarTitle != null && <b className={titleClassName}>{navbarTitle}</b>}
    </Link>
  );
}
