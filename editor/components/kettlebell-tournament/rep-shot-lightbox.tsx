'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  KbtCommentatorOverlay,
  KbtRepShot,
  KettlebellIssueCode,
} from '@smelter-editor/types';
import {
  KBT_EXERCISE_COLORS,
  KETTLEBELL_ISSUE_LABELS,
} from '@smelter-editor/types';
import { KBT, KbtButton, Label, Plate, Tab, displayFont } from './kbt-kit';
import { kbtPhotoSrc } from './avatar';

/**
 * Fullscreen rep-shot viewer for the commentator panel: the enlarged apex
 * still with its verdict + technique issues, ←/→ stepping, and the on-air
 * controls — SHOW ON AIR mirrors the very shot being viewed onto the program
 * output (prev/next re-aims it while live), AI VERDICT toggles whether the
 * output overlay explains the judge's call.
 */
export function RepShotLightbox({
  shots,
  playerId,
  playerName,
  playerColor,
  index,
  onIndex,
  onClose,
  onAirOverlay,
  sendOverlay,
}: {
  shots: KbtRepShot[];
  playerId: string;
  playerName: string;
  playerColor: string;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** The server-echoed overlay, to mark this shot as ON AIR. */
  onAirOverlay: KbtCommentatorOverlay | null;
  sendOverlay: (overlay: KbtCommentatorOverlay) => void;
}) {
  const [showVerdict, setShowVerdict] = useState(true);
  const clamped = Math.max(0, Math.min(index, shots.length - 1));
  const shot = shots[clamped] ?? null;
  const onAir =
    onAirOverlay?.kind === 'rep_shot' && onAirOverlay.playerId === playerId;

  const step = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(clamped + delta, shots.length - 1));
      if (next === clamped) return;
      onIndex(next);
      // The output follows the lightbox while this player's rep cam is live.
      if (onAir) {
        sendOverlay({ kind: 'rep_shot', playerId, index: next, showVerdict });
      }
    },
    [clamped, shots.length, onIndex, onAir, sendOverlay, playerId, showVerdict],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);

  if (!shot) return null;
  const src = kbtPhotoSrc(shot.url);
  const bad = shot.verdict === 'incorrect';
  const issues = (shot.issues ?? []).map(
    (c) => KETTLEBELL_ISSUE_LABELS[c as KettlebellIssueCode] ?? c,
  );
  const exColor =
    KBT_EXERCISE_COLORS[shot.exercise as keyof typeof KBT_EXERCISE_COLORS] ??
    KBT.cream;

  const toggleVerdict = () => {
    const next = !showVerdict;
    setShowVerdict(next);
    if (onAir) {
      sendOverlay({
        kind: 'rep_shot',
        playerId,
        index: clamped,
        showVerdict: next,
      });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: KBT.overlay,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <Plate
          cutPx={22}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '16px 18px',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: displayFont,
                fontWeight: 800,
                fontSize: 24,
                letterSpacing: 1,
                textTransform: 'uppercase',
                color: KBT.cream,
              }}>
              {playerName}
            </span>
            {onAir ? (
              <Tab size={10} color={KBT.bad} textColor={KBT.cream}>
                ● ON AIR
              </Tab>
            ) : null}
            <div style={{ flex: 1 }} />
            <Label size={11} tracking={2}>
              {clamped + 1} / {shots.length}
            </Label>
          </div>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={`rep ${shot.repIndex} — ${shot.exercise}`}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '58vh',
                margin: '0 auto',
                border: `2px solid ${bad ? KBT.bad : playerColor}`,
                opacity: bad ? 0.85 : 1,
              }}
            />
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}>
            <Label size={11} tracking={2} color={exColor}>
              {shot.exercise}
            </Label>
            <Label size={11} tracking={2}>
              REP #{shot.repIndex}
            </Label>
            <Label size={11} tracking={2} color={KBT.accent}>
              +{shot.points} PTS
            </Label>
            <div style={{ flex: 1 }} />
            <Label
              size={11}
              tracking={2}
              weight={600}
              color={bad ? KBT.bad : KBT.good}>
              {bad ? '✕ NO COUNT' : '✓ CORRECT'}
            </Label>
          </div>
          {issues.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {issues.map((issue) => (
                <Label key={issue} size={10} tracking={1.5} color={KBT.amber}>
                  · {issue}
                </Label>
              ))}
            </div>
          ) : null}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
            <KbtButton
              dense
              variant='outline'
              label='‹ PREV'
              disabled={clamped === 0}
              onClick={() => step(-1)}
            />
            <KbtButton
              dense
              variant='outline'
              label='NEXT ›'
              disabled={clamped >= shots.length - 1}
              onClick={() => step(1)}
            />
            <div style={{ flex: 1 }} />
            <KbtButton
              dense
              variant='outline'
              label={`AI VERDICT: ${showVerdict ? 'ON' : 'OFF'}`}
              onClick={toggleVerdict}
            />
            {onAir ? (
              <KbtButton
                dense
                variant='danger'
                active
                label='HIDE FROM AIR'
                onClick={() => sendOverlay({ kind: 'none' })}
              />
            ) : (
              <KbtButton
                dense
                variant='solid'
                label='SHOW ON AIR'
                onClick={() =>
                  sendOverlay({
                    kind: 'rep_shot',
                    playerId,
                    index: clamped,
                    showVerdict,
                  })
                }
              />
            )}
          </div>
        </Plate>
      </div>
    </div>
  );
}
