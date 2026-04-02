import { Suspense } from 'react';

import IntroView from '@/components/pages/intro-view';

export default function Home() {
  return (
    <Suspense fallback={null}>
      <IntroView />
    </Suspense>
  );
}
