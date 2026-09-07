'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { BasketballGameArcade } from '@/components/basketball-game/arcade';
import { bigShoulders, plexMono } from '../fonts';

/**
 * The arcade bound to a live room: /basketball-game rewrites its URL here
 * after creating the room, so a refresh rehydrates the match from the server.
 */
export default function BasketballGameRoomPage() {
  const { roomId } = useParams();
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <BasketballGameArcade initialRoomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
