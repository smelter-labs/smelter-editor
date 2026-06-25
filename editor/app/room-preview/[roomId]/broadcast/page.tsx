'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import LoadingSpinner from '@/components/ui/spinner';
import BroadcastModeScreen from '@/components/broadcast-mode/broadcast-mode-screen';

export default function BroadcastModePage() {
  const { roomId } = useParams();
  const [loading, setLoading] = useState(true);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) return;
      try {
        const state = await getRoomInfo(roomId as string);
        if (state === 'not-found') {
          if (mounted) {
            setError('Room not found');
            setLoading(false);
          }
        } else if (mounted) {
          // Initialize broadcast tiles if not present
          if (!state.broadcastTiles) {
            state.broadcastTiles = [];
          }
          if (state.selectedBroadcastTileId === undefined) {
            state.selectedBroadcastTileId = null;
          }
          setRoomState(state);
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load room');
          setLoading(false);
        }
      }
    };

    void fetchState();
    const interval = setInterval(fetchState, 3_000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [roomId]);

  return (
    <div className='w-full h-screen bg-black text-white'>
      {loading ? (
        <div className='flex items-center justify-center h-full'>
          <LoadingSpinner size='lg' variant='spinner' />
        </div>
      ) : error ? (
        <div className='flex items-center justify-center h-full'>
          <div className='text-center'>
            <h2 className='text-xl font-semibold mb-2'>Error</h2>
            <p className='text-gray-400'>{error}</p>
          </div>
        </div>
      ) : roomState ? (
        <BroadcastModeScreen
          roomState={roomState}
          whepUrl={roomState.whepUrl}
          roomId={roomId as string}
        />
      ) : null}
    </div>
  );
}
