'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import { connectWhep } from '@/lib/webrtc/whep-connect';

export default function RawPreviewPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const [whepUrl, setWhepUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) {
        if (mounted) router.replace('/');
        return;
      }

      const state = await getRoomInfo(roomId as string);
      if (!mounted) return;

      if (state === 'not-found') {
        router.replace('/');
        return;
      }

      setWhepUrl(state.whepUrl);
    };
    void fetchState();
    return () => {
      mounted = false;
    };
  }, [roomId, router]);

  useEffect(() => {
    if (!whepUrl) return;

    let closeConnection = () => {};
    connectWhep(whepUrl).then(({ stream, close }) => {
      closeConnection = close;
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    });

    return () => {
      closeConnection();
    };
  }, [whepUrl]);

  return (
    <div className='fixed inset-0 bg-[#0a0f1a]'>
      <video
        ref={videoRef}
        className='w-full h-full object-contain'
        autoPlay
        playsInline
        muted={false}
      />
    </div>
  );
}
