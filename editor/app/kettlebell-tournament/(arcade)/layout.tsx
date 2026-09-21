import { Suspense } from 'react';
import type { Metadata } from 'next';
import { KettlebellTournamentArcadeHost } from '@/components/kettlebell-tournament/arcade-host';
import { bigShoulders, plexMono } from '../fonts';

export const metadata: Metadata = {
  title: 'KETTLEBELL TOURNAMENT',
};

/**
 * The standalone Kettlebell Tournament arcade: rules setup → QR registration
 * (each phone camera becomes a WHIP tile with the kettlebell-coach AI) →
 * heats on the Smelter output → standings → final → podium. No dashboard
 * chrome — just the tournament.
 *
 * The arcade lives in this LAYOUT, not in the pages, on purpose (same reason
 * as /duck-hunter). After the room is created the page rewrites its URL from
 * /kettlebell-tournament to /kettlebell-tournament/[roomId] with
 * `history.replaceState` (so a refresh rejoins the room). The App Router
 * records the new URL but keeps rendering the old page tree; the next server
 * action (the roster's join-URL push, moments later) re-syncs the tree and
 * swaps the page segment — which used to unmount and remount the arcade
 * mid-roster: a RESTORING ARENA… flash, a dropped feed socket, and on EXIT TO
 * TITLE a cancelled recording download. A layout segment survives that swap,
 * so the two pages below only render null.
 *
 * It is a route group so the commentator panel
 * (/kettlebell-tournament/panel/[roomId]) stays outside this layout.
 */
export default function KettlebellTournamentArcadeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <KettlebellTournamentArcadeHost />
      </Suspense>
      {children}
    </div>
  );
}
