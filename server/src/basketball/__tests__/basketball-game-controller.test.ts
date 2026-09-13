import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import type { BbHudState } from '../../app/store';
import {
  BasketballGameController,
  type BbFileClock,
} from '../BasketballGameController';

const ROOM = 'room-bb';
const HOLD = 3000;

function harness(opts?: { withLiveness?: boolean; withClipCut?: boolean }) {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const aiCalls: {
    inputId: string;
    enabled: boolean;
    params?: Record<string, number | string>;
  }[] = [];
  const layouts: { inputId: string; x: number; y: number; width: number }[][] =
    [];
  const hudApplies: (BbHudState | null)[] = [];
  const qrCalls: string[] = [];
  const replayRequests: { inputId: string; shotId: string; t?: number }[] = [];
  const replayClips: { file: string; offsetMs: number; inputId: string }[] = [];
  const replayUnregisters: string[] = [];
  const connected = new Set<string>();
  const live = new Set<string>();
  // Playhead anchors of file cams (RoomState derives them from the engine).
  const fileClocks = new Map<string, BbFileClock>();
  const resyncs: number[] = [];
  // Ultra AI: events sidecars keyed by clip (RoomState reads them from disk).
  const clipEvents = new Map<string, unknown>();
  const clipEventReads: string[] = [];
  // Instant replay cut from a file cam's mp4 (RoomState runs ffmpeg).
  const clipCuts: { clip: string; mediaMs: number; shotId: string }[] = [];
  let camSeq = 0;

  const controller = new BasketballGameController(ROOM, {
    broadcast: (event) => events.push(event),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    registerGameCam: async () => {
      const inputId = `${ROOM}::whip::cam-${++camSeq}`;
      connected.add(inputId);
      return {
        inputId,
        whipUrl: `http://smelter/whip/${inputId}`,
        bearerToken: 'token',
      };
    },
    removeInput: async (inputId) => {
      connected.delete(inputId);
    },
    setBasketballScorer: async (inputId, enabled, params) => {
      aiCalls.push({ inputId, enabled, params });
    },
    setAnimTickMs: () => {},
    layoutTiles: async (tiles) => {
      // Mirror RoomState's unplaced-input auto-append hazard (see the KBT
      // harness): omitting a connected input must fail fast.
      for (const inputId of connected) {
        if (!tiles.some((t) => t.inputId === inputId)) {
          throw new Error(
            `layoutTiles omitted connected input ${inputId} — RoomState would auto-append it on top of the stage`,
          );
        }
      }
      layouts.push(
        tiles.map(({ inputId, x, y, width }) => ({ inputId, x, y, width })),
      );
    },
    runInputTransition: () => {},
    isInputConnected: (inputId) => connected.has(inputId),
    ...(opts?.withLiveness
      ? { isInputLive: (inputId: string) => live.has(inputId) }
      : {}),
    getResolution: () => ({ width: 1920, height: 1080 }),
    publishHud: (state) => hudApplies.push(state),
    registerJoinQr: async (url) => {
      qrCalls.push(url);
      return `bb-qr-${qrCalls.length}`;
    },
    requestReplay: (inputId, shotId, t) => {
      replayRequests.push({ inputId, shotId, ...(t != null ? { t } : {}) });
    },
    registerReplayClip: async (file, offsetMs) => {
      const inputId = `bb-replay-${replayClips.length + 1}`;
      replayClips.push({ file, offsetMs, inputId });
      return inputId;
    },
    unregisterReplayClip: (inputId) => {
      replayUnregisters.push(inputId);
    },
    getPipelineTimeMs: () => 100_000,
    getFileClock: (inputId) => fileClocks.get(inputId) ?? null,
    resyncFileCams: async () => {
      resyncs.push(Date.now());
    },
    loadClipEvents: async (clip) => {
      clipEventReads.push(clip);
      const json = clipEvents.get(clip);
      return json === undefined
        ? null
        : { fileName: clip.replace(/\.mp4$/i, '.events.json'), json };
    },
    ...(opts?.withClipCut
      ? {
          cutReplayClip: async (
            clip: string,
            mediaMs: number,
            shotId: string,
          ) => {
            clipCuts.push({ clip, mediaMs, shotId });
            await new Promise((r) => setTimeout(r, 600));
            return { file: `cut-${clipCuts.length}.mp4`, durationMs: 8000 };
          },
        }
      : {}),
  });

  return {
    controller,
    events,
    sent,
    aiCalls,
    layouts,
    hudApplies,
    qrCalls,
    replayRequests,
    replayClips,
    replayUnregisters,
    connected,
    live,
    fileClocks,
    resyncs,
    clipEvents,
    clipEventReads,
    clipCuts,
    ofType<T extends RoomEvent['type']>(type: T) {
      return events.filter((e) => e.type === type) as Extract<
        RoomEvent,
        { type: T }
      >[];
    },
    lastState() {
      const s = this.ofType('bb_state');
      return s[s.length - 1];
    },
    lastMatch() {
      const s = this.ofType('bb_match');
      return s[s.length - 1];
    },
    errorsFor(clientId: string) {
      return sent
        .filter((s) => s.clientId === clientId && s.event.type === 'bb_error')
        .map((s) => s.event) as Extract<RoomEvent, { type: 'bb_error' }>[];
    },
    joinedFor(clientId: string) {
      const found = [...sent]
        .reverse()
        .find(
          (s) => s.clientId === clientId && s.event.type === 'bb_cam_joined',
        );
      return found?.event.type === 'bb_cam_joined' ? found.event : null;
    },
    offerFor(clientId: string) {
      const found = [...sent]
        .reverse()
        .find(
          (s) => s.clientId === clientId && s.event.type === 'bb_cam_offer',
        );
      return found?.event.type === 'bb_cam_offer' ? found.event : null;
    },
    lastHud(): BbHudState | null {
      return hudApplies.length ? hudApplies[hudApplies.length - 1] : null;
    },
  };
}

type H = ReturnType<typeof harness>;

/** Hoop + court phones joined and publishing, moderator joined. */
async function rigged(h: H) {
  h.controller.handleMessage('hoop', {
    type: 'bb_cam_join',
    role: 'hoop',
    name: 'HOOP',
  });
  h.controller.handleMessage('court', {
    type: 'bb_cam_join',
    role: 'court',
    name: 'COURT',
  });
  await h.controller.startCamera('hoop', { width: 1280, height: 720 });
  await h.controller.startCamera('court', { width: 1920, height: 1080 });
  h.controller.handleMessage('mod', {
    type: 'bb_commentator_join',
    name: 'MOD',
  });
  h.controller.handleMessage('hoop', {
    type: 'bb_rim_calibrate',
    rim: { cx: 0.5, cy: 0.3, rx: 0.06, ry: 0.02 },
  });
  return {
    hoopIn: h.offerFor('hoop')!.inputId,
    courtIn: h.offerFor('court')!.inputId,
  };
}

async function started(
  h: H,
  cfg?: Parameters<BasketballGameController['setConfig']>[0],
) {
  const ids = await rigged(h);
  h.controller.setConfig({ targetPoints: 21, durationMs: 60_000, ...cfg });
  const r = h.controller.controlMatch({ action: 'start' });
  expect(r.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  return ids;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BasketballGameController — cameras', () => {
  it('claims a role, offers a WHIP slot and arms the scorer on the hoop cam only', async () => {
    const h = harness();
    h.controller.handleMessage('p1', {
      type: 'bb_cam_join',
      role: 'hoop',
      name: 'RIM',
    });
    const joined = h.joinedFor('p1');
    expect(joined?.role).toBe('hoop');
    expect(joined?.camKey).toBeTruthy();
    await h.controller.startCamera('p1', { width: 1280, height: 720 });
    const offer = h.offerFor('p1');
    expect(offer?.role).toBe('hoop');
    expect(offer?.whipUrl).toContain(offer!.inputId);
    expect(h.aiCalls).toHaveLength(1);
    expect(h.aiCalls[0]).toMatchObject({
      inputId: offer!.inputId,
      enabled: true,
    });
    expect(h.aiCalls[0].params).toMatchObject({
      rimSet: 0,
      teamColorA: '#ff6a1f',
    });

    h.controller.handleMessage('p2', { type: 'bb_cam_join', role: 'court' });
    await h.controller.startCamera('p2');
    expect(h.aiCalls).toHaveLength(1); // court cam never runs the model
    h.controller.dispose();
  });

  it('refuses a held role without the key and adopts it with the key', async () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'bb_cam_join', role: 'hoop' });
    await h.controller.startCamera('p1');
    const key = h.joinedFor('p1')!.camKey;
    h.controller.handleMessage('p2', { type: 'bb_cam_join', role: 'hoop' });
    expect(h.errorsFor('p2').map((e) => e.code)).toEqual(['role_taken']);
    h.controller.handleMessage('p3', {
      type: 'bb_cam_join',
      role: 'hoop',
      camKey: key,
    });
    const joined = h.joinedFor('p3');
    expect(joined?.camKey).toBe(key);
    expect(joined?.camInputActive).toBe(true);
    // The original client no longer owns the slot.
    h.controller.handleMessage('p1', { type: 'bb_cam_stop' });
    expect(h.lastState().cams.hoop.joined).toBe(true);
    h.controller.dispose();
  });

  it('adopts a disconnected slot without a key and keeps the input through the drop', async () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'bb_cam_join', role: 'court' });
    await h.controller.startCamera('p1');
    const inputId = h.offerFor('p1')!.inputId;
    h.controller.handleDisconnect('p1');
    expect(h.lastState().cams.court.connected).toBe(false);
    expect(h.connected.has(inputId)).toBe(true);
    h.controller.handleMessage('p2', {
      type: 'bb_cam_join',
      role: 'court',
      name: 'NEW',
    });
    expect(h.errorsFor('p2')).toHaveLength(0);
    expect(h.lastState().cams.court).toMatchObject({
      connected: true,
      name: 'NEW',
    });
    h.controller.dispose();
  });

  it('stores the rim calibration and re-pushes the full param set', async () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'bb_cam_join', role: 'hoop' });
    await h.controller.startCamera('p1');
    h.controller.handleMessage('p1', {
      type: 'bb_rim_calibrate',
      rim: { cx: 0.51, cy: 0.33, rx: 0.07, ry: 0.025 },
    });
    expect(h.lastState().config.rim).toEqual({
      cx: 0.51,
      cy: 0.33,
      rx: 0.07,
      ry: 0.025,
    });
    expect(h.lastState().cams.hoop.calibrated).toBe(true);
    const last = h.aiCalls[h.aiCalls.length - 1];
    expect(last.params).toMatchObject({
      rimSet: 1,
      rimCx: 0.51,
      analysisFps: 20,
    });
    h.controller.handleMessage('p1', {
      type: 'bb_rim_calibrate',
      rim: { cx: 2, cy: 0, rx: 0.1, ry: 0.1 },
    });
    expect(h.errorsFor('p1').map((e) => e.code)).toEqual(['invalid_rim']);
    h.controller.dispose();
  });

  it('reflects reaped inputs and publish liveness', async () => {
    const h = harness({ withLiveness: true });
    const { hoopIn } = await rigged(h);
    expect(h.lastState().cams.hoop.camConnected).toBe(false);
    h.live.add(hoopIn);
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.lastState().cams.hoop.camConnected).toBe(true);
    h.connected.delete(hoopIn);
    h.live.delete(hoopIn);
    h.controller.onInputsRemoved([hoopIn]);
    expect(h.lastState().cams.hoop.camConnected).toBe(false);
    expect(h.lastState().cams.hoop.joined).toBe(true);
    h.controller.dispose();
  });
});

describe('BasketballGameController — file cams (attachExternalCam)', () => {
  it('reports the file source, arms the scorer on the hoop clip only and lists the inputs', () => {
    const h = harness();
    h.connected.add('mp4-hoop');
    h.connected.add('mp4-court');
    h.controller.attachExternalCam(
      'hoop',
      'mp4-hoop',
      { width: 1280, height: 720 },
      'bb-test/hoop.mp4',
    );
    expect(h.lastState().cams.hoop).toMatchObject({
      joined: true,
      connected: false,
      source: 'file',
      fileName: 'bb-test/hoop.mp4',
      name: 'Hoop cam (file)',
      camWidth: 1280,
    });
    expect(h.aiCalls).toHaveLength(1);
    expect(h.aiCalls[0]).toMatchObject({ inputId: 'mp4-hoop', enabled: true });

    h.controller.attachExternalCam(
      'court',
      'mp4-court',
      undefined,
      'bb-test/court.mp4',
    );
    expect(h.aiCalls).toHaveLength(1);
    expect(h.lastState().cams.court).toMatchObject({
      source: 'file',
      fileName: 'bb-test/court.mp4',
      name: 'Court cam (file)',
    });
    expect(h.controller.fileCamInputIds()).toEqual([
      { role: 'hoop', inputId: 'mp4-hoop' },
      { role: 'court', inputId: 'mp4-court' },
    ]);
    // Empty and WHIP slots never carry a fileName.
    expect(h.lastState().cams.hoop.fileName).toBe('bb-test/hoop.mp4');
    h.controller.dispose();
  });

  it('replaces a phone stream, and a phone can take the slot back', async () => {
    const h = harness();
    h.controller.handleMessage('p1', {
      type: 'bb_cam_join',
      role: 'court',
      name: 'PHONE',
    });
    await h.controller.startCamera('p1');
    const whipIn = h.offerFor('p1')!.inputId;
    expect(h.lastState().cams.court.source).toBe('whip');

    h.connected.add('mp4-court');
    h.controller.attachExternalCam('court', 'mp4-court', undefined, 'c.mp4');
    expect(h.connected.has(whipIn)).toBe(false); // the phone's input retired
    expect(h.lastState().cams.court).toMatchObject({
      source: 'file',
      fileName: 'c.mp4',
      name: 'Court cam (file)',
    });

    // Swapping the file keeps a single input attached.
    h.connected.add('mp4-court-2');
    h.controller.attachExternalCam('court', 'mp4-court-2', undefined, 'd.mp4');
    expect(h.connected.has('mp4-court')).toBe(false);
    expect(h.controller.fileCamInputIds()).toEqual([
      { role: 'court', inputId: 'mp4-court-2' },
    ]);

    // The phone still holds the slot and can publish again.
    await h.controller.startCamera('p1');
    expect(h.connected.has('mp4-court-2')).toBe(false);
    const cam = h.lastState().cams.court;
    expect(cam.source).toBe('whip');
    expect(cam.fileName).toBeUndefined();
    expect(h.controller.fileCamInputIds()).toEqual([]);
    h.controller.dispose();
  });

  it('kick_cam drops a file cam and its input', () => {
    const h = harness();
    h.connected.add('mp4-hoop');
    h.controller.attachExternalCam('hoop', 'mp4-hoop', undefined, 'h.mp4');
    const r = h.controller.controlMatch({ action: 'kick_cam', role: 'hoop' });
    expect(r.error).toBeUndefined();
    expect(h.connected.has('mp4-hoop')).toBe(false);
    expect(h.aiCalls[h.aiCalls.length - 1]).toMatchObject({
      inputId: 'mp4-hoop',
      enabled: false,
    });
    expect(h.lastState().cams.hoop).toMatchObject({
      joined: false,
      source: 'whip',
    });
    expect(h.controller.fileCamInputIds()).toEqual([]);
    h.controller.dispose();
  });
});

describe('BasketballGameController — ledger + match', () => {
  it('auto-assigns a confident make and queues an unsure one for the moderator', async () => {
    const h = harness();
    await started(h);
    const a = h.controller.simulateShot('A', 0.9)!;
    expect(a.status).toBe('confirmed');
    expect(h.lastState().teams.A.score).toBe(1);
    const unsure = h.controller.simulateShot('B', 0.3)!;
    expect(unsure.status).toBe('pending');
    expect(h.lastState().teams.B.score).toBe(0);
    expect(h.lastState().pending.map((s) => s.id)).toEqual([unsure.id]);
    h.controller.handleMessage('mod', {
      type: 'bb_shot_resolve',
      shotId: unsure.id,
      team: 'B',
      points: 2,
    });
    const st = h.lastState();
    expect(st.teams.B).toMatchObject({ score: 2, makes: 1, twos: 1 });
    expect(st.pending).toHaveLength(0);
    expect(h.ofType('bb_shot').map((e) => e.kind)).toEqual([
      'made',
      'made',
      'assigned',
    ]);
    h.controller.dispose();
  });

  it('undo voids the newest make and re-derives the score; manual points go through the ledger', async () => {
    const h = harness();
    await started(h);
    h.controller.simulateShot('A', 0.9);
    h.controller.simulateShot('A', 0.9);
    expect(h.lastState().teams.A.score).toBe(2);
    h.controller.handleMessage('mod', { type: 'bb_shot_undo' });
    expect(h.lastState().teams.A.score).toBe(1);
    h.controller.handleMessage('mod', {
      type: 'bb_shot_add',
      team: 'B',
      points: 2,
    });
    expect(h.lastState().teams.B).toMatchObject({ score: 2, twos: 1 });
    expect(h.ofType('bb_lead_change').map((e) => e.team)).toEqual(['B']);
    // Only the moderator may edit.
    h.controller.handleMessage('hoop', { type: 'bb_shot_undo' });
    expect(h.errorsFor('hoop').map((e) => e.code)).toContain('not_commentator');
    h.controller.dispose();
  });

  it('ends at the target score, and an undo re-opens the match', async () => {
    const h = harness();
    await started(h, { targetPoints: 2 });
    h.controller.simulateShot('A', 0.9);
    expect(h.lastMatch().phase).toBe('live');
    h.controller.simulateShot('A', 0.9);
    expect(h.lastMatch()).toMatchObject({ phase: 'ended', winner: 'A' });
    h.controller.handleMessage('mod', { type: 'bb_shot_undo' });
    expect(h.lastMatch()).toMatchObject({ phase: 'live', winner: null });
    expect(h.lastState().teams.A.score).toBe(1);
    h.controller.dispose();
  });

  it('runs out the clock: a leader wins, a tie goes to overtime, first to 2 in OT wins', async () => {
    const h = harness();
    await started(h, { durationMs: 30_000 });
    h.controller.simulateShot('A', 0.9);
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(h.lastMatch().remainingMs).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1_100);
    // Buzzer: clock at zero, decision pending the shot grace.
    expect(h.lastMatch()).toMatchObject({ phase: 'live', remainingMs: 0 });
    await vi.advanceTimersByTimeAsync(700);
    expect(h.lastMatch()).toMatchObject({ phase: 'overtime', period: 'ot' });
    h.controller.simulateShot('B', 0.9);
    expect(h.lastMatch().phase).toBe('overtime');
    h.controller.simulateShot('B', 0.9);
    expect(h.lastMatch()).toMatchObject({ phase: 'ended', winner: 'B' });
    expect(h.lastMatch().otScores).toEqual({ A: 0, B: 2 });
    h.controller.dispose();
  });

  it('ends on time for the leading team and honours a buzzer-beater in the grace', async () => {
    const h = harness();
    await started(h, { durationMs: 30_000 });
    h.controller.simulateShot('A', 0.9);
    await vi.advanceTimersByTimeAsync(30_100);
    expect(h.lastMatch()).toMatchObject({ phase: 'live', remainingMs: 0 });
    const late = h.controller.simulateShot('B', 0.9)!;
    expect(late.period).toBe('reg');
    await vi.advanceTimersByTimeAsync(700);
    expect(h.lastMatch()).toMatchObject({ phase: 'overtime' });
    h.controller.dispose();
  });

  it('pause freezes the clock; makes while paused land as pending', async () => {
    const h = harness();
    await started(h, { durationMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    h.controller.controlMatch({ action: 'pause' });
    const frozen = h.lastMatch().remainingMs;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.lastMatch().remainingMs).toBe(frozen);
    const shot = h.controller.simulateShot('A', 0.95)!;
    expect(shot.status).toBe('confirmed');
    h.controller.controlMatch({ action: 'resume' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.lastMatch().remainingMs).toBeLessThan(frozen);
    h.controller.dispose();
  });

  it('rejects out-of-order flow actions and resets cleanly', async () => {
    const h = harness();
    await started(h);
    expect(h.controller.controlMatch({ action: 'start' }).error?.code).toBe(
      'bad_action',
    );
    expect(h.controller.controlMatch({ action: 'lobby' }).error?.code).toBe(
      'bad_action',
    );
    h.controller.simulateShot('A', 0.9);
    h.controller.controlMatch({ action: 'reset' });
    const st = h.lastState();
    expect(st.phase).toBe('lobby');
    expect(st.teams.A.score).toBe(0);
    expect(st.recent).toHaveLength(0);
    expect(st.cams.hoop.joined).toBe(true);
    h.controller.dispose();
  });

  it('treats makes in the lobby as warm-up feedback, not points', async () => {
    const h = harness();
    await rigged(h);
    const shot = h.controller.simulateShot('A', 0.9)!;
    expect(shot.status).toBe('voided');
    expect(h.ofType('bb_shot').map((e) => e.kind)).toEqual(['warmup']);
    expect(h.lastState().teams.A.score).toBe(0);
    h.controller.dispose();
  });
});

describe('BasketballGameController — worker feed', () => {
  it('dedupes events by index, resets on a new session and pings the hoop phone', async () => {
    const h = harness();
    const { hoopIn, courtIn } = await started(h);
    h.controller.onWorkerResult(courtIn, {
      session: 'x',
      events: [{ type: 'shot_made', index: 1, team: 'A', teamConfidence: 0.9 }],
    });
    expect(h.lastState().teams.A.score).toBe(0); // court cam results are ignored
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: { x: 0.5, y: 0.2, w: 0.02, h: 0.03, src: 'yolo' },
      zone: 'above',
      events: [
        {
          type: 'shot_made',
          index: 3,
          t: 12.5,
          team: 'A',
          teamConfidence: 0.9,
          frameFile: 'm.jpg',
          releaseFrameFile: 'r.jpg',
        },
        { type: 'shot_attempt', index: 3, result: 'made', team: 'A' },
      ],
    });
    expect(h.lastState().teams.A).toMatchObject({
      score: 1,
      makes: 1,
      attempts: 1,
    });
    const made = h.ofType('bb_shot')[0];
    expect(made.shot).toMatchObject({
      sourceT: 12.5,
      frameUrl: '/bb-shot-frames/m.jpg',
      releaseFrameUrl: '/bb-shot-frames/r.jpg',
    });
    await vi.advanceTimersByTimeAsync(0);
    // The instant replay is requested at the make's frame time.
    expect(h.replayRequests).toEqual([
      { inputId: hoopIn, shotId: made.shot.id, t: 12.5 },
    ]);
    const ball = sentBall(h);
    expect(ball).toMatchObject({
      tracked: true,
      zone: 'above',
      source: 'yolo',
    });
    // Replayed index → ignored; miss attempt counts for FG%.
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_made', index: 3, team: 'A', teamConfidence: 0.9 },
        { type: 'shot_attempt', index: 4, result: 'miss', team: 'B' },
        { type: 'shot_attempt', index: 5, result: 'miss', team: null },
      ],
    });
    expect(h.lastState().teams.A.score).toBe(1);
    expect(h.lastState().teams.B.attempts).toBe(1);
    expect(h.lastState().unattributedMisses).toBe(1);
    // New worker session: indices start over.
    h.controller.onWorkerResult(hoopIn, {
      session: 's2',
      events: [{ type: 'shot_made', index: 1, team: 'B', teamConfidence: 0.9 }],
    });
    expect(h.lastState().teams.B.score).toBe(1);
    h.controller.dispose();
  });
});

describe('BasketballGameController — weak make evidence', () => {
  it('queues a net_pass make for the moderator even with a confident team', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        {
          type: 'shot_made',
          index: 1,
          team: 'B',
          teamConfidence: 0.95,
          evidence: 'net_pass',
        },
      ],
    });
    expect(h.lastState().teams.B.score).toBe(0);
    expect(h.lastState().pending).toHaveLength(1);
    expect(h.lastState().pending[0]).toMatchObject({
      aiTeam: 'B',
      aiConfidence: 0.95,
      status: 'pending',
      evidence: 'net_pass',
    });
    const refCall = h
      .ofType('bb_ai_log')
      .flatMap((e) => e.entries)
      .find((e) => e.label === 'REF CALL');
    expect(refCall).toMatchObject({
      kind: 'refcall',
      tone: 'electric',
      text: 'net_pass · AI B 95% · weak evidence · ref call',
    });
    h.controller.resolveShot({
      shotId: h.lastState().pending[0].id,
      team: 'B',
    });
    expect(h.lastState().teams.B.score).toBe(1);
    h.controller.dispose();
  });
});

/** Newest `bb_ball` — a room broadcast (hoop phone + moderator panel). */
function sentBall(h: H) {
  const balls = h.ofType('bb_ball');
  return balls.length ? balls[balls.length - 1] : null;
}

function aiLogLabels(h: H) {
  return h.ofType('bb_ai_log').flatMap((e) => e.entries.map((x) => x.label));
}

describe('BasketballGameController — AI log + overlay', () => {
  it('sends the log snapshot on spectate and streams state / verdict entries', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    h.controller.spectate('viewer');
    const snap = [...h.sent]
      .reverse()
      .find((s) => s.clientId === 'viewer' && s.event.type === 'bb_ai_log');
    expect(snap?.event).toMatchObject({ type: 'bb_ai_log', reset: true });
    // armed on start (rim calibrated by rigged())
    expect(
      snap?.event.type === 'bb_ai_log' ? snap.event.entries[0] : null,
    ).toMatchObject({ label: 'AI', text: 'armed · auto · auto · rim set' });

    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: { x: 0.5, y: 0.2, w: 0.02, h: 0.03, src: 'yolo' },
      zone: 'above',
      state: 'flight',
      procMs: 31.5,
    });
    await vi.advanceTimersByTimeAsync(300); // past the bb_ball debounce
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: { x: 0.5, y: 0.3, w: 0.02, h: 0.03, src: 'yolo' },
      zone: 'rim',
      state: 'rim',
    });
    await vi.advanceTimersByTimeAsync(300);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: null,
      zone: 'none',
      state: 'idle',
      events: [
        { type: 'shot_attempt', index: 1, result: 'miss', team: null },
        {
          type: 'candidate_end',
          t: 4.2,
          made: false,
          reason: 'rim_exit',
          attempted: true,
          metrics: { minDist: 0.4, netSamples: 0, touchedRim: true },
        },
      ],
    });
    // armed twice: at cam start (rim NOT SET) and again after calibration
    expect(aiLogLabels(h)).toEqual([
      'AI',
      'AI',
      'SESSION',
      'RIM',
      'MISS',
      'ATTEMPT',
    ]);
    const miss = h
      .ofType('bb_ai_log')
      .flatMap((e) => e.entries)
      .find((e) => e.label === 'MISS');
    expect(miss).toMatchObject({
      tone: 'amber',
      t: 4.2,
      text: 'rim_exit · left the rim without dropping',
      detail: 'net 0/0 lost 0 · min 0.40rx · rim touched',
    });
    // bb_ball is a broadcast now, with the state machine + timing
    expect(sentBall(h)).toMatchObject({
      tracked: false,
      zone: 'none',
      state: 'idle',
    });
    expect(h.ofType('bb_ball')[0]).toMatchObject({
      tracked: true,
      state: 'flight',
      procMs: 31.5,
    });
    h.controller.dispose();
  });

  it('carries the verdict measurements onto the make and its ledger entry', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_attempt', index: 1, result: 'made', team: 'A' },
        {
          type: 'shot_made',
          index: 1,
          t: 9.4,
          team: 'A',
          teamConfidence: 0.9,
          evidence: 'net_occluded',
          colorSample: '#ff6a1f',
        },
        {
          type: 'candidate_end',
          t: 9.4,
          made: true,
          reason: 'net_occluded',
          attempted: true,
          metrics: { dwell: 0.12, netSamples: 3, netCentred: 1, netLost: 2 },
        },
      ],
    });
    expect(h.lastState().recent[0]).toMatchObject({
      evidence: 'net_occluded',
      aiReason: 'dwell 0.12s · net 3/1 lost 2',
      status: 'confirmed',
    });
    const entries = h.ofType('bb_ai_log').flatMap((e) => e.entries);
    expect(entries.map((e) => e.label)).toEqual([
      'AI',
      'AI',
      'SESSION',
      'LEDGER',
    ]);
    expect(entries[3]).toMatchObject({
      tone: 'good',
      text: 'net_occluded · AI A 90% · +1 A · in ledger',
      detail:
        'seen in the net, hidden by the mesh, out under it · dwell 0.12s · net 3/1 lost 2 · jersey #ff6a1f',
    });
    h.controller.dispose();
  });

  it('is moderator-gated and puts quantized AI data on the held HUD', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    h.controller.handleMessage('stranger', {
      type: 'bb_commentator_ai_overlay',
      enabled: true,
    });
    expect(h.errorsFor('stranger').map((e) => e.code)).toEqual([
      'not_commentator',
    ]);
    expect(h.lastState().aiOverlay).toBe(false);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_ai_overlay',
      enabled: true,
    });
    expect(h.lastState().aiOverlay).toBe(true);
    expect(aiLogLabels(h)).toContain('OVERLAY');
    await vi.advanceTimersByTimeAsync(HOLD + 200);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: { x: 0.51234, y: 0.2, w: 0.02, h: 0.03, src: 'crop' },
      zone: 'above',
      state: 'flight',
      frameW: 640,
      frameH: 480,
      events: [
        {
          type: 'candidate_end',
          made: false,
          reason: 'flight_away',
          attempted: false,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.lastHud()?.ai).toMatchObject({
      rim: { cx: 0.5, cy: 0.3, rx: 0.06, ry: 0.02 },
      frameAspect: 1.333,
      ball: { x: 0.512, y: 0.2, w: 0.02, h: 0.03 },
      zone: 'above',
      state: 'flight',
      src: 'crop',
      verdict: { text: 'DROP flight_away', tone: 'dim' },
    });
    // the verdict expires on the snapshot clock; an idle feed clears the ball
    await vi.advanceTimersByTimeAsync(4_100);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: null,
      zone: 'none',
      state: 'idle',
    });
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.lastHud()?.ai).toMatchObject({
      ball: null,
      state: 'idle',
      verdict: null,
    });
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_ai_overlay',
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.lastHud()?.ai).toBeNull();
    h.controller.dispose();
  });

  it('publishes the overlay from the worker feed in the lobby', async () => {
    const h = harness();
    const { hoopIn } = await rigged(h);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_ai_overlay',
      enabled: true,
    });
    await vi.advanceTimersByTimeAsync(HOLD + 200);
    const before = h.hudApplies.length;
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      ball: { x: 0.5, y: 0.2, w: 0.02, h: 0.03, src: 'yolo' },
      zone: 'above',
      state: 'flight',
    });
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.hudApplies.length).toBeGreaterThan(before);
    expect(h.lastHud()?.ai?.ball).toEqual({ x: 0.5, y: 0.2, w: 0.02, h: 0.03 });
    h.controller.dispose();
  });
});

describe('BasketballGameController — stage + HUD', () => {
  it('lays out court full + hoop PiP live, parks the commentator when PiP is off', async () => {
    const h = harness();
    const { hoopIn, courtIn } = await started(h);
    await h.controller.startCommentatorCamera('mod', {
      width: 1280,
      height: 720,
    });
    await vi.advanceTimersByTimeAsync(0);
    const castIn = h.offerFor('mod')!.inputId;
    const last = h.layouts[h.layouts.length - 1];
    const byId = Object.fromEntries(last.map((t) => [t.inputId, t]));
    expect(byId[courtIn]).toMatchObject({ x: 0, y: 0, width: 1920 });
    expect(byId[hoopIn].width).toBe(480);
    expect(byId[castIn].width).toBe(220); // lower-third caster PiP
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_caster_pip',
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(0);
    // A leaving tile holds its rect through the fade-out, then parks.
    const holding = h.layouts[h.layouts.length - 1].find(
      (t) => t.inputId === castIn,
    );
    expect(holding?.width).toBe(220);
    await vi.advanceTimersByTimeAsync(400);
    const parked = h.layouts[h.layouts.length - 1].find(
      (t) => t.inputId === castIn,
    );
    expect(parked?.width).toBe(1);
    h.controller.dispose();
  });

  it('holds the score for the delayed video, then opens the REPLAY window over the unchanged layout', async () => {
    const h = harness();
    const { hoopIn, courtIn } = await started(h);
    await vi.advanceTimersByTimeAsync(HOLD + 200); // let the start snapshot land
    expect(h.lastHud()?.stage.scene).toBe('live');
    const layoutsBefore = h.layouts.length;
    h.controller.simulateShot('A', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    // No cut at detection: layout untouched, scene stays live…
    expect(h.layouts.length).toBe(layoutsBefore);
    expect(h.lastHud()?.stage.scene).toBe('live');
    // …and the worker was asked for the clip.
    const shotId = h.ofType('bb_shot')[0].shot.id;
    expect(h.replayRequests).toEqual([{ inputId: hoopIn, shotId }]);
    // The score bug still shows the pre-make score for HUD_HOLD_MS.
    expect(h.lastHud()?.teams.A.score).toBe(0);
    // Worker delivers the clip 600 ms later: it is mounted so its first frame
    // lands 250 ms before the window opens (HOLD + replayDelayMs = 4.5 s).
    await vi.advanceTimersByTimeAsync(600);
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'replay_ready', shotId, file: 'clip.mp4', durationMs: 8000 },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.replayClips).toEqual([
      {
        file: 'clip.mp4',
        offsetMs: 100_000 + 4500 - 600 - 250,
        inputId: 'bb-replay-1',
      },
    ]);
    await vi.advanceTimersByTimeAsync(HOLD - 600 + 100);
    expect(h.lastHud()?.teams.A.score).toBe(1);
    expect(h.lastHud()?.lastShot).toMatchObject({
      team: 'A',
      points: 1,
      showBanner: true,
    });
    expect(h.lastHud()?.stage.scene).toBe('live');
    // Window opens after the banner had its 1.5 s alone.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.lastHud()?.stage).toMatchObject({
      scene: 'replay',
      main: 'court',
      replay: { inputId: 'bb-replay-1', team: 'A', points: 1, pending: false },
    });
    expect(h.lastState().scene).toBe('replay');
    // Still the live layout underneath (court full, hoop PiP).
    const during = h.layouts[h.layouts.length - 1];
    expect(during.find((t) => t.inputId === courtIn)?.width).toBe(1920);
    expect(during.find((t) => t.inputId === hoopIn)?.width).toBe(480);
    // Closes as the clip runs out (it started 250 ms before the window and
    // the closing crossfade covers its last 350 ms: 8000 − 250 − 350); the
    // input goes after the crossfade.
    await vi.advanceTimersByTimeAsync(7_400);
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(h.lastHud()?.stage.replay).toBeNull();
    expect(h.replayUnregisters).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayUnregisters).toEqual(['bb-replay-1']);
    h.controller.dispose();
  });

  it('drops the replay when the clip never arrives, and keeps it off when disabled', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    await vi.advanceTimersByTimeAsync(HOLD + 200);
    h.controller.simulateShot('A', 0.9);
    await vi.advanceTimersByTimeAsync(HOLD + 1_500 + 2_000 + 100);
    expect(h.replayRequests).toHaveLength(1);
    expect(h.replayClips).toEqual([]);
    expect(h.lastHud()?.stage.scene).toBe('live');
    // A clip arriving after the grace is mounted and released right away.
    const shotId = h.replayRequests[0].shotId;
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'replay_ready', shotId, file: 'late.mp4', durationMs: 8000 },
      ],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.replayClips).toEqual([]);
    expect(h.lastHud()?.stage.scene).toBe('live');
    // Disabled: no request at all.
    h.controller.setConfig({ replay: false });
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.replayRequests).toHaveLength(1);
    h.controller.dispose();
  });

  it('a make during a replay replaces it', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    await vi.advanceTimersByTimeAsync(HOLD + 200);
    h.controller.simulateShot('A', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    const first = h.replayRequests[0].shotId;
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        {
          type: 'replay_ready',
          shotId: first,
          file: 'a.mp4',
          durationMs: 8000,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(HOLD + 1_500 + 100);
    expect(h.lastHud()?.stage.scene).toBe('replay');
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(h.replayRequests).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayUnregisters).toEqual(['bb-replay-1']);
    const second = h.replayRequests[1].shotId;
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        {
          type: 'replay_ready',
          shotId: second,
          file: 'b.mp4',
          durationMs: 6000,
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(HOLD + 1_500);
    expect(h.lastHud()?.stage).toMatchObject({
      scene: 'replay',
      replay: { inputId: 'bb-replay-2', team: 'B' },
    });
    h.controller.dispose();
  });

  it('view overrides cut the stage and clear on the next flow action', async () => {
    const h = harness();
    const { hoopIn } = await started(h);
    h.controller.handleMessage('hoop', {
      type: 'bb_commentator_view',
      override: { mode: 'scene', scene: 'hoop' },
    });
    expect(h.errorsFor('hoop').map((e) => e.code)).toContain('not_commentator');
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_view',
      override: { mode: 'scene', scene: 'caster' },
    });
    expect(h.errorsFor('mod').map((e) => e.code)).toContain('invalid_view'); // no caster input
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_view',
      override: { mode: 'scene', scene: 'hoop' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastState()).toMatchObject({
      scene: 'hoop',
      viewOverride: { mode: 'scene', scene: 'hoop' },
    });
    expect(
      h.layouts[h.layouts.length - 1].find((t) => t.inputId === hoopIn)?.width,
    ).toBe(1920);
    h.controller.controlMatch({ action: 'pause' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastState()).toMatchObject({
      scene: 'live',
      viewOverride: { mode: 'auto' },
    });
    h.controller.dispose();
  });

  it('shows the ended card only after the winning make played out (banner, then the replay)', async () => {
    const h = harness();
    const { hoopIn } = await started(h, {
      targetPoints: 1,
      replayDelayMs: 1000,
    });
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastMatch().phase).toBe('ended');
    expect(h.lastHud()?.stage.scene).toBe('live');
    const shotId = h.replayRequests[0].shotId;
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'replay_ready', shotId, file: 'win.mp4', durationMs: 4000 },
      ],
    });
    // Banner lands with the score, the replay opens 1 s later…
    await vi.advanceTimersByTimeAsync(HOLD + 1_100);
    expect(h.lastHud()?.stage.scene).toBe('replay');
    expect(h.lastHud()?.teams.B.score).toBe(1);
    // …and the final card waits for it to close.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.lastHud()?.stage.scene).toBe('ended');
    expect(h.lastHud()?.ended).toMatchObject({ winner: 'B' });
    h.controller.dispose();
  });

  it('a game-ending make without a replay shows the ended card after the banner', async () => {
    const h = harness();
    await started(h, { targetPoints: 1, replay: false });
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(h.lastHud()?.lastShot?.showBanner).toBe(true);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(h.lastHud()?.stage.scene).toBe('ended');
    h.controller.dispose();
  });

  it('registers one QR per join link and publishes the lobby with them', async () => {
    const h = harness();
    await rigged(h);
    h.controller.setConfig({
      joinUrls: {
        hoop: 'http://x/h',
        court: 'http://x/c',
        commentator: 'http://x/m',
      },
      joinLabel: 'x',
    });
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.qrCalls).toEqual(['http://x/h', 'http://x/c', 'http://x/m']);
    expect(h.lastHud()?.lobby?.qr.court.imageId).toBe('bb-qr-2');
    expect(h.lastHud()?.lobby?.cams.map((c) => c.joined)).toEqual([true, true]);
    h.controller.dispose();
    expect(h.lastHud()).toBeNull();
  });

  it('clamps config and pushes detector changes to the worker', async () => {
    const h = harness();
    await rigged(h);
    const cfg = h.controller.setConfig({
      durationMs: 5,
      targetPoints: 500,
      detector: { imgsz: 999, analysisFps: 99, ballConf: 5 },
      teams: { A: { color: '#FFFFFF', name: 'WHITES' } },
    });
    expect(cfg.durationMs).toBe(30_000);
    expect(cfg.targetPoints).toBe(99);
    expect(cfg.detector).toMatchObject({
      imgsz: 992,
      analysisFps: 30,
      ballConf: 0.9,
    });
    expect(cfg.teams.A).toEqual({ color: '#ffffff', name: 'WHITES' });
    const last = h.aiCalls[h.aiCalls.length - 1];
    expect(last.params).toMatchObject({ imgsz: 992, teamColorA: '#ffffff' });
    h.controller.dispose();
  });
});

// ── ground-truth replay ──────────────────────────────────────────────────────

/** Worker-side confirmation lag the replay adds on top of the clip time. */
const REPLAY_LAG = 300;

function fileRig(h: H, clock?: Partial<BbFileClock>) {
  h.connected.add('mp4-hoop');
  h.controller.attachExternalCam(
    'hoop',
    'mp4-hoop',
    { width: 1600, height: 1200 },
    'apidis/q2/cam7.mp4',
  );
  h.fileClocks.set('mp4-hoop', {
    anchorWallMs: Date.now(),
    playFromMs: 0,
    durationMs: 60_000,
    delayMs: HOLD,
    ...clock,
  });
  h.controller.setConfig({ targetPoints: 21, durationMs: 60_000 });
  return 'mp4-hoop';
}

const GT_MAKE = {
  tMs: 10_000,
  made: true,
  team: 'A' as const,
  points: 1 as const,
  gtPoints: 2 as const,
  basket: 'left' as const,
};
const GT_MISS = {
  tMs: 20_000,
  made: false,
  team: 'B' as const,
  points: 2 as const,
  gtPoints: 3 as const,
  basket: 'left' as const,
};

describe('BasketballGameController — ground-truth replay', () => {
  it('needs a file cam and reports the clock it follows', () => {
    const h = harness();
    expect(() =>
      h.controller.loadReplay({
        fileName: 'x/events.json',
        shots: [GT_MAKE],
        basket: 'both',
        loop: false,
      }),
    ).toThrow(/file camera/);
    fileRig(h);
    const r = h.controller.loadReplay({
      fileName: 'apidis/q2/events.json',
      shots: [GT_MISS, GT_MAKE],
      basket: 'left',
      loop: false,
    });
    expect(r).toMatchObject({
      fileName: 'apidis/q2/events.json',
      active: true,
      ultra: false,
      basket: 'left',
      total: 2,
      fired: 0,
      skipped: 0,
      nextEventTMs: 10_000,
      clockRole: 'hoop',
    });
    // Fires when the model would have confirmed it: frame time + side
    // channel delay − the HUD hold the viewers see it under + detect lag.
    expect(r.nextFireInMs).toBe(10_000 + HOLD - HOLD + REPLAY_LAG);
    expect(h.lastState().replay).toMatchObject({
      total: 2,
      nextEventTMs: 10_000,
    });
    h.controller.dispose();
  });

  it('fires makes as replay shots at their clip time and misses as attempts', async () => {
    const h = harness();
    fileRig(h);
    h.controller.controlMatch({ action: 'start' });
    h.controller.loadReplay({
      fileName: 'apidis/q2/events.json',
      shots: [GT_MAKE, GT_MISS],
      basket: 'both',
      loop: false,
    });
    await vi.advanceTimersByTimeAsync(10_000 + REPLAY_LAG - 1);
    expect(h.ofType('bb_shot')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const made = h.ofType('bb_shot');
    expect(made).toHaveLength(1);
    expect(made[0].kind).toBe('made');
    expect(made[0].shot).toMatchObject({
      source: 'replay',
      team: 'A',
      aiTeam: 'A',
      aiConfidence: 1,
      points: 1,
      gtPoints: 2,
      mediaMs: 10_000,
      status: 'confirmed',
    });
    expect(h.lastState().teams.A).toMatchObject({ score: 1, makes: 1 });
    expect(h.lastState().replay).toMatchObject({
      fired: 1,
      nextEventTMs: 20_000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.lastState().teams.B).toMatchObject({ score: 0, attempts: 1 });
    expect(h.lastState().replay).toMatchObject({
      fired: 2,
      nextEventTMs: null,
      nextFireInMs: null,
    });
    h.controller.dispose();
  });

  it('skips throws before START without warm-up feedback and owns the ledger over the model', async () => {
    const h = harness();
    const hoopIn = fileRig(h);
    h.controller.loadReplay({
      fileName: 'apidis/q2/events.json',
      shots: [
        { ...GT_MAKE, tMs: 2_000 },
        { ...GT_MAKE, tMs: 30_000 },
      ],
      basket: 'both',
      loop: false,
    });
    await vi.advanceTimersByTimeAsync(2_000 + REPLAY_LAG + 10);
    expect(h.ofType('bb_shot')).toHaveLength(0);
    expect(h.lastState().replay).toMatchObject({
      skipped: 1,
      fired: 0,
      nextEventTMs: 30_000,
    });
    h.controller.controlMatch({ action: 'start' });
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_made', index: 1, team: 'B', teamConfidence: 0.95 },
        { type: 'shot_attempt', index: 2, result: 'miss', team: 'B' },
      ],
    });
    expect(h.lastState().teams.B).toMatchObject({ score: 0, attempts: 0 });
    h.controller.unloadReplay();
    expect(h.lastState().replay).toBeNull();
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_made', index: 3, team: 'B', teamConfidence: 0.95 },
      ],
    });
    expect(h.lastState().teams.B.score).toBe(1);
    h.controller.dispose();
  });

  it('follows a re-synced clip, loops, and stops on dispose', async () => {
    const h = harness();
    fileRig(h, { durationMs: 30_000 });
    h.controller.controlMatch({ action: 'start' });
    h.controller.loadReplay({
      fileName: 'apidis/q2/events.json',
      shots: [{ ...GT_MAKE, tMs: 5_000, points: 2, gtPoints: 3 }],
      basket: 'both',
      loop: true,
    });
    await vi.advanceTimersByTimeAsync(5_000 + REPLAY_LAG);
    expect(h.lastState().teams.A.score).toBe(2);
    // Looping: the same throw is due again one clip length later.
    expect(h.lastState().replay).toMatchObject({
      fired: 1,
      nextEventTMs: 5_000,
      nextFireInMs: 30_000,
    });
    // RESTART CLIPS from 4.0 s → the tick re-anchors the schedule.
    h.fileClocks.set('mp4-hoop', {
      anchorWallMs: Date.now(),
      playFromMs: 4_000,
      durationMs: 30_000,
      delayMs: HOLD,
    });
    await vi.advanceTimersByTimeAsync(1_000 + REPLAY_LAG);
    expect(h.lastState().teams.A.score).toBe(4);
    expect(h.lastState().replay).toMatchObject({ fired: 2 });
    h.controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.lastState().teams.A.score).toBe(4);
  });

  it('fires earlier when the clip has no side-channel delay', () => {
    const h = harness();
    fileRig(h, { delayMs: 0 });
    const r = h.controller.loadReplay({
      fileName: 'apidis/q2/events.json',
      shots: [GT_MAKE],
      basket: 'both',
      loop: false,
    });
    expect(r.nextFireInMs).toBe(10_000 - HOLD + REPLAY_LAG);
    h.controller.dispose();
  });
});

// ── Ultra AI ─────────────────────────────────────────────────────────────────

const TICK = 100;

/** A demo clip's events sidecar: two left-basket plays, one on the right. */
const ULTRA_GT = {
  baskets: { left: { cams: [7, 5, 1, 2] }, right: { cams: [3, 6, 4] } },
  events: [
    {
      tMs: 10_000,
      kind: 'throw',
      made: true,
      points: 2,
      team: 'A',
      shotType: 'layup',
      basket: 'left',
    },
    {
      tMs: 20_000,
      kind: 'throw',
      made: false,
      points: 0,
      team: 'B',
      shotType: 'three',
      basket: 'left',
    },
    {
      tMs: 25_000,
      kind: 'throw',
      made: true,
      points: 2,
      team: 'B',
      shotType: 'layup',
      basket: 'right',
    },
    { tMs: 30_000, kind: 'rebound', team: 'B' },
  ],
};

function ultraLog(h: H) {
  return h.ofType('bb_ai_log').flatMap((e) => e.entries);
}

function ultraOn(h: H, enabled = true) {
  h.controller.handleMessage('mod', {
    type: 'bb_commentator_ultra_ai',
    enabled,
  });
}

describe('BasketballGameController — Ultra AI', () => {
  it('is moderator-gated, waits for a file cam, then arms with the basket the clip shows', async () => {
    const h = harness();
    h.controller.handleMessage('stranger', {
      type: 'bb_commentator_ultra_ai',
      enabled: true,
    });
    expect(h.errorsFor('stranger').map((e) => e.code)).toEqual([
      'not_commentator',
    ]);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_join',
      name: 'MOD',
    });
    expect(h.lastState().ultraAi).toBe('off');
    ultraOn(h);
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(h.lastState().ultraAi).toBe('no_clip');
    expect(h.lastState().replay).toBeNull();
    expect(
      ultraLog(h).filter((e) => e.text === 'waiting for a file cam · USE FILE'),
    ).toHaveLength(1);
    expect(h.clipEventReads).toEqual([]);
    // USE FILE → the tick reads the sidecar and arms on the clip clock.
    h.clipEvents.set('apidis/q2/cam7.mp4', ULTRA_GT);
    fileRig(h);
    await vi.advanceTimersByTimeAsync(TICK + 10);
    expect(h.lastState().ultraAi).toBe('armed');
    expect(h.lastState().replay).toMatchObject({
      fileName: 'apidis/q2/cam7.events.json',
      ultra: true,
      basket: 'left',
      loop: true,
      total: 2,
      nextEventTMs: 10_000,
    });
    expect(ultraLog(h)).toContainEqual(
      expect.objectContaining({
        label: 'ULTRA AI',
        tone: 'good',
        text: 'armed · 2 plays · left basket',
      }),
    );
    expect(h.clipEventReads).toEqual(['apidis/q2/cam7.mp4']);
    h.controller.dispose();
  });

  it('fires annotated plays as model calls and supersedes the live model', async () => {
    const h = harness();
    h.clipEvents.set('apidis/q2/cam7.mp4', ULTRA_GT);
    const hoopIn = fileRig(h);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_join',
      name: 'MOD',
    });
    h.controller.controlMatch({ action: 'start' });
    ultraOn(h);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastState().ultraAi).toBe('armed');
    await vi.advanceTimersByTimeAsync(10_000 + REPLAY_LAG - 1);
    expect(h.ofType('bb_shot')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const made = h.ofType('bb_shot');
    expect(made).toHaveLength(1);
    expect(made[0].kind).toBe('made');
    expect(made[0].shot).toMatchObject({
      source: 'ai',
      evidence: 'ultra',
      team: 'A',
      aiTeam: 'A',
      points: 1,
      mediaMs: 10_000,
      status: 'confirmed',
    });
    expect(made[0].shot.gtPoints).toBeUndefined();
    const conf = made[0].shot.aiConfidence;
    expect(conf).toBeGreaterThanOrEqual(0.9);
    expect(conf).toBeLessThan(1);
    expect(ultraLog(h)).toContainEqual(
      expect.objectContaining({
        label: 'LEDGER',
        tone: 'good',
        text: `ultra · AI A ${Math.round(conf * 100)}% · +1 A · in ledger`,
        detail: 'ultra model call',
      }),
    );
    expect(h.lastState().teams.A).toMatchObject({ score: 1, makes: 1 });
    // The instant replay is requested like for any model make.
    expect(h.replayRequests).toHaveLength(1);
    // The live model's own call is logged as superseded, never scored.
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        {
          type: 'shot_made',
          index: 1,
          team: 'B',
          teamConfidence: 0.95,
          evidence: 'net_dwell',
        },
        { type: 'shot_attempt', index: 2, result: 'miss', team: 'B' },
      ],
    });
    expect(h.lastState().teams.B).toMatchObject({ score: 0, attempts: 0 });
    expect(ultraLog(h)).toContainEqual(
      expect.objectContaining({
        label: 'MAKE',
        tone: 'dim',
        text: 'net_dwell · AI B 95% · superseded (ultra ai)',
      }),
    );
    // An annotated miss is an attempt (FG% only).
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.lastState().teams.B).toMatchObject({ score: 0, attempts: 1 });
    expect(ultraLog(h)).toContainEqual(
      expect.objectContaining({
        label: 'ATTEMPT',
        text: 'miss · team B · FG% only',
      }),
    );
    // Nothing on the panel says where the plays come from.
    for (const e of ultraLog(h)) {
      expect(`${e.text} ${e.detail ?? ''}`).not.toMatch(
        /ground|\bGT\b|events\.json/,
      );
    }
    // OFF → the mode unloads and the live model scores again.
    ultraOn(h, false);
    expect(h.lastState().ultraAi).toBe('off');
    expect(h.lastState().replay).toBeNull();
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_made', index: 3, team: 'B', teamConfidence: 0.95 },
      ],
    });
    expect(h.lastState().teams.B.score).toBe(1);
    h.controller.dispose();
  });

  it('leaves the live model in charge without a sidecar and re-arms on a new clip', async () => {
    const h = harness();
    const hoopIn = fileRig(h);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_join',
      name: 'MOD',
    });
    h.controller.controlMatch({ action: 'start' });
    ultraOn(h);
    await vi.advanceTimersByTimeAsync(TICK * 10);
    expect(h.lastState().ultraAi).toBe('no_events');
    expect(h.lastState().replay).toBeNull();
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['bad_action']);
    // Read once, no retry storm from the tick.
    expect(h.clipEventReads).toEqual(['apidis/q2/cam7.mp4']);
    expect(ultraLog(h)).toContainEqual(
      expect.objectContaining({
        label: 'ULTRA AI',
        tone: 'amber',
        text: 'no annotated plays next to apidis/q2/cam7.mp4 · live model in charge',
      }),
    );
    h.controller.onWorkerResult(hoopIn, {
      session: 's1',
      events: [
        { type: 'shot_made', index: 1, team: 'B', teamConfidence: 0.95 },
      ],
    });
    expect(h.lastState().teams.B.score).toBe(1);
    // USE FILE with an annotated clip → arms with that clip's plays.
    h.clipEvents.set('demo/right-3-makes/cam6.mp4', ULTRA_GT);
    h.connected.add('mp4-hoop-2');
    h.controller.attachExternalCam(
      'hoop',
      'mp4-hoop-2',
      { width: 1600, height: 1200 },
      'demo/right-3-makes/cam6.mp4',
    );
    h.fileClocks.set('mp4-hoop-2', {
      anchorWallMs: Date.now(),
      playFromMs: 0,
      durationMs: 60_000,
      delayMs: HOLD,
    });
    await vi.advanceTimersByTimeAsync(TICK + 10);
    expect(h.lastState().ultraAi).toBe('armed');
    expect(h.lastState().replay).toMatchObject({
      ultra: true,
      basket: 'right',
      total: 1,
    });
    // RESET keeps the mode armed for the next match.
    h.controller.controlMatch({ action: 'reset' });
    expect(h.lastState().ultraAi).toBe('armed');
    h.controller.dispose();
  });

  it('cuts the instant replay from the file clip itself and opens the window', async () => {
    const h = harness({ withClipCut: true });
    h.clipEvents.set('apidis/q2/cam7.mp4', ULTRA_GT);
    fileRig(h);
    h.controller.handleMessage('mod', {
      type: 'bb_commentator_join',
      name: 'MOD',
    });
    h.controller.controlMatch({ action: 'start' });
    ultraOn(h);
    await vi.advanceTimersByTimeAsync(10_000 + REPLAY_LAG);
    const shotId = h.ofType('bb_shot')[0].shot.id;
    // No worker involved: the clip comes from the mp4 at the play's time.
    expect(h.replayRequests).toEqual([]);
    expect(h.clipCuts).toEqual([
      { clip: 'apidis/q2/cam7.mp4', mediaMs: 10_000, shotId },
    ]);
    await vi.advanceTimersByTimeAsync(600);
    expect(h.replayClips).toEqual([
      {
        file: 'cut-1.mp4',
        offsetMs: 100_000 + 4500 - 600 - 250,
        inputId: 'bb-replay-1',
      },
    ]);
    await vi.advanceTimersByTimeAsync(HOLD + 1_500 - 600 + 100);
    expect(h.lastHud()?.stage).toMatchObject({
      scene: 'replay',
      replay: { inputId: 'bb-replay-1', team: 'A', points: 1 },
    });
    // The room config can switch the window off (panel REPLAY chip).
    h.controller.setConfig({ replay: false });
    await vi.advanceTimersByTimeAsync(10_000);
    h.controller.controlMatch({ action: 'start' });
    h.controller.dispose();
  });
});

describe('BasketballGameController — looping file cams', () => {
  it('asks for one joint restart per pass, just before the first clip wraps', async () => {
    const h = harness();
    // Hoop runs its 3 s side-channel delay ahead: it is the first to wrap.
    fileRig(h, { playFromMs: HOLD, durationMs: 60_000, delayMs: HOLD });
    h.connected.add('mp4-court');
    h.controller.attachExternalCam(
      'court',
      'mp4-court',
      { width: 1600, height: 1200 },
      'apidis/q2/cam1.mp4',
    );
    h.fileClocks.set('mp4-court', {
      anchorWallMs: Date.now(),
      playFromMs: 0,
      durationMs: 60_000,
      delayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(56_000);
    expect(h.resyncs).toHaveLength(0);
    // hoop unwrapped media = 3000 + 57 000 ≥ 60 000 − 200
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.resyncs).toHaveLength(1);
    // Same pass (clock anchors unchanged): no second request.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.resyncs).toHaveLength(1);
    // The restart moved the anchors → the next pass gets its own resync.
    const anchor = Date.now();
    h.fileClocks.set('mp4-hoop', {
      anchorWallMs: anchor,
      playFromMs: HOLD,
      durationMs: 60_000,
      delayMs: HOLD,
    });
    h.fileClocks.set('mp4-court', {
      anchorWallMs: anchor,
      playFromMs: 0,
      durationMs: 60_000,
      delayMs: 0,
    });
    await vi.advanceTimersByTimeAsync(57_000);
    expect(h.resyncs).toHaveLength(2);
    h.controller.dispose();
  });

  it('never resyncs without a file cam clock', async () => {
    const h = harness();
    await started(h);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.resyncs).toHaveLength(0);
    h.controller.dispose();
  });
});
