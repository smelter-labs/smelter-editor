import { Suspense } from 'react';
import type { Metadata } from 'next';
import { KettlebellTournamentArcade } from '@/components/kettlebell-tournament/arcade';
import { bigShoulders, plexMono } from './fonts';

export const metadata: Metadata = {
  title: 'KETTLEBELL TOURNAMENT',
};

/**
 * The standalone Kettlebell Tournament arcade: rules setup → QR registration
 * (each phone camera becomes a WHIP tile with the kettlebell-coach AI) →
 * heats on the Smelter output → standings → final → podium. No dashboard
 * chrome — just the tournament.
 */
export default function KettlebellTournamentPage() {
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <KettlebellTournamentArcade />
      </Suspense>
    </div>
  );
}
