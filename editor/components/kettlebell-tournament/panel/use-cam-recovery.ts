'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommentatorRig } from './use-commentator-rig';
import type { PanelSocket } from './use-panel-socket';

const REPUBLISH_MAX_MS = 8000;
/** How long the server must keep reporting the cam down — while the rig
 * still believes its publish is live — before recovery forces a fresh
 * publish. Covers the reaped-input case, where the local peer connection can
 * look healthy long after the server dropped the input. */
const SERVER_DIVERGENCE_MS = 10_000;
const DIVERGENCE_POLL_MS = 2000;

export type CamRecovery = {
  /** A republish is pending/running — surface RESTORING VIDEO… in the UI. */
  restoring: boolean;
  /** GO LIVE was pressed: from here on a dead publish self-heals. */
  markWanted: () => void;
  /** Manual escape hatch: tear down and re-arm the whole camera path now. */
  restartCamera: () => void;
};

/**
 * Desktop self-heal for the commentator publish, ported from the phone
 * commentate page's scheduleRepublish (1s→8s backoff, single-flight): a dead
 * peer connection, an ended camera track, or a server that reaped the input
 * re-arms the camera automatically instead of leaving the broadcast without
 * the caster until a page refresh.
 */
export function useCamRecovery(
  rig: CommentatorRig,
  socket: PanelSocket,
): CamRecovery {
  const [restoring, setRestoring] = useState(false);
  const wantsCamRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const delayRef = useRef(1000);
  const divergedAtRef = useRef<number | null>(null);

  // The hooks return fresh objects every render; timers must read the
  // current ones, not the closure's.
  const rigRef = useRef(rig);
  rigRef.current = rig;
  const socketRef = useRef(socket);
  socketRef.current = socket;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleRepublishRef = useRef<(() => void) | null>(null);
  const scheduleRepublish = useCallback(() => {
    if (!wantsCamRef.current) return;
    if (timerRef.current != null) return;
    setRestoring(true);
    const delay = delayRef.current;
    delayRef.current = Math.min(REPUBLISH_MAX_MS, delay * 2);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const r = rigRef.current;
      if (!wantsCamRef.current || r.hasActivePc()) return;
      const fire = () => {
        const s = socketRef.current;
        if (s.connected) {
          r.markPublishing();
          s.requestCam();
        } else {
          // The socket re-arms the cam itself on reconnect (ws.onopen);
          // keep a backstop in case that races or the WS stays down.
          scheduleRepublishRef.current?.();
        }
      };
      if (!r.hasLiveTrack()) {
        void r.enableCamera().then(() => {
          if (rigRef.current.hasLiveTrack()) fire();
          else scheduleRepublishRef.current?.();
        });
      } else {
        fire();
      }
    }, delay);
  }, []);
  scheduleRepublishRef.current = scheduleRepublish;

  // Trigger 1: the rig says the publish died (pc failed/closed, publish POST
  // failed, camera track ended).
  const { setOnPublishDead } = rig;
  useEffect(() => {
    setOnPublishDead(() => scheduleRepublishRef.current?.());
    return () => setOnPublishDead(null);
  }, [setOnPublishDead]);

  // Publish back up: stand down and reset the backoff.
  useEffect(() => {
    if (!rig.live) return;
    clearTimer();
    delayRef.current = 1000;
    divergedAtRef.current = null;
    setRestoring(false);
  }, [rig.live, clearTimer]);

  // Socket reconnected: its onopen already re-sent join + cam request, so a
  // pending republish would only race it — cancel and let that path land.
  useEffect(() => {
    if (!socket.connected) return;
    clearTimer();
    delayRef.current = 1000;
  }, [socket.connected, clearTimer]);

  // Trigger 2: server divergence. The server has declared the cam down
  // (camConnected false — e.g. the stale sweep reaped the input) while the
  // rig still holds a "live" publish, sustained for SERVER_DIVERGENCE_MS.
  // Tear the publish down ourselves and go through the normal republish
  // path for a fresh input.
  useEffect(() => {
    const poll = window.setInterval(() => {
      const r = rigRef.current;
      const s = socketRef.current;
      const diverged =
        wantsCamRef.current &&
        r.live &&
        !r.publishing &&
        s.connected &&
        s.state?.commentator?.camConnected === false;
      if (!diverged) {
        divergedAtRef.current = null;
        return;
      }
      const now = Date.now();
      if (divergedAtRef.current == null) {
        divergedAtRef.current = now;
        return;
      }
      if (
        now - divergedAtRef.current >= SERVER_DIVERGENCE_MS &&
        timerRef.current == null
      ) {
        divergedAtRef.current = null;
        r.closePublish();
        scheduleRepublishRef.current?.();
      }
    }, DIVERGENCE_POLL_MS);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const markWanted = useCallback(() => {
    wantsCamRef.current = true;
  }, []);

  const restartCamera = useCallback(() => {
    wantsCamRef.current = true;
    clearTimer();
    delayRef.current = 1000;
    divergedAtRef.current = null;
    setRestoring(true);
    const r = rigRef.current;
    r.closePublish();
    r.markPublishing();
    void r.enableCamera().then(() => {
      if (rigRef.current.hasLiveTrack()) socketRef.current.requestCam();
      else scheduleRepublishRef.current?.();
    });
  }, [clearTimer]);

  return { restoring, markWanted, restartCamera };
}
