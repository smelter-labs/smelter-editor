'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { ModeratorPanel } from '@/components/football-game/panel/moderator-panel';
import { fbDisplay, fbMono } from '../../fonts';

/**
 * Touchline moderator panel (phone/tablet friendly): rule on the REF CALLS
 * (goal candidates), fix the ledger, run the clock and the halves, pick the
 * broadcast view, swap the camera clips.
 */
export default function ModeratorPanelPage() {
  const { roomId } = useParams();
  return (
    <div className={`${fbDisplay.variable} ${fbMono.variable}`}>
      <Suspense>
        <ModeratorPanel roomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
