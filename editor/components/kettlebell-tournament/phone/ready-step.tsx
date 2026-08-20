'use client';

import React from 'react';
import type { KbtPlayer, KbtStateEvent } from '@smelter-editor/types';
import {
  DisplayText,
  KBT,
  Label,
  Num,
  Plate,
  PlateTitle,
  StatusDot,
  kbtMonoFont,
} from '../kbt-kit';

function Row({
  left,
  right,
  color,
  dim,
  rightNum = false,
  camState,
}: {
  left: string;
  right: string;
  color?: string;
  dim?: boolean;
  /** Render the right side as a mono numeral (scores). */
  rightNum?: boolean;
  /** Square cam-status dot next to the right label (line-up rows). */
  camState?: 'good' | 'idle';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        fontFamily: kbtMonoFont,
        fontSize: 12,
        letterSpacing: 0.5,
        color: dim ? KBT.dim : KBT.cream,
      }}>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          overflow: 'hidden',
          minWidth: 0,
        }}>
        <span
          style={{
            width: 8,
            height: 8,
            background: color ?? KBT.cream,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
          {left}
        </span>
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          flexShrink: 0,
        }}>
        {camState ? <StatusDot state={camState} size={7} /> : null}
        {rightNum ? (
          <Num size={13} color={dim ? KBT.dim : KBT.cream}>
            {right}
          </Num>
        ) : (
          <Label size={10} tracking={1.5} color={dim ? KBT.dim : KBT.cream}>
            {right}
          </Label>
        )}
      </span>
    </div>
  );
}

/**
 * Step 4 — standing by between heats: your heat assignment, the live pose
 * check while your heat is staged, and the tournament standings. The page
 * flips to the live HUD on its own when your heat starts counting.
 */
export function ReadyStep({
  state,
  myClientId,
  myName,
  poseTracked,
  fullBody,
  inMyIntro,
  camOn,
  facing,
  attachVideo,
}: {
  state: KbtStateEvent | null;
  myClientId: string | null;
  myName: string;
  poseTracked: boolean;
  /** Head + an ankle in frame per the AI (false = ask the athlete to back up). */
  fullBody: boolean;
  /** My heat is staged (intro) — show the framing check prominently. */
  inMyIntro: boolean;
  camOn: boolean;
  facing: 'user' | 'environment';
  attachVideo: (el: HTMLVideoElement | null) => void;
}) {
  const players = state?.players ?? [];
  const me =
    (myClientId && players.find((p) => p.clientId === myClientId)) ||
    players.find((p) => p.name === myName.trim()) ||
    null;
  const myHeat =
    me?.heatIndex != null && state ? state.heats[me.heatIndex] : null;
  const heatMates = myHeat
    ? myHeat.playerIds
        .map((id) => players.find((p) => p.clientId === id))
        .filter((p): p is KbtPlayer => !!p)
    : [];
  const standings = [...players].sort(
    (a, b) =>
      (b.finalScore ?? -1) - (a.finalScore ?? -1) || b.bestScore - a.bestScore,
  );

  const poseOk = poseTracked && fullBody;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      {inMyIntro ? (
        <Plate
          cutPx={14}
          accentBar
          accentColor={poseOk ? KBT.good : KBT.amber}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 18px',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot state={poseOk ? 'good' : 'warn'} pulse={!poseOk} />
            <DisplayText
              size={24}
              weight={700}
              tracking={2}
              color={poseOk ? KBT.good : KBT.amber}
              style={{ textAlign: 'center' }}>
              {!poseTracked
                ? 'STEP INTO FRAME'
                : fullBody
                  ? 'POSE LOCKED ✓'
                  : 'BACK UP'}
            </DisplayText>
          </div>
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 11,
              letterSpacing: 0.5,
              color: KBT.dim,
              textAlign: 'center',
            }}>
            {!poseTracked
              ? 'Stand back until your whole body is tracked on your tile.'
              : fullBody
                ? 'The AI sees you. Grab the bell and await the countdown.'
                : 'Head to toe must fit — move the phone or step back.'}
          </span>
        </Plate>
      ) : (
        <Plate
          cutPx={14}
          accentBar
          accentColor={KBT.amber}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '16px 18px',
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot state='warn' pulse />
            <DisplayText size={24} weight={700} tracking={2}>
              STANDING BY…
            </DisplayText>
          </div>
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 11,
              letterSpacing: 0.5,
              color: KBT.dim,
              textAlign: 'center',
            }}>
            {myHeat
              ? `You lift in ${myHeat.final ? 'the FINAL' : `HEAT ${myHeat.index + 1}`}. Keep the phone propped and awake.`
              : 'Waiting for the host to draw the heats.'}
          </span>
        </Plate>
      )}

      {camOn ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '3 / 4',
            maxHeight: '40vh',
            minHeight: 180,
            background: '#000',
            border: `1px solid ${KBT.border}`,
            overflow: 'hidden',
            flexShrink: 0,
          }}>
          <video
            ref={attachVideo}
            autoPlay
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: facing === 'user' ? 'scaleX(-1)' : undefined,
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: '4% 12%',
              border: '2px dashed rgba(232,228,218,.5)',
              pointerEvents: 'none',
            }}
          />
          {inMyIntro ? (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 8,
                textAlign: 'center',
                pointerEvents: 'none',
              }}>
              <span
                className={poseOk ? undefined : 'kbt-blink'}
                style={{ display: 'inline-block' }}>
                <Label
                  size={10}
                  tracking={1.5}
                  color={poseOk ? KBT.good : KBT.amber}
                  style={{
                    display: 'inline-block',
                    background: 'rgba(13,14,16,.7)',
                    padding: '5px 9px',
                  }}>
                  {!poseTracked
                    ? 'STEP INTO FRAME'
                    : fullBody
                      ? 'POSE LOCKED ✓'
                      : 'BACK UP — WHOLE BODY IN FRAME'}
                </Label>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {heatMates.length > 0 ? (
        <Plate
          cutPx={14}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: '14px 16px',
          }}>
          <PlateTitle>
            {myHeat?.final
              ? 'FINAL LINE-UP'
              : `HEAT ${myHeat!.index + 1} LINE-UP`}
          </PlateTitle>
          {heatMates.map((p) => (
            <Row
              key={p.clientId}
              left={p.name + (p.clientId === me?.clientId ? ' (YOU)' : '')}
              right={p.camConnected ? 'CAM ✓' : 'NO CAM'}
              color={p.color}
              dim={!p.camConnected}
              camState={p.camConnected ? 'good' : 'idle'}
            />
          ))}
        </Plate>
      ) : null}

      {standings.some((p) => p.bestScore > 0 || p.finalScore != null) ? (
        <Plate
          cutPx={14}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
            padding: '14px 16px',
          }}>
          <PlateTitle>STANDINGS</PlateTitle>
          {standings.slice(0, 8).map((p, i) => (
            <Row
              key={p.clientId}
              left={`${i + 1}. ${p.name}`}
              right={`${p.finalScore ?? p.bestScore}`}
              color={p.color}
              dim={p.bestScore === 0 && p.finalScore == null}
              rightNum
            />
          ))}
        </Plate>
      ) : null}
    </div>
  );
}
