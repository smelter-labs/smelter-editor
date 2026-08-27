'use client';

import React, { useEffect, useRef, useState } from 'react';
import { connectWhep } from '@/lib/webrtc/whep-connect';
import {
  Bar,
  ConfirmRail,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
  Tab,
} from '../kbt-kit';
import { DevicePickers } from './device-pickers';
import type { PanelSocket } from './use-panel-socket';
import type { CommentatorRig } from './use-commentator-rig';
import type { CamRecovery } from './use-cam-recovery';
import { ViewSwitcher } from './view-switcher';
import { ShowControl } from './show-control';
import { OverlayControl } from './overlay-control';
import { RepShotStrip } from '../rep-shots';
import { RepShotLightbox } from '../rep-shot-lightbox';
import { repShotsForPlayer } from '../rep-shot-source';
import { useKbtRecording } from '../use-kbt-recording';
import { RecordingPlate } from '../recording-control';

/**
 * PROGRAM monitor: the composited broadcast over WHEP. Always muted — the
 * commentator's own mic is in that mix and an open monitor would feed back.
 */
function ProgramMonitor({ whepUrl }: { whepUrl: string | null }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!whepUrl) return;
    let closeConnection = () => {};
    let cancelled = false;
    void connectWhep(whepUrl).then(({ stream, close }) => {
      if (cancelled) {
        close();
        return;
      }
      closeConnection = close;
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    });
    return () => {
      cancelled = true;
      closeConnection();
    };
  }, [whepUrl]);

  return (
    <Plate cutPx={18} innerStyle={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#000',
        }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      </div>
      <div style={{ padding: '8px 14px' }}>
        <Label size={9} tracking={1.5}>
          PROGRAM — what viewers see (runs ~3s behind you) · monitor muted to
          stop echo
        </Label>
      </div>
    </Plate>
  );
}

/** Self-preview + ON AIR + mic meter + device/mute controls — the rig. */
function RigStrip({
  rig,
  recovery,
  name,
}: {
  rig: CommentatorRig;
  recovery: CamRecovery;
  name: string;
}) {
  const restoring = recovery.restoring && !rig.live;
  return (
    <Plate
      cutPx={14}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '10px 14px',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <video
          autoPlay
          playsInline
          muted
          ref={rig.attachPreview}
          style={{
            width: 192,
            height: 108,
            objectFit: 'cover',
            border: `1px solid ${KBT.border}`,
            background: '#000',
            transform: 'scaleX(-1)',
            flexShrink: 0,
          }}
        />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tab
              size={10}
              color={rig.live ? KBT.good : restoring ? KBT.amber : KBT.bad}
              textColor={KBT.dark}>
              {rig.live ? 'ON AIR' : restoring ? 'RESTORING VIDEO…' : 'OFFLINE'}
            </Tab>
            {restoring ? <StatusDot state='warn' pulse /> : null}
            <Label size={10} tracking={1.5} color={KBT.cream}>
              {name}
            </Label>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              minHeight: 14,
            }}>
            <Label size={9} tracking={2}>
              MIC
            </Label>
            {rig.muted ? (
              <Label size={9} tracking={2} color={KBT.bad}>
                MUTED
              </Label>
            ) : (
              <Bar
                value={rig.micLevel}
                max={1}
                color={rig.micLevel > 0.03 ? KBT.good : KBT.amber}
                style={{ flex: 1 }}
              />
            )}
          </div>
          <Label size={9} tracking={1}>
            your voice is always in the mix — mute between segments
          </Label>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'stretch',
          }}>
          <KbtButton
            dense
            variant={rig.muted ? 'danger' : 'outline'}
            label={rig.muted ? 'MIC MUTED — UNMUTE' : 'MUTE MIC'}
            active={rig.muted}
            onClick={rig.toggleMute}
          />
          {/* Escape hatch for a wedged publish the self-heal didn't catch. */}
          <KbtButton
            dense
            variant='outline'
            label='RESTART CAMERA'
            onClick={recovery.restartCamera}
          />
        </div>
      </div>
      <DevicePickers rig={rig} />
      {rig.camErr ? (
        <Label size={9} tracking={1} color={KBT.bad}>
          {rig.camErr}
        </Label>
      ) : null}
    </Plate>
  );
}

/**
 * The one-page moderator panel: program monitor + own rig on the left,
 * view switching and show control on the right. Everything the commentator
 * needs during the show lives here — no other tab required.
 */
export function PanelScreen({
  socket,
  rig,
  recovery,
  name,
  whepUrl,
  roomId,
}: {
  socket: PanelSocket;
  rig: CommentatorRig;
  recovery: CamRecovery;
  name: string;
  whepUrl: string | null;
  roomId: string;
}) {
  const rec = useKbtRecording(roomId, socket.state?.isRecording ?? false);
  const heatPhase =
    socket.match?.heatIndex != null ? socket.match.phase : 'idle';
  const heatLive =
    heatPhase === 'intro' ||
    heatPhase === 'countdown' ||
    heatPhase === 'playing';
  // Lightbox target: the clicked shot's owner + position in their full list.
  const [lightbox, setLightbox] = useState<{
    playerId: string;
    index: number;
  } | null>(null);
  const lightboxPlayer = lightbox
    ? (socket.state?.players ?? []).find(
        (p) => p.clientId === lightbox.playerId,
      )
    : null;
  const lightboxShots = lightbox
    ? repShotsForPlayer(socket.state, lightbox.playerId)
    : [];

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        flex: 1,
        minHeight: 0,
        alignItems: 'stretch',
      }}>
      {/* Left: what's on air + own rig. */}
      <div
        style={{
          flex: '0 0 55%',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minWidth: 0,
        }}>
        <ProgramMonitor whepUrl={whepUrl} />
        <RigStrip rig={rig} recovery={recovery} name={name} />
        {!socket.connected ? (
          <Plate
            cutPx={12}
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 14px',
            }}>
            <StatusDot state='bad' pulse />
            <Label size={10} tracking={1.5} color={KBT.bad}>
              LINK LOST — reconnecting…
            </Label>
          </Plate>
        ) : null}
      </div>

      {/* Right: the controls. */}
      <div
        className='kbt-scroll'
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          minWidth: 0,
          overflowY: 'auto',
          // overflow-x computes to auto when overflow-y is auto — pin it so a
          // 1px-too-wide child can't spawn a horizontal bar.
          overflowX: 'hidden',
        }}>
        <ViewSwitcher state={socket.state} sendView={socket.sendView} />
        <ShowControl
          state={socket.state}
          match={socket.match}
          sendMatch={socket.sendMatch}
        />
        <OverlayControl
          state={socket.state}
          sendOverlay={socket.sendOverlay}
          sendBanner={socket.sendBanner}
          sendSkeleton={socket.sendSkeleton}
          sendRepFloat={socket.sendRepFloat}
          sendCasterPip={socket.sendCasterPip}
        />
        <RecordingPlate rec={rec} />
        {socket.recentShots.length > 0 ? (
          <Plate
            cutPx={14}
            innerStyle={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '10px 14px',
            }}>
            <PlateTitle
              right={
                <Label size={9} tracking={1.5}>
                  click a shot to inspect / put on air
                </Label>
              }>
              REP SHOTS
            </PlateTitle>
            <RepShotStrip
              // Newest-first feed → oldest-left strip, like a film roll.
              shots={[...socket.recentShots].reverse().map((r) => ({
                url: r.screenshotUrl!,
                repIndex: r.repIndex,
                exercise: r.exercise,
                verdict: r.verdict,
                name: r.name,
                clientId: r.clientId,
                issues: r.issues,
                points: r.points,
              }))}
              height={54}
              max={12}
              onSelect={(shot) => {
                if (!shot.clientId) return;
                const list = repShotsForPlayer(socket.state, shot.clientId);
                const idx = list.findIndex((s) => s.url === shot.url);
                setLightbox({
                  playerId: shot.clientId,
                  index:
                    idx >= 0
                      ? idx
                      : Math.max(
                          0,
                          list.findIndex((s) => s.repIndex === shot.repIndex),
                        ),
                });
              }}
            />
          </Plate>
        ) : null}
        <div style={{ flex: 1 }} />
        <ConfirmRail
          actions={[
            ...(heatLive
              ? [
                  {
                    id: 'stop',
                    label: 'STOP HEAT',
                    prompt: 'stop this heat?',
                  },
                ]
              : []),
            {
              id: 'reset',
              label: 'RESET TOURNAMENT',
              prompt: 'reset the whole tournament?',
            },
          ]}
          onConfirm={(id) =>
            socket.sendMatch(id === 'stop' ? 'stop_heat' : 'reset')
          }
        />
      </div>
      {lightbox && lightboxPlayer && lightboxShots.length > 0 ? (
        <RepShotLightbox
          shots={lightboxShots}
          playerId={lightbox.playerId}
          playerName={lightboxPlayer.name}
          playerColor={lightboxPlayer.color}
          index={lightbox.index}
          onIndex={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
          onAirOverlay={socket.state?.commentatorOverlay ?? null}
          sendOverlay={socket.sendOverlay}
        />
      ) : null}
    </div>
  );
}
