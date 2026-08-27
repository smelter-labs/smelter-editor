'use client';

import React, { useEffect, useRef, useState } from 'react';
import type {
  KbtCommentatorOverlay,
  KbtHypeBannerId,
  KbtSkeletonMode,
  KbtStateEvent,
} from '@smelter-editor/types';
import { KBT_HYPE_BANNERS } from '@smelter-editor/types';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
} from '../kbt-kit';
import { KbtAvatar } from '../avatar';
import { repShotsForPlayer } from '../rep-shot-source';

const SKELETON_MODES: KbtSkeletonMode[] = ['off', 'lines', 'neon'];
const PENDING_TIMEOUT_MS = 1500;
const SENT_FLASH_MS = 800;

/** Stable key for pending-echo matching (identity, not the payload details). */
function overlayKey(o: KbtCommentatorOverlay | undefined | null): string {
  if (!o || o.kind === 'none') return 'none';
  if (o.kind === 'rep_shot') return `rep_shot:${o.playerId}`;
  if (o.kind === 'spotlight') return `spotlight:${o.playerId}`;
  return `h2h:${o.playerIdA}:${o.playerIdB}`;
}

/**
 * ON-AIR EXTRAS — the commentator's output-overlay drawer: player spotlight,
 * head-to-head, one-shot hype banners and the live skeleton switch. Active
 * chips mirror the server's `kbt_state` echo (same optimistic-pending
 * pattern as the view switcher); a rep cam put on air from the lightbox gets
 * a compact stepper row here so it can be driven without reopening it.
 */
export function OverlayControl({
  state,
  sendOverlay,
  sendBanner,
  sendSkeleton,
  sendRepFloat,
  sendCasterPip,
}: {
  state: KbtStateEvent | null;
  sendOverlay: (overlay: KbtCommentatorOverlay) => void;
  sendBanner: (bannerId: KbtHypeBannerId) => void;
  sendSkeleton: (mode: KbtSkeletonMode) => void;
  sendRepFloat: (enabled: boolean) => void;
  sendCasterPip: (enabled: boolean) => void;
}) {
  const players = state?.players ?? [];
  const serverOverlay = state?.commentatorOverlay ?? { kind: 'none' };
  const serverSkeleton = state?.skeletonMode ?? 'neon';
  const serverRepFloat = state?.config?.repFloatText !== false;
  const serverCasterPip = state?.casterPip !== false;

  // Optimistic-pending on the overlay identity: a press locks the section
  // until the kbt_state echo lands (or a short timeout — e.g. refused).
  const [pendingOverlay, setPendingOverlay] = useState<string | null>(null);
  const [pendingSkeleton, setPendingSkeleton] =
    useState<KbtSkeletonMode | null>(null);
  const [pendingRepFloat, setPendingRepFloat] = useState<boolean | null>(null);
  const [pendingCasterPip, setPendingCasterPip] = useState<boolean | null>(
    null,
  );
  const timersRef = useRef<number[]>([]);
  const [h2hA, setH2hA] = useState<string | null>(null);
  const [h2hB, setH2hB] = useState<string | null>(null);
  const [sentBanner, setSentBanner] = useState<KbtHypeBannerId | null>(null);

  const activeKey = overlayKey(serverOverlay);
  useEffect(() => {
    if (pendingOverlay != null && activeKey === pendingOverlay) {
      setPendingOverlay(null);
    }
  }, [pendingOverlay, activeKey]);
  useEffect(() => {
    if (pendingSkeleton != null && serverSkeleton === pendingSkeleton) {
      setPendingSkeleton(null);
    }
  }, [pendingSkeleton, serverSkeleton]);
  useEffect(() => {
    if (pendingRepFloat != null && serverRepFloat === pendingRepFloat) {
      setPendingRepFloat(null);
    }
  }, [pendingRepFloat, serverRepFloat]);
  useEffect(() => {
    if (pendingCasterPip != null && serverCasterPip === pendingCasterPip) {
      setPendingCasterPip(null);
    }
  }, [pendingCasterPip, serverCasterPip]);
  useEffect(
    () => () => {
      timersRef.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };

  const pressOverlay = (overlay: KbtCommentatorOverlay) => {
    if (pendingOverlay != null) return;
    sendOverlay(overlay);
    const key = overlayKey(overlay);
    setPendingOverlay(key);
    later(
      () => setPendingOverlay((p) => (p === key ? null : p)),
      PENDING_TIMEOUT_MS,
    );
  };

  const pressSkeleton = (mode: KbtSkeletonMode) => {
    if (pendingSkeleton != null || mode === serverSkeleton) return;
    sendSkeleton(mode);
    setPendingSkeleton(mode);
    later(
      () => setPendingSkeleton((p) => (p === mode ? null : p)),
      PENDING_TIMEOUT_MS,
    );
  };

  const pressCasterPip = (enabled: boolean) => {
    if (pendingCasterPip != null || enabled === serverCasterPip) return;
    sendCasterPip(enabled);
    setPendingCasterPip(enabled);
    later(
      () => setPendingCasterPip((p) => (p === enabled ? null : p)),
      PENDING_TIMEOUT_MS,
    );
  };

  const pressRepFloat = (enabled: boolean) => {
    if (pendingRepFloat != null || enabled === serverRepFloat) return;
    sendRepFloat(enabled);
    setPendingRepFloat(enabled);
    later(
      () => setPendingRepFloat((p) => (p === enabled ? null : p)),
      PENDING_TIMEOUT_MS,
    );
  };

  const pressBanner = (id: KbtHypeBannerId) => {
    sendBanner(id);
    setSentBanner(id);
    later(() => setSentBanner((p) => (p === id ? null : p)), SENT_FLASH_MS);
  };

  // Follow the server: another session may have set the h2h pair.
  const serverH2hA =
    serverOverlay.kind === 'h2h' ? serverOverlay.playerIdA : null;
  const serverH2hB =
    serverOverlay.kind === 'h2h' ? serverOverlay.playerIdB : null;
  useEffect(() => {
    if (serverH2hA) setH2hA(serverH2hA);
    if (serverH2hB) setH2hB(serverH2hB);
  }, [serverH2hA, serverH2hB]);

  const spotlightId =
    serverOverlay.kind === 'spotlight' ? serverOverlay.playerId : null;
  const h2hLive = serverOverlay.kind === 'h2h';
  const repShotLive = serverOverlay.kind === 'rep_shot' ? serverOverlay : null;
  const repShots = repShotLive
    ? repShotsForPlayer(state, repShotLive.playerId)
    : [];
  const repShotPlayer = repShotLive
    ? players.find((p) => p.clientId === repShotLive.playerId)
    : null;

  const playerChips = (
    activeId: string | null,
    onPick: (clientId: string) => void,
  ) =>
    players.length === 0 ? (
      <Label size={10} tracking={1} color={KBT.dim}>
        — no lifters yet —
      </Label>
    ) : (
      players.map((p) => (
        <ChipButton
          key={p.clientId}
          dense
          active={p.clientId === activeId}
          label={p.name}
          leading={
            <KbtAvatar
              name={p.name}
              color={p.color}
              photoUrl={p.photoUrl}
              size={18}
            />
          }
          onClick={() => onPick(p.clientId)}
        />
      ))
    );

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
          serverOverlay.kind !== 'none' ? (
            <KbtButton
              dense
              variant='danger'
              label='HIDE OVERLAY'
              onClick={() => pressOverlay({ kind: 'none' })}
            />
          ) : undefined
        }>
        ON-AIR EXTRAS
      </PlateTitle>

      {repShotLive && repShotPlayer ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
          <Label size={10} tracking={2} color={KBT.bad}>
            ● REP CAM ON AIR
          </Label>
          <Label size={10} tracking={1.5} color={KBT.cream}>
            {repShotPlayer.name} · {repShotLive.index + 1}/{repShots.length}
          </Label>
          <ChipButton
            dense
            label='‹'
            disabled={repShotLive.index <= 0}
            onClick={() =>
              sendOverlay({ ...repShotLive, index: repShotLive.index - 1 })
            }
          />
          <ChipButton
            dense
            label='›'
            disabled={repShotLive.index >= repShots.length - 1}
            onClick={() =>
              sendOverlay({ ...repShotLive, index: repShotLive.index + 1 })
            }
          />
          <ChipButton
            dense
            active={repShotLive.showVerdict}
            label={`AI VERDICT ${repShotLive.showVerdict ? 'ON' : 'OFF'}`}
            onClick={() =>
              sendOverlay({
                ...repShotLive,
                showVerdict: !repShotLive.showVerdict,
              })
            }
          />
        </div>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          SPOTLIGHT
        </Label>
        {playerChips(spotlightId, (clientId) =>
          pressOverlay(
            spotlightId === clientId
              ? { kind: 'none' }
              : { kind: 'spotlight', playerId: clientId },
          ),
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
          <Label size={10} tracking={2}>
            H2H · A
          </Label>
          {playerChips(h2hA, (id) => setH2hA(id))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}>
          <Label size={10} tracking={2}>
            H2H · B
          </Label>
          {playerChips(h2hB, (id) => setH2hB(id))}
          <div style={{ flex: 1 }} />
          <KbtButton
            dense
            variant={h2hLive ? 'danger' : 'outline'}
            label={h2hLive ? 'HIDE H2H' : 'SHOW H2H'}
            disabled={!h2hLive && (!h2hA || !h2hB || h2hA === h2hB)}
            onClick={() =>
              pressOverlay(
                h2hLive
                  ? { kind: 'none' }
                  : { kind: 'h2h', playerIdA: h2hA!, playerIdB: h2hB! },
              )
            }
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          HYPE
        </Label>
        {(
          Object.entries(KBT_HYPE_BANNERS) as [
            KbtHypeBannerId,
            { text: string; color: string },
          ][]
        ).map(([id, banner]) => (
          <ChipButton
            key={id}
            dense
            active={sentBanner === id}
            label={sentBanner === id ? 'SENT!' : banner.text}
            onClick={() => pressBanner(id)}
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          SKELETON
        </Label>
        {SKELETON_MODES.map((mode) => {
          const isActive =
            pendingSkeleton == null
              ? serverSkeleton === mode
              : pendingSkeleton === mode;
          return (
            <ChipButton
              key={mode}
              dense
              active={isActive}
              label={mode.toUpperCase()}
              onClick={() => pressSkeleton(mode)}
            />
          );
        })}
        <Label size={9} tracking={1} color={KBT.dim}>
          applies live to all heat cameras
        </Label>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          REP TEXT
        </Label>
        {[true, false].map((enabled) => {
          const isActive =
            pendingRepFloat == null
              ? serverRepFloat === enabled
              : pendingRepFloat === enabled;
          return (
            <ChipButton
              key={enabled ? 'on' : 'off'}
              dense
              active={isActive}
              label={enabled ? 'ON' : 'OFF'}
              onClick={() => pressRepFloat(enabled)}
            />
          );
        })}
        <Label size={9} tracking={1} color={KBT.dim}>
          floating &quot;SNATCH +3&quot; on every scored rep
        </Label>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
        <Label size={10} tracking={2}>
          MY CAM PIP
        </Label>
        {[true, false].map((enabled) => {
          const isActive =
            pendingCasterPip == null
              ? serverCasterPip === enabled
              : pendingCasterPip === enabled;
          return (
            <ChipButton
              key={enabled ? 'on' : 'off'}
              dense
              active={isActive}
              label={enabled ? 'ON' : 'OFF'}
              onClick={() => pressCasterPip(enabled)}
            />
          );
        })}
        <Label size={9} tracking={1} color={KBT.dim}>
          your camera stays picture-in-picture during heats
        </Label>
      </div>
    </Plate>
  );
}
