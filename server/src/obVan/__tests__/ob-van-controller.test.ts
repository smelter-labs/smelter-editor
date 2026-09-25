import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ObLogEntry,
  ObRuleset,
  ObShot,
  ObState,
  RoomEvent,
} from '@smelter-editor/types';
import type { ObHudState } from '../../app/store';
import {
  NULL_ATTENTION,
  ObNullSignals,
  ObVanController,
  type ObControllerDeps,
  type ObFileClock,
} from '../ObVanController';
import type { ObBrain, ObBrainContext, ObDecision } from '../contracts';
import type { ObStageTile } from '../scene';

const ROOM = 'room-ob';
const T0 = 1_000_000;

type Transition = {
  inputId: string;
  type: string;
  durationMs: number;
  direction: 'in' | 'out';
  at: number;
};

/** A brain whose next decision the test sets. */
class StubBrain implements ObBrain {
  next: ((ctx: ObBrainContext) => ObDecision | null) | null = null;
  calls = 0;
  step(ctx: ObBrainContext): ObDecision | null {
    this.calls++;
    const d = this.next?.(ctx) ?? null;
    this.next = null;
    return d;
  }
  setRuleset(_r: ObRuleset): void {}
  reset(): void {}
}

function harness() {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const layouts: { at: number; tiles: ObStageTile[] }[] = [];
  const transitions: Transition[] = [];
  const volumes: { inputId: string; volume: number; at: number }[] = [];
  const hud: (ObHudState | null)[] = [];
  const connected = new Set<string>();
  const live = new Set<string>();
  const removed: string[] = [];
  const fileClocks = new Map<string, ObFileClock>();
  const replayCuts: { clip: string; mediaMs: number; id: string }[] = [];
  const replayRegs: string[] = [];
  const replayUnregs: string[] = [];
  let whipSeq = 0;
  const brain = new StubBrain();
  const signals = new ObNullSignals();

  const deps: ObControllerDeps = {
    broadcast: (e) => events.push(e),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    removeInput: async (inputId) => {
      removed.push(inputId);
      connected.delete(inputId);
      live.delete(inputId);
    },
    layoutTiles: async (tiles) => {
      for (const inputId of connected) {
        if (!tiles.some((t) => t.inputId === inputId))
          throw new Error(`layoutTiles omitted connected input ${inputId}`);
      }
      const ids = tiles.map((t) => t.inputId);
      if (new Set(ids).size !== ids.length)
        throw new Error(`duplicate tile in ${ids}`);
      layouts.push({ at: Date.now(), tiles: tiles.map((t) => ({ ...t })) });
    },
    runInputTransition: (inputId, t) =>
      transitions.push({ inputId, ...t, at: Date.now() }),
    setInputVolume: (inputId, volume) =>
      volumes.push({ inputId, volume, at: Date.now() }),
    isInputConnected: (inputId) => connected.has(inputId),
    isInputLive: (inputId) => live.has(inputId),
    getResolution: () => ({ width: 1280, height: 720 }),
    publishHud: (s) => hud.push(s),
    registerJoinQr: async (url) => `ob-qr-${url.length}`,
    registerGameCam: async () => {
      const inputId = `whip-${++whipSeq}`;
      connected.add(inputId);
      return { inputId, whipUrl: `http://whip/${inputId}`, bearerToken: 'tok' };
    },
    getSideChannelDelayMs: () => 3000,
    getFileClock: (inputId) => fileClocks.get(inputId) ?? null,
    cutReplayClip: async (clip, mediaMs, id) => {
      replayCuts.push({ clip, mediaMs, id });
      return { file: `file-${id}.mp4`, durationMs: 8000 };
    },
    registerReplayClip: async (file) => {
      replayRegs.push(file);
      return `ob-replay-${replayRegs.length}`;
    },
    unregisterReplayClip: (inputId) => replayUnregs.push(inputId),
    getPipelineTimeMs: () => 50_000,
  };

  const controller = new ObVanController(ROOM, deps, {
    createSignals: () => signals,
    createBrain: () => brain,
    attention: NULL_ATTENTION,
  });

  const attach = (
    n: number,
    role: 'speaker' | 'wide' | 'guest' = 'speaker',
  ) => {
    const inputId = `mp4-${n}`;
    connected.add(inputId);
    const r = controller.attachFileCam({
      role,
      inputId,
      fileName: `ob-demo/clip${n}.mp4`,
      width: 1920,
      height: 1080,
      talent: n === 1 ? 'Anna' : null,
    });
    if (!r.ok) throw new Error(r.message);
    return r.camId;
  };

  const lastState = (): ObState => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'ob_state') return e.state;
    }
    return controller.stateSnapshot();
  };
  const logs = (): ObLogEntry[] =>
    events.flatMap((e) => (e.type === 'ob_log' ? e.entries : []));
  const visibleOf = (tiles: ObStageTile[]) =>
    tiles.filter((t) => t.width > 1).map((t) => t.inputId);
  const lastLayout = () => layouts[layouts.length - 1].tiles;

  return {
    controller,
    deps,
    brain,
    signals,
    events,
    sent,
    layouts,
    transitions,
    volumes,
    hud,
    connected,
    live,
    removed,
    fileClocks,
    replayCuts,
    replayRegs,
    replayUnregs,
    attach,
    lastState,
    logs,
    visibleOf,
    lastLayout,
  };
}

const solo = (cam: string): ObShot => ({ kind: 'solo', cam });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ObVanController · cameras', () => {
  it('two file cams appear in ob_state with bus numbers and parked tiles', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2, 'wide');
    await vi.advanceTimersByTimeAsync(150);
    const s = h.lastState();
    expect(s.cams.map((c) => [c.id, c.number, c.role, c.kind, c.live])).toEqual(
      [
        [c1, 1, 'speaker', 'file', true],
        [c2, 2, 'wide', 'file', true],
      ],
    );
    expect(s.cams[0].talent).toBe('Anna');
    expect(h.visibleOf(h.lastLayout())).toEqual([]);
    expect(
      h
        .lastLayout()
        .map((t) => t.inputId)
        .sort(),
    ).toEqual(['mp4-1', 'mp4-2']);
    expect(h.hud.at(-1)?.setup?.cams).toHaveLength(2);
    h.controller.dispose();
  });

  it('a phone joins, gets an offer and tally on preview / program', async () => {
    const h = harness();
    h.controller.handleMessage('phone-1', {
      type: 'ob_cam_join',
      name: 'Kasia',
      role: 'guest',
      talent: 'Kasia N.',
    });
    const joined = h.sent.find((s) => s.event.type === 'ob_cam_joined');
    expect(joined?.event).toMatchObject({
      number: 1,
      role: 'guest',
      tally: 'off',
    });
    const camId =
      joined?.event.type === 'ob_cam_joined' ? joined.event.camId : '';
    h.controller.handleMessage('phone-1', {
      type: 'ob_cam_request',
      nativeWidth: 1080,
      nativeHeight: 1920,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(
      h.sent.find((s) => s.event.type === 'ob_cam_offer')?.event,
    ).toMatchObject({
      camId,
      inputId: 'whip-1',
    });
    // Not live until the WHIP heartbeat says so.
    expect(
      h.controller.operate({ op: 'shot', shot: solo(camId), mode: 'cut' }),
    ).toMatchObject({
      ok: false,
      code: 'cam_not_live',
    });
    h.live.add('whip-1');
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.controller.operate({ op: 'preview', shot: solo(camId) })).toEqual({
      ok: true,
    });
    const tallies = () =>
      h.sent.filter((s) => s.event.type === 'ob_tally').map((s) => s.event);
    expect(tallies().at(-1)).toMatchObject({
      camId,
      tally: 'preview',
      number: 1,
    });
    expect(h.controller.operate({ op: 'cut' })).toEqual({ ok: true });
    expect(tallies().at(-1)).toMatchObject({ camId, tally: 'program' });
    // Portrait phone: pillarboxed full height.
    const tile = h.lastLayout().find((t) => t.inputId === 'whip-1');
    expect(tile?.height).toBe(720);
    expect(tile?.width).toBeLessThan(500);
    h.controller.dispose();
  });

  it('re-join with the same camKey (phone EDIT) updates the seat in place', async () => {
    const h = harness();
    h.controller.handleMessage('p1', {
      type: 'ob_cam_join',
      name: 'A',
      role: 'wide',
    });
    const first = h.sent.find((s) => s.event.type === 'ob_cam_joined')?.event;
    if (first?.type !== 'ob_cam_joined') throw new Error('no join');
    h.controller.handleMessage('p1', { type: 'ob_cam_request' });
    await vi.advanceTimersByTimeAsync(10);
    h.controller.handleMessage('p1', {
      type: 'ob_cam_join',
      name: 'Podium',
      role: 'speaker',
      talent: 'Anna',
      camKey: first.camKey,
    });
    const again = h.sent
      .filter((s) => s.event.type === 'ob_cam_joined')
      .at(-1)?.event;
    expect(again).toMatchObject({
      camId: first.camId,
      number: 1,
      name: 'Podium',
      role: 'speaker',
      talent: 'Anna',
      camInputActive: true,
    });
    const cams = h.controller.stateSnapshot().cams;
    expect(cams).toHaveLength(1);
    expect(cams[0].inputId).toBe('whip-1');
    expect(h.removed).toEqual([]);
    h.controller.dispose();
  });

  it('a dropped phone keeps its seat, the camKey re-adopts it, the reaper frees it', async () => {
    const h = harness();
    h.controller.handleMessage('p1', {
      type: 'ob_cam_join',
      name: 'A',
      role: 'wide',
    });
    const joined = h.sent.find((s) => s.event.type === 'ob_cam_joined')?.event;
    const camKey = joined?.type === 'ob_cam_joined' ? joined.camKey : '';
    h.controller.handleDisconnect('p1');
    h.controller.handleMessage('p2', {
      type: 'ob_cam_join',
      name: 'A',
      role: 'wide',
      camKey,
    });
    const again = h.sent
      .filter((s) => s.event.type === 'ob_cam_joined')
      .at(-1)?.event;
    expect(again).toMatchObject({ number: 1, camKey });
    h.controller.handleDisconnect('p2');
    await vi.advanceTimersByTimeAsync(91_000);
    expect(h.controller.stateSnapshot().cams).toHaveLength(0);
    h.controller.dispose();
  });
});

describe('ObVanController · program bus', () => {
  it('TAKE dissolve: incoming under, outgoing on top fading, parked at settle; audio follows', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1']);
    expect(h.volumes.filter((v) => v.inputId === 'mp4-1').at(-1)?.volume).toBe(
      1,
    );
    expect(h.volumes.filter((v) => v.inputId === 'mp4-2').at(-1)?.volume).toBe(
      0,
    );

    h.controller.operate({ op: 'preview', shot: solo(c2) });
    const before = h.layouts.length;
    expect(
      h.controller.operate({
        op: 'take',
        transition: { type: 'dissolve', durationMs: 400 },
      }),
    ).toEqual({ ok: true });
    const start = h.layouts[before].tiles;
    expect(h.visibleOf(start)).toEqual(['mp4-2', 'mp4-1']);
    expect(h.transitions.at(-1)).toMatchObject({
      inputId: 'mp4-1',
      type: 'fade',
      direction: 'out',
      durationMs: 400,
    });
    // Incoming audio at once; outgoing still up until the settle.
    expect(h.volumes.filter((v) => v.inputId === 'mp4-2').at(-1)?.volume).toBe(
      1,
    );
    expect(h.volumes.filter((v) => v.inputId === 'mp4-1').at(-1)?.volume).toBe(
      1,
    );
    const s = h.controller.stateSnapshot();
    expect(s.program.transition).toMatchObject({
      type: 'dissolve',
      durationMs: 400,
    });
    expect(s.preview).toEqual(solo(c1));

    await vi.advanceTimersByTimeAsync(360);
    const parked = h.lastLayout();
    expect(h.visibleOf(parked)).toEqual(['mp4-2']);
    expect(h.layouts.length).toBe(before + 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.stateSnapshot().program.transition).toBeNull();
    expect(h.volumes.filter((v) => v.inputId === 'mp4-1').at(-1)?.volume).toBe(
      0,
    );
    h.controller.dispose();
  });

  it('CUT: one layout, no shader transition', () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.operate({ op: 'preview', shot: solo(c2) });
    const before = h.layouts.length;
    const nTrans = h.transitions.length;
    h.controller.operate({ op: 'cut' });
    expect(h.layouts.length).toBe(before + 1);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-2']);
    expect(h.lastLayout().every((t) => t.transitionDurationMs === 0)).toBe(
      true,
    );
    expect(h.transitions.length).toBe(nTrans);
    expect(h.controller.stateSnapshot().program.shot).toEqual(solo(c2));
    h.controller.dispose();
  });

  it('fade: the picture switches under full black, half-way through', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.operate({
      op: 'transition',
      transition: { type: 'fade', durationMs: 800 },
    });
    h.controller.operate({ op: 'shot', shot: solo(c2), mode: 'take' });
    expect(h.hud.at(-1)?.stage.dip).toMatchObject({
      inMs: 400,
      holdMs: 0,
      outMs: 400,
    });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1']);
    await vi.advanceTimersByTimeAsync(399);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1']);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-2']);
    expect(h.layouts.at(-1)?.at).toBe(T0 + 400);
    await vi.advanceTimersByTimeAsync(450);
    expect(h.hud.at(-1)?.stage.dip).toBeNull();
    h.controller.dispose();
  });

  it('standalone DIP draws the plate without touching the program', async () => {
    const h = harness();
    const c1 = h.attach(1);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    const n = h.layouts.length;
    h.controller.operate({ op: 'dip', holdMs: 200 });
    expect(h.hud.at(-1)?.stage.dip).toMatchObject({
      inMs: 300,
      holdMs: 200,
      outMs: 300,
    });
    await vi.advanceTimersByTimeAsync(850);
    expect(h.hud.at(-1)?.stage.dip).toBeNull();
    expect(h.layouts.length).toBe(n);
    h.controller.dispose();
  });

  it('a take in the middle of a dissolve parks the old outgoing picture at once', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    const c3 = h.attach(3);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.operate({ op: 'shot', shot: solo(c2), mode: 'take' });
    await vi.advanceTimersByTimeAsync(100);
    h.controller.operate({ op: 'shot', shot: solo(c3), mode: 'take' });
    const tiles = h.lastLayout();
    expect(h.visibleOf(tiles)).toEqual(['mp4-3', 'mp4-2']);
    expect(tiles.find((t) => t.inputId === 'mp4-1')?.width).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-3']);
    h.controller.dispose();
  });

  it('virtual shot: an oversized tile around the window; the spotlight follows it', async () => {
    const h = harness();
    h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({
      op: 'fx',
      effects: { grade: 'mono', spotlight: true },
    });
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'virtual', cam: c2, target: 'speaker', zoom: 'tight' },
      mode: 'cut',
    });
    const tile = h.lastLayout().find((t) => t.inputId === 'mp4-2');
    expect(tile).toMatchObject({ x: -640, y: -360, width: 2560, height: 1440 });
    expect(h.hud.at(-1)?.stage.tiles['mp4-2']).toEqual({
      grade: 'mono',
      spotlight: true,
      focus: { cx: 0, cy: 0, scale: 0.5 },
    });
    // The window glides one tick at a time (250 ms linear moves).
    await vi.advanceTimersByTimeAsync(300);
    h.controller.dispose();
  });

  it('PiP / split / grid layouts through operate', () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'pip', main: c1, inset: c2, corner: 'tr' },
      mode: 'cut',
    });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1', 'mp4-2']);
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'split', cams: [c2, c1] },
      mode: 'cut',
    });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-2', 'mp4-1']);
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'grid', cams: [] },
      mode: 'cut',
    });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1', 'mp4-2']);
    h.controller.dispose();
  });

  it('removing the program camera falls back to a live one', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'split', cams: [c1, c2] },
      mode: 'cut',
    });
    h.connected.delete('mp4-1');
    h.controller.onInputsRemoved(['mp4-1']);
    const s = h.controller.stateSnapshot();
    expect(s.program.shot).toEqual(solo(c2));
    expect(s.cams.map((c) => c.id)).toEqual([c2]);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-2']);
    h.connected.delete('mp4-2');
    h.controller.onInputsRemoved(['mp4-2']);
    expect(h.controller.stateSnapshot().program.shot).toBeNull();
    h.controller.dispose();
  });
});

describe('ObVanController · operate() validation', () => {
  it('refuses bad commands with a code', () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    expect(h.controller.operate({ op: 'take' })).toMatchObject({
      ok: false,
      code: 'bad_action',
    });
    expect(
      h.controller.operate({ op: 'preview', shot: solo('nope') }),
    ).toMatchObject({ ok: false, code: 'unknown_cam' });
    expect(
      h.controller.operate({
        op: 'shot',
        shot: { kind: 'split', cams: [c1, c1] },
        mode: 'cut',
      }),
    ).toMatchObject({
      ok: false,
      code: 'invalid_shot',
    });
    expect(
      h.controller.operate({
        op: 'shot',
        shot: { kind: 'pip', main: c2, inset: c2 },
        mode: 'cut',
      }),
    ).toMatchObject({
      ok: false,
      code: 'invalid_shot',
    });
    expect(
      h.controller.operate({ op: 'segment', action: 'next' }),
    ).toMatchObject({ ok: false, code: 'bad_action' });
    expect(
      h.controller.operate({ op: 'lower_third', camId: 'x' }),
    ).toMatchObject({ ok: false, code: 'unknown_cam' });
    expect(
      h.controller.operate({
        op: 'audio',
        audio: { mode: 'master', cam: 'x' },
      }),
    ).toMatchObject({
      ok: false,
      code: 'unknown_cam',
    });
    expect(h.controller.control('wrap')).toMatchObject({
      ok: false,
      code: 'bad_phase',
    });
    expect(h.controller.control('kick_cam', 'nope')).toMatchObject({
      ok: false,
      code: 'unknown_cam',
    });
    h.connected.delete('mp4-2');
    vi.advanceTimersByTime(1100);
    expect(
      h.controller.operate({ op: 'shot', shot: solo(c2), mode: 'cut' }),
    ).toMatchObject({
      ok: false,
      code: 'cam_not_live',
    });
    h.controller.dispose();
  });

  it('WS: unreadable commands answer ob_error, good ones run', () => {
    const h = harness();
    const c1 = h.attach(1);
    h.controller.handleMessage('panel', {
      type: 'ob_operator_cmd',
      cmd: { op: 'shot', shot: { kind: 'solo' }, mode: 'cut' },
    });
    expect(h.sent.at(-1)?.event).toMatchObject({
      type: 'ob_error',
      code: 'bad_action',
    });
    h.controller.handleMessage('panel', {
      type: 'ob_operator_cmd',
      cmd: { op: 'take' },
    });
    expect(h.sent.at(-1)?.event).toMatchObject({
      type: 'ob_error',
      code: 'bad_action',
    });
    h.controller.handleMessage('panel', {
      type: 'ob_operator_cmd',
      cmd: { op: 'shot', shot: solo(c1), mode: 'cut' },
    });
    expect(h.controller.stateSnapshot().program.shot).toEqual(solo(c1));
    h.controller.dispose();
  });
});

describe('ObVanController · auto pilot', () => {
  function onAir(h: ReturnType<typeof harness>) {
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.control('go_live');
    h.controller.setConfig({ autoPilot: true });
    return { c1, c2 };
  }

  it('a decision lands at its air time with its reasons in the log', async () => {
    const h = harness();
    const { c2 } = onAir(h);
    h.brain.next = (ctx) => ({
      atAirMs: ctx.nowAir + 3000,
      shot: solo(c2),
      transition: { type: 'cut', durationMs: 0 },
      holdMs: 4000,
      reason: 'CAM 2 · speech 2.4 s',
      reasons: ['speech 2.4 s', 'held CAM 1 12 s'],
      source: 'score',
    });
    await vi.advanceTimersByTimeAsync(100);
    const decidedAt = Date.now();
    expect(h.controller.stateSnapshot().autoPilot.next).toMatchObject({
      shot: solo(c2),
      atMs: decidedAt + 3000 - 0,
    });
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1']);
    await vi.advanceTimersByTimeAsync(2900);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-1']);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.visibleOf(h.lastLayout())).toEqual(['mp4-2']);
    const cut = h.layouts.find((l) => h.visibleOf(l.tiles)[0] === 'mp4-2');
    expect(cut?.at).toBe(decidedAt + 3000);
    const entry = h
      .logs()
      .find((e) => e.source === 'auto' && e.kind === 'auto');
    expect(entry?.reasons).toEqual(['speech 2.4 s', 'held CAM 1 12 s']);
    expect(h.controller.stateSnapshot().program.source).toBe('auto');
    expect(h.controller.stateSnapshot().stats.bySource.auto).toBe(1);
    h.controller.dispose();
  });

  it('an operator take cancels the pending auto cut and pauses the pilot', async () => {
    const h = harness();
    const { c1, c2 } = onAir(h);
    h.controller.setConfig({ resumeAfterMs: 5000 });
    h.brain.next = (ctx) => ({
      atAirMs: ctx.nowAir + 3000,
      shot: solo(c2),
      holdMs: 0,
      reason: 'x',
      reasons: [],
      source: 'rule',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(h.controller.stateSnapshot().autoPilot.next).not.toBeNull();
    h.controller.operate({
      op: 'shot',
      shot: { kind: 'pip', main: c1, inset: c2 },
      mode: 'cut',
    });
    const s = h.controller.stateSnapshot();
    expect(s.autoPilot.next).toBeNull();
    expect(s.autoPilot.pausedUntilMs).toBe(Date.now() + 5000);
    const calls = h.brain.calls;
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.brain.calls).toBe(calls);
    expect(h.controller.stateSnapshot().program.shot).toEqual({
      kind: 'pip',
      main: c1,
      inset: c2,
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.brain.calls).toBeGreaterThan(calls);
    expect(h.controller.stateSnapshot().autoPilot.pausedUntilMs).toBeNull();
    h.controller.dispose();
  });

  it('a decision more than 2 s late is skipped and logged', async () => {
    const h = harness();
    const { c2 } = onAir(h);
    h.brain.next = (ctx) => ({
      atAirMs: ctx.nowAir - 2500,
      shot: solo(c2),
      holdMs: 0,
      reason: 'stale',
      reasons: [],
      source: 'score',
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(
      h.logs().some((e) => e.kind === 'late' && e.text.startsWith('skipped')),
    ).toBe(true);
    expect(h.controller.stateSnapshot().program.shot).not.toEqual(solo(c2));
    h.controller.dispose();
  });

  it('the brain is not asked off air, paused or while a cut is pending', async () => {
    const h = harness();
    h.attach(1);
    h.controller.setConfig({ autoPilot: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.brain.calls).toBe(0);
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(300);
    expect(h.brain.calls).toBeGreaterThan(0);
    h.controller.dispose();
  });

  it('decision lower third uses the camera’s talent', async () => {
    const h = harness();
    const { c1 } = onAir(h);
    h.brain.next = (ctx) => ({
      atAirMs: ctx.nowAir,
      lowerThird: { camId: c1, mode: 'talent', holdMs: 3000 },
      holdMs: 0,
      reason: 'new speaker',
      reasons: ['rule lt-new-speaker'],
      source: 'rule',
    });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.hud.at(-1)?.lowerThird).toMatchObject({
      name: 'Anna',
      subtitle: 'SPEAKER',
    });
    await vi.advanceTimersByTimeAsync(3100);
    expect(h.hud.at(-1)?.lowerThird).toBeNull();
    h.controller.dispose();
  });
});

describe('ObVanController · graphics, rundown, replay, stats', () => {
  it('lower third from the desk expires after its duration', async () => {
    const h = harness();
    const c1 = h.attach(1);
    h.controller.control('go_live');
    expect(
      h.controller.operate({ op: 'lower_third', camId: c1, ms: 2000 }),
    ).toEqual({ ok: true });
    expect(h.hud.at(-1)?.lowerThird).toMatchObject({
      name: 'Anna',
      subtitle: 'SPEAKER',
    });
    expect(h.controller.stateSnapshot().lowerThird?.untilMs).toBe(
      Date.now() + 2000,
    );
    await vi.advanceTimersByTimeAsync(2150);
    expect(h.hud.at(-1)?.lowerThird).toBeNull();
    expect(h.controller.stateSnapshot().lowerThird).toBeNull();
    h.controller.dispose();
  });

  it('rundown: next segment names the title bug and switches the preset rules', () => {
    const h = harness();
    h.attach(1);
    h.controller.setConfig({
      eventName: 'Smelter Conf',
      rundown: [
        { id: 'a', title: 'Keynote' },
        { id: 'b', title: 'Band', preset: 'gig' },
      ],
    });
    h.controller.control('go_live');
    h.controller.operate({ op: 'segment', action: 'next' });
    expect(h.hud.at(-1)?.titleBug).toEqual({
      event: 'Smelter Conf',
      segment: 'Keynote',
    });
    expect(h.controller.stateSnapshot().ruleset.preset).toBe('talk');
    h.controller.operate({ op: 'segment', action: 'next' });
    expect(h.controller.stateSnapshot().ruleset.preset).toBe('gig');
    expect(h.controller.stateSnapshot().rundown.index).toBe(1);
    h.controller.operate({ op: 'segment', action: 'goto', index: 0 });
    expect(h.controller.stateSnapshot().ruleset.preset).toBe('talk');
    h.controller.dispose();
  });

  it('replay: file cam clip opens, closes and unregisters; WHIP refuses', async () => {
    const h = harness();
    const c1 = h.attach(1);
    h.fileClocks.set('mp4-1', {
      anchorWallMs: T0 - 20_000,
      playFromMs: 0,
      durationMs: 600_000,
      delayMs: 3000,
    });
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    expect(h.controller.operate({ op: 'replay' })).toEqual({ ok: true });
    expect(h.controller.operate({ op: 'replay' })).toMatchObject({
      ok: false,
      code: 'replay_busy',
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(h.replayCuts[0]).toMatchObject({
      clip: 'ob-demo/clip1.mp4',
      mediaMs: 17_000,
    });
    expect(h.hud.at(-1)?.stage.replay).toMatchObject({
      inputId: 'ob-replay-1',
    });
    expect(h.controller.stateSnapshot().replay?.camId).toBe(c1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(h.hud.at(-1)?.stage.replay).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.replayUnregs).toEqual(['ob-replay-1']);

    h.controller.handleMessage('p', {
      type: 'ob_cam_join',
      name: 'Phone',
      role: 'wide',
    });
    const phone = h.controller
      .stateSnapshot()
      .cams.find((c) => c.kind === 'whip');
    expect(
      h.controller.operate({ op: 'replay', camId: phone?.id }),
    ).toMatchObject({
      ok: false,
      code: 'no_file_cam',
    });
    h.controller.dispose();
  });

  it('stats: cuts by source and on-air time, frozen at wrap', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(4000);
    h.controller.operate({ op: 'shot', shot: solo(c2), mode: 'cut' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.controller.control('wrap')).toEqual({ ok: true });
    const s = h.controller.stateSnapshot().stats;
    expect(s.cuts).toBe(1);
    expect(s.bySource.operator).toBe(1);
    expect(s.onAirMsByCam[c1]).toBe(4000);
    expect(s.onAirMsByCam[c2]).toBe(2000);
    expect(s.avgHoldMs).toBe(3000);
    expect(h.hud.at(-1)?.wrap).toMatchObject({ cuts: 1, durationMs: 6000 });
    expect(h.hud.at(-1)?.wrap?.shares[0]).toMatchObject({ number: 1, pct: 67 });
    h.controller.control('reset');
    expect(h.controller.stateSnapshot().phase).toBe('setup');
    h.controller.dispose();
  });

  it('worker results reach the signals keyed by camera', () => {
    const h = harness();
    const c1 = h.attach(1);
    h.controller.onWorkerResult(
      'mp4-1',
      {
        kind: 'audio',
        rms: -20,
        speechProb: 0.9,
        speech: true,
        onset: false,
        procMs: 4,
      },
      123_000_000,
    );
    h.controller.onWorkerResult('mp4-1', {
      kind: 'video',
      frameW: 640,
      frameH: 360,
      persons: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.5, conf: 0.8 }],
      ball: null,
      motion: 0.2,
      procMs: 30,
    });
    h.controller.onWorkerResult('unknown', { kind: 'audio' });
    h.controller.onTranscript('mp4-1', 'next slide please', T0, 1500);
    expect(h.signals.ingested.map((s) => [s.camId, s.sample.kind])).toEqual([
      [c1, 'audio'],
      [c1, 'video'],
      [c1, 'transcript'],
    ]);
    expect(h.signals.ingested[0].sample).toMatchObject({
      ptsNanos: 123_000_000,
      speech: true,
      arrivalMs: T0,
    });
    expect(h.controller.stateSnapshot().cams[0].signals).toBe(true);
    h.controller.dispose();
  });

  it('dispose clears every timer and the HUD', async () => {
    const h = harness();
    const c1 = h.attach(1);
    const c2 = h.attach(2);
    h.fileClocks.set('mp4-1', {
      anchorWallMs: T0,
      playFromMs: 0,
      durationMs: 60_000,
      delayMs: 0,
    });
    h.controller.operate({ op: 'shot', shot: solo(c1), mode: 'cut' });
    h.controller.control('go_live');
    h.controller.setConfig({ autoPilot: true });
    h.brain.next = (ctx) => ({
      atAirMs: ctx.nowAir + 3000,
      shot: solo(c2),
      holdMs: 0,
      reason: '',
      reasons: [],
      source: 'score',
    });
    h.controller.operate({ op: 'shot', shot: solo(c2), mode: 'take' });
    h.controller.operate({ op: 'lower_third', camId: c1 });
    h.controller.operate({ op: 'replay', camId: c1 });
    await vi.advanceTimersByTimeAsync(120);
    h.controller.dispose();
    expect(h.hud.at(-1)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
