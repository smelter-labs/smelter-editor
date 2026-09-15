'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { ModeratorPanel } from '@/components/football-game/panel/moderator-panel';
import { fbDisplay, fbMono } from '../../fonts';

/**
 * Courtside moderator panel (phone/tablet friendly): confirm the AI's calls
 * (pending makes), fix the ledger, run the clock, switch views — optionally
 * with a commentary cam + mic.
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
