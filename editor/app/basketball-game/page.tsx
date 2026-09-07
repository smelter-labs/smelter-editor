import { Suspense } from 'react';
import type { Metadata } from 'next';
import { BasketballGameArcade } from '@/components/basketball-game/arcade';
import { bigShoulders, plexMono } from './fonts';

export const metadata: Metadata = {
  title: 'BLACKTOP · BASKETBALL',
};

/**
 * The standalone one-hoop streetball production: rules setup → phones join
 * by QR (hoop cam runs the basketball-scorer AI, court cam is the picture,
 * a moderator confirms the calls) → the match on the Smelter output → final.
 */
export default function BasketballGamePage() {
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <BasketballGameArcade />
      </Suspense>
    </div>
  );
}
