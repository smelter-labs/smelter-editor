import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DuckHunterArcadeHost } from '@/components/duck-hunter/arcade-host';
import { doto, pressStart, robotoMono } from './fonts';

export const metadata: Metadata = {
  title: 'DUCK HUNTER',
};

/**
 * The standalone Duck Hunter arcade: title screen → mode + config → phone
 * lobby → live game on the Smelter output → results. No dashboard chrome —
 * just the game.
 *
 * The arcade lives in this LAYOUT, not in the pages, on purpose. After the
 * room is created the page rewrites its URL from /duck-hunter to
 * /duck-hunter/[roomId] with `history.replaceState` (so a refresh rejoins the
 * room). The App Router records the new URL but keeps rendering the old page
 * tree; the next server action (the lobby's join-URL push, ~600 ms later)
 * re-syncs the tree and swaps the page segment — which used to unmount and
 * remount the arcade mid-lobby, resetting the round setup to its defaults.
 * A layout segment survives that swap, so the arcade keeps its state and the
 * two pages below only render null.
 */
export default function DuckHunterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${pressStart.variable} ${doto.variable} ${robotoMono.variable}`}>
      <Suspense>
        <DuckHunterArcadeHost />
      </Suspense>
      {children}
    </div>
  );
}
