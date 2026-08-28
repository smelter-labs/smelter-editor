'use client';

import React from 'react';
import { CHARACTERS, type ArcadeCharacter } from '../characters';
import {
  ACCENT_LINE,
  ACCENT_RGB,
  PixelPanel,
  R5,
  monoFont,
  pixelFont,
} from '../retro-kit';

function CharacterCard({
  character,
  selected,
  onPick,
}: {
  character: ArcadeCharacter;
  selected: boolean;
  onPick: () => void;
}) {
  const color = ACCENT_LINE[character.accent];
  const rgb = ACCENT_RGB[character.accent];
  return (
    <button
      type='button'
      className='r5-btn'
      onClick={onPick}
      style={{ display: 'block', width: '100%' }}>
      <PixelPanel
        accent={character.accent}
        cut={12}
        glow={selected ? 0.55 : 0.25}
        fill={`rgba(${rgb},${selected ? 0.18 : 0.08})`}
        innerStyle={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '14px 16px',
        }}>
        {/* Color swatch instead of the 4 MB select-screen clip — phones. */}
        <span
          style={{
            width: 26,
            height: 26,
            flexShrink: 0,
            background: character.color,
            boxShadow: `0 0 10px ${character.color}`,
          }}
        />
        <span
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            textAlign: 'left',
            minWidth: 0,
          }}>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 12,
                letterSpacing: 1,
                color,
                textShadow: `0 0 8px rgba(${rgb},0.6)`,
              }}>
              {character.name}
            </span>
            {selected ? (
              <span
                style={{
                  fontFamily: pixelFont,
                  fontSize: 7,
                  letterSpacing: 1,
                  color: R5.bgDeep,
                  background: color,
                  padding: '3px 6px',
                }}>
                PICKED
              </span>
            ) : null}
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
            {character.title}
          </span>
        </span>
      </PixelPanel>
    </button>
  );
}

/**
 * Step 3 — hunter select. Every player picks their own character here
 * (duplicates across phones are fine — the assigned crosshair color still
 * separates hunters). Tapping a card picks it and advances the wizard.
 */
export function CharacterStep({
  selectedId,
  onPick,
}: {
  selectedId: string | null;
  /** Called with the picked character id; the page advances the step. */
  onPick: (id: ArcadeCharacter['id']) => void;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 14,
      }}>
      {CHARACTERS.map((c) => (
        <CharacterCard
          key={c.id}
          character={c}
          selected={selectedId === c.id}
          onPick={() => onPick(c.id)}
        />
      ))}
      <p
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: R5.inkMuted,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        two hunters can share a character — your color stays yours
      </p>
    </div>
  );
}
