'use client';

import { useEffect, useState } from 'react';
import type {
  ShooterMatchEvent,
  ShooterPlayer,
  ShooterServerEvent,
} from '@smelter-editor/types';
import { useRoomSocketFeed } from '@/lib/arcade/use-room-feed';

export type ShooterFeed = {
  connected: boolean;
  players: ShooterPlayer[];
  /** Whether a duck-enabled input is live (the YOLO sidecar is warm). */
  targetActive: boolean;
  match: ShooterMatchEvent | null;
};

/**
 * Read-only live feed for the /duck-hunter arcade page: connects to the
 * room WebSocket, sends `shoot_spectate` (snapshot reply, never creates a
 * player) and then consumes the `shooter_state` / `shooter_match`
 * broadcasts. Reconnects with backoff while the page stays mounted.
 */
export function useShooterFeed(
  roomId: string | null,
  onRoomGone?: () => void,
): ShooterFeed {
  const [players, setPlayers] = useState<ShooterPlayer[]>([]);
  const [targetActive, setTargetActive] = useState(false);
  const [match, setMatch] = useState<ShooterMatchEvent | null>(null);

  useEffect(() => {
    if (roomId) return;
    setPlayers([]);
    setTargetActive(false);
    setMatch(null);
  }, [roomId]);

  const { connected } = useRoomSocketFeed(roomId, {
    spectateMessage: { type: 'shoot_spectate' },
    onEvent: (event) => {
      const parsed = event as ShooterServerEvent;
      if (parsed.type === 'shooter_state') {
        setPlayers(parsed.players);
        setTargetActive(parsed.targetActive);
      } else if (parsed.type === 'shooter_match') {
        setMatch(parsed);
      }
    },
    onRoomGone,
  });

  return { connected, players, targetActive, match };
}
