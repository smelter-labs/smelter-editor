'use client';

import React from 'react';
import type { KbtPlayer, KbtStateEvent } from '@smelter-editor/types';
import {
  ChipButton,
  DisplayText,
  KBT,
  Label,
  Num,
  Plate,
  PlateTitle,
  StatusDot,
  WarnPlate,
  kbtMonoFont,
} from '../kbt-kit';
import { KbtAvatar } from '../avatar';

function Row({
  left,
  right,
  color,
  photoUrl,
  dim,
  rightNum = false,
  camState,
}: {
  left: string;
  right: string;
  color?: string;
  /** Profile photo — swaps the color square for a small avatar. */
  photoUrl?: string | null;
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
        {photoUrl ? (
          <KbtAvatar
            name={left}
            color={color ?? KBT.cream}
            photoUrl={photoUrl}
            size={20}
          />
        ) : (
          <span
            style={{
              width: 8,
              height: 8,
              background: color ?? KBT.cream,
              flexShrink: 0,
            }}
          />
        )}
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
  live,
  publishing = false,
  onRetryPublish,
  fileMode,
  filePlaying,
  sendFps,
  onToggleFile,
  onRestartFile,
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
  /** The WHIP publish is up (false with camOn = stream not reaching the arena). */
  live?: boolean;
  /** A republish is in flight — the retry chip goes quiet meanwhile. */
  publishing?: boolean;
  /** Manual republish fallback when the self-heal loop isn't enough. */
  onRetryPublish?: () => void;
  /** The "camera" is a looping recording — offer playback controls. */
  fileMode?: boolean;
  filePlaying?: boolean;
  /** Outbound video fps while publishing (0 = nothing leaves the phone). */
  sendFps?: number | null;
  onToggleFile?: () => void;
  onRestartFile?: () => void;
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
  // Host-chosen lifter orientation; absent field (older server) = front.
  const sideOn = state?.config?.cameraView === 'side';

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
                ? sideOn
                  ? 'The AI sees you. Turn SIDE-ON to the camera, grab the bell and await the countdown.'
                  : 'The AI sees you. Grab the bell and await the countdown.'
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
              border: `2px dashed ${KBT.dim}`,
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
                    background: KBT.scrim,
                    padding: '5px 9px',
                  }}>
                  {!poseTracked
                    ? 'STEP INTO FRAME'
                    : fullBody
                      ? sideOn
                        ? 'POSE LOCKED ✓ — LIFT SIDE-ON'
                        : 'POSE LOCKED ✓'
                      : 'BACK UP — WHOLE BODY IN FRAME'}
                </Label>
              </span>
            </div>
          ) : null}
          {fileMode ? (
            <div
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
                pointerEvents: 'none',
              }}>
              <div style={{ background: KBT.scrim, padding: '4px 8px' }}>
                <Label
                  size={9}
                  tracking={2}
                  color={filePlaying === false ? KBT.amber : KBT.cream}>
                  {filePlaying === false ? 'PAUSED' : 'RECORDING'}
                </Label>
              </div>
              {/* A paused clip legitimately encodes nothing — the PAUSED chip
                  already says so, so only report fps while playing. */}
              {sendFps != null && filePlaying !== false ? (
                <div
                  style={{
                    background: KBT.scrim,
                    padding: '4px 8px',
                  }}>
                  <Label
                    size={9}
                    tracking={2}
                    color={sendFps > 0 ? KBT.good : KBT.bad}>
                    {sendFps > 0 ? `SENDING ${sendFps} FPS` : 'NO SIGNAL OUT'}
                  </Label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {camOn && live === false ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flexShrink: 0,
          }}>
          <WarnPlate>
            VIDEO NOT REACHING THE ARENA — reconnecting; if it doesn&apos;t come
            back, go live again.
          </WarnPlate>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <ChipButton
              label={publishing ? 'RECONNECTING…' : '⟳ GO LIVE AGAIN'}
              dense
              disabled={publishing}
              onClick={() => onRetryPublish?.()}
            />
          </div>
        </div>
      ) : null}

      {fileMode && camOn ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            flexShrink: 0,
          }}>
          <ChipButton
            label={filePlaying ? '⏸ PAUSE' : '▶ PLAY'}
            dense
            onClick={() => onToggleFile?.()}
          />
          <ChipButton
            label='↺ FROM THE TOP'
            dense
            onClick={() => onRestartFile?.()}
          />
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
              photoUrl={p.photoUrl}
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
              photoUrl={p.photoUrl}
              dim={p.bestScore === 0 && p.finalScore == null}
              rightNum
            />
          ))}
        </Plate>
      ) : null}
    </div>
  );
}
