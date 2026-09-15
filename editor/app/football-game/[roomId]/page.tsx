'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { FootballGameArcade } from '@/components/football-game/arcade';
import { fbDisplay, fbMono } from '../fonts';

/**
 * The arcade bound to a live room: /football-game rewrites its URL here
 * after creating the room, so a refresh rehydrates the match from the server.
 */
export default function FootballGameRoomPage() {
  const { roomId } = useParams();
  return (
    <div className={`${fbDisplay.variable} ${fbMono.variable}`}>
      <Suspense>
        <FootballGameArcade initialRoomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
