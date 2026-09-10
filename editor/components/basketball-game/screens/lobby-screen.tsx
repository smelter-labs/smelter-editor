'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { BbCam } from '@smelter-editor/types';
import { setBbConfig } from '@/app/actions/actions';
import { buildJoinUrl, useJoinLinks } from '@/lib/arcade/use-join-link';
import {
  BB,
  BbButton,
  BbPlate,
  Chip,
  Copy,
  Display,
  HostFrame,
  Meta,
  Mono,
  QrBox,
  TeamStripe,
  chainLink,
  colorsTooClose,
  useArmed,
} from '../bb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
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
    role: 'ROLE 1',
    sub: 'On the rim, 45° off the board, above head height. Runs the AI that counts makes and reads jersey colour.',
  },
  court: {
    title: 'COURT CAM',
    role: 'ROLE 2',
    sub: 'Wide on the half court. The main picture for the stream.',
  },
  commentator: {
    title: 'MODERATOR / COMMENTARY',
    role: 'ROLE 3',
    sub: 'Courtside. Confirms disputed makes, runs the clock, switches shots. Optionally on air with camera and mic.',
  },
} as const;

type Status = 'live' | 'connecting' | 'waiting';

function StatusLine({ status, name }: { status: Status; name: string | null }) {
  const color =
    status === 'live' ? BB.good : status === 'connecting' ? BB.amber : BB.chalk;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: status === 'waiting' ? 0.6 : 1,
      }}>
      <span
        className={status === 'connecting' ? 'bb-pulse' : undefined}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: status === 'live' ? color : 'transparent',
          border: `${status === 'connecting' ? 2 : 1}px solid ${color}`,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      />
      <Mono size={10} weight={600} tracking={0.2} color={color}>
        {status === 'live'
          ? `LIVE${name ? ` · ${name}` : ''}`
          : status === 'connecting'
            ? `CONNECTING${name ? ` · ${name}` : ''}`
            : 'WAITING'}
      </Mono>
    </div>
  );
}

function RolePlate({
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
  const joined =
    role === 'commentator' ? commentatorName != null : !!cam?.joined;
  const live = role === 'commentator' ? joined : !!cam?.camConnected;
  const status: Status = !joined ? 'waiting' : live ? 'live' : 'connecting';
  const name =
    role === 'commentator' ? commentatorName : camSourceLabel(cam) || null;
  const barColor =
    status === 'live' ? BB.good : status === 'connecting' ? BB.amber : BB.rule2;
  const second =
    role === 'hoop' && joined
      ? cam?.calibrated
        ? { text: 'RIM CALIBRATED', color: BB.good }
        : { text: 'CALIBRATE THE RIM', color: BB.amber }
      : null;
  const qr = 128;
  return (
    <BbPlate
      cutPx={15}
      bottomBar={3}
      bottomBarColor={barColor}
      style={{
        flex: 1,
        minWidth: 0,
        padding: '16px 19px 19px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
        }}>
        <Display
          size={24}
          weight={800}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {meta.title}
        </Display>
        <Meta size={10} tracking={0.22} style={{ flexShrink: 0 }}>
          {meta.role}
        </Meta>
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
        {url ? (
          <QrBox url={url} size={qr} padding={12} />
        ) : (
          <div
            style={{
              width: qr + 24,
              height: qr + 24,
              border: `1px dashed ${BB.rule2}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
            <Meta size={10}>{creating ? 'BUILDING…' : 'NO COURT'}</Meta>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}>
          <Copy size={10} color='rgba(232,228,218,.8)' lineHeight={1.6}>
            {meta.sub}
          </Copy>
          <div
            style={{
              marginTop: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}>
            <StatusLine status={status} name={name} />
            <Mono
              size={9}
              tracking={0.2}
              color={second ? second.color : BB.chalk}
              style={{ opacity: second ? 0.9 : 0.4 }}>
              {second ? second.text : '—'}
            </Mono>
          </div>
        </div>
      </div>
      {picker ? (
        <div style={{ width: '100%', minWidth: 0 }}>{picker}</div>
      ) : null}
    </BbPlate>
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
  const armed = !hoopReady && force.armed === 'start';

  return (
    <HostFrame
      title='COURT OPEN'
      background={
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: chainLink(0.04, 20),
          }}
        />
      }
      meta={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: BB.plate2,
              border: `1px solid ${BB.rule2}`,
              padding: '5px 10px',
            }}>
            <Meta size={10} tracking={0.22} color={BB.chalk}>
              ROOM ·{' '}
              <span style={{ fontWeight: 600, color: BB.electric }}>
                {roomId ?? '—'}
              </span>
            </Meta>
          </span>
          <span
            className={feed.connected ? undefined : 'bb-pulse'}
            title={feed.connected ? 'feed connected' : 'feed down'}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: feed.connected ? BB.good : BB.bad,
            }}
          />
        </div>
      }
      actions={
        <>
          <BbButton
            variant='outline'
            label='SETUP'
            onClick={onBack}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <BbButton
            variant={armed ? 'chalk' : 'primary'}
            active={hoopReady || armed}
            label={armed ? 'TIP-OFF ANYWAY?' : 'TIP-OFF'}
            keyBadge='ENTER'
            onClick={start}
            style={{
              height: 43,
              fontSize: 20,
              padding: '0 24px',
              ...(armed ? { background: BB.amber } : {}),
            }}
          />
        </>
      }
      hints={[
        { key: 'ENTER', label: 'TIP-OFF' },
        { key: 'ESC', label: 'SETUP' },
      ]}
      hintsRight={
        <Mono
          size={10}
          tracking={0.22}
          color={BB.chalk}
          style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
          HOOP CAM NOT READY → BUTTON READS{' '}
          <span style={{ fontWeight: 600, color: BB.amber }}>
            TIP-OFF ANYWAY?
          </span>{' '}
          · TWO PRESSES
        </Mono>
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
            gap: 19,
            alignItems: 'stretch',
            flex: 1,
            minHeight: 0,
          }}>
          <RolePlate
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
          <RolePlate
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
          <RolePlate
            role='commentator'
            url={links.commentator}
            cam={null}
            commentatorName={state?.commentator?.name ?? null}
            creating={room.creating}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 43,
            padding: '0 19px',
            background: BB.plate,
            border: `1px solid ${BB.rule}`,
            boxSizing: 'border-box',
          }}>
          {teams ? (
            <>
              <TeamStripe color={teams.A.color} w={8} h={16} />
              <Display size={20} weight={800}>
                {teams.A.name}
              </Display>
              <Meta size={10} tracking={0.18}>
                VS
              </Meta>
              <Display size={20} weight={800}>
                {teams.B.name}
              </Display>
              <TeamStripe color={teams.B.color} w={8} h={16} />
            </>
          ) : null}
          {tooClose ? (
            <Mono
              size={9}
              weight={600}
              tracking={0.18}
              color={BB.amber}
              style={{ marginLeft: 12 }}>
              TEAM COLOURS TOO CLOSE FOR THE AI
            </Mono>
          ) : null}
          <Mono
            size={10}
            tracking={0.18}
            color={BB.chalk}
            style={{ marginLeft: 'auto', opacity: 0.75, whiteSpace: 'nowrap' }}>
            FIRST TO {state?.config.targetPoints ?? 21} ·{' '}
            {formatClock(state?.config.durationMs ?? 600_000)} · OT TO +
            {state?.config.otWinPoints ?? 2}
          </Mono>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            minWidth: 0,
          }}>
          <Meta size={9} tracking={0.18}>
            PANEL LINK FOR A LAPTOP
          </Meta>
          <Mono
            size={10}
            weight={500}
            tracking={0.04}
            uppercase={false}
            color={BB.chalk}
            style={{
              opacity: 0.9,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {panelUrl || '—'}
          </Mono>
          <Chip
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
          {roomId ? (
            <>
              <Meta size={9} tracking={0.18} style={{ marginLeft: 8 }}>
                TEST CLIPS
              </Meta>
              <FileCamSyncButton
                dense
                roomId={roomId}
                cams={cams}
                onReload={library.reload}
              />
            </>
          ) : null}
        </div>
      </div>
    </HostFrame>
  );
}
