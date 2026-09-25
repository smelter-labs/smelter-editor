'use client';

import React, { useEffect, useState } from 'react';
import type { ObPhase } from '@smelter-editor/types';
import { PHASE_LABEL } from '@/lib/ob-van/view-labels';
import {
  Chip,
  Display,
  FooterHints,
  Meta,
  Mono,
  OB,
  ProgressBar,
  StatusPill,
  TagChip,
  WarnPlate,
  Wordmark,
  type PillTone,
} from '../ob-kit';
import { useObPending } from '../use-ob-pending';
import { AutopilotPlate } from './autopilot-plate';
import { BusRow } from './bus-row';
import { FxBar } from './fx-bar';
import { LowerThirdBar } from './lower-third-bar';
import { MonitorRow } from './monitor-row';
import { PANEL_KEY_HINTS } from './panel-keys';
import { panelKeyContextOf } from './panel-model';
import { RundownStrip } from './rundown-strip';
import { ShotBar } from './shot-bar';
import { Transport } from './transport';
import { usePanelKeys } from './use-panel-keys';
import type { ObPanelSocket } from './use-ob-panel-socket';
import { WhyTicker } from './why-ticker';

const ERROR_TOAST_MS = 4000;

const PHASE_TONE: Record<ObPhase, PillTone> = {
  setup: 'idle',
  'on-air': 'onair',
  wrap: 'amber',
};

const PHASE_INFO: Partial<Record<ObPhase, string>> = {
  setup: 'SETUP — cameras joining; the host goes live',
  wrap: 'WRAP — the show is over',
};

/**
 * The operator desk — a broadcast vision mixer. Top → bottom: header,
 * PROGRAM + PREVIEW monitors, the preview bus, TAKE / CUT / AUTO + the
 * transition, shot / FX / lower-third / rundown bars, the auto pilot and
 * the WHY ticker. Every press is pending-until-echo; the keyboard map works
 * everywhere except inside a text field.
 */
export function PanelScreen({
  socket,
  name,
  whepUrl,
  desk,
  onLeave,
}: {
  socket: ObPanelSocket;
  name: string;
  whepUrl: string | null;
  /** ≥ 900 px: monitors side by side, bars in rows; else one column. */
  desk: boolean;
  onLeave: () => void;
}) {
  const state = socket.state;
  const pending = useObPending(state, socket.send);
  usePanelKeys(state ? panelKeyContextOf(state) : null, pending.send, true);

  // A refused command: drop every pending mark and show the reason for 4 s.
  const errorAt = socket.lastError?.at ?? null;
  const [toastAt, setToastAt] = useState<number | null>(null);
  const clearPending = pending.clear;
  useEffect(() => {
    if (errorAt == null) return;
    clearPending();
    setToastAt(errorAt);
    const timer = window.setTimeout(
      () => setToastAt((cur) => (cur === errorAt ? null : cur)),
      ERROR_TOAST_MS,
    );
    return () => window.clearTimeout(timer);
  }, [errorAt, clearPending]);
  const toast =
    toastAt != null && socket.lastError?.at === toastAt
      ? socket.lastError
      : null;

  if (!state) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          paddingTop: 40,
        }}>
        <ProgressBar width={260} height={4} indeterminate />
        <Mono size={12} weight={600} tracking={0.22}>
          WAITING FOR THE DESK…
        </Mono>
      </div>
    );
  }

  const deskHolder = state.operator?.name ?? null;
  const someoneElse = deskHolder != null && deskHolder !== name;
  const info = PHASE_INFO[state.phase];
  const gap = desk ? 8 : 10;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        minWidth: 0,
      }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          minWidth: 0,
        }}>
        <Wordmark size={desk ? 22 : 20} lit={state.phase === 'on-air'} />
        <Display
          size={desk ? 20 : 18}
          weight={700}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: '0 1 auto',
          }}>
          {state.config.eventName}
        </Display>
        <StatusPill tone={PHASE_TONE[state.phase]}>
          {PHASE_LABEL[state.phase]}
        </StatusPill>
        {state.isRecording ? <StatusPill tone='rec'>REC</StatusPill> : null}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
          }}>
          {someoneElse ? (
            <TagChip tone='amber' title='Another operator took the desk'>
              DESK · {deskHolder}
            </TagChip>
          ) : null}
          <Meta size={9.5}>OPERATOR · {name}</Meta>
          <Chip
            dense
            label='LEAVE'
            onClick={onLeave}
            title='Hand the desk over'
          />
        </div>
      </header>

      {info ? <WarnPlate tone='amber'>{info}</WarnPlate> : null}

      <MonitorRow
        state={state}
        signals={socket.signals}
        clockOffsetMs={socket.clockOffsetMs}
        whepUrl={whepUrl}
        desk={desk}
      />

      <BusRow
        state={state}
        signals={socket.signals}
        pending={pending}
        desk={desk}
      />

      <Transport state={state} pending={pending} desk={desk} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: desk ? '8px 10px' : '10px',
          background: OB.plate,
          border: `1px solid ${OB.rule}`,
          borderRadius: 3,
          minWidth: 0,
        }}>
        <ShotBar state={state} pending={pending} />
        <FxBar state={state} pending={pending} />
        <LowerThirdBar state={state} pending={pending} />
        <RundownStrip state={state} pending={pending} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: desk ? 'minmax(0, 1fr) minmax(0, 1.4fr)' : '1fr',
          gap,
        }}>
        <AutopilotPlate
          state={state}
          pending={pending}
          clockOffsetMs={socket.clockOffsetMs}
        />
        <WhyTicker log={socket.log} />
      </div>

      {desk ? <FooterHints hints={PANEL_KEY_HINTS} /> : null}

      {toast ? (
        <div
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 70,
            maxWidth: 'min(420px, calc(100vw - 32px))',
            background: OB.page,
            borderRadius: 3,
            boxShadow: '0 8px 24px rgba(0,0,0,.5)',
          }}>
          <WarnPlate
            tone='bad'
            title={toast.code.replace(/_/g, ' ').toUpperCase()}>
            {toast.message}
          </WarnPlate>
        </div>
      ) : null}
    </div>
  );
}
