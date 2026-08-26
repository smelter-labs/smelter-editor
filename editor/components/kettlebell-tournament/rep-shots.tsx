'use client';

import React, { useState } from 'react';
import { KBT } from './kbt-kit';
import { kbtPhotoSrc } from './avatar';

/** Minimal shape a rep-shot thumbnail needs (KbtRepShot or a mapped kbt_rep). */
export type RepShotLike = {
  /** Server-relative still URL (`/kbt-rep-frames/…`). */
  url: string;
  repIndex: number;
  exercise: string;
  verdict: 'correct' | 'incorrect';
  /** Optional lifter name for the tooltip (panel feed). */
  name?: string;
  /** Judge's fault codes (panel feed / newer servers). */
  issues?: string[];
  points?: number;
  /** Owning player — lets the panel resolve the full shot list on click. */
  clientId?: string;
};

/**
 * Horizontal filmstrip of rep-apex stills. Incorrect reps get the kit's red
 * frame and are dimmed. Scrolls sideways inside its own box, newest last.
 * With `onSelect` the thumbnails become click targets (panel lightbox).
 */
export function RepShotStrip({
  shots,
  height = 40,
  max = 10,
  style,
  onSelect,
}: {
  shots: RepShotLike[];
  height?: number;
  max?: number;
  style?: React.CSSProperties;
  onSelect?: (shot: RepShotLike) => void;
}) {
  const shown = shots.slice(-max);
  if (shown.length === 0) return null;
  return (
    <div
      className='kbt-scroll'
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        maxWidth: '100%',
        ...style,
      }}>
      {shown.map((s) => (
        <RepShotImg
          key={`${s.repIndex}-${s.url}`}
          shot={s}
          height={height}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * One rep-shot thumbnail. A still that fails to load (stale URL after a
 * server restart) disappears entirely instead of leaving an empty frame.
 */
function RepShotImg({
  shot: s,
  height,
  onSelect,
}: {
  shot: RepShotLike;
  height: number;
  onSelect?: (shot: RepShotLike) => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const src = kbtPhotoSrc(s.url);
  if (!src || failedSrc === src) return null;
  const bad = s.verdict === 'incorrect';
  const img = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`rep ${s.repIndex} — ${s.exercise}`}
      title={`${s.name ? `${s.name} · ` : ''}#${s.repIndex} ${s.exercise.toUpperCase()}${bad ? ' ✕' : ''}`}
      onError={() => setFailedSrc(src)}
      style={{
        height,
        flexShrink: 0,
        display: 'block',
        border: `1px solid ${
          onSelect && hover ? KBT.accent : bad ? KBT.bad : KBT.border
        }`,
        opacity: bad ? 0.7 : 1,
      }}
    />
  );
  if (!onSelect) return img;
  return (
    <button
      type='button'
      onClick={() => onSelect(s)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        flexShrink: 0,
      }}>
      {img}
    </button>
  );
}
