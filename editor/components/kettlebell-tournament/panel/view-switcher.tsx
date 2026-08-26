'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { KbtStateEvent, KbtViewOverride } from '@smelter-editor/types';
import {
  KBT,
  KbtButton,
  ChipButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
} from '../kbt-kit';
import { KbtAvatar } from '../avatar';

/** The six choices, in reading order. */
type ViewKey = 'auto' | 'caster' | 'split' | 'player_solo' | 'grid' | 'board';

const VIEW_META: {
  key: ViewKey;
  label: string;
  sub: string;
  needsCaster?: boolean;
  needsLifter?: boolean;
}[] = [
  { key: 'auto', label: 'AUTO', sub: 'follows the show' },
  {
    key: 'caster',
    label: 'MY CAMERA',
    sub: 'you, fullscreen',
    needsCaster: true,
  },
  {
    key: 'split',
    label: 'ME + LIFTER',
    sub: 'side by side',
    needsCaster: true,
    needsLifter: true,
  },
  {
    key: 'player_solo',
    label: 'LIFTER FULLSCREEN',
    sub: 'featured lifter',
    needsLifter: true,
  },
  { key: 'grid', label: 'ALL LIFTERS', sub: 'camera grid' },
  { key: 'board', label: 'LEADERBOARD', sub: 'standings' },
];

const PENDING_TIMEOUT_MS = 1500;

function overrideKey(o: KbtViewOverride | undefined | null): ViewKey {
  return o?.mode ?? 'auto';
}

function buildOverride(
  key: ViewKey,
  lifterId: string | null,
): KbtViewOverride | null {
  switch (key) {
    case 'auto':
    case 'caster':
    case 'grid':
    case 'board':
      return { mode: key };
    case 'player_solo':
    case 'split':
      return lifterId ? { mode: key, playerId: lifterId } : null;
  }
}

/**
 * The VIEW plate: six big labeled buttons + the featured-lifter picker.
 * The active button mirrors the server's echoed viewOverride (kbt_state) —
 * a press marks the target pending and further presses are ignored until the
 * echo lands (or a short timeout, e.g. the server refused a stale target).
 */
export function ViewSwitcher({
  state,
  sendView,
}: {
  state: KbtStateEvent | null;
  sendView: (override: KbtViewOverride) => void;
}) {
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [pending, setPending] = useState<ViewKey | null>(null);
  const pendingTimerRef = useRef<number | null>(null);

  const players = state?.players ?? [];
  const serverOverride = state?.viewOverride ?? { mode: 'auto' };
  const activeKey = overrideKey(serverOverride);
  const scene = state?.scene ?? '—';
  const casterReady = state?.commentator?.camConnected ?? false;

  // Follow the server: a forced player view names the featured lifter (it
  // may have been picked in another panel session before a reconnect).
  const serverFeatured =
    serverOverride.mode === 'player_solo' || serverOverride.mode === 'split'
      ? serverOverride.playerId
      : null;
  useEffect(() => {
    if (serverFeatured) setFeaturedId(serverFeatured);
  }, [serverFeatured]);

  // The echo landed → the press is no longer pending.
  useEffect(() => {
    if (pending && activeKey === pending) {
      setPending(null);
      if (pendingTimerRef.current != null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }
  }, [pending, activeKey]);

  useEffect(
    () => () => {
      if (pendingTimerRef.current != null) {
        window.clearTimeout(pendingTimerRef.current);
      }
    },
    [],
  );

  const press = (key: ViewKey) => {
    if (pending) return;
    const override = buildOverride(key, featuredId);
    if (!override) return;
    sendView(override);
    setPending(key);
    if (pendingTimerRef.current != null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      pendingTimerRef.current = null;
      setPending(null);
    }, PENDING_TIMEOUT_MS);
  };

  // A lifter is a valid feature target when their camera is up.
  const featurable = players.filter((p) => p.camConnected);
  const featured = players.find((p) => p.clientId === featuredId) ?? null;

  return (
    <Plate
      cutPx={18}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '14px 18px',
      }}>
      <PlateTitle
        right={
          <Label size={10} tracking={1.5}>
            ON AIR: <span style={{ color: KBT.accent }}>{scene}</span>
          </Label>
        }>
        VIEW
      </PlateTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
        }}>
        {VIEW_META.map((v) => {
          const disabled =
            (v.needsCaster && !casterReady) ||
            (v.needsLifter && (!featured || !featured.camConnected));
          const isActive = activeKey === v.key && !pending;
          const isPending = pending === v.key;
          return (
            <KbtButton
              key={v.key}
              dense
              variant={isActive ? 'solid' : 'outline'}
              active={isPending}
              disabled={disabled}
              locked={pending != null && !isPending}
              label={v.label}
              sub={isPending ? 'switching…' : v.sub}
              onClick={() => press(v.key)}
              style={{ width: '100%' }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          FEATURED LIFTER
        </Label>
        {featurable.length === 0 ? (
          <Label size={10} tracking={1} color={KBT.dim}>
            — no live lifter cameras —
          </Label>
        ) : (
          featurable.map((p) => (
            <ChipButton
              key={p.clientId}
              dense
              active={p.clientId === featuredId}
              label={p.name}
              leading={
                <KbtAvatar
                  name={p.name}
                  color={p.color}
                  photoUrl={p.photoUrl}
                  size={18}
                />
              }
              onClick={() => {
                setFeaturedId(p.clientId);
                // Re-aim an already-forced player view at the new pick.
                if (activeKey === 'player_solo' || activeKey === 'split') {
                  sendView({ mode: activeKey, playerId: p.clientId });
                }
              }}
            />
          ))
        )}
        {featured ? (
          <StatusDot
            state={featured.camConnected ? 'good' : 'bad'}
            pulse={!featured.camConnected}
          />
        ) : null}
      </div>
    </Plate>
  );
}
