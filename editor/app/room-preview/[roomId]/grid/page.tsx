'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { getRoomInfo, type RoomState } from '@/app/actions/actions';
import LoadingSpinner from '@/components/ui/spinner';
import OutputStreamGrid from '@/components/output-stream-grid';

export default function RoomPreviewGridPage() {
  const { roomId } = useParams();
  const search = useSearchParams();
  const cols = Math.max(1, Number(search.get('cols') || 6));
  const rows = Math.max(1, Number(search.get('rows') || 4));

  const [loading, setLoading] = useState(true);
  const [roomState, setRoomState] = useState<RoomState>({
    inputs: [],
    layout: 'grid',
    whepUrl: '',
  });

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) return;
      const state = await getRoomInfo(roomId as string);
      if (state !== 'not-found' && mounted) {
        setRoomState(state);
        setLoading(false);
      }
    };
    void fetchState();
    const interval = setInterval(fetchState, 5_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [roomId]);

  return (
    <div className='min-h-screen w-full bg-[#0a0a0a] text-white p-4 flex items-center'>
      <div className='w-full h-full'>
        {loading ? (
          <div className='flex items-center justify-center h-[60vh]'>
            <LoadingSpinner size='lg' variant='spinner' />
          </div>
        ) : (
          <OutputStreamGrid
            whepUrl={roomState.whepUrl}
            cols={cols}
            rows={rows}
          />
        )}
      </div>
    </div>
  );
}
