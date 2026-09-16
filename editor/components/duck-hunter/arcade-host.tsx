'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { DuckHunterArcade } from './arcade';

/**
 * Mounts the arcade from the /duck-hunter layout with the room named in the
 * URL (if any) as its initial room. The id is read ONCE: the arcade rewrites
 * the URL itself after creating a room, and the router's params catch up a
 * moment later — that resync must not change `initialRoomId`, which only
 * matters for the mount-time restore in useDuckHunterRoom.
 */
export function DuckHunterArcadeHost() {
  const params = useParams<{ roomId?: string }>();
  const [initialRoomId] = useState(() =>
    typeof params?.roomId === 'string' ? params.roomId : undefined,
  );
  return <DuckHunterArcade initialRoomId={initialRoomId} />;
}
