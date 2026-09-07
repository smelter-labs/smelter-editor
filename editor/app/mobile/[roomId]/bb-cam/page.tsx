'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import type {
  BbBallEvent,
  BbCamJoinedEvent,
  BbCamRole,
  BbRim,
  BbStateEvent,
  BbTeamId,
  RoomEvent,
} from '@smelter-editor/types';
import { getRoomInfo } from '@/app/actions/actions';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import { bigShoulders, plexMono } from '@/app/basketball-game/fonts';
import {
  KBT,
  KbtButton,
  KbtConnectStep,
  KbtPhoneShell,
  KbtStatusStrip,
  KbtTextInput,
  Label,
  Plate,
  kbtMonoFont,
} from '@/components/kettlebell-tournament/kbt-kit';
import {
  createFileCamera,
  type FileCamera,
} from '@/components/kettlebell-tournament/phone/file-camera';
import { usePreviewSet } from '@/components/kettlebell-tournament/phone/use-preview';
import { usePublishWatchdog } from '@/components/kettlebell-tournament/phone/use-publish-watchdog';
import { FixedCamStep } from '@/components/basketball-game/phone/fixed-cam-step';
import { RimCalibrator } from '@/components/basketball-game/phone/rim-calibrator';
import { CamLiveHud } from '@/components/basketball-game/phone/cam-live-hud';
import {
  readCamSession,
  writeCamSession,
  type CamSession,
} from '@/components/basketball-game/phone/cam-session';
import '@/components/kettlebell-tournament/kbt-kit.css';

// The fixed-camera wizard: boot → role → name → camera rig → (hoop only)
// rim calibration → live. A refresh resumes via the stored camKey.
type Step = 'connect' | 'role' | 'name' | 'camera' | 'calibrate' | 'live';

const STEP_META: Record<
  Exclude<Step, 'live'>,
  { index: number; label: string }
> = {
  connect: { index: 0, label: 'CONNECTING' },
  role: { index: 1, label: 'WHICH CAMERA' },
  name: { index: 2, label: 'OPERATOR' },
  camera: { index: 3, label: 'CAMERA RIG' },
  calibrate: { index: 4, label: 'RIM CALIBRATION' },
};

const RECONNECT_MAX_MS = 8000;
const REPUBLISH_MAX_MS = 8000;
const REPUBLISH_STUCK_AFTER = 4;

export default function BasketballCamPage() {
  const { roomId } = useParams();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('connect');
  const [role, setRole] = useState<BbCamRole | null>(null);
  const [name, setName] = useState('');
  const [connected, setConnected] = useState(false);
  const [roomStatus, setRoomStatus] = useState<'loading' | 'ok' | 'not-found'>(
    'loading',
  );
  const [wsDbg, setWsDbg] = useState('');
  const [bbState, setBbState] = useState<BbStateEvent | null>(null);
  const [rim, setRim] = useState<BbRim | null>(null);
  const [ball, setBall] = useState<BbBallEvent | null>(null);
  const [warmupFlash, setWarmupFlash] = useState(false);

  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [fileMode, setFileMode] = useState(false);
  const [filePlaying, setFilePlaying] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);
  const [wantsCam, setWantsCam] = useState(false);
  const [publishStuck, setPublishStuck] = useState(false);
  const [needsSource, setNeedsSource] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const sessionRef = useRef<CamSession>({});
  const resumeRef = useRef<'no' | 'pending' | 'done'>('no');
  const republishDelayRef = useRef(1000);
  const republishTimerRef = useRef<number | null>(null);
  const republishAttemptsRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const roleRef = useRef<BbCamRole | null>(null);
  const nameRef = useRef('');
  const facingRef = useRef<'user' | 'environment'>('environment');
  const camStreamRef = useRef<MediaStream | null>(null);
  const fileCamRef = useRef<FileCamera | null>(null);
  const stripFileRef = useRef<HTMLInputElement>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const camCodecRef = useRef<'h264' | 'vp8'>('h264');
  const stepRef = useRef<Step>('connect');
  stepRef.current = step;
  roleRef.current = role;
  nameRef.current = name;
  facingRef.current = facing;

  const saveSession = useCallback(
    (patch: Partial<CamSession>) => {
      sessionRef.current = { ...sessionRef.current, ...patch };
      writeCamSession(String(roomId), sessionRef.current);
    },
    [roomId],
  );

  useWhipHeartbeat(String(roomId), camInputId, camOn && live);
  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);
  const sendFps = usePublishWatchdog(live, camPcRef, setCamErr);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current != null)
      window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 4000);
  }, []);

  // ── Camera ────────────────────────────────────────────────────────────────

  const enableCamera = useCallback(
    async (nextFacing?: 'user' | 'environment') => {
      const facingMode = nextFacing ?? facingRef.current;
      try {
        fileCamRef.current?.dispose();
        fileCamRef.current = null;
        setFileMode(false);
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        // Landscape 16:9 at the highest common size — a small ball needs pixels.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        camStreamRef.current = stream;
        camCodecRef.current = 'h264';
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (camStreamRef.current === stream && wantsCamRef.current) {
            scheduleRepublishRef.current?.();
          }
        });
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setNeedsSource(false);
        saveSession({ usedFile: false });
        if (nextFacing) setFacing(nextFacing);
      } catch {
        setCamErr(
          'CAMERA BLOCKED — allow camera access for this site (HTTPS required) and try again.',
        );
        setCamOn(false);
      }
    },
    [saveSession, syncPreviews],
  );

  const flipCamera = useCallback(() => {
    void enableCamera(facingRef.current === 'user' ? 'environment' : 'user');
  }, [enableCamera]);

  const enableFileCamera = useCallback(
    async (file: File) => {
      try {
        fileCamRef.current?.dispose();
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const cam = await createFileCamera(file);
        fileCamRef.current = cam;
        camStreamRef.current = cam.stream;
        camCodecRef.current = 'vp8';
        cam.video.addEventListener('play', () => setFilePlaying(true));
        cam.video.addEventListener('pause', () => setFilePlaying(false));
        setFilePlaying(!cam.video.paused);
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setFileMode(true);
        setNeedsSource(false);
        saveSession({ usedFile: true });
        setFacing('environment');
      } catch {
        setCamErr('COULD NOT PLAY THAT FILE — try an .mp4 (H.264).');
      }
    },
    [saveSession, syncPreviews],
  );

  const sendCamRequest = useCallback((ws: WebSocket) => {
    const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    const width = settings?.width || fileCamRef.current?.width;
    const height = settings?.height || fileCamRef.current?.height;
    ws.send(
      JSON.stringify({
        type: 'bb_cam_request',
        ...(width && height
          ? { nativeWidth: width, nativeHeight: height }
          : {}),
      }),
    );
  }, []);
  const sendCamRequestRef = useRef(sendCamRequest);
  sendCamRequestRef.current = sendCamRequest;

  const requestCamSilent = useCallback(() => {
    wantsCamRef.current = true;
    setWantsCam(true);
    setPublishing(true);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) sendCamRequest(ws);
  }, [sendCamRequest]);

  const requestCam = useCallback(() => {
    requestCamSilent();
    saveSession({ wantsCam: true });
  }, [requestCamSilent, saveSession]);

  const scheduleRepublishRef = useRef<(() => void) | null>(null);
  const scheduleRepublish = useCallback(() => {
    if (!wantsCamRef.current || closedByUsRef.current) return;
    if (republishTimerRef.current != null) return;
    setLive(false);
    const delay = republishDelayRef.current;
    republishDelayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    republishAttemptsRef.current += 1;
    if (republishAttemptsRef.current > REPUBLISH_STUCK_AFTER)
      setPublishStuck(true);
    republishTimerRef.current = window.setTimeout(() => {
      republishTimerRef.current = null;
      if (!wantsCamRef.current || camPcRef.current != null) return;
      const track = camStreamRef.current?.getVideoTracks()[0];
      const streamDead = !track || track.readyState === 'ended';
      const fire = () => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) requestCamSilent();
        else scheduleRepublishRef.current?.();
      };
      if (streamDead && !fileCamRef.current) {
        void enableCamera(facingRef.current).then(() => {
          const t = camStreamRef.current?.getVideoTracks()[0];
          if (t && t.readyState === 'live') fire();
          else scheduleRepublishRef.current?.();
        });
      } else {
        fire();
      }
    }, delay);
  }, [enableCamera, requestCamSilent]);
  scheduleRepublishRef.current = scheduleRepublish;

  const toggleFilePlayback = useCallback(() => {
    const v = fileCamRef.current?.video;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);
  const restartFile = useCallback(() => {
    const v = fileCamRef.current?.video;
    if (!v) return;
    v.currentTime = 0;
    void v.play();
  }, []);

  const swapPublish = useCallback(() => {
    if (!wantsCamRef.current) return;
    republishAttemptsRef.current = 0;
    republishDelayRef.current = 1000;
    setPublishStuck(false);
    requestCam();
  }, [requestCam]);
  const swapToFile = useCallback(
    async (file: File) => {
      await enableFileCamera(file);
      const t = camStreamRef.current?.getVideoTracks()[0];
      if (t?.readyState === 'live') swapPublish();
    },
    [enableFileCamera, swapPublish],
  );
  const swapToCamera = useCallback(async () => {
    await enableCamera();
    const t = camStreamRef.current?.getVideoTracks()[0];
    if (t?.readyState === 'live') swapPublish();
  }, [enableCamera, swapPublish]);

  const stopCamera = useCallback(() => {
    wantsCamRef.current = false;
    setWantsCam(false);
    saveSession({ wantsCam: false });
    camPcRef.current?.close();
    camPcRef.current = null;
    setLive(false);
    setPublishing(false);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'bb_cam_stop' }));
    setStep('camera');
  }, [saveSession]);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const sendJoin = useCallback((ws: WebSocket) => {
    const r = roleRef.current;
    if (!r) return;
    ws.send(
      JSON.stringify({
        type: 'bb_cam_join',
        role: r,
        name:
          nameRef.current.trim() || (r === 'hoop' ? 'Hoop cam' : 'Court cam'),
        ...(sessionRef.current.camKey
          ? { camKey: sessionRef.current.camKey }
          : {}),
      }),
    );
  }, []);

  const routeResume = useCallback(
    (event: BbCamJoinedEvent) => {
      const sess = sessionRef.current;
      setRim(event.rim);
      if (sess.wantsCam) {
        wantsCamRef.current = true;
        setWantsCam(true);
        if (sess.usedFile) {
          setNeedsSource(true);
        } else {
          void enableCamera(facingRef.current).then(() => {
            const t = camStreamRef.current?.getVideoTracks()[0];
            if (t && t.readyState === 'live') requestCamSilent();
          });
        }
        setStep(event.role === 'hoop' && !event.rim ? 'calibrate' : 'live');
      } else {
        setStep('camera');
      }
    },
    [enableCamera, requestCamSilent],
  );

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'bb_state':
          setBbState(event);
          if (roleRef.current === 'hoop') setRim(event.config.rim);
          break;
        case 'bb_cam_joined': {
          wantsJoinRef.current = true;
          saveSession({
            camKey: event.camKey,
            role: event.role,
            name: event.name,
          });
          if (resumeRef.current === 'pending') {
            resumeRef.current = 'done';
            routeResume(event);
          }
          break;
        }
        case 'bb_error':
          showNotice(event.message);
          if (event.code === 'role_taken') setStep('role');
          break;
        case 'bb_ball':
          setBall(event);
          break;
        case 'bb_shot':
          if (event.kind === 'warmup' && roleRef.current === 'hoop') {
            setWarmupFlash(true);
            window.setTimeout(() => setWarmupFlash(false), 1500);
            if (navigator.vibrate) navigator.vibrate(60);
          }
          break;
        case 'bb_cam_offer': {
          if (event.role === 'commentator') return;
          if (!wantsCamRef.current || !camStreamRef.current) return;
          camPcRef.current?.close();
          camPcRef.current = null;
          setCamInputId(event.inputId);
          void startPublish(
            event.inputId,
            event.bearerToken,
            resolveMediaUrl(event.whipUrl),
            camPcRef,
            camStreamRef,
            () => {
              camPcRef.current = null;
              setLive(false);
              scheduleRepublishRef.current?.();
            },
            facingRef.current,
            false,
            camStreamRef.current,
            camCodecRef.current,
          )
            .then(() => {
              setLive(true);
              setPublishing(false);
              setCamErr(null);
              republishDelayRef.current = 1000;
              republishAttemptsRef.current = 0;
              setPublishStuck(false);
            })
            .catch(() => {
              camPcRef.current = null;
              setLive(false);
              setPublishing(false);
              setCamErr('PUBLISH FAILED — check the connection and try again.');
              scheduleRepublishRef.current?.();
            });
          break;
        }
        default:
          break;
      }
    },
    [routeResume, saveSession, showNotice],
  );
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const connectWs = useCallback(() => {
    const base = toWsUrl(
      getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        remoteOrigin() ??
        getEffectiveClientServerUrl(),
    );
    const url = `${base}/room/${encodeURIComponent(String(roomId))}/ws`;
    setWsDbg(`connecting: ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setWsDbg('');
      reconnectDelayRef.current = 1000;
      ws.send(JSON.stringify({ type: 'bb_spectate' }));
      if (wantsJoinRef.current || resumeRef.current === 'pending') {
        sendJoin(ws);
        if (wantsCamRef.current && camStreamRef.current) {
          if (republishTimerRef.current != null) {
            window.clearTimeout(republishTimerRef.current);
            republishTimerRef.current = null;
          }
          sendCamRequestRef.current(ws);
        }
      }
    };
    ws.onerror = () => setWsDbg(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      setWsDbg(`WS closed (${ev.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        if (!closedByUsRef.current && wsRef.current === ws) connectWs();
      }, delay);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (data && typeof data === 'object' && 'type' in data) {
        handleEventRef.current(data as RoomEvent);
      }
    };
  }, [roomId, sendJoin]);

  useEffect(() => {
    applyServerUrlFromQueryParam(searchParams.get('server'));
    const session = readCamSession(String(roomId));
    sessionRef.current = session;
    const urlRole = searchParams.get('role');
    const initialRole: BbCamRole | null =
      urlRole === 'hoop' || urlRole === 'court'
        ? urlRole
        : (session.role ?? null);
    setRole(initialRole);
    roleRef.current = initialRole;
    setName(session.name ?? '');
    if (session.camKey && initialRole) resumeRef.current = 'pending';
    void getRoomInfo(String(roomId)).then((info) => {
      setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
    });
    closedByUsRef.current = false;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      camPcRef.current?.close();
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      fileCamRef.current?.dispose();
      if (republishTimerRef.current != null)
        window.clearTimeout(republishTimerRef.current);
      if (noticeTimerRef.current != null)
        window.clearTimeout(noticeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep(role ? 'name' : 'role');
    }
  }, [step, connected, roomStatus, role]);

  const join = useCallback(() => {
    wantsJoinRef.current = true;
    saveSession({
      name: nameRef.current.trim(),
      role: roleRef.current ?? undefined,
    });
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) sendJoin(ws);
    setStep('camera');
  }, [saveSession, sendJoin]);

  const calibrate = useCallback(
    (r: BbRim) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'bb_rim_calibrate', rim: r }));
      }
      setRim(r);
      saveSession({ rim: r });
      setStep('live');
    },
    [saveSession],
  );

  const sampleColor = useCallback(
    (team: BbTeamId, hex: string) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'bb_team_color', team, color: hex }));
      }
      showNotice(`TEAM ${team} COLOUR SET TO ${hex.toUpperCase()}`);
    },
    [showNotice],
  );

  const retryConnect = useCallback(() => {
    setWsDbg('');
    closedByUsRef.current = false;
    wsRef.current?.close();
    if (roomStatus !== 'ok') {
      setRoomStatus('loading');
      void getRoomInfo(String(roomId)).then((info) => {
        setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
      });
    }
    connectWs();
  }, [roomId, roomStatus, connectWs]);

  const retryPublishNow = () => {
    republishAttemptsRef.current = 0;
    republishDelayRef.current = 1000;
    setPublishStuck(false);
    requestCam();
  };

  const fontClass = `${bigShoulders.variable} ${plexMono.variable}`;
  const statusStrip =
    step === 'connect' ? null : !connected ? (
      <KbtStatusStrip text='RECONNECTING…' />
    ) : notice ? (
      <KbtStatusStrip text={notice} />
    ) : needsSource ? (
      <>
        <input
          ref={stripFileRef}
          type='file'
          accept='video/*'
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void swapToFile(file);
          }}
        />
        <KbtStatusStrip
          text='VIDEO OFF — TAP TO PICK YOUR RECORDING'
          tone='bad'
          onTap={() => stripFileRef.current?.click()}
        />
      </>
    ) : publishStuck ? (
      <KbtStatusStrip
        text='VIDEO DOWN — TAP TO RETRY'
        tone='bad'
        onTap={retryPublishNow}
      />
    ) : wantsCam && !live ? (
      <KbtStatusStrip text='RESTORING VIDEO…' />
    ) : null;

  if (step === 'live' && role) {
    return (
      <div className={fontClass}>
        {statusStrip}
        <CamLiveHud
          role={role}
          name={name || (role === 'hoop' ? 'Hoop cam' : 'Court cam')}
          state={bbState}
          rim={rim}
          ball={ball}
          live={live}
          sendFps={sendFps}
          fileMode={fileMode}
          filePlaying={filePlaying}
          onToggleFile={toggleFilePlayback}
          onRestartFile={restartFile}
          attachVideo={attachPreview}
          warmupFlash={warmupFlash}
          onRecalibrate={() => setStep('calibrate')}
          onSampleColor={sampleColor}
          onStop={stopCamera}
        />
      </div>
    );
  }

  const meta = STEP_META[step as Exclude<Step, 'live'>];
  return (
    <div className={fontClass}>
      {statusStrip}
      <KbtPhoneShell
        title='BLACKTOP'
        stepIndex={meta.index}
        stepCount={Object.keys(STEP_META).length}
        stepLabel={meta.label}>
        {step === 'connect' ? (
          <KbtConnectStep
            roomStatus={roomStatus}
            wsConnected={connected}
            wsError={wsDbg}
            onRetry={retryConnect}
          />
        ) : step === 'role' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              justifyContent: 'center',
              flex: 1,
            }}>
            <Plate
              cutPx={14}
              innerStyle={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
              <Label size={10}>WHICH CAMERA IS THIS PHONE?</Label>
              <div
                style={{
                  fontFamily: kbtMonoFont,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: KBT.dim,
                }}>
                The hoop camera runs the AI referee and must stay put on a
                tripod. The court camera is the wide picture viewers watch.
              </div>
            </Plate>
            <KbtButton
              block
              active
              label='HOOP CAM'
              sub='on the rim · runs the AI'
              onClick={() => {
                setRole('hoop');
                roleRef.current = 'hoop';
                setStep('name');
              }}
            />
            <KbtButton
              block
              label='COURT CAM'
              sub='wide on the court'
              onClick={() => {
                setRole('court');
                roleRef.current = 'court';
                setStep('name');
              }}
            />
          </div>
        ) : step === 'name' ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              justifyContent: 'center',
              flex: 1,
            }}>
            <Plate
              cutPx={14}
              innerStyle={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                padding: '18px 16px',
              }}>
              <Label size={10}>
                {role === 'hoop' ? 'HOOP CAM' : 'COURT CAM'} · OPERATOR NAME
                (OPTIONAL)
              </Label>
              <KbtTextInput
                value={name}
                onChange={setName}
                placeholder={
                  role === 'hoop' ? 'E.G. RIM PHONE' : 'E.G. BASELINE'
                }
                maxLength={20}
                autoCapitalize='characters'
              />
              <div
                style={{
                  fontFamily: kbtMonoFont,
                  fontSize: 11,
                  lineHeight: 1.6,
                  color: KBT.dim,
                }}>
                Shows in the lobby so the crew knows which phone is which.
              </div>
            </Plate>
            <KbtButton block active label='CLAIM THIS CAMERA' onClick={join} />
            <KbtButton
              block
              variant='outline'
              label='CHANGE ROLE'
              onClick={() => setStep('role')}
            />
          </div>
        ) : step === 'camera' && role ? (
          <FixedCamStep
            role={role}
            camOn={camOn}
            camErr={camErr}
            fileMode={fileMode}
            filePlaying={filePlaying}
            onToggleFile={toggleFilePlayback}
            onRestartFile={restartFile}
            sendFps={sendFps}
            publishing={publishing}
            live={live}
            attachVideo={attachPreview}
            onEnable={() => void enableCamera()}
            onUseFile={(f) => void swapToFile(f)}
            onUseCamera={() => void swapToCamera()}
            onFlip={flipCamera}
            onGoLive={requestCam}
            onContinue={() => setStep(role === 'hoop' ? 'calibrate' : 'live')}
          />
        ) : step === 'calibrate' ? (
          <RimCalibrator
            attachVideo={attachPreview}
            initial={rim ?? sessionRef.current.rim ?? null}
            onCalibrate={calibrate}
            onSkip={rim ? () => setStep('live') : undefined}
          />
        ) : null}
      </KbtPhoneShell>
    </div>
  );
}
