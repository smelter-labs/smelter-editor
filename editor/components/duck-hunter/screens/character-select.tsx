'use client';

import { useEffect, useState } from 'react';
import {
  ACCENT_LINE,
  PixelButton,
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
} from '../retro-kit';
import {
  CHARACTERS,
  characterVideoUrl,
  type ArcadeCharacter,
} from '../characters';
import { useArcadeKeys } from '../use-arcade-input';

/**
 * Character select — plays the three pre-rendered select-screen clips as
 * the literal UI. ←/→ flips between characters (all three videos stay
 * mounted so the flip is instant), Enter/(A)/click picks, Esc/(B) backs
 * out. If a clip fails to load (fresh checkout before seeding) a styled
 * fallback card stands in.
 */
export function CharacterSelect({
  selected,
  onPick,
  onBack,
}: {
  selected: ArcadeCharacter;
  onPick: (c: ArcadeCharacter) => void;
  onBack: () => void;
}) {
  const [idx, setIdx] = useState(() =>
    Math.max(
      0,
      CHARACTERS.findIndex((c) => c.id === selected.id),
    ),
  );
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const current = CHARACTERS[idx];

  const prev = () =>
    setIdx((i) => (i - 1 + CHARACTERS.length) % CHARACTERS.length);
  const next = () => setIdx((i) => (i + 1) % CHARACTERS.length);

  useArcadeKeys({
    left: prev,
    right: next,
    confirm: () => onPick(current),
    back: onBack,
  });

  // Restart the newly shown clip from its first frame so every flip gets
  // the full select-screen intro animation.
  useEffect(() => {
    const vid = document.getElementById(
      `dh-char-${current.id}`,
    ) as HTMLVideoElement | null;
    if (vid) {
      vid.currentTime = 0;
      void vid.play().catch(() => {});
    }
  }, [current.id]);

  return (
    <div className='r5-enter' style={{ position: 'absolute', inset: 0 }}>
      {CHARACTERS.map((c, i) => (
        <video
          key={c.id}
          id={`dh-char-${c.id}`}
          src={characterVideoUrl(c)}
          autoPlay
          loop
          muted
          playsInline
          preload='auto'
          onClick={() => onPick(c)}
          onError={() => setFailed((f) => ({ ...f, [c.id]: true }))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: i === idx && !failed[c.id] ? 1 : 0,
            pointerEvents: i === idx ? 'auto' : 'none',
            cursor: 'pointer',
            background: R5.bgDeep,
          }}
        />
      ))}

      {/* Fallback card when the current clip is unavailable. */}
      {failed[current.id] ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: R5.bgDeep,
          }}>
          <PixelPanel
            accent={current.accent}
            cut={14}
            glow={0.5}
            innerStyle={{
              padding: '48px 64px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 26,
                color: ACCENT_LINE[current.accent],
              }}>
              {current.name}
            </span>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 13,
                color: R5.inkMuted,
              }}>
              — {current.title} — (clip not seeded yet)
            </span>
          </PixelPanel>
        </div>
      ) : null}

      {/* Flip controls + selection dots, kept clear of the clip's own UI. */}
      <div
        style={{
          position: 'absolute',
          left: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 5,
        }}>
        <PixelButton accent='cyan' glyph='◀' label='PREV' onClick={prev} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 24,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 5,
        }}>
        <PixelButton accent='cyan' glyph='▶' label='NEXT' onClick={next} />
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 18,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 10,
          zIndex: 5,
        }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {CHARACTERS.map((c, i) => (
            <button
              key={c.id}
              type='button'
              className='r5-btn'
              onClick={() => setIdx(i)}
              aria-label={c.name}
              style={{
                width: 12,
                height: 12,
                background:
                  i === idx ? ACCENT_LINE[c.accent] : 'rgba(120,150,200,0.25)',
                boxShadow:
                  i === idx
                    ? `0 0 8px ${ACCENT_LINE[c.accent]}`
                    : 'inset 0 0 0 1px rgba(120,150,200,0.3)',
              }}
            />
          ))}
        </div>
        <div
          style={{
            fontFamily: monoFont,
            fontSize: 11,
            letterSpacing: 2,
            color: R5.ink,
            textTransform: 'uppercase',
            textShadow: '0 1px 4px #000',
          }}>
          ◀ ▶ switch · enter / tap select · esc back
        </div>
      </div>
    </div>
  );
}
