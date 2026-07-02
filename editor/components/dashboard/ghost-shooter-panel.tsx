'use client';

import { useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  getEffectiveClientServerUrl,
  SERVER_URL_QUERY_PARAM,
} from '@/lib/server-url';

type Props = {
  roomId: string;
};

/**
 * Ghost Shooter — shows a QR that phones scan to open the gyroscope shooting
 * controller for this room. Live crosshairs and the scoreboard are rendered on
 * the Smelter output itself (on the ghost-enabled input).
 */
export function GhostShooterPanel({ roomId }: Props) {
  const [copied, setCopied] = useState(false);

  const shootUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const api = getEffectiveClientServerUrl();
    const qs = `${SERVER_URL_QUERY_PARAM}=${encodeURIComponent(api)}`;
    return `${window.location.origin}/mobile/${encodeURIComponent(roomId)}/shoot?${qs}`;
  }, [roomId]);

  return (
    <div className='h-full overflow-y-auto p-4 flex flex-col items-center gap-3 text-neutral-200'>
      <div className='text-[11px] uppercase tracking-wide text-neutral-500 self-start'>
        Ghost Shooter
      </div>
      <p className='text-xs text-neutral-400 text-center max-w-xs'>
        Włącz <span className='text-neutral-200'>Pac-Man ghosts</span> na inpucie
        z ludźmi, zeskanuj telefonem i celuj żyroskopem do duszków.
      </p>

      {shootUrl && (
        <div className='rounded-lg bg-white p-3'>
          <QRCode value={shootUrl} size={180} />
        </div>
      )}

      <button
        onClick={() => {
          void navigator.clipboard?.writeText(shootUrl);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
        className='text-xs rounded border border-neutral-700 px-3 py-1 hover:border-cyan/50'>
        {copied ? 'Skopiowano!' : 'Kopiuj link'}
      </button>

      <p className='text-[11px] text-neutral-500 text-center max-w-xs'>
        Żyroskop wymaga HTTPS (na iOS). Bez czujnika działa celowanie palcem.
        Wielu graczy = własny celownik i tablica wyników na obrazie.
      </p>
    </div>
  );
}
