import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FootballGameArcade } from '@/components/football-game/arcade';
import { fbDisplay, fbMono } from './fonts';

export const metadata: Metadata = {
  title: 'TOUCHLINE · FOOTBALL',
};

/**
 * The standalone one-hoop streetball production: rules setup → phones join
 * by QR (hoop cam runs the football-scorer AI, court cam is the picture,
 * a moderator confirms the calls) → the match on the Smelter output → final.
 */
export default function FootballGamePage() {
  return (
    <div className={`${fbDisplay.variable} ${fbMono.variable}`}>
      <Suspense>
        <FootballGameArcade />
      </Suspense>
    </div>
  );
}
