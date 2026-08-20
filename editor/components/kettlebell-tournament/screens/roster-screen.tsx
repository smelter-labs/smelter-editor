'use client';

import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'react-qr-code';
import type { KbtPlayer } from '@smelter-editor/types';
import { setKbtConfig } from '@/app/actions/actions';
import {
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
} from '@/lib/server-url';
import {
  DisplayText,
  FooterHint,
  Frame,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
  kbtMonoFont,
} from '../kbt-kit';
import { useArcadeKeys } from '../../duck-hunter/use-arcade-input';
import type { KbtFeed } from '../use-kbt-feed';
import type { KbtRoom } from '../use-kbt-room';

const PUBLIC_BASE_KEY = 'smelter-public-base';

function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

function PlayerRow({ p, mark }: { p: KbtPlayer; mark?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
      <span
        style={{ width: 8, height: 8, background: p.color, flexShrink: 0 }}
      />
      <DisplayText
        size={20}
        weight={700}
        tracking={1.5}
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {p.name}
      </DisplayText>
      {mark ? (
        <Label size={10} tracking={1.5}>
          {mark}
        </Label>
      ) : null}
      <StatusDot
        state={p.camConnected ? 'good' : 'warn'}
        pulse={!p.camConnected}
      />
      <Label
        size={10}
        tracking={1.5}
        color={p.camConnected ? KBT.good : KBT.amber}>
        {p.camConnected ? 'CAM ✓' : 'NO CAM'}
      </Label>
    </div>
  );
}

/**
 * Registration screen: the join QR (the phone page publishes its camera), the
 * live roster with camera status, and — once drawn — the heat card the host
 * stages next. The output video behind this shows the camera mosaic, so
 * lifters see themselves the moment they go live.
 */
export function RosterScreen({
  room,
  feed,
  onDrawHeats,
  onStageHeat,
  onBack,
}: {
  room: KbtRoom;
  feed: KbtFeed;
  onDrawHeats: () => void;
  onStageHeat: (heatIndex: number) => void;
  onBack: () => void;
}) {
  const [base, setBase] = useState('');
  const [baseFocused, setBaseFocused] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(PUBLIC_BASE_KEY);
    setBase(saved || defaultPublicBase());
  }, []);

  // Same link recipe as Duck Hunter: public page base + explicit ?server=.
  const liftUrl = useMemo(() => {
    const b = base.trim().replace(/\/+$/, '');
    if (!b || !room.roomId) return '';
    const url = `${b}/mobile/${encodeURIComponent(room.roomId)}/lift`;
    const api = getStoredClientServerUrl() ?? getPublicDefaultServerUrl();
    return api ? `${url}?server=${encodeURIComponent(api)}` : url;
  }, [base, room.roomId]);

  const commentateUrl = useMemo(() => {
    if (!liftUrl) return '';
    return liftUrl.replace('/lift', '/commentate');
  }, [liftUrl]);

  // The server can't know the public page base — push the join URL down so
  // the broadcast's lobby scene can burn in its own QR.
  useEffect(() => {
    if (!liftUrl || !room.roomId) return;
    let label = base.trim();
    try {
      label = new URL(base.trim()).host;
    } catch {
      /* keep the raw base */
    }
    void setKbtConfig(room.roomId, {
      joinUrl: liftUrl,
      joinLabel: label,
    }).catch(() => {
      /* non-fatal: the on-air QR just stays empty */
    });
  }, [liftUrl, base, room.roomId]);

  const commentator = feed.state?.commentator ?? null;

  const players = feed.state?.players ?? [];
  const heats = feed.state?.heats ?? [];
  const heatsDrawn = heats.length > 0;
  const nextHeat = heats.find((h) => h.phase === 'idle');
  const camsReady = players.filter((p) => p.camConnected).length;
  // One lifter is a valid tournament — the SOLO CHALLENGE (one heat of one).
  const canDraw = !!room.roomId && players.length >= 1;
  const solo = players.length === 1;
  const canStage = heatsDrawn && !!nextHeat;

  const primary = () => {
    if (canStage) onStageHeat(nextHeat!.index);
    else if (canDraw) onDrawHeats();
  };
  useArcadeKeys({ confirm: primary, back: onBack });

  const statusLine = room.error
    ? `SETUP FAILED: ${room.error}`
    : room.creating || !room.roomId
      ? 'BUILDING THE ARENA…'
      : players.length === 0
        ? 'WAITING FOR THE FIRST LIFTER'
        : camsReady < players.length
          ? `${camsReady}/${players.length} CAMERAS LIVE`
          : solo
            ? 'SOLO CHALLENGE — CAMERA LIVE'
            : 'ALL CAMERAS LIVE';

  return (
    <Frame
      title='REGISTRATION'
      tab={<Tab>ROSTER</Tab>}
      footer={
        <FooterHint
          hints={[
            { key: 'ENTER', label: canStage ? 'STAGE HEAT' : 'DRAW HEATS' },
            { key: 'ESC', label: 'RULES' },
          ]}
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <KbtButton
                variant='outline'
                dense
                label='RULES'
                onClick={onBack}
              />
              {!heatsDrawn ? (
                <KbtButton
                  variant='solid'
                  dense
                  label={solo ? 'SOLO CHALLENGE' : 'DRAW HEATS'}
                  active={canDraw}
                  disabled={!canDraw}
                  onClick={onDrawHeats}
                />
              ) : !nextHeat ? (
                <KbtButton
                  variant='solid'
                  dense
                  label='ALL HEATS DONE'
                  disabled
                />
              ) : null}
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        {/* Join plate: QR + link + commentator booth. */}
        <Plate
          cutPx={18}
          style={{ width: 330, flexShrink: 0 }}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: '16px 18px',
            height: '100%',
          }}>
          <PlateTitle>JOIN THE TOURNAMENT</PlateTitle>
          {liftUrl ? (
            <div style={{ background: KBT.cream, padding: 12 }}>
              <QRCode
                value={liftUrl}
                size={168}
                fgColor={KBT.dark}
                bgColor={KBT.cream}
              />
            </div>
          ) : (
            <div
              style={{
                width: 192,
                height: 192,
                background: KBT.fill,
                border: `1px solid ${KBT.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Label size={11}>
                {room.creating ? 'BUILDING…' : 'NO ARENA'}
              </Label>
            </div>
          )}
          <div
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 10,
              letterSpacing: 0.5,
              color: KBT.dim,
              textAlign: 'center',
              wordBreak: 'break-all',
            }}>
            {liftUrl || 'the join link appears when the arena is up'}
          </div>
          <input
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              window.localStorage.setItem(PUBLIC_BASE_KEY, e.target.value);
            }}
            onFocus={() => setBaseFocused(true)}
            onBlur={() => setBaseFocused(false)}
            placeholder='public page base (https://…)'
            style={{
              width: '100%',
              fontFamily: kbtMonoFont,
              fontSize: 11,
              color: KBT.cream,
              background: KBT.fill,
              border: `1px solid ${baseFocused ? KBT.accent : KBT.border}`,
              borderRadius: 0,
              padding: '8px 10px',
              outline: 'none',
            }}
          />
          <div
            style={{
              alignSelf: 'stretch',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
            }}>
            <Label size={10} tracking={2}>
              ATHLETES CONNECTED
            </Label>
            <Num size={18}>{`${camsReady}/${players.length}`}</Num>
          </div>
          <Label size={9} tracking={1.5} style={{ textAlign: 'center' }}>
            {statusLine}
          </Label>
          <div
            style={{
              alignSelf: 'stretch',
              height: 1,
              background: KBT.border,
            }}
          />
          {/* Commentator: own QR (audio+cam into the broadcast mix). */}
          <PlateTitle>COMMENTARY BOOTH</PlateTitle>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {commentateUrl ? (
              <div style={{ background: KBT.cream, padding: 7 }}>
                <QRCode
                  value={commentateUrl}
                  size={80}
                  fgColor={KBT.dark}
                  bgColor={KBT.cream}
                />
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
              {commentator ? (
                <>
                  <DisplayText size={18} weight={700} tracking={1.5}>
                    {commentator.name}
                  </DisplayText>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StatusDot
                      state={commentator.camConnected ? 'good' : 'bad'}
                      pulse={!commentator.camConnected}
                    />
                    <Label
                      size={10}
                      tracking={1.5}
                      color={commentator.camConnected ? KBT.good : KBT.bad}>
                      {commentator.camConnected ? 'ON AIR' : 'NO SIGNAL'}
                    </Label>
                  </div>
                </>
              ) : (
                <span
                  style={{
                    fontFamily: kbtMonoFont,
                    fontSize: 10,
                    lineHeight: 1.7,
                    letterSpacing: 0.5,
                    color: KBT.dim,
                  }}>
                  scan to join as the commentator — voice goes on air
                </span>
              )}
            </div>
          </div>
        </Plate>

        {/* Roster */}
        <Plate
          cutPx={18}
          style={{ flex: 1, minWidth: 0 }}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: '16px 18px',
            height: '100%',
          }}>
          <PlateTitle>
            {`ROSTER — ${players.length} LIFTER${players.length === 1 ? '' : 'S'}`}
          </PlateTitle>
          {players.length === 0 ? (
            <Label size={11} tracking={2} style={{ marginTop: 6 }}>
              <span className='kbt-blink'>WAITING FOR LIFTERS…</span>
            </Label>
          ) : (
            players.map((p) => (
              <PlayerRow
                key={p.clientId}
                p={p}
                mark={
                  p.heatIndex != null ? `HEAT ${p.heatIndex + 1}` : undefined
                }
              />
            ))
          )}
        </Plate>

        {/* Heats preview */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: 0,
            overflowY: 'auto',
          }}>
          <Label size={11}>HEATS</Label>
          {heatsDrawn ? (
            heats.map((h) => {
              const done = h.phase === 'ended';
              const isNext = nextHeat?.index === h.index;
              return (
                <Plate
                  key={h.index}
                  cutPx={14}
                  accentBar={isNext}
                  innerStyle={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '12px 14px',
                    opacity: done ? 0.55 : 1,
                  }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}>
                    <Tab
                      size={10}
                      color={isNext ? KBT.accent : KBT.fillStrong}
                      textColor={isNext ? KBT.dark : KBT.dim}>
                      {h.final ? 'FINAL' : `HEAT ${h.index + 1}`}
                    </Tab>
                    <Label
                      size={9}
                      tracking={2}
                      color={isNext ? KBT.accent : KBT.dim}>
                      {done ? 'DONE' : isNext ? 'UP NEXT' : ''}
                    </Label>
                  </div>
                  <span
                    style={{
                      fontFamily: kbtMonoFont,
                      fontSize: 11,
                      letterSpacing: 0.5,
                      color: KBT.cream,
                    }}>
                    {h.playerIds
                      .map(
                        (id) =>
                          players.find((p) => p.clientId === id)?.name ?? '?',
                      )
                      .join(' · ')}
                  </span>
                  {isNext ? (
                    <KbtButton
                      variant='solid'
                      dense
                      block
                      label={`STAGE ${h.final ? 'FINAL' : `HEAT ${h.index + 1}`}`}
                      active
                      onClick={() => onStageHeat(h.index)}
                    />
                  ) : null}
                </Plate>
              );
            })
          ) : (
            <Plate cutPx={14} innerStyle={{ padding: '12px 14px' }}>
              <span
                style={{
                  fontFamily: kbtMonoFont,
                  fontSize: 11,
                  lineHeight: 1.7,
                  letterSpacing: 0.5,
                  color: KBT.dim,
                }}>
                Draw heats when the roster is in — groups of{' '}
                {feed.state?.config.heatSize ?? 2} in join order. A lone
                trailing lifter folds into the last heat.
              </span>
            </Plate>
          )}
          {feed.state ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
              <Label size={10} tracking={2}>
                ROUND
              </Label>
              <Num size={16}>
                {`${Math.floor(feed.state.config.heatDurationMs / 60000)}:${String(
                  Math.round(feed.state.config.heatDurationMs / 1000) % 60,
                ).padStart(2, '0')}`}
              </Num>
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}
