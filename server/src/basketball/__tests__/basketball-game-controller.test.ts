import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import type { BbHudState } from '../../app/store';
import {
  BasketballGameController,
  type BbFileClock,
} from '../BasketballGameController';

const ROOM = 'room-bb';
const HOLD = 3000;

function harness(opts?: { withLiveness?: boolean }) {
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
  const frameRegisters: string[] = [];
  const connected = new Set<string>();
  const live = new Set<string>();
  // Playhead anchors of file cams (RoomState derives them from the engine).
  const fileClocks = new Map<string, BbFileClock>();
  const resyncs: number[] = [];
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
    registerShotFrameImage: async (url) => {
      frameRegisters.push(url);
      return `img-${frameRegisters.length}`;
    },
    unregisterShotFrameImage: () => {},
    getFileClock: (inputId) => fileClocks.get(inputId) ?? null,
    resyncFileCams: async () => {
      resyncs.push(Date.now());
    },
  });

  return {
    controller,
    events,
    sent,
    aiCalls,
    layouts,
    hudApplies,
    qrCalls,
    frameRegisters,
    connected,
    live,
    fileClocks,
    resyncs,
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
    expect(h.frameRegisters).toEqual([
      '/bb-shot-frames/m.jpg',
      '/bb-shot-frames/r.jpg',
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

function sentBall(h: H) {
  const found = [...h.sent].reverse().find((s) => s.event.type === 'bb_ball');
  return found?.event.type === 'bb_ball' ? found.event : null;
}

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

  it('cuts to the hoop cam immediately on a make and holds the score for the delayed video', async () => {
    const h = harness();
    const { hoopIn, courtIn } = await started(h);
    await vi.advanceTimersByTimeAsync(HOLD + 200); // let the start snapshot land
    expect(h.lastHud()?.stage.scene).toBe('live');
    h.controller.simulateShot('A', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    // Layout + stage flip now…
    const cut = h.layouts[h.layouts.length - 1];
    expect(cut.find((t) => t.inputId === hoopIn)).toMatchObject({
      width: 1920,
    });
    expect(cut.find((t) => t.inputId === courtIn)?.width).toBe(480);
    expect(h.lastHud()?.stage).toMatchObject({ scene: 'score', main: 'hoop' });
    // …but the score bug still shows the pre-make score for HUD_HOLD_MS.
    expect(h.lastHud()?.teams.A.score).toBe(0);
    await vi.advanceTimersByTimeAsync(HOLD + 100);
    expect(h.lastHud()?.teams.A.score).toBe(1);
    expect(h.lastHud()?.lastShot).toMatchObject({
      team: 'A',
      points: 1,
      showBanner: true,
    });
    // After the linger the stage returns to the live layout.
    await vi.advanceTimersByTimeAsync(2_600);
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(
      h.layouts[h.layouts.length - 1].find((t) => t.inputId === courtIn)?.width,
    ).toBe(1920);
    expect(h.lastState().scene).toBe('live');
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

  it('shows the ended card only after the held final score landed', async () => {
    const h = harness();
    await started(h, { targetPoints: 1, scoreLingerMs: 1000 });
    h.controller.simulateShot('B', 0.9);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastMatch().phase).toBe('ended');
    expect(h.lastHud()?.stage.scene).toBe('score');
    await vi.advanceTimersByTimeAsync(HOLD + 1_100);
    expect(h.lastHud()?.stage.scene).toBe('ended');
    expect(h.lastHud()?.ended).toMatchObject({ winner: 'B' });
    expect(h.lastHud()?.teams.B.score).toBe(1);
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
