'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';

type Props = {
  roomId: string;
};

const PUBLIC_BASE_KEY = 'smelter-public-base';

/** Default public base for the QR: env override, else the current origin. */
function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

/**
 * Ghost Shooter — shows a QR that phones scan to open the touch/gyro shooting
 * controller for this room. The QR uses a configurable public base URL (e.g.
 * your ngrok domain) so it works on a phone even when the editor is opened on
 * localhost. Live crosshairs and the scoreboard render on the Smelter output.
 */
export function GhostShooterPanel({ roomId }: Props) {
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('');

  // Load saved base (or default) once on mount.
  useEffect(() => {
    const saved =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(PUBLIC_BASE_KEY)
        : null;
    setBase(saved || defaultPublicBase());
  }, []);

  const shootUrl = useMemo(() => {
    const b = base.trim().replace(/\/+$/, '');
    if (!b) return '';
    return `${b}/mobile/${encodeURIComponent(roomId)}/shoot`;
  }, [base, roomId]);

  const onBaseChange = (value: string) => {
    setBase(value);
    try {
      window.localStorage.setItem(PUBLIC_BASE_KEY, value);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className='h-full overflow-y-auto p-4 flex flex-col items-center gap-3 text-neutral-200'>
      <div className='text-[11px] uppercase tracking-wide text-neutral-500 self-start'>
        Ghost Shooter
      </div>
      <p className='text-xs text-neutral-400 text-center max-w-xs'>
        Włącz <span className='text-neutral-200'>Pac-Man ghosts</span> na inpucie
        z ludźmi (albo <span className='text-neutral-200'>Bird Counter</span> na
        inpucie z ptakami), zeskanuj telefonem i celuj palcem po obrazie do
        celów. Ptaki po zgubieniu odlatują samodzielnie i też można je
        ustrzelić. Dla celności ustaw ten input na{' '}
        <span className='text-neutral-200'>pełny ekran (broadcast/solo)</span>.
      </p>

      <label className='w-full max-w-xs text-[11px] text-neutral-500'>
        Publiczny adres (np. tunel HTTPS dla żyroskopu):
        <input
          value={base}
          onChange={(e) => onBaseChange(e.target.value)}
          placeholder='https://xxx.ngrok-free.dev'
          className='mt-1 w-full rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs text-neutral-100'
        />
      </label>

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

      <p className='text-[11px] text-neutral-500 text-center max-w-xs break-all'>
        {shootUrl}
      </p>

      <p className='text-[11px] text-neutral-500 text-center max-w-xs'>
        Żyroskop wymaga HTTPS (tunel). Bez czujnika działa celowanie palcem.
        Wielu graczy = własny celownik i tablica wyników na obrazie.
      </p>
    </div>
  );
}
