import { Suspense } from 'react';

import IntroView from '@/components/pages/intro-view';

export default function KickPage() {
  return (
    <Suspense fallback={null}>
      <IntroView />
    </Suspense>
  );
}
