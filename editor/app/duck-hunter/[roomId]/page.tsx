'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { DuckHunterArcade } from '@/components/duck-hunter/arcade';
import { doto, pressStart, robotoMono } from '../fonts';

/**
 * The arcade bound to a live room: /duck-hunter rewrites its URL here after
 * creating the room, so a refresh (or the landing page's resume button)
 * rehydrates the running game from the server instead of dropping back to
 * the title screen.
 */
export default function DuckHunterRoomPage() {
  const { roomId } = useParams();
  return (
    <div
      className={`${pressStart.variable} ${doto.variable} ${robotoMono.variable}`}>
      <Suspense>
        <DuckHunterArcade initialRoomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
