'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { FbCam, FbCamRole } from '@smelter-editor/types';
import { setFbConfig } from '@/app/actions/actions';
import { buildJoinUrl, useJoinLinks } from '@/lib/arcade/use-join-link';
import {
  FB,
  FbButton,
  FbPlate,
  Chip,
  Copy,
  Display,
  HostFrame,
  Meta,
  Mono,
  QrBox,
  Segment,
  TeamStripe,
  chainLink,
  useArmed,
} from '../fb-kit';
import { useArcadeKeys } from '@/components/duck-hunter/use-arcade-input';
import {
  FileCamPicker,
  FileCamSyncButton,
  ROLE_LABEL,
  rolesForSession,
  useMp4Library,
} from '../file-cam-picker';
import type { FbFeed } from '../use-fb-feed';
import type { FbRoom } from '../use-fb-room';

type Session = 'pano' | 'tricam';

const SESSION_META: Record<Session, { title: string; sub: string }> = {
  pano: {
    title: 'STADIUM PANORAMA',
    sub: 'One stitched 4450×2000 clip. The director crops a 16:9 window and follows the ball; goal views and the wide shot are crops too.',
  },
  tricam: {
    title: 'THREE CAMERAS',
    sub: 'Left, centre and right fixed cameras. The director cuts to the third where the tagged players are.',
  },
};

function CamRow({ cam, role }: { cam: FbCam | undefined; role: FbCamRole }) {
  const attached = !!cam?.fileName;
  const live = !!cam?.connected;
  const color = !attached ? FB.chalk : live ? FB.good : FB.amber;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        opacity: attached ? 1 : 0.6,
      }}>
      <span
        className={attached && !live ? 'fb-pulse' : undefined}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: live ? color : 'transparent',
          border: `1px solid ${color}`,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      />
      <Mono
        size={10}
        weight={600}
        tracking={0.2}
        color={color}
        style={{ width: 96, flexShrink: 0 }}>
        {ROLE_LABEL[role]}
      </Mono>
      <Mono
        size={10}
        tracking={0.08}
        uppercase={false}
        color={FB.chalk}
        style={{
          opacity: 0.8,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
        {attached ? cam?.fileName : 'no clip'}
      </Mono>
      {cam?.telemetry ? (
        <Meta
          size={9}
          tracking={0.16}
          color={cam.telemetry.ball || cam.telemetry.zxy ? FB.good : FB.dim}>
          {[
            cam.telemetry.ball ? 'BALL' : null,
            cam.telemetry.zxy ? 'PLAYERS' : null,
            cam.telemetry.events ? 'EVENTS' : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'NO TELEMETRY'}
        </Meta>
      ) : null}
    </div>
  );
}

/**
 * Pre-match: pick the session (panorama or three cameras), attach the clips,
 * scan the moderator panel QR, then KICK-OFF once the driving clip is live.
 */
export function LobbyScreen({
  room,
  feed,
  onStart,
  onBack,
}: {
  room: FbRoom;
  feed: FbFeed;
  onStart: () => void;
  onBack: () => void;
}) {
  const roomId = room.roomId;
  const enc = roomId ? encodeURIComponent(roomId) : '';
  const { base, label, links } = useJoinLinks(roomId, {
    commentator: `/football-game/panel/${enc}`,
  });
  const panelUrl = useMemo(
    () =>
      base && roomId ? buildJoinUrl(base, `/football-game/panel/${enc}`) : '',
    [base, roomId, enc],
  );

  useEffect(() => {
    if (!roomId || !links.commentator) return;
    const timer = window.setTimeout(() => {
      void setFbConfig(roomId, {
        joinUrls: { commentator: links.commentator },
        joinLabel: label,
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(timer);
  }, [roomId, links.commentator, label]);

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
  const [session, setSession] = useState<Session>('pano');
  useEffect(() => {
    if (state?.session) setSession(state.session);
  }, [state?.session]);
  const roles = rolesForSession(session);
  const driving = roles.map((r) => cams?.[r]).find((c) => c?.fileName);
  const ready = !!driving?.connected;
  const force = useArmed(4000);
  const start = () => {
    if (ready || force.armed === 'start') {
      force.disarm();
      onStart();
    } else force.arm('start');
  };
  useArcadeKeys({ confirm: start, back: onBack });
  const teams = state?.teams;
  const armed = !ready && force.armed === 'start';
  const filterFor = library.filterFor;

  return (
    <HostFrame
      title='PRE-MATCH'
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
              background: FB.plate2,
              border: `1px solid ${FB.rule2}`,
              padding: '5px 10px',
            }}>
            <Meta size={10} tracking={0.22} color={FB.chalk}>
              ROOM ·{' '}
              <span style={{ fontWeight: 600, color: FB.electric }}>
                {roomId ?? '—'}
              </span>
            </Meta>
          </span>
          <span
            className={feed.connected ? undefined : 'fb-pulse'}
            title={feed.connected ? 'feed connected' : 'feed down'}
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: feed.connected ? FB.good : FB.bad,
            }}
          />
        </div>
      }
      actions={
        <>
          <FbButton
            variant='outline'
            label='SETUP'
            onClick={onBack}
            style={{ height: 43, fontSize: 17, padding: '0 21px' }}
          />
          <div style={{ flex: 1 }} />
          <FbButton
            variant={armed ? 'chalk' : 'primary'}
            active={ready || armed}
            label={armed ? 'KICK OFF ANYWAY?' : 'KICK-OFF'}
            keyBadge='ENTER'
            onClick={start}
            style={{
              height: 43,
              fontSize: 20,
              padding: '0 24px',
              ...(armed ? { background: FB.amber } : {}),
            }}
          />
        </>
      }
      hints={[
        { key: 'ENTER', label: 'KICK-OFF' },
        { key: 'ESC', label: 'SETUP' },
      ]}
      hintsRight={
        <Mono
          size={10}
          tracking={0.22}
          color={FB.chalk}
          style={{ opacity: 0.7, whiteSpace: 'nowrap' }}>
          NO CLIP ATTACHED → BUTTON READS{' '}
          <span style={{ fontWeight: 600, color: FB.amber }}>
            KICK OFF ANYWAY?
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
          <FbPlate
            cutPx={15}
            bottomBar={3}
            bottomBarColor={ready ? FB.good : driving ? FB.amber : FB.rule2}
            style={{
              flex: 1.6,
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
                alignItems: 'center',
                gap: 8,
              }}>
              <Display size={24} weight={800}>
                CAMERAS
              </Display>
              <Segment
                height={28}
                fontSize={10}
                style={{ width: 300 }}
                options={[
                  { value: 'pano', label: 'PANORAMA' },
                  { value: 'tricam', label: '3 CAMERAS' },
                ]}
                value={session}
                onChange={(v) => setSession(v as Session)}
              />
            </div>
            <Copy size={10} color='rgba(232,228,218,.8)' lineHeight={1.6}>
              {SESSION_META[session].sub}
            </Copy>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {roles.map((role) => (
                <div
                  key={role}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    borderTop: `1px solid ${FB.rule}`,
                    paddingTop: 8,
                  }}>
                  <CamRow cam={cams?.[role]} role={role} />
                  {roomId ? (
                    <FileCamPicker
                      dense
                      roomId={roomId}
                      role={role}
                      cams={cams}
                      files={library.files}
                      loading={library.loading}
                      filter={filterFor(role)}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
              {roomId ? (
                <FileCamSyncButton
                  dense
                  roomId={roomId}
                  cams={cams}
                  onReload={library.reload}
                />
              ) : null}
              <Meta size={9} tracking={0.16} style={{ marginLeft: 'auto' }}>
                AI EVENTS ·{' '}
                {(state?.aiEvents ?? 'off').replace('_', ' ').toUpperCase()}
              </Meta>
            </div>
          </FbPlate>

          <FbPlate
            cutPx={15}
            bottomBar={3}
            bottomBarColor={state?.commentator ? FB.good : FB.rule2}
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
              <Display size={24} weight={800}>
                MODERATOR
              </Display>
              <Meta size={10} tracking={0.22}>
                PANEL
              </Meta>
            </div>
            <div style={{ display: 'flex', gap: 14 }}>
              {links.commentator ? (
                <QrBox url={links.commentator} size={128} padding={12} />
              ) : (
                <div
                  style={{
                    width: 152,
                    height: 152,
                    border: `1px dashed ${FB.rule2}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                  <Meta size={10}>
                    {room.creating ? 'BUILDING…' : 'NO ROOM'}
                  </Meta>
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
                  Confirms goal candidates, runs the clock and halves, picks the
                  view (AUTO / WIDE / FOLLOW / GOALS), toggles the minimap and
                  replays.
                </Copy>
                <Mono
                  size={10}
                  weight={600}
                  tracking={0.2}
                  color={state?.commentator ? FB.good : FB.chalk}
                  style={{
                    marginTop: 'auto',
                    opacity: state?.commentator ? 1 : 0.6,
                  }}>
                  {state?.commentator
                    ? `● ${state.commentator.name}`
                    : '○ WAITING'}
                </Mono>
              </div>
            </div>
          </FbPlate>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 43,
            padding: '0 19px',
            background: FB.plate,
            border: `1px solid ${FB.rule}`,
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
          <Mono
            size={10}
            tracking={0.18}
            color={FB.chalk}
            style={{ marginLeft: 'auto', opacity: 0.75, whiteSpace: 'nowrap' }}>
            2 × {Math.round((state?.config.halfMs ?? 2_700_000) / 60000)} MIN ·{' '}
            {state?.config.clockFromClip
              ? 'CLOCK FROM THE CLIP'
              : 'CLOCK FROM KICK-OFF'}
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
            color={FB.chalk}
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
        </div>
      </div>
    </HostFrame>
  );
}
