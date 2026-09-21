import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import type { FbHudState } from '../../app/store';
import {
  FootballGameController,
  type FbFileClock,
  type FbStageTile,
} from '../FootballGameController';
import { TRICAM_DWELL_MS, TRICAM_SWITCH_MS } from '../director';

const ROOM = 'room-fb';
const CLIP = 'fb/demo/test/pano.mp4';
const CLIP_MS = 30_000;

const CAM = {
  model: 'tilted-cylinder',
  cx: 56.6025,
  d: 7.506,
  hc: 9.3208,
  f: 1593.9699,
  x0: 2239.0293,
  y0: 1068.1905,
  tilt: 0.4357,
};

/** Synthetic sidecars: a ball rolling left → right at 50 px/s, three tags. */
function telemetryFiles(opts?: { centroidX?: number; noBall?: boolean }) {
  const samples: number[][] = [];
  for (let t = 0; t <= CLIP_MS; t += 40) {
    samples.push([t, 1000 + t * 0.05, 900, 20 + t / 1000, 34]);
  }
  const n = CLIP_MS / 100 + 1;
  const cx = opts?.centroidX ?? 50;
  // Tag 2 sprints at 8.4 m/s (30.2 km/h) between 3.0 and 4.5 s.
  const tag = (id: number, x: number, y: number, v: number) => ({
    id,
    firstMs: 0,
    lastMs: CLIP_MS,
    x: Array.from({ length: n }, () => x),
    y: Array.from({ length: n }, () => y),
    v: Array.from({ length: n }, (_, i) =>
      id === 2 && i >= 30 && i <= 45 ? 8.4 : v,
    ),
    d: Array.from({ length: n }, (_, i) => i * v * 0.1),
  });
  return {
    meta: {
      session: 'pano',
      fps: 25,
      width: 4450,
      height: 2000,
      panoWidth: 4450,
      panoHeight: 2000,
      t0Utc: 1,
    },
    zones: { pano: { w: 4450, h: 2000 }, camera: CAM },
    zxy: {
      hz: 10,
      durationMs: CLIP_MS,
      team: 'Tromsø',
      frame: 'pano',
      tags: [tag(1, cx - 5, 30, 1), tag(2, cx, 40, 2), tag(3, cx + 5, 50, 3)],
      sprints: [
        { tag: 2, startMs: 3000, endMs: 4500, topKmh: 30.2, meters: 11 },
      ],
    },
    ...(opts?.noBall ? {} : { ball: { fps: 25, w: 4450, h: 2000, samples } }),
  };
}

/** Kick-off 2 s BEFORE the clip starts (the clip opens at match clock 0:02). */
const EVENTS = {
  session: 'pano',
  kickoffMs: -2000,
  teams: {
    A: { name: 'Tromsø', attacks: 'left' },
    B: { name: 'Tottenham', attacks: 'right' },
  },
  events: [
    { tMs: 3000, kind: 'sprint', team: 'A', tag: 2, topKmh: 30.2, meters: 11 },
    {
      tMs: 5000,
      kind: 'shot',
      side: 'left',
      team: 'A',
      onTarget: true,
      speedMs: 20,
    },
    { tMs: 8000, kind: 'goal', side: 'left', team: null, candidate: true },
    { tMs: 12000, kind: 'corner', side: 'right', team: 'B' },
    { tMs: 15000, kind: 'kickoff' },
  ],
};

function harness(opts?: { withClipCut?: boolean }) {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const layouts: FbStageTile[][] = [];
  const hudApplies: (FbHudState | null)[] = [];
  const qrCalls: string[] = [];
  const replayClips: { file: string; offsetMs: number; inputId: string }[] = [];
  const replayUnregisters: string[] = [];
  const connected = new Set<string>();
  const removed: string[] = [];
  const fileClocks = new Map<string, FbFileClock>();
  const resyncs: number[] = [];
  const clipEvents = new Map<string, unknown>();
  const clipTelemetry = new Map<string, unknown>();
  const telemetryReads: string[] = [];
  const clipCuts: {
    clip: string;
    mediaMs: number;
    eventId: string;
    crop?: { x: number; y: number; w: number; h: number };
  }[] = [];

  const controller = new FootballGameController(ROOM, {
    broadcast: (event) => events.push(event),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    removeInput: async (inputId) => {
      removed.push(inputId);
      connected.delete(inputId);
    },
    setAnimTickMs: () => {},
    layoutTiles: async (tiles) => {
      for (const inputId of connected) {
        if (!tiles.some((t) => t.inputId === inputId)) {
          throw new Error(
            `layoutTiles omitted connected input ${inputId} — RoomState would auto-append it`,
          );
        }
      }
      layouts.push(tiles.map((t) => ({ ...t })));
    },
    runInputTransition: () => {},
    isInputConnected: (inputId) => connected.has(inputId),
    getResolution: () => ({ width: 1280, height: 720 }),
    publishHud: (state) => hudApplies.push(state),
    registerJoinQr: async (url) => {
      qrCalls.push(url);
      return `fb-qr-${qrCalls.length}`;
    },
    registerReplayClip: async (file, offsetMs) => {
      const inputId = `fb-replay-${replayClips.length + 1}`;
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
      const json = clipEvents.get(clip);
      return json === undefined
        ? null
        : { fileName: clip.replace(/\.mp4$/i, '.events.json'), json };
    },
    loadClipTelemetry: async (clip) => {
      telemetryReads.push(clip);
      return (clipTelemetry.get(clip) as never) ?? null;
    },
    ...(opts?.withClipCut
      ? {
          cutReplayClip: async (
            clip: string,
            mediaMs: number,
            eventId: string,
            crop?: { x: number; y: number; w: number; h: number },
          ) => {
            clipCuts.push({ clip, mediaMs, eventId, crop });
            await new Promise((r) => setTimeout(r, 300));
            return { file: `cut-${clipCuts.length}.mp4`, durationMs: 8000 };
          },
        }
      : {}),
  });

  return {
    controller,
    events,
    sent,
    layouts,
    hudApplies,
    qrCalls,
    replayClips,
    replayUnregisters,
    connected,
    removed,
    fileClocks,
    resyncs,
    clipEvents,
    clipTelemetry,
    telemetryReads,
    clipCuts,
    ofType<T extends RoomEvent['type']>(type: T) {
      return events.filter((e) => e.type === type) as Extract<
        RoomEvent,
        { type: T }
      >[];
    },
    lastState() {
      const s = this.ofType('fb_state');
      return s[s.length - 1];
    },
    lastMatch() {
      const s = this.ofType('fb_match');
      return s[s.length - 1];
    },
    errorsFor(clientId: string) {
      return sent
        .filter((s) => s.clientId === clientId && s.event.type === 'fb_error')
        .map((s) => s.event) as Extract<RoomEvent, { type: 'fb_error' }>[];
    },
    lastHud(): FbHudState | null {
      return hudApplies.length ? hudApplies[hudApplies.length - 1] : null;
    },
    lastLayout(): FbStageTile[] {
      return layouts[layouts.length - 1] ?? [];
    },
  };
}

type H = ReturnType<typeof harness>;

/** The panorama clip attached with sidecars + a file clock anchored now, moderator joined. */
async function panoAttached(
  h: H,
  opts?: { events?: unknown; telemetry?: unknown; delayMs?: number },
) {
  const inputId = `${ROOM}::mp4::pano`;
  h.connected.add(inputId);
  if (opts?.telemetry !== null)
    h.clipTelemetry.set(CLIP, opts?.telemetry ?? telemetryFiles());
  if (opts?.events !== null) h.clipEvents.set(CLIP, opts?.events ?? EVENTS);
  h.fileClocks.set(inputId, {
    anchorWallMs: Date.now(),
    playFromMs: 0,
    durationMs: CLIP_MS,
    delayMs: opts?.delayMs ?? 0,
  });
  h.controller.handleMessage('mod', {
    type: 'fb_commentator_join',
    name: 'MOD',
  });
  h.controller.attachExternalCam(
    'pano',
    inputId,
    { width: 4450, height: 2000 },
    CLIP,
  );
  await vi.advanceTimersByTimeAsync(0);
  return inputId;
}

async function started(h: H, opts?: Parameters<typeof panoAttached>[1]) {
  const inputId = await panoAttached(h, opts);
  h.controller.setConfig({
    halfMs: 120_000,
    replayDelayMs: 0,
    ai: { events: true },
  });
  // Let the AI EVENTS arm (tick) before kick-off.
  await vi.advanceTimersByTimeAsync(150);
  const r = h.controller.controlMatch({ action: 'start' });
  expect(r.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(0);
  return inputId;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('FootballGameController — file cams + telemetry', () => {
  it('attaches the panorama, loads its sidecars and stages it in the lobby', async () => {
    const h = harness();
    const inputId = await panoAttached(h);
    const s = h.lastState();
    expect(s.session).toBe('pano');
    expect(s.cams.pano.fileName).toBe(CLIP);
    expect(s.cams.pano.telemetry).toMatchObject({
      ball: true,
      zxy: true,
      zones: true,
    });
    expect(h.telemetryReads).toEqual([CLIP]);
    // Lobby HUD carries the telemetry flags; the panorama is on stage.
    const hud = h.lastHud();
    expect(hud?.stage.scene).toBe('lobby');
    expect(hud?.lobby?.telemetry).toMatchObject({ ball: true, zxy: true });
    expect(h.lastLayout().some((t) => t.inputId === inputId)).toBe(true);
    expect(h.controller.isEngaged()).toBe(true);
    expect(h.controller.fileCamInputIds()).toEqual([{ role: 'pano', inputId }]);
    h.controller.dispose();
  });

  it('a clip without sidecars still stages, with the telemetry flagged off', async () => {
    const h = harness();
    await panoAttached(h, { telemetry: null, events: null });
    await vi.advanceTimersByTimeAsync(200);
    const s = h.lastState();
    expect(s.cams.pano.telemetry).toMatchObject({
      ball: false,
      zxy: false,
      zones: false,
      events: false,
    });
    expect(s.aiEvents).toBe('no_events');
    h.controller.dispose();
  });

  it('kick_cam releases the slot and removes the input', async () => {
    const h = harness();
    const inputId = await panoAttached(h);
    const r = h.controller.controlMatch({ action: 'kick_cam', role: 'pano' });
    expect(r.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.removed).toEqual([inputId]);
    expect(h.lastState().session).toBeNull();
    h.controller.dispose();
  });

  it('restarts looping clips just before they wrap', async () => {
    const h = harness();
    await panoAttached(h);
    await vi.advanceTimersByTimeAsync(CLIP_MS - 500);
    expect(h.resyncs.length).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.resyncs.length).toBe(1);
    // The same clock signature does not resync twice.
    await vi.advanceTimersByTimeAsync(300);
    expect(h.resyncs.length).toBe(1);
    h.controller.dispose();
  });
});

describe('FootballGameController — AI EVENTS', () => {
  it('arms the annotated plays on the file clock and fires them on time', async () => {
    const h = harness();
    await started(h);
    const armed = h.lastState();
    expect(armed.aiEvents).toBe('armed');
    // kickoff is not a play; the four others are within the default kinds.
    expect(armed.aiRun?.total).toBe(4);
    expect(armed.cams.pano.telemetry.events).toBe(true);

    await vi.advanceTimersByTimeAsync(3200);
    let fired = h.ofType('fb_event');
    expect(fired.map((e) => e.event.kind)).toEqual(['sprint']);
    expect(fired[0].event.status).toBe('confirmed');
    expect(fired[0].event.source).toBe('ai');
    expect(fired[0].event.tag).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    fired = h.ofType('fb_event');
    const shot = fired.find((e) => e.event.kind === 'shot')!;
    expect(shot).toBeTruthy();
    expect(shot.event.team).toBe('A');
    expect(shot.event.status).toBe('confirmed');
    expect(shot.event.mediaMs).toBe(5000);
    expect(shot.event.onTarget).toBe(true);
    expect(h.lastState().teams.A.shots).toBe(1);
    expect(h.lastState().teams.A.shotsOnTarget).toBe(1);
    // Banner on air, immediately (no hold without a model).
    const hud = h.lastHud();
    expect(hud?.lastEvent?.kind).toBe('shot');
    expect(hud?.lastEvent?.showBanner).toBe(true);
    h.controller.dispose();
  });

  it('a goal candidate is a REF CALL: pending until the moderator assigns a team', async () => {
    const h = harness();
    await started(h);
    await vi.advanceTimersByTimeAsync(8200);
    const goal = h
      .ofType('fb_event')
      .find((e) => e.event.kind === 'goal' && e.kind === 'fired')!;
    expect(goal).toBeTruthy();
    expect(goal.event.status).toBe('pending');
    expect(goal.event.aiConfidence).toBe(0.5);
    expect(h.lastState().pending.map((e) => e.id)).toEqual([goal.event.id]);
    expect(h.lastHud()?.pendingCount).toBe(1);
    expect(h.lastState().teams.A.score).toBe(0);

    // A spectator cannot resolve it.
    h.controller.handleMessage('spec', {
      type: 'fb_event_resolve',
      eventId: goal.event.id,
      team: 'A',
    });
    expect(h.errorsFor('spec').map((e) => e.code)).toEqual(['not_commentator']);

    h.controller.handleMessage('mod', {
      type: 'fb_event_resolve',
      eventId: goal.event.id,
      team: 'A',
    });
    const assigned = h.ofType('fb_event').find((e) => e.kind === 'assigned')!;
    expect(assigned.event.status).toBe('confirmed');
    expect(assigned.scores).toEqual({ A: 1, B: 0 });
    expect(h.lastState().pending).toEqual([]);
    expect(h.lastHud()?.teams.A.score).toBe(1);
    expect(h.lastHud()?.lastEvent?.kind).toBe('goal');
    expect(h.lastHud()?.lastEvent?.pending).toBe(false);

    // UNDO voids the newest confirmed goal.
    h.controller.handleMessage('mod', { type: 'fb_event_undo' });
    const undone = h.ofType('fb_event').find((e) => e.kind === 'undone')!;
    expect(undone.event.id).toBe(goal.event.id);
    expect(undone.scores).toEqual({ A: 0, B: 0 });
    h.controller.dispose();
  });

  it('plays are skipped while the match is not live and re-selected on a kinds change', async () => {
    const h = harness();
    await panoAttached(h);
    h.controller.setConfig({ ai: { events: true } });
    await vi.advanceTimersByTimeAsync(3200);
    // Not kicked off: the sprint fired into nothing.
    expect(h.ofType('fb_event').length).toBe(0);
    expect(h.lastState().aiRun?.skipped).toBe(1);
    h.controller.setConfig({ ai: { kinds: ['shot'] } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastState().aiRun?.total).toBe(1);
    h.controller.setConfig({ ai: { events: false } });
    expect(h.lastState().aiEvents).toBe('off');
    expect(h.lastState().aiRun).toBeNull();
    h.controller.dispose();
  });

  it('a manual event lands confirmed at once and the ledger tallies per team', async () => {
    const h = harness();
    await started(h, { events: null });
    expect(h.lastState().aiEvents).toBe('no_events');
    h.controller.handleMessage('mod', {
      type: 'fb_event_add',
      team: 'B',
      kind: 'corner',
    });
    h.controller.handleMessage('mod', {
      type: 'fb_event_add',
      team: 'B',
      kind: 'goal',
    });
    const s = h.lastState();
    expect(s.teams.B.corners).toBe(1);
    expect(s.teams.B.score).toBe(1);
    expect(s.recent[0].source).toBe('manual');
    expect(h.lastMatch().scores).toEqual({ A: 0, B: 1 });
    // Events land with the clip's media time.
    expect(s.recent[0].mediaMs).toBeGreaterThanOrEqual(0);
    h.controller.dispose();
  });
});

describe('FootballGameController — match flow + clock', () => {
  it('runs the clock from the clip kick-off, through half time to full time', async () => {
    const h = harness();
    await started(h);
    // The clip opened 2 s after kick-off and played ~0.15 s before KICK-OFF
    // was pressed: the clock starts at ~0:02 and runs with the wall clock.
    expect(h.lastMatch().clockFromClip).toBe(true);
    expect(h.lastMatch().elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(h.lastMatch().elapsedMs).toBeLessThan(2400);
    await vi.advanceTimersByTimeAsync(12_000);
    let m = h.controller.getMatchSnapshot();
    expect(m.phase).toBe('live');
    expect(m.elapsedMs).toBeGreaterThanOrEqual(14_000);
    expect(m.elapsedMs).toBeLessThan(14_400);
    expect(h.lastHud()?.clock.phase).toBe('live');
    expect(h.lastHud()?.clock.period).toBe(1);

    expect(
      h.controller.controlMatch({ action: 'pause' }).error,
    ).toBeUndefined();
    const frozen = h.controller.getMatchSnapshot().elapsedMs;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.controller.getMatchSnapshot().elapsedMs).toBe(frozen);
    expect(
      h.controller.controlMatch({ action: 'resume' }).error,
    ).toBeUndefined();

    expect(
      h.controller.controlMatch({ action: 'half_time' }).error,
    ).toBeUndefined();
    expect(h.controller.getMatchSnapshot().phase).toBe('halftime');
    expect(h.lastHud()?.banner?.text).toBe('HALF TIME');
    expect(
      h.controller.controlMatch({ action: 'second_half' }).error,
    ).toBeUndefined();
    m = h.controller.getMatchSnapshot();
    expect(m.period).toBe(2);
    expect(m.elapsedMs).toBeLessThan(500);
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.controller.getMatchSnapshot().elapsedMs).toBeGreaterThan(2500);

    h.controller.handleMessage('mod', {
      type: 'fb_event_add',
      team: 'A',
      kind: 'goal',
    });
    expect(h.controller.controlMatch({ action: 'end' }).error).toBeUndefined();
    const ended = h.lastState();
    expect(ended.phase).toBe('ended');
    expect(ended.winner).toBe('A');
    expect(ended.tracking.length).toBe(3);
    // The final banner plays out before the full-time card takes the stage.
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(h.lastHud()?.banner?.text).toBe('TROMSØ WIN');
    await vi.advanceTimersByTimeAsync(3700);
    const hud = h.lastHud();
    expect(hud?.ended?.winner).toBe('A');
    expect(hud?.ended?.teams.A.score).toBe(1);
    expect(hud?.ended?.topSpeed?.tag).toBe(2);
    expect(hud?.stage.scene).toBe('ended');

    expect(
      h.controller.controlMatch({ action: 'reset' }).error,
    ).toBeUndefined();
    expect(h.lastState().phase).toBe('lobby');
    expect(h.lastState().recent).toEqual([]);
    h.controller.dispose();
  });

  it('rejects out-of-order actions', async () => {
    const h = harness();
    await panoAttached(h);
    expect(h.controller.controlMatch({ action: 'pause' }).error?.code).toBe(
      'bad_action',
    );
    expect(
      h.controller.controlMatch({ action: 'second_half' }).error?.code,
    ).toBe('bad_action');
    expect(
      h.controller.controlMatch({ action: 'start' }).error,
    ).toBeUndefined();
    expect(h.controller.controlMatch({ action: 'start' }).error?.code).toBe(
      'bad_action',
    );
    h.controller.controlMatch({ action: 'half_time' });
    expect(h.controller.controlMatch({ action: 'half_time' }).error?.code).toBe(
      'bad_action',
    );
    // The moderator gets the error over the socket.
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_match',
      action: 'pause',
    });
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['bad_action']);
    h.controller.dispose();
  });

  it('a wall clock runs when the clip has no kick-off', async () => {
    const h = harness();
    await started(h, { events: null });
    expect(h.lastMatch().clockFromClip).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    const e = h.controller.getMatchSnapshot().elapsedMs;
    expect(e).toBeGreaterThanOrEqual(5000);
    expect(e).toBeLessThan(5300);
    h.controller.dispose();
  });
});

describe('FootballGameController — virtual director', () => {
  it('follows the ball with an oversized panorama tile and reports the crop', async () => {
    const h = harness();
    const inputId = await started(h);
    await vi.advanceTimersByTimeAsync(1100);
    const d = h.lastState().director;
    expect(d.session).toBe('pano');
    expect(d.view).toBe('auto');
    expect(d.effectiveView).toBe('follow');
    expect(d.ballTracked).toBe(true);
    expect(d.crop).toBeTruthy();
    expect(d.crop!.w).toBeGreaterThanOrEqual(1600);
    expect(d.crop!.w).toBeLessThan(2300);
    // The ball (≈ px 1050 at 1 s) sits inside the crop.
    expect(d.crop!.x).toBeLessThan(1100);
    expect(d.crop!.x + d.crop!.w).toBeGreaterThan(1100);
    const main = h.lastLayout().find((t) => t.inputId === inputId)!;
    expect(main.width).toBeGreaterThan(1280);
    expect(main.x).toBeLessThanOrEqual(0);
    expect(main.transitionDurationMs).toBe(250);
    expect(main.transitionEasing).toBeUndefined();
    expect(h.ofType('fb_director').length).toBeGreaterThan(0);
    expect(h.lastHud()?.stage.crop?.width).toBe(d.crop!.w);
    h.controller.dispose();
  });

  it('the moderator switches WIDE / LEFT GOAL / back to AUTO with an eased move', async () => {
    const h = harness();
    const inputId = await started(h);
    await vi.advanceTimersByTimeAsync(600);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'wide' },
    });
    await vi.advanceTimersByTimeAsync(0);
    let d = h.lastState().director;
    expect(d.view).toBe('wide');
    expect(d.effectiveView).toBe('wide');
    expect(d.crop!.h).toBe(2000);
    expect(d.crop!.w).toBe(Math.round(2000 * (1280 / 720)));
    let main = h.lastLayout().find((t) => t.inputId === inputId)!;
    expect(main.transitionDurationMs).toBe(600);
    expect(main.transitionEasing).toBe('cubic_bezier_ease_in_out');

    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'left-goal' },
    });
    await vi.advanceTimersByTimeAsync(0);
    d = h.lastState().director;
    expect(d.effectiveView).toBe('left-goal');
    expect(d.crop!.x).toBeLessThan(1000);

    // A tricam-only view is refused on the panorama.
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'centre' },
    });
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['invalid_view']);

    h.controller.setConfig({ director: { switchStyle: 'cut' } });
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'auto' },
    });
    await vi.advanceTimersByTimeAsync(0);
    d = h.lastState().director;
    expect(d.view).toBe('auto');
    expect(d.effectiveView).toBe('follow');
    main = h.lastLayout().find((t) => t.inputId === inputId)!;
    expect(main.transitionDurationMs).toBe(0);
    h.controller.dispose();
  });

  it('drifts to the wide view when the clip has no ball track', async () => {
    const h = harness();
    await started(h, { telemetry: telemetryFiles({ noBall: true }) });
    await vi.advanceTimersByTimeAsync(6000);
    const d = h.lastState().director;
    expect(d.effectiveView).toBe('follow');
    expect(d.ballTracked).toBe(false);
    expect(d.crop!.w).toBeGreaterThan(3000);
    h.controller.dispose();
  });

  it('puts the tracking minimap on air and lets the moderator hide it', async () => {
    const h = harness();
    await started(h);
    await vi.advanceTimersByTimeAsync(3300);
    const mm = h.lastHud()?.minimap;
    expect(mm).toBeTruthy();
    expect(mm!.players.map((p) => p.tag)).toEqual([1, 2, 3]);
    expect(mm!.ball).toBeTruthy();
    expect(mm!.sprint?.tag).toBe(2);
    expect(mm!.top).toEqual({ tag: 2, kmh: 30 });
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_minimap',
      enabled: false,
    });
    expect(h.lastHud()?.minimap).toBeNull();
    expect(h.lastState().minimap).toBe(false);
    h.controller.dispose();
  });

  it('lets the moderator resize the minimap (1–5, clamped)', async () => {
    const h = harness();
    await started(h);
    await vi.advanceTimersByTimeAsync(3300);
    expect(h.lastHud()?.minimap?.size).toBe(1);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_minimap_size',
      size: 4,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.lastHud()?.minimap?.size).toBe(4);
    expect(h.lastState().config.minimapSize).toBe(4);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_minimap_size',
      size: 9,
    });
    expect(h.lastState().config.minimapSize).toBe(5);
    h.controller.handleMessage('stranger', {
      type: 'fb_commentator_minimap_size',
      size: 2,
    });
    expect(h.lastState().config.minimapSize).toBe(5);
    h.controller.dispose();
  });

  it('takes follow tuning from the moderator, clamped, and the legacy preset', async () => {
    const h = harness();
    await started(h);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_director',
      director: { smoothTimeMs: 99_999, deadZonePx: -5, maxSpeedPxS: 800 },
    });
    const d = h.lastState().config.director;
    expect(d.smoothTimeMs).toBe(3000);
    expect(d.deadZonePx).toBe(0);
    expect(d.maxSpeedPxS).toBe(800);
    h.controller.handleMessage('stranger', {
      type: 'fb_commentator_director',
      director: { maxSpeedPxS: 4000 },
    });
    expect(h.lastState().config.director.maxSpeedPxS).toBe(800);
    expect(
      h.controller.setConfig({ director: { smoothing: 'snappy' } }).director
        .smoothTimeMs,
    ).toBe(350);
    h.controller.dispose();
  });
});

describe('FootballGameController — instant replay', () => {
  it('cuts the shot from the clip with the follow crop and opens the replay scene', async () => {
    const h = harness({ withClipCut: true });
    const inputId = await started(h);
    // Only shots replay here (the goal candidate at 8 s would cut it short).
    h.controller.setConfig({ ai: { replayOn: ['shot'] } });
    await vi.advanceTimersByTimeAsync(5200);
    expect(h.clipCuts.length).toBe(1);
    const cut = h.clipCuts[0];
    expect(cut.clip).toBe(CLIP);
    expect(cut.mediaMs).toBe(5000);
    expect(cut.crop).toBeTruthy();
    expect(cut.crop!.w).toBe(1800);
    expect(cut.crop!.h).toBe(Math.round(1800 / (1280 / 720)));
    // The ball was around px 1200 at media 4–5.5 s.
    expect(cut.crop!.x + cut.crop!.w / 2).toBeGreaterThan(1100);
    expect(cut.crop!.x + cut.crop!.w / 2).toBeLessThan(1300);

    await vi.advanceTimersByTimeAsync(400);
    expect(h.replayClips.length).toBe(1);
    expect(h.replayClips[0].file).toBe('cut-1.mp4');
    const hud = h.lastHud();
    expect(hud?.stage.scene).toBe('replay');
    expect(hud?.stage.replay?.inputId).toBe('fb-replay-1');
    expect(hud?.stage.replay?.title).toBe('SHOT');
    expect(hud?.stage.replay?.team).toBe('A');
    // The replay window is HUD chrome over the unchanged live layout: the
    // panorama stays the only staged tile, the clip input is not laid out.
    expect(h.lastLayout().some((t) => t.inputId === inputId)).toBe(true);
    expect(h.lastLayout().some((t) => t.inputId === 'fb-replay-1')).toBe(false);

    await vi.advanceTimersByTimeAsync(9000);
    expect(h.lastHud()?.stage.scene).toBe('live');
    expect(h.replayUnregisters).toEqual(['fb-replay-1']);
    h.controller.dispose();
  });

  it('no replay when the moderator turns it off', async () => {
    const h = harness({ withClipCut: true });
    await started(h);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_replay',
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(5200);
    expect(h.clipCuts.length).toBe(0);
    h.controller.dispose();
  });
});

describe('FootballGameController — three cameras', () => {
  async function tricam(h: H, centroidX: number) {
    const ids = {
      left: `${ROOM}::mp4::left`,
      centre: `${ROOM}::mp4::centre`,
      right: `${ROOM}::mp4::right`,
    };
    const files = telemetryFiles({ centroidX });
    for (const role of ['left', 'centre', 'right'] as const) {
      const clip = `fb/tricam/cam-${role}.mp4`;
      h.connected.add(ids[role]);
      h.clipTelemetry.set(clip, {
        meta: { ...files.meta, session: 'tricam', width: 1280, height: 960 },
        zxy: files.zxy,
      });
      h.fileClocks.set(ids[role], {
        anchorWallMs: Date.now(),
        playFromMs: 0,
        durationMs: CLIP_MS,
        delayMs: 0,
      });
      h.controller.attachExternalCam(
        role,
        ids[role],
        { width: 1280, height: 960 },
        clip,
      );
    }
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_join',
      name: 'MOD',
    });
    await vi.advanceTimersByTimeAsync(0);
    return ids;
  }

  it('kicking a camera only drops the manual view that needed it', async () => {
    const h = harness();
    await tricam(h, 50);
    h.controller.controlMatch({ action: 'start' });
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'centre' },
    });
    h.controller.controlMatch({ action: 'kick_cam', role: 'left' });
    expect(h.lastState().director.view).toBe('centre');
    h.controller.controlMatch({ action: 'kick_cam', role: 'centre' });
    expect(h.lastState().director.view).toBe('auto');
    h.controller.dispose();
  });

  it('a reaped input frees its slot instead of reading CONNECTING for ever', async () => {
    const h = harness();
    const ids = await tricam(h, 50);
    h.connected.delete(ids.right);
    h.controller.onInputsRemoved([ids.right]);
    await vi.advanceTimersByTimeAsync(0);
    const cams = h.lastState().cams;
    expect(cams.right.fileName ?? null).toBeNull();
    expect(cams.centre.fileName).toBe('fb/tricam/cam-centre.mp4');
    expect(h.removed).toEqual([]);
    h.controller.dispose();
  });

  it('cuts to the camera of the third the players occupy, with a dwell', async () => {
    const h = harness();
    const ids = await tricam(h, 15);
    expect(h.lastState().session).toBe('tricam');
    expect(
      h.controller.controlMatch({ action: 'start' }).error,
    ).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300);
    // Opens on the centre camera.
    let d = h.lastState().director;
    expect(d.cam).toBe('centre');
    expect(d.crop).toBeNull();
    const centreMain = h.lastLayout().find((t) => t.inputId === ids.centre)!;
    expect(centreMain.width).toBe(1280);
    expect(centreMain.height).toBe(720);

    await vi.advanceTimersByTimeAsync(TRICAM_SWITCH_MS + TRICAM_DWELL_MS + 400);
    d = h.lastState().director;
    expect(d.cam).toBe('left');
    expect(d.effectiveView).toBe('left');
    const layout = h.lastLayout();
    expect(layout.find((t) => t.inputId === ids.left)!.width).toBe(1280);
    expect(layout.find((t) => t.inputId === ids.centre)!.width).toBe(1);
    expect(layout.find((t) => t.inputId === ids.right)!.width).toBe(1);

    // The moderator forces the right camera.
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'right' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastState().director.cam).toBe('right');
    expect(h.lastLayout().find((t) => t.inputId === ids.right)!.width).toBe(
      1280,
    );
    h.controller.dispose();
  });
});

describe('FootballGameController — HUD hold', () => {
  it('holds the HUD by the clip delay when a model runs on the clip', async () => {
    const h = harness();
    await started(h, { delayMs: 1500 });
    const before = h.hudApplies.length;
    h.controller.handleMessage('mod', {
      type: 'fb_event_add',
      team: 'A',
      kind: 'goal',
    });
    // Held: the score lands 1.5 s later.
    expect(h.lastHud()?.teams.A.score ?? 0).toBe(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(h.hudApplies.length).toBeGreaterThan(before);
    expect(h.lastHud()?.teams.A.score).toBe(1);
    h.controller.dispose();
  });

  it('registers the panel QR and shows it in the lobby', async () => {
    const h = harness();
    await panoAttached(h);
    h.controller.setConfig({
      joinUrls: { commentator: 'https://x/football-game/panel/room-fb' },
      joinLabel: 'x/panel',
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.qrCalls).toEqual(['https://x/football-game/panel/room-fb']);
    expect(h.lastHud()?.lobby?.qr).toEqual({
      imageId: 'fb-qr-1',
      label: 'x/panel',
    });
    expect(h.lastHud()?.lobby?.commentatorName).toBe('MOD');
    h.controller.dispose();
  });
});

describe('FootballGameController — operator regressions', () => {
  it("a pause / resume keeps the moderator's manual view; a new segment returns to AUTO", async () => {
    const h = harness();
    await started(h);
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'wide' },
    });
    expect(h.lastState().director.view).toBe('wide');
    h.controller.controlMatch({ action: 'pause' });
    expect(h.lastState().director.view).toBe('wide');
    h.controller.controlMatch({ action: 'resume' });
    expect(h.lastState().director.view).toBe('wide');
    h.controller.controlMatch({ action: 'half_time' });
    expect(h.lastState().director.view).toBe('auto');
    h.controller.dispose();
  });

  it('UNDO with no confirmed play leaves a pending REF CALL alone', async () => {
    const h = harness();
    await started(h, {
      events: {
        ...EVENTS,
        events: [
          {
            tMs: 1000,
            kind: 'goal',
            side: 'left',
            team: null,
            candidate: true,
          },
        ],
      },
    });
    await vi.advanceTimersByTimeAsync(1300);
    expect(h.lastState().pending).toHaveLength(1);
    h.controller.handleMessage('mod', { type: 'fb_event_undo' });
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['unknown_event']);
    expect(h.lastState().pending).toHaveLength(1);
    h.controller.dispose();
  });

  it('a stranger cannot take the seat of a connected moderator; a gone one frees it', async () => {
    const h = harness();
    await panoAttached(h);
    h.controller.handleMessage('intruder', {
      type: 'fb_commentator_join',
      name: 'EVE',
    });
    expect(h.errorsFor('intruder').map((e) => e.code)).toEqual(['role_taken']);
    expect(h.lastState().commentator?.name).toBe('MOD');

    // The holder resumes on a new socket with its key.
    const joined = h.sent.find((s) => s.event.type === 'fb_commentator_joined')!
      .event as Extract<RoomEvent, { type: 'fb_commentator_joined' }>;
    h.controller.handleMessage('mod-2', {
      type: 'fb_commentator_join',
      name: 'MOD',
      commentatorKey: joined.commentatorKey,
    });
    expect(h.errorsFor('mod-2')).toEqual([]);

    // Dropped for good: the seat frees itself and the next join succeeds.
    h.controller.handleDisconnect('mod-2');
    expect(h.lastState().commentator?.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(91_000);
    expect(h.lastState().commentator).toBeNull();
    h.controller.handleMessage('intruder', {
      type: 'fb_commentator_join',
      name: 'EVE',
    });
    expect(h.lastState().commentator?.name).toBe('EVE');
    h.controller.dispose();
  });

  it('the second half keeps the footage sides: AI plays are credited as in the first', async () => {
    const h = harness();
    await started(h);
    h.controller.setConfig({ attacksLeft: 'B' });
    h.controller.controlMatch({ action: 'half_time' });
    h.controller.controlMatch({ action: 'second_half' });
    // The clip loops (30 s): the shot at 5 s airs again in the second lap.
    await vi.advanceTimersByTimeAsync(36_000);
    const shots = h
      .ofType('fb_event')
      .filter((e) => e.kind === 'fired' && e.event.kind === 'shot');
    expect(shots.length).toBeGreaterThan(0);
    // side 'left' + B attacks the left goal in the clip → B, in either half.
    expect(shots.every((e) => e.event.team === 'B')).toBe(true);
    h.controller.dispose();
  });

  it('TAKE THE LEAD airs only when the lead changes hands', async () => {
    const h = harness();
    await started(h, { events: null });
    const goal = (team: 'A' | 'B') =>
      h.controller.handleMessage('mod', {
        type: 'fb_event_add',
        team,
        kind: 'goal',
      });
    const leadBanner = () =>
      h.lastHud()?.banner?.kind === 'lead_change'
        ? h.lastHud()!.banner!.text
        : null;
    goal('A'); // 1–0: the opening goal is not a lead change
    expect(leadBanner()).toBeNull();
    goal('B'); // 1–1
    goal('A'); // 2–1: the same team back in front
    expect(leadBanner()).toBeNull();
    goal('B'); // 2–2
    goal('B'); // 2–3: the lead changes hands
    expect(leadBanner()).toMatch(/TAKE THE LEAD/);
    h.controller.dispose();
  });

  it('an unattended looping clip keeps the REF CALL queue and the ledger bounded, scores exact', async () => {
    const h = harness();
    await started(h, { events: null });
    for (let i = 0; i < 20; i++) h.controller.simulateEvent('goal', null);
    expect(h.lastState().pending).toHaveLength(12);

    for (let i = 0; i < 700; i++) h.controller.addManualEvent('A', 'corner');
    h.controller.addManualEvent('B', 'goal');
    const s = h.lastState();
    expect(s.teams.A.corners).toBe(700);
    expect(s.teams.B.score).toBe(1);
    const rows = (h.controller as unknown as { events: unknown[] }).events;
    expect(rows.length).toBeLessThanOrEqual(600);
    h.controller.dispose();
  });
});

describe('FootballGameController — host fallback + auto flow', () => {
  it('the host steers the view and the minimap without a moderator seat', async () => {
    const h = harness();
    await started(h);
    expect(
      h.controller.hostSetViewOverride({ mode: 'view', view: 'wide' }),
    ).toBeNull();
    expect(h.lastState().director.view).toBe('wide');
    // The same refusals as the panel gets.
    expect(
      h.controller.hostSetViewOverride({ mode: 'view', view: 'centre' }),
    ).toMatch(/camera/);
    expect(h.controller.hostSetViewOverride({ mode: 'nope' })).toMatch(
      /Unknown/,
    );
    h.controller.setMinimapOn(false);
    expect(h.lastState().minimap).toBe(false);
    h.controller.dispose();
  });

  it('autoFlow blows HALF TIME and FULL TIME when the halves run out', async () => {
    const h = harness();
    await panoAttached(h, { events: null });
    h.controller.setConfig({
      halfMs: 60_000,
      clockFromClip: false,
      autoFlow: true,
    });
    h.controller.controlMatch({ action: 'start' });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(h.lastMatch().phase).toBe('live');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(h.lastMatch().phase).toBe('halftime');
    // The break is the moderator's: nothing restarts on its own.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.lastMatch().phase).toBe('halftime');
    h.controller.controlMatch({ action: 'second_half' });
    await vi.advanceTimersByTimeAsync(60_500);
    expect(h.lastMatch().phase).toBe('ended');
    h.controller.dispose();
  });

  it('without autoFlow the clock runs into added time', async () => {
    const h = harness();
    await panoAttached(h, { events: null });
    h.controller.setConfig({ halfMs: 60_000, clockFromClip: false });
    h.controller.controlMatch({ action: 'start' });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(h.lastMatch().phase).toBe('live');
    h.controller.dispose();
  });
});

describe('FootballGameController — moderator seat + kits + AI attribution', () => {
  it('the host frees the seat with kick_commentator; LEAVE hands it over', async () => {
    const h = harness();
    await panoAttached(h);
    expect(
      h.controller.controlMatch({ action: 'kick_commentator' }).error,
    ).toBeUndefined();
    expect(h.lastState().commentator).toBeNull();
    // The kicked socket lost its rights.
    h.controller.handleMessage('mod', {
      type: 'fb_commentator_view',
      override: { mode: 'auto' },
    });
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['not_commentator']);
    expect(
      h.controller.controlMatch({ action: 'kick_commentator' }).error?.code,
    ).toBe('bad_action');

    h.controller.handleMessage('next', {
      type: 'fb_commentator_join',
      name: 'NEXT',
    });
    h.controller.handleMessage('next', { type: 'fb_commentator_leave' });
    expect(h.lastState().commentator).toBeNull();
    h.controller.dispose();
  });

  it('the moderator recolours a kit; a bad colour or a spectator is refused', async () => {
    const h = harness();
    await panoAttached(h);
    h.controller.handleMessage('mod', {
      type: 'fb_team_color',
      team: 'B',
      color: '#6cabdd',
    });
    expect(h.lastState().teams.B.color).toBe('#6cabdd');
    expect(h.lastHud()?.teams.B.color).toBe('#6cabdd');
    h.controller.handleMessage('mod', {
      type: 'fb_team_color',
      team: 'B',
      color: 'sky',
    });
    h.controller.handleMessage('spec', {
      type: 'fb_team_color',
      team: 'A',
      color: '#ffffff',
    });
    expect(h.errorsFor('mod').map((e) => e.code)).toEqual(['invalid_color']);
    expect(h.errorsFor('spec').map((e) => e.code)).toEqual(['not_commentator']);
    expect(h.lastState().teams.B.color).toBe('#6cabdd');
    h.controller.dispose();
  });

  it('an AI play whose team is unknown waits for the moderator, whatever its kind', async () => {
    const h = harness();
    await started(h, {
      events: {
        ...EVENTS,
        events: [{ tMs: 1000, kind: 'corner', side: null, team: null }],
      },
    });
    await vi.advanceTimersByTimeAsync(1300);
    const corner = h.ofType('fb_event').find((e) => e.kind === 'fired')!;
    expect(corner.event.status).toBe('pending');
    expect(h.lastState().teams.A.corners + h.lastState().teams.B.corners).toBe(
      0,
    );
    h.controller.handleMessage('mod', {
      type: 'fb_event_resolve',
      eventId: corner.event.id,
      team: 'B',
    });
    expect(h.lastState().teams.B.corners).toBe(1);
    h.controller.dispose();
  });

  it('a looping clip airs its plays again every lap', async () => {
    const h = harness();
    await started(h);
    await vi.advanceTimersByTimeAsync(2 * CLIP_MS + 6_000);
    const shots = h
      .ofType('fb_event')
      .filter((e) => e.kind === 'fired' && e.event.kind === 'shot');
    expect(shots).toHaveLength(3);
    expect(h.lastState().teams.A.shots).toBe(3);
    h.controller.dispose();
  });
});
