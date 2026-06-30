'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';

type OutputStreamGridProps = {
  whepUrl: string;
  cols?: number;
  rows?: number;
  gapPx?: number;
};

export default function OutputStreamGrid({
  whepUrl,
  cols = 6,
  rows = 4,
  gapPx = 8,
}: OutputStreamGridProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const count = cols * rows;

  useEffect(() => {
    let mounted = true;
    let closeConnection = () => {};

    void connectWhep(whepUrl)
      .then(({ stream: whepStream, close }) => {
        closeConnection = close;
        if (!mounted) {
          close();
          return;
        }
        setStream(whepStream);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      mounted = false;
      closeConnection();
    };
  }, [whepUrl]);

  useEffect(() => {
    if (!stream) return;
    // Attach the same stream to all tiles
    for (const vid of videoRefs.current) {
      if (!vid) continue;
      if (vid.srcObject !== stream) {
        vid.srcObject = stream;
        // Mute to avoid audio multiplicity
        vid.muted = true;
        // Best-effort autoplay
        void vid.play().catch(() => {});
      }
    }
  }, [stream, count]);

  const items = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => i);
  }, [count]);

  return (
    <div
      className='w-full'
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: gapPx,
      }}>
      {items.map((i) => (
        <div
          key={i}
          className='relative bg-black rounded overflow-hidden aspect-video border-[#414154] border'>
          <video
            ref={(el) => {
              videoRefs.current[i] = el;
            }}
            className='w-full h-full object-cover bg-black'
            playsInline
            autoPlay
            muted
          />
        </div>
      ))}
    </div>
  );
}
