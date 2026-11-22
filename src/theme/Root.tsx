import type {ReactNode} from 'react';
import IntroSplash from '@site/src/components/IntroSplash';

export default function Root({children}: {children: ReactNode}): ReactNode {
  return (
    <>
      {children}
      <IntroSplash />
    </>
  );
}
