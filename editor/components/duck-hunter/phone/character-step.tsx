'use client';

import React, { useState } from 'react';
import {
  CHARACTERS,
  characterVideoUrl,
  type ArcadeCharacter,
} from '../characters';
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
  expanded,
  onTap,
}: {
  character: ArcadeCharacter;
  selected: boolean;
  /** Another hunter already holds this one — the card is dead. */
  taken: boolean;
  /** Accordion open: the select-screen clip plays and the next tap confirms. */
  expanded: boolean;
  onTap: () => void;
}) {
  const color = ACCENT_LINE[character.accent];
  const rgb = ACCENT_RGB[character.accent];
  // Clip failed to load (dev server without the seeded mp4s, flaky network) —
  // fall back to a static accent panel; the confirming tap still works.
  const [videoFailed, setVideoFailed] = useState(false);
  const lit = expanded || selected;
  return (
    <button
      type='button'
      className='r5-btn'
      disabled={taken}
      onClick={onTap}
      style={{
        display: 'block',
        width: '100%',
        opacity: taken ? 0.4 : 1,
        cursor: taken ? 'not-allowed' : undefined,
      }}>
      <PixelPanel
        accent={character.accent}
        cut={12}
        glow={lit ? 0.55 : taken ? 0 : 0.25}
        fill={`rgba(${rgb},${lit ? 0.18 : 0.08})`}
        innerStyle={{ padding: 0 }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 16px',
          }}>
          {/* Collapsed identity mark; the 4 MB clip only loads on expand. */}
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
              style={{
                fontFamily: monoFont,
                fontSize: 10,
                color: R5.inkMuted,
              }}>
              {character.title}
            </span>
          </span>
        </span>
        {/* Accordion body. 0fr→1fr grid rows animate the reveal without a
            magic max-height; the inner wrapper needs overflow:hidden +
            minHeight:0 for the collapsed row to actually reach zero. */}
        <span
          style={{
            display: 'grid',
            gridTemplateRows: expanded ? '1fr' : '0fr',
            transition: 'grid-template-rows 280ms ease',
          }}>
          <span style={{ display: 'block', overflow: 'hidden', minHeight: 0 }}>
            {expanded ? (
              videoFailed ? (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    aspectRatio: '16 / 9',
                    background: `rgba(${rgb},0.12)`,
                    fontFamily: monoFont,
                    fontSize: 10,
                    color: R5.inkMuted,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                  }}>
                  preview unavailable
                </span>
              ) : (
                <video
                  src={characterVideoUrl(character)}
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload='metadata'
                  onError={() => setVideoFailed(true)}
                  style={{
                    display: 'block',
                    width: '100%',
                    aspectRatio: '16 / 9',
                    objectFit: 'cover',
                  }}
                />
              )
            ) : null}
            <span
              className='r5-blink'
              style={{
                display: 'block',
                fontFamily: pixelFont,
                fontSize: 9,
                letterSpacing: 1,
                color,
                textAlign: 'center',
                padding: '10px 0 12px',
                textShadow: `0 0 8px rgba(${rgb},0.6)`,
              }}>
              ▶ TAP AGAIN TO SELECT ◀
            </span>
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
  /**
   * Called with the picked character id on the confirming (second) tap; the
   * page advances the step.
   */
  onPick: (id: ArcadeCharacter['id']) => void;
}) {
  // First tap previews, second tap on the same card confirms. Local because
  // the parent only cares about the confirmed pick; initialised from the
  // previous pick so a return visit (back-out from the briefing, or a
  // character_taken bounce that left the pick intact) starts with that card
  // open. The component remounts on every step visit, so lazy initial state
  // is enough.
  const [expandedId, setExpandedId] = useState<string | null>(selectedId);
  const allTaken = CHARACTERS.every(
    (c) => takenIds.includes(c.id) && selectedId !== c.id,
  );
  return (
    <div
      style={{
        // Auto margins center when there's room, collapse to 0 on overflow —
        // unlike justifyContent:center, which clips the top in a scroll parent.
        margin: 'auto 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
      {CHARACTERS.map((c) => {
        const taken = selectedId !== c.id && takenIds.includes(c.id);
        // A roster push can claim the open card mid-preview: render treats it
        // as collapsed, and the parent's guard catches a confirm race.
        const expanded = expandedId === c.id && !taken;
        return (
          <CharacterCard
            key={c.id}
            character={c}
            selected={selectedId === c.id}
            taken={taken}
            expanded={expanded}
            onTap={() => (expanded ? onPick(c.id) : setExpandedId(c.id))}
          />
        );
      })}
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
          : 'tap to preview — tap again to lock in'}
      </p>
    </div>
  );
}
