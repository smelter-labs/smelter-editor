'use client';

import React, { useCallback } from 'react';
import type { ObOperatorCommand } from '@smelter-editor/types';
import {
  effectiveHold,
  formatSeconds,
  secondsUntil,
} from '@/lib/ob-van/pacing';
import { shotLabel, SOURCE_LABEL } from '@/lib/ob-van/view-labels';
import { presetLabel } from '@/lib/ob-van/presets-meta';
import type { ObUiConfig } from '@/lib/ob-van/ui-config';
import {
  Chip,
  Meta,
  Mono,
  OB,
  ObPlate,
  StatusPill,
  HostFrame,
} from '../ob-kit';
import type { ObJoinLinks } from '../arcade';
import type { ObFeed } from '../use-ob-feed';
import type { ObRoom } from '../use-ob-room';
import { useObPending } from '../use-ob-pending';
import { ProgramMonitor } from '../program-monitor';
import { usePanelKeys } from '../panel/use-panel-keys';
import { PANEL_KEY_HINTS } from '../panel/panel-keys';
import {
  autopilotStatus,
  isReplayEnabled,
  panelKeyContextOf,
} from '../panel/panel-model';
import { useServerNow } from '../panel/use-server-now';
import { CamStrip } from '../on-air/cam-strip';
import { RundownPlate } from '../on-air/rundown-plate';
import { WhyLog } from '../on-air/why-log';
import { LlmPlate } from '../on-air/llm-plate';
import { HostStatus } from '../on-air/host-status';
import { QuickActions } from '../on-air/quick-actions';

/**
 * ON AIR: the program monitor and the camera strip (tally + live meters)
 * on the left; the auto pilot, rundown, WHY log, LLM and the desk keys on
 * the right. The keyboard is the operator panel's (1..8, Enter, Space, A…);
 * commands go over REST as the host.
 */
export function OnAirScreen({
  room,
  feed,
  config,
  onConfig,
  joinLinks,
  onWrap,
}: {
  room: ObRoom;
  feed: ObFeed;
  config: ObUiConfig;
  onConfig: React.Dispatch<React.SetStateAction<ObUiConfig>>;
  joinLinks: ObJoinLinks;
  onWrap: () => void;
}) {
  const state = feed.state;
  const operate = useCallback(
    (cmd: ObOperatorCommand) => void room.operate(cmd),
    [room],
  );
  const pending = useObPending(state, operate);
  usePanelKeys(state ? panelKeyContextOf(state) : null, pending.send, true);
  const now = useServerNow(feed.clockOffsetMs);

  if (!state)
    return (
      <HostFrame title='ON AIR'>
        <Meta>waiting for the show state…</Meta>
      </HostFrame>
    );

  const auto = autopilotStatus(state.autoPilot, now);
  const next = state.autoPilot.next;
  const nextIn = next ? secondsUntil(next.atMs, now) : null;
  const hold = effectiveHold(state);
  const sinceS = Math.max(0, Math.round((now - state.program.sinceMs) / 1000));
  const llmNotes = feed.log.filter((e) => e.source === 'llm');

  return (
    <HostFrame
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusPill tone='onair' size={10}>
            ON AIR
          </StatusPill>
          <Mono size={12} weight={600} tracking={0.12}>
            {state.config.eventName}
          </Mono>
        </div>
      }
      meta={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Meta size={9}>{presetLabel(state.config.presetId)}</Meta>
          <Chip
            dense
            label={`PACING ${config.pacingDial.toUpperCase()}`}
            title='Cycle calm → lively → frantic'
            onClick={() =>
              onConfig((c) => ({
                ...c,
                pacingDial:
                  c.pacingDial === 'calm'
                    ? 'lively'
                    : c.pacingDial === 'lively'
                      ? 'frantic'
                      : 'calm',
              }))
            }
          />
          {joinLinks.panel ? (
            <Chip
              dense
              label='PANEL ↗'
              onClick={() => window.open(joinLinks.panel, '_blank')}
            />
          ) : null}
        </div>
      }
      hints={PANEL_KEY_HINTS}
      hintsRight={
        <Mono size={9.5} tracking={0.14} color={OB.dim2}>
          ROOM {room.roomId ?? '—'}
        </Mono>
      }
      contentStyle={{ padding: '10px 16px' }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '700px 1fr',
          gap: 12,
        }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minHeight: 0,
          }}>
          <ProgramMonitor
            whepUrl={room.whepUrl}
            caption={`${shotLabel(state.program.shot, state.cams)} · ${SOURCE_LABEL[state.program.source]} · ${sinceS} s`}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              height: 20,
              minWidth: 0,
            }}>
            <Meta size={9}>PREVIEW</Meta>
            <Mono size={10} weight={600} color={OB.preview}>
              {state.preview
                ? shotLabel(state.preview, state.cams)
                : 'NONE — 1..8'}
            </Mono>
            <div style={{ flex: 1 }} />
            <Mono
              size={9.5}
              tracking={0.06}
              color={auto.kind === 'on' ? OB.accent : OB.dim}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {auto.kind === 'off'
                ? 'AUTO OFF · you are cutting'
                : auto.kind === 'paused'
                  ? `AUTO PAUSED · resumes in ${auto.resumesInS} s`
                  : next && nextIn != null
                    ? `next auto cut in ${nextIn} s → ${shotLabel(next.shot, state.cams)} · ${next.reason}`
                    : `AUTO · hold ${formatSeconds(hold.minHoldMs)}–${formatSeconds(hold.maxHoldMs)}`}
            </Mono>
          </div>
          <CamStrip
            cams={state.cams}
            signals={feed.signals}
            pending={pending}
          />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 0,
          }}>
          <ObPlate title='RUNDOWN' padding={10}>
            <RundownPlate rundown={state.rundown} pending={pending} />
          </ObPlate>
          <ObPlate
            title='WHY'
            right={<Meta size={9}>{feed.log.length} ENTRIES</Meta>}
            padding='4px 10px'
            gap={0}
            scroll
            style={{ flex: 1 }}>
            <WhyLog entries={feed.log} max={8} />
          </ObPlate>
          <ObPlate title='LLM' bar={OB.accent} padding={10}>
            <HostStatus host={state.host} cams={state.cams} />
            <LlmPlate
              roomId={room.roomId}
              llm={state.llm}
              notes={llmNotes}
              onError={room.showError}
            />
          </ObPlate>
          <QuickActions
            state={state}
            pending={pending}
            replayEnabled={isReplayEnabled(state)}
            onWrap={onWrap}
          />
        </div>
      </div>
    </HostFrame>
  );
}
