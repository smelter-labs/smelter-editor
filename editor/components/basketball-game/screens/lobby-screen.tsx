'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import type { BbCam } from '@smelter-editor/types';
import { setBbConfig } from '@/app/actions/actions';
import { buildJoinUrl, useJoinLinks } from '@/lib/arcade/use-join-link';
import {
  ChipButton,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
  kbtMonoFont,
  useArmed,
} from '@/components/kettlebell-tournament/kbt-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import { TeamBadge, colorsTooClose } from '../bb-kit';
import {
  FileCamPicker,
  FileCamSyncButton,
  camSourceLabel,
  useMp4Library,
} from '../file-cam-picker';
import type { BbFeed } from '../use-bb-feed';
import type { BbRoom } from '../use-bb-room';
import { formatClock } from '../use-bb-feed';

const ROLE_META = {
  hoop: {
    title: 'HOOP CAM',
    sub: 'tripod, 45° off the backboard, 5–8 m out, above head height — runs the AI',
  },
  court: {
    title: 'COURT CAM',
    sub: 'wide on the whole half-court — the broadcast picture',
  },
  commentator: {
    title: 'MODERATOR / COMMENTARY',
    sub: 'courtside phone: confirm the calls, run the clock, talk on air',
  },
} as const;

function JoinPlate({
  role,
  url,
  cam,
  commentatorName,
  creating,
  picker,
}: {
  role: keyof typeof ROLE_META;
  url: string;
  cam: BbCam | null;
  commentatorName: string | null;
  creating: boolean;
  /** Clip picker (hoop / court only) — a file instead of a phone. */
  picker?: React.ReactNode;
}) {
  const meta = ROLE_META[role];
  // The clip picker takes a row at the bottom — trade some QR size for it
  // so the plate still fits a laptop viewport.
  const qrSize = picker ? 124 : 150;
  const joined =
    role === 'commentator' ? commentatorName != null : !!cam?.joined;
  const live = role === 'commentator' ? false : !!cam?.camConnected;
  const state = !joined
    ? 'idle'
    : role === 'commentator'
      ? 'good'
      : live
        ? 'good'
        : 'warn';
  const status = !joined
    ? 'WAITING'
    : role === 'commentator'
      ? `JOINED · ${commentatorName}`
      : live
        ? `LIVE · ${camSourceLabel(cam)}`
        : `CONNECTING · ${camSourceLabel(cam)}`;
  return (
    <Plate
      cutPx={16}
      style={{ flex: 1, minWidth: 0 }}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        padding: '14px 14px',
        height: '100%',
      }}>
      <PlateTitle>{meta.title}</PlateTitle>
      {url ? (
        <div style={{ background: KBT.cream, padding: 10 }}>
          <QRCode
            value={url}
            size={qrSize}
            fgColor={KBT.dark}
            bgColor={KBT.cream}
          />
        </div>
      ) : (
        <div
          style={{
            width: qrSize + 20,
            height: qrSize + 20,
            background: KBT.fill,
            border: `1px solid ${KBT.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Label size={11}>{creating ? 'BUILDING…' : 'NO COURT'}</Label>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot
          state={state}
          pulse={joined && !live && role !== 'commentator'}
        />
        <Label size={10} tracking={1.5} color={joined ? KBT.cream : KBT.dim}>
          {status}
        </Label>
      </div>
      {role === 'hoop' ? (
        <Tab
          size={10}
          color={cam?.calibrated ? KBT.good : KBT.amber}
          textColor={KBT.dark}>
          {cam?.calibrated ? 'RIM CALIBRATED' : 'RIM NOT CALIBRATED'}
        </Tab>
      ) : null}
      <div
        style={{
          fontFamily: kbtMonoFont,
          fontSize: 10,
          letterSpacing: 0.5,
          lineHeight: 1.5,
          color: KBT.dim,
          textAlign: 'center',
        }}>
        {meta.sub}
      </div>
      {picker ? (
        <div style={{ width: '100%', minWidth: 0, marginTop: 'auto' }}>
          {picker}
        </div>
      ) : null}
    </Plate>
  );
}

/**
 * The court is open: three QR codes (hoop cam, court cam, moderator), the
 * camera status, the panel link for a laptop, and TIP-OFF once the hoop
 * camera is live and calibrated (or the host insists).
 */
export function LobbyScreen({
  room,
  feed,
  onStart,
  onBack,
}: {
  room: BbRoom;
  feed: BbFeed;
  onStart: () => void;
  onBack: () => void;
}) {
  const roomId = room.roomId;
  const enc = roomId ? encodeURIComponent(roomId) : '';
  const { base, label, links } = useJoinLinks(roomId, {
    hoop: `/mobile/${enc}/bb-cam?role=hoop`,
    court: `/mobile/${enc}/bb-cam?role=court`,
    commentator: `/basketball-game/panel/${enc}`,
  });
  const panelUrl = useMemo(
    () =>
      base && roomId ? buildJoinUrl(base, `/basketball-game/panel/${enc}`) : '',
    [base, roomId, enc],
  );

  // Push the join links so the broadcast lobby burns in its own QRs.
  useEffect(() => {
    if (!roomId || !links.hoop) return;
    const timer = window.setTimeout(() => {
      void setBbConfig(roomId, {
        joinUrls: {
          hoop: links.hoop,
          court: links.court,
          commentator: links.commentator,
        },
        joinLabel: label,
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [roomId, links.hoop, links.court, links.commentator, label]);

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const copyPanel = () => {
    if (!panelUrl) return;
    void navigator.clipboard
      .writeText(panelUrl)
      .then(() => {
        setCopyState('copied');
        window.setTimeout(() => setCopyState('idle'), 2000);
      })
      .catch(() => {
        setCopyState('failed');
        window.setTimeout(() => setCopyState('idle'), 2500);
      });
  };

  const state = feed.state;
  const cams = state?.cams ?? null;
  const library = useMp4Library();
  const hoopReady = !!cams?.hoop.camConnected && !!cams?.hoop.calibrated;
  const force = useArmed(4000);
  const start = () => {
    if (hoopReady || force.armed === 'start') {
      force.disarm();
      onStart();
    } else {
      force.arm('start');
    }
  };
  useArcadeKeys({ confirm: start, back: onBack });
  const teams = state?.teams;
  const tooClose = teams ? colorsTooClose(teams.A.color, teams.B.color) : false;

  return (
    <Frame
      title='COURT OPEN'
      tab={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Label size={10} tracking={1.5}>
            ROOM {roomId ?? '—'}
          </Label>
          <StatusDot
            state={feed.connected ? 'good' : 'bad'}
            pulse={!feed.connected}
          />
        </div>
      }
      footer={
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <FooterHint
            hints={[
              { key: 'ESC', label: 'SETUP' },
              { key: 'ENTER', label: 'TIP-OFF' },
            ]}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <KbtButton label='SETUP' variant='outline' onClick={onBack} />
            <KbtButton
              label={
                hoopReady
                  ? 'TIP-OFF'
                  : force.armed === 'start'
                    ? 'TIP-OFF ANYWAY?'
                    : 'TIP-OFF'
              }
              sub={
                hoopReady
                  ? 'start the clock'
                  : 'hoop cam not ready — press twice'
              }
              active={hoopReady || force.armed === 'start'}
              onClick={start}
            />
          </div>
        </div>
      }>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          minHeight: 0,
        }}>
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'stretch',
            flex: 1,
            minHeight: 0,
          }}>
          <JoinPlate
            role='hoop'
            url={links.hoop}
            cam={cams?.hoop ?? null}
            commentatorName={null}
            creating={room.creating}
            picker={
              roomId ? (
                <FileCamPicker
                  dense
                  roomId={roomId}
                  role='hoop'
                  cams={cams}
                  files={library.files}
                  loading={library.loading}
                />
              ) : null
            }
          />
          <JoinPlate
            role='court'
            url={links.court}
            cam={cams?.court ?? null}
            commentatorName={null}
            creating={room.creating}
            picker={
              roomId ? (
                <FileCamPicker
                  dense
                  roomId={roomId}
                  role='court'
                  cams={cams}
                  files={library.files}
                  loading={library.loading}
                />
              ) : null
            }
          />
          <JoinPlate
            role='commentator'
            url={links.commentator}
            cam={null}
            commentatorName={state?.commentator?.name ?? null}
            creating={room.creating}
          />
        </div>
        {roomId ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Label size={9} tracking={1.5}>
              TEST CLIPS
            </Label>
            <FileCamSyncButton
              dense
              roomId={roomId}
              cams={cams}
              onReload={library.reload}
            />
          </div>
        ) : null}
        <Plate
          cutPx={14}
          innerStyle={{
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            padding: '10px 14px',
            flexWrap: 'wrap',
          }}>
          {teams ? (
            <>
              <TeamBadge name={teams.A.name} color={teams.A.color} />
              <Label size={10} tracking={2}>
                VS
              </Label>
              <TeamBadge name={teams.B.name} color={teams.B.color} />
            </>
          ) : null}
          <Label size={10} tracking={1.5} style={{ marginLeft: 'auto' }}>
            FIRST TO {state?.config.targetPoints ?? 21} ·{' '}
            {formatClock(state?.config.durationMs ?? 600_000)} · OT TO +
            {state?.config.otWinPoints ?? 2}
          </Label>
          {tooClose ? (
            <Label size={10} tracking={1.5} color={KBT.amber}>
              TEAM COLOURS TOO CLOSE FOR THE AI
            </Label>
          ) : null}
        </Plate>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Label size={9} tracking={1.5}>
            PANEL LINK FOR A LAPTOP
          </Label>
          <div
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 10,
              color: KBT.dim,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {panelUrl || '—'}
          </div>
          <ChipButton
            dense
            label={
              copyState === 'copied'
                ? 'COPIED'
                : copyState === 'failed'
                  ? 'COPY FAILED'
                  : 'COPY'
            }
            onClick={copyPanel}
          />
        </div>
      </div>
    </Frame>
  );
}
