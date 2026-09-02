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
  taken,
  onPick,
}: {
  character: ArcadeCharacter;
  selected: boolean;
  /** Another hunter already holds this one — the card is dead. */
  taken: boolean;
  onPick: () => void;
}) {
  const color = ACCENT_LINE[character.accent];
  const rgb = ACCENT_RGB[character.accent];
  return (
    <button
      type='button'
      className='r5-btn'
      disabled={taken}
      onClick={onPick}
      style={{
        display: 'block',
        width: '100%',
        opacity: taken ? 0.4 : 1,
        cursor: taken ? 'not-allowed' : undefined,
      }}>
      <PixelPanel
        accent={character.accent}
        cut={12}
        glow={selected ? 0.55 : taken ? 0 : 0.25}
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
            {selected || taken ? (
              <span
                style={{
                  fontFamily: pixelFont,
                  fontSize: 7,
                  letterSpacing: 1,
                  color: R5.bgDeep,
                  background: selected ? color : R5.inkMuted,
                  padding: '3px 6px',
                }}>
                {selected ? 'PICKED' : 'TAKEN'}
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
 * Step 3 — hunter select. Each character belongs to exactly one player per
 * game, so a card another phone already claimed is dead here. `takenIds` comes
 * from the live roster broadcast, which the phone receives before it joins —
 * but it is only the courtesy layer: two phones can tap the last free hunter in
 * the same instant, and the server settles that with 'character_taken'.
 */
export function CharacterStep({
  selectedId,
  takenIds,
  onPick,
}: {
  selectedId: string | null;
  /** Characters held by OTHER players (never this phone's own pick). */
  takenIds: readonly string[];
  /** Called with the picked character id; the page advances the step. */
  onPick: (id: ArcadeCharacter['id']) => void;
}) {
  const allTaken = CHARACTERS.every(
    (c) => takenIds.includes(c.id) && selectedId !== c.id,
  );
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
          taken={selectedId !== c.id && takenIds.includes(c.id)}
          onPick={() => onPick(c.id)}
        />
      ))}
      <p
        style={{
          fontFamily: monoFont,
          fontSize: 10,
          color: allTaken ? R5.red : R5.inkMuted,
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        {allTaken
          ? 'every hunter is taken — wait for a slot to open'
          : 'one hunter each — first to pick keeps it'}
      </p>
    </div>
  );
}
