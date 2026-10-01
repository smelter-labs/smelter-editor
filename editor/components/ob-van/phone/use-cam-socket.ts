'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  OB_MAX_CAMS,
  WS_CLOSE_ROOM_NOT_FOUND,
  type ObCamJoinMessage,
  type ObCamRole,
  type ObClientMessage,
  type ObTally,
  type RoomEvent,
} from '@smelter-editor/types';
import { getRoomInfo } from '@/app/actions/actions';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import { usePublishWatchdog } from '@/components/kettlebell-tournament/phone/use-publish-watchdog';
import {
  applyServerUrlFromQueryParam,
  getEffectiveClientServerUrl,
  getPublicDefaultServerUrl,
  getStoredClientServerUrl,
  remoteOrigin,
  resolveMediaUrl,
  toWsUrl,
} from '@/lib/server-url';
import {
  type CamSession,
  clearCamSession,
  readCamSession,
  writeCamSession,
} from './cam-session';
import { useCamMedia } from './use-cam-media';

export type CamStep = 'connect' | 'setup' | 'rig' | 'live';
export type RoomStatus = 'loading' | 'ok' | 'not-found' | 'unreachable';

export type CamJoinInfo = {
  name: string;
  role: ObCamRole;
  talent: string | null;
};

/** The seat as the server confirmed it (ob_cam_joined). */
export type CamSeat = CamJoinInfo & { camId: string; number: number };

const RECONNECT_MAX_MS = 8000;
const REPUBLISH_MAX_MS = 8000;
const NOTICE_MS = 4000;

function send(ws: WebSocket | null, msg: ObClientMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

/**
 * The camera phone's control-socket + WHIP machine, ported from the KBT
 * commentate page: WS with backoff, seat join/resume by camKey, GO LIVE →
 * ob_cam_offer → WHIP publish, a republish watchdog (1 s → 8 s) and the
 * iOS track-ended self-heal. Phones get unicast events only (no spectate).
 */
export function useCamSocket(roomId: string, serverParam: string | null) {
  const [step, setStep] = useState<CamStep>('connect');
  const [connected, setConnected] = useState(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('loading');
  const [wsDbg, setWsDbg] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [seat, setSeat] = useState<CamSeat | null>(null);
  const [tally, setTally] = useState<ObTally | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [wantsCam, setWantsCam] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const closedByUsRef = useRef(false);
  const roomGoneRef = useRef(false);
  const wantsJoinRef = useRef(false);
  const wantsCamRef = useRef(false);
  const joinInfoRef = useRef<CamJoinInfo | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const sessionRef = useRef<CamSession>({});
  const resumeRef = useRef<'no' | 'pending' | 'done'>('no');
  const republishDelayRef = useRef(1000);
  const republishTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const scheduleRepublishRef = useRef<(() => void) | null>(null);
  /** Bumped per publish attempt; stale pc callbacks compare and bail. */
  const publishSeqRef = useRef(0);

  const media = useCamMedia(() => scheduleRepublishRef.current?.());
  const { camStreamRef, facingRef, enableCamera, setCamErr, stopCamera } =
    media;

  // Keeps the stream published server-side (ack every 5s, wake lock).
  // Gated on `live` so a dead publish stops acking and the server can see it.
  useWhipHeartbeat(roomId, camInputId, media.camOn && live);
  // Flags a transport that never carries media (e.g. 5G + no TURN).
  const sendFps = usePublishWatchdog(live, camPcRef, setCamErr);

  const saveSession = useCallback(
    (patch: Partial<CamSession>) => {
      sessionRef.current = writeCamSession(roomId, patch);
    },
    [roomId],
  );

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current != null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setNotice(null);
    }, NOTICE_MS);
  }, []);

  const setWants = useCallback((v: boolean) => {
    wantsCamRef.current = v;
    setWantsCam(v);
  }, []);

  const clearRepublishTimer = useCallback(() => {
    if (republishTimerRef.current != null) {
      window.clearTimeout(republishTimerRef.current);
      republishTimerRef.current = null;
    }
  }, []);

  /** Close the publish pc without triggering the self-heal. */
  const closePublish = useCallback(() => {
    clearRepublishTimer();
    publishSeqRef.current += 1;
    const pc = camPcRef.current;
    camPcRef.current = null;
    pc?.close();
    setLive(false);
    setPublishing(false);
    setCamInputId(null);
  }, [clearRepublishTimer]);

  const joinMessage = useCallback((): ObCamJoinMessage | null => {
    const sess = sessionRef.current;
    const info =
      joinInfoRef.current ??
      (sess.name != null && sess.role
        ? { name: sess.name, role: sess.role, talent: sess.talent ?? null }
        : null);
    if (!info) return null;
    return {
      type: 'ob_cam_join',
      name: info.name,
      role: info.role,
      talent: info.talent,
      ...(sess.camKey ? { camKey: sess.camKey } : {}),
    };
  }, []);

  const sendCamRequest = useCallback(
    (ws: WebSocket | null) => {
      const settings = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
      return send(ws, {
        type: 'ob_cam_request',
        ...(settings?.width && settings?.height
          ? { nativeWidth: settings.width, nativeHeight: settings.height }
          : {}),
      });
    },
    [camStreamRef],
  );

  const requestCamSilent = useCallback(() => {
    setWants(true);
    setPublishing(true);
    sendCamRequest(wsRef.current);
  }, [sendCamRequest, setWants]);

  /** Self-heal a dead publish while the control socket is fine (1s→8s). */
  const scheduleRepublish = useCallback(() => {
    if (!wantsCamRef.current || closedByUsRef.current) return;
    if (republishTimerRef.current != null) return;
    setLive(false);
    const delay = republishDelayRef.current;
    republishDelayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    republishTimerRef.current = window.setTimeout(() => {
      republishTimerRef.current = null;
      if (!wantsCamRef.current || camPcRef.current != null) return;
      const track = camStreamRef.current?.getVideoTracks()[0];
      const streamDead = !track || track.readyState === 'ended';
      const fire = () => {
        if (wsRef.current?.readyState === WebSocket.OPEN) requestCamSilent();
        else scheduleRepublishRef.current?.();
      };
      if (streamDead) {
        void enableCamera(facingRef.current).then((ok) => {
          if (ok) fire();
          else scheduleRepublishRef.current?.();
        });
      } else {
        fire();
      }
    }, delay);
  }, [camStreamRef, enableCamera, facingRef, requestCamSilent]);
  scheduleRepublishRef.current = scheduleRepublish;

  // ── Events ────────────────────────────────────────────────────────────────

  /** The seat is gone (kicked, expired) or refused: back to the form. */
  const dropSeat = useCallback(() => {
    wantsJoinRef.current = false;
    resumeRef.current = 'no';
    setWants(false);
    closePublish();
    stopCamera();
    saveSession({ camKey: undefined, wantsCam: false });
    setSeat(null);
    setTally(null);
    setStep('setup');
  }, [closePublish, saveSession, setWants, stopCamera]);

  const roomGone = useCallback(() => {
    roomGoneRef.current = true;
    wantsJoinRef.current = false;
    setWants(false);
    closePublish();
    stopCamera();
    setRoomStatus('not-found');
    setStep('connect');
  }, [closePublish, setWants, stopCamera]);

  /** Refresh resume, driven by the server's ob_cam_joined. */
  const routeResume = useCallback(() => {
    if (sessionRef.current.wantsCam) {
      setWants(true);
      void enableCamera(sessionRef.current.facing).then((ok) => {
        if (ok) requestCamSilent();
      });
    }
    // The rig→live effect advances on its own once the publish is up.
    setStep('rig');
  }, [enableCamera, requestCamSilent, setWants]);

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      switch (event.type) {
        case 'ob_cam_joined': {
          wantsJoinRef.current = true;
          const info: CamJoinInfo = {
            name: event.name,
            role: event.role,
            talent: event.talent,
          };
          joinInfoRef.current = info;
          setRoomStatus('ok');
          setSeat({ ...info, camId: event.camId, number: event.number });
          setTally(event.tally);
          saveSession({
            camKey: event.camKey,
            name: event.name,
            role: event.role,
            talent: event.talent ?? undefined,
          });
          if (resumeRef.current === 'pending') {
            resumeRef.current = 'done';
            routeResume();
          }
          break;
        }
        case 'ob_tally':
          setTally(event.tally);
          setSeat((prev) => (prev ? { ...prev, number: event.number } : prev));
          break;
        case 'ob_error':
          if (event.code === 'unknown_cam' || event.code === 'not_joined') {
            dropSeat();
            showNotice('Camera seat gone — join again');
          } else if (event.code === 'room_full') {
            dropSeat();
            showNotice(`All ${OB_MAX_CAMS} camera seats are taken`);
          } else {
            showNotice(event.message);
          }
          break;
        case 'ob_cam_offer': {
          if (!wantsCamRef.current || !camStreamRef.current) return;
          const token = ++publishSeqRef.current;
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
              // A pc we already replaced or closed on purpose.
              if (publishSeqRef.current !== token) return;
              camPcRef.current = null;
              setLive(false);
              scheduleRepublishRef.current?.();
            },
            facingRef.current,
            false,
            camStreamRef.current,
            'h264',
          )
            .then(() => {
              if (publishSeqRef.current !== token) return;
              setLive(true);
              setPublishing(false);
              setCamErr(null);
              republishDelayRef.current = 1000;
            })
            .catch(() => {
              if (publishSeqRef.current !== token) return;
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
    [
      camStreamRef,
      dropSeat,
      facingRef,
      routeResume,
      saveSession,
      setCamErr,
      showNotice,
    ],
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;
  const roomGoneCbRef = useRef(roomGone);
  roomGoneCbRef.current = roomGone;

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    const base = toWsUrl(
      getStoredClientServerUrl() ??
        getPublicDefaultServerUrl() ??
        remoteOrigin() ??
        getEffectiveClientServerUrl(),
    );
    const url = `${base}/room/${encodeURIComponent(roomId)}/ws`;
    setWsDbg(`connecting: ${url}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      setWsDbg('');
      reconnectDelayRef.current = 1000;
      // A reconnect minted a fresh clientId: re-join (the camKey adopts the
      // seat) and re-arm the camera with a fresh input.
      if (wantsJoinRef.current || resumeRef.current === 'pending') {
        const join = joinMessage();
        if (join) send(ws, join);
        if (wantsCamRef.current && camStreamRef.current) {
          clearRepublishTimer();
          sendCamRequest(ws);
        }
      }
    };
    ws.onerror = () => setWsDbg(`WS error: ${url}`);
    ws.onclose = (ev) => {
      setConnected(false);
      if (closedByUsRef.current) return;
      if (ev.code === WS_CLOSE_ROOM_NOT_FOUND || roomGoneRef.current) {
        // The room is gone (deleted/GC'd) — reconnecting is pointless.
        setWsDbg(`room not found — ${url}`);
        roomGoneCbRef.current();
        return;
      }
      setWsDbg(`WS closed (${ev.code}) — retrying…`);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(RECONNECT_MAX_MS, delay * 2);
      window.setTimeout(() => {
        // The identity check keeps two sockets from racing after a manual
        // retry already replaced wsRef.
        if (!closedByUsRef.current && wsRef.current === ws) connectWs();
      }, delay);
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      if (data.type === 'room_error') {
        roomGoneCbRef.current();
        return;
      }
      handleEventRef.current(data as RoomEvent);
    };
  }, [roomId, joinMessage, camStreamRef, clearRepublishTimer, sendCamRequest]);

  const checkRoom = useCallback(() => {
    setRoomStatus('loading');
    void getRoomInfo(roomId)
      .then((info) => {
        setRoomStatus(info && info !== 'not-found' ? 'ok' : 'not-found');
      })
      .catch(() => setRoomStatus('unreachable'));
  }, [roomId]);

  /** The stored session, once read on mount (the form prefills from it). */
  const [restored, setRestored] = useState<CamSession | null>(null);

  useEffect(() => {
    applyServerUrlFromQueryParam(serverParam);
    if (!roomId) {
      setRoomStatus('not-found');
      setRestored({});
      return;
    }
    const session = readCamSession(roomId);
    sessionRef.current = session;
    setRestored(session);
    if (session.facing) media.presetFacing(session.facing);
    if (session.camKey) resumeRef.current = 'pending';
    checkRoom();
    // Re-arm after a StrictMode unmount/remount — the cleanup below set the
    // flag, and without the reset auto-reconnect would stay off for good.
    closedByUsRef.current = false;
    connectWs();
    return () => {
      closedByUsRef.current = true;
      wsRef.current?.close();
      publishSeqRef.current += 1;
      camPcRef.current?.close();
      camPcRef.current = null;
      stopCamera();
      clearRepublishTimer();
      if (noticeTimerRef.current != null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (step === 'connect' && connected && roomStatus === 'ok') {
      setStep('setup');
    }
  }, [step, connected, roomStatus]);

  // GO LIVE lands on the tally screen once the publish is up.
  useEffect(() => {
    if (step === 'rig' && live) setStep('live');
  }, [step, live]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const join = useCallback(
    (info: CamJoinInfo) => {
      joinInfoRef.current = info;
      saveSession({
        name: info.name,
        role: info.role,
        talent: info.talent ?? undefined,
      });
      wantsJoinRef.current = true;
      const msg = joinMessage();
      if (msg) send(wsRef.current, msg);
      setStep('rig');
    },
    [joinMessage, saveSession],
  );

  const requestCam = useCallback(() => {
    requestCamSilent();
    saveSession({ wantsCam: true, facing: facingRef.current });
  }, [facingRef, requestCamSilent, saveSession]);

  /** Stop publishing on purpose; the camera stays on for re-framing. */
  const stopVideo = useCallback(() => {
    send(wsRef.current, { type: 'ob_cam_stop' });
    setWants(false);
    closePublish();
    saveSession({ wantsCam: false });
    setStep('rig');
  }, [closePublish, saveSession, setWants]);

  const leave = useCallback(() => {
    send(wsRef.current, { type: 'ob_cam_leave' });
    wantsJoinRef.current = false;
    resumeRef.current = 'no';
    joinInfoRef.current = null;
    setWants(false);
    closePublish();
    stopCamera();
    clearCamSession(roomId);
    sessionRef.current = {};
    setSeat(null);
    setTally(null);
    setStep('setup');
  }, [closePublish, roomId, setWants, stopCamera]);

  const editSeat = useCallback(() => setStep('setup'), []);

  const retryConnect = useCallback(() => {
    if (!roomId) return;
    setWsDbg('');
    roomGoneRef.current = false;
    closedByUsRef.current = false;
    wsRef.current?.close();
    if (roomStatus !== 'ok') checkRoom();
    connectWs();
  }, [roomId, roomStatus, checkRoom, connectWs]);

  return {
    step,
    connected,
    roomStatus,
    wsDbg,
    notice,
    seat,
    tally,
    publishing,
    live,
    wantsCam,
    sendFps,
    restored,
    media,
    join,
    requestCam,
    stopVideo,
    leave,
    editSeat,
    retryConnect,
  };
}

export type CamSocket = ReturnType<typeof useCamSocket>;
