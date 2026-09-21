import { Suspense } from 'react';
import type { Metadata } from 'next';
import { FootballGameArcade } from '@/components/football-game/arcade';
import { fbDisplay, fbMono } from './fonts';

export const metadata: Metadata = {
  title: 'TOUCHLINE · FOOTBALL',
};

/**
 * The standalone football production ("Touchline"): setup → pre-match (pick
 * the panorama or the three camera clips, the moderator joins by QR) → the
 * match on the Smelter output (virtual director, AI EVENTS from the clip's
 * sidecars, REF CALLS confirmed by the moderator) → full time.
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
