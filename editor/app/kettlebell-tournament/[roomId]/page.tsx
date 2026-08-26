'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { KettlebellTournamentArcade } from '@/components/kettlebell-tournament/arcade';
import { bigShoulders, plexMono } from '../fonts';

/**
 * The arcade bound to a live room: /kettlebell-tournament rewrites its URL
 * here after creating the room, so a refresh rehydrates the tournament from
 * the server instead of dropping back to the title screen.
 */
export default function KettlebellTournamentRoomPage() {
  const { roomId } = useParams();
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <KettlebellTournamentArcade initialRoomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
