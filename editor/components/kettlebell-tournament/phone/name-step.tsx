'use client';

import React from 'react';
import {
  KBT,
  KbtButton,
  KbtTextInput,
  Label,
  Plate,
  kbtMonoFont,
} from '../kbt-kit';

// Lifter and commentator run the same step with role-fitted copy — the
// commentator has no roster, no scores and no tile, just the booth.
const NAME_COPY = {
  lifter: {
    label: 'LIFTER NAME',
    placeholder: 'E.G. IRON ANIA',
    hint: 'Your name rides your camera tile on the big screen. Reconnecting with the same name restores your scores.',
    button: 'REGISTER',
    sub: 'join the tournament roster',
  },
  commentator: {
    label: 'COMMENTATOR NAME',
    placeholder: 'E.G. VOICE OF STEEL',
    hint: 'Your name badges the commentary lower-third on the broadcast. Reconnecting with the same name takes the booth back.',
    button: 'TAKE THE MIC',
    sub: 'claim the commentary booth',
  },
} as const;

/** Step 2 — pick a name (lifter: tile, scoreboard, podium; commentator: booth). */
export function NameStep({
  name,
  onName,
  onContinue,
  variant = 'lifter',
  weights,
}: {
  name: string;
  onName: (v: string) => void;
  onContinue: () => void;
  variant?: 'lifter' | 'commentator';
  /** Weighted-scoring fields (lifter only; null/absent hides the plate).
   * Values stay raw strings so partial typing ("7", "72.") survives; blank
   * means the 24/80 tournament defaults. */
  weights?: {
    kettlebellKg: string;
    bodyKg: string;
    onKettlebellKg: (v: string) => void;
    onBodyKg: (v: string) => void;
  } | null;
}) {
  const copy = NAME_COPY[variant];
  const trimmed = name.trim();
  const showWeights = variant === 'lifter' && weights != null;
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 16,
      }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '18px 16px',
        }}>
        <Label size={10}>{copy.label}</Label>
        <KbtTextInput
          value={name}
          onChange={onName}
          placeholder={copy.placeholder}
          maxLength={20}
          autoCapitalize='characters'
        />
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            color: KBT.dim,
          }}>
          {copy.hint}
        </span>
      </Plate>
      {showWeights ? (
        <Plate
          cutPx={14}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: '18px 16px',
          }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
              <Label size={10}>KETTLEBELL KG</Label>
              <KbtTextInput
                value={weights.kettlebellKg}
                onChange={weights.onKettlebellKg}
                placeholder='24'
                maxLength={5}
                inputMode='decimal'
              />
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
              <Label size={10}>BODY WEIGHT KG</Label>
              <KbtTextInput
                value={weights.bodyKg}
                onChange={weights.onBodyKg}
                placeholder='80'
                maxLength={5}
                inputMode='decimal'
              />
            </div>
          </div>
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 11,
              letterSpacing: 0.5,
              color: KBT.dim,
            }}>
            Weighted tournament: score = points × bell kg ÷ body weight. Leave
            blank for 24 / 80.
          </span>
        </Plate>
      ) : null}
      <KbtButton
        block
        variant='solid'
        label={copy.button}
        sub={copy.sub}
        disabled={trimmed.length === 0}
        active={trimmed.length > 0}
        onClick={onContinue}
      />
    </div>
  );
}
