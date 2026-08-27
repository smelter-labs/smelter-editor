import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KettlebellExercise,
  KettlebellIssueCode,
  RoomEvent,
} from '@smelter-editor/types';
import type { KbtHudState } from '../../app/store';
import { KettlebellTournamentController } from '../KettlebellTournamentController';

const ROOM = 'room-1';

function harness(opts?: {
  withLiveness?: boolean;
  hasActiveRecording?: () => boolean;
}) {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const aiCalls: {
    inputId: string;
    enabled: boolean;
    params?: Record<string, number | string>;
  }[] = [];
  const layouts: {
    inputId: string;
    x: number;
    width: number;
    transitionDurationMs?: number;
    transitionEasing?: string;
  }[][] = [];
  const hudApplies: (KbtHudState | null)[] = [];
  const qrCalls: string[] = [];
  const photoRegisters: { photoPath: string; photoHash: string }[] = [];
  const photoUnregisters: { imageId: string | null; photoPath: string }[] = [];
  const repShotRegisters: string[] = [];
  const repShotUnregisters: string[] = [];
  const connected = new Set<string>();
  /** Publish-liveness set, only consulted with opts.withLiveness. */
  const live = new Set<string>();
  let camSeq = 0;

  const controller = new KettlebellTournamentController(ROOM, {
    broadcast: (event) => events.push(event),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    registerPlayerCam: async () => {
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
    setKettlebellCoach: async (inputId, enabled, params) => {
      aiCalls.push({ inputId, enabled, params });
    },
    layoutTiles: async (tiles) => {
      // Mirror RoomState's unplaced-input auto-append hazard: a layout that
      // omits a connected input would resurrect it fullscreen on the real
      // output, so the fake fails fast instead of letting it pass silently.
      for (const inputId of connected) {
        if (!tiles.some((t) => t.inputId === inputId)) {
          throw new Error(
            `layoutTiles omitted connected input ${inputId} — RoomState would auto-append it on top of the stage`,
          );
        }
      }
      layouts.push(
        tiles.map(
          ({ inputId, x, width, transitionDurationMs, transitionEasing }) => ({
            inputId,
            x,
            width,
            ...(transitionDurationMs !== undefined
              ? { transitionDurationMs }
              : {}),
            ...(transitionEasing !== undefined ? { transitionEasing } : {}),
          }),
        ),
      );
    },
    isInputConnected: (inputId) => connected.has(inputId),
    ...(opts?.withLiveness
      ? { isInputLive: (inputId: string) => live.has(inputId) }
      : {}),
    ...(opts?.hasActiveRecording
      ? { hasActiveRecording: opts.hasActiveRecording }
      : {}),
    getResolution: () => ({ width: 1920, height: 1080 }),
    publishHud: (state) => hudApplies.push(state),
    registerJoinQr: async (url) => {
      qrCalls.push(url);
      return `kbt-qr-test-${qrCalls.length}`;
    },
    registerPlayerPhoto: async (photoPath, photoHash) => {
      photoRegisters.push({ photoPath, photoHash });
      return `kbt-photo-test-${photoHash}`;
    },
    unregisterPlayerPhoto: (imageId, photoPath) => {
      photoUnregisters.push({ imageId, photoPath });
    },
    registerRepShotImage: async (url) => {
      repShotRegisters.push(url);
      return `img-${repShotRegisters.length}`;
    },
    unregisterRepShotImage: (imageId) => {
      repShotUnregisters.push(imageId);
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
    photoRegisters,
    photoUnregisters,
    repShotRegisters,
    repShotUnregisters,
    connected,
    live,
    joinedFor(clientId: string) {
      const found = [...sent]
        .reverse()
        .find((s) => s.clientId === clientId && s.event.type === 'kbt_joined');
      return found?.event.type === 'kbt_joined' ? found.event : null;
    },
    errorsFor(clientId: string) {
      return sent
        .filter((s) => s.clientId === clientId && s.event.type === 'kbt_error')
        .map((s) => s.event) as Extract<RoomEvent, { type: 'kbt_error' }>[];
    },
    ofType<T extends RoomEvent['type']>(type: T) {
      return events.filter((e) => e.type === type) as Extract<
        RoomEvent,
        { type: T }
      >[];
    },
    lastHud(): KbtHudState | null {
      return hudApplies.length ? hudApplies[hudApplies.length - 1] : null;
    },
    camOfferFor(clientId: string) {
      const offer = [...sent]
        .reverse()
        .find(
          (s) => s.clientId === clientId && s.event.type === 'kbt_cam_offer',
        );
      return offer?.event.type === 'kbt_cam_offer' ? offer.event : null;
    },
    rep(
      inputId: string,
      repIndex: number,
      exercise: KettlebellExercise = 'swing',
      verdict: 'correct' | 'incorrect' = 'correct',
      issues: KettlebellIssueCode[] = [],
      screenshotUrl?: string,
    ) {
      controller.onCoachEvent({
        type: 'kettlebell_rep_completed',
        roomId: ROOM,
        inputId,
        repIndex,
        exercise,
        verdict,
        issues,
        ...(screenshotUrl ? { screenshotUrl } : {}),
      });
    },
  };
}

/** Join two players, give them cameras, draw heats, and reach 'playing'. */
async function playingHeat(h: ReturnType<typeof harness>) {
  h.controller.join('p1', 'ANIA');
  h.controller.join('p2', 'BARTEK');
  await h.controller.startCamera('p1');
  await h.controller.startCamera('p2');
  h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
  h.controller.controlMatch({ action: 'assign_heats' });
  h.controller.controlMatch({ action: 'start_heat' });
  await vi.advanceTimersByTimeAsync(0); // flush stageActiveHeat
  h.controller.handleMessage('p1', { type: 'kbt_briefed' });
  h.controller.handleMessage('p2', { type: 'kbt_briefed' });
  await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
  h.controller.controlMatch({ action: 'begin_heat' });
  await vi.advanceTimersByTimeAsync(3100); // countdown → playing
  const in1 = h.camOfferFor('p1')!.inputId;
  const in2 = h.camOfferFor('p2')!.inputId;
  return { in1, in2 };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('KettlebellTournamentController', () => {
  it('sends a WHIP offer on camera request and retires the old input on re-request', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    const first = h.camOfferFor('p1');
    expect(first?.whipUrl).toContain(first!.inputId);
    await h.controller.startCamera('p1');
    const second = h.camOfferFor('p1');
    expect(second!.inputId).not.toBe(first!.inputId);
    expect(h.connected.has(first!.inputId)).toBe(false);
    h.controller.dispose();
  });

  it('mirrors the room recording flag into the state snapshot', () => {
    let recording = false;
    const h = harness({ hasActiveRecording: () => recording });
    expect(h.controller.stateSnapshot().isRecording).toBe(false);
    recording = true;
    h.events.length = 0;
    h.controller.notifyRecordingChanged();
    expect(h.controller.stateSnapshot().isRecording).toBe(true);
    // The RoomState poke pushes the flag to every panel.
    const state = h.events.find((e) => e.type === 'kbt_state');
    expect(state && 'isRecording' in state && state.isRecording).toBe(true);
    h.controller.dispose();
  });

  it('defaults isRecording to false when the dep is absent (older wiring)', () => {
    const h = harness();
    expect(h.controller.stateSnapshot().isRecording).toBe(false);
    h.controller.dispose();
  });

  it('chunks the roster into heats and folds a trailing solo entrant', () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.controller.join(`p${i}`, `P${i}`);
    h.controller.setConfig({ heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    const state = h.controller.stateSnapshot();
    expect(state.heats.map((heat) => heat.playerIds.length)).toEqual([2, 3]);
    expect(state.tournamentPhase).toBe('heats');
    expect(state.currentHeatIndex).toBe(0);
    h.controller.dispose();
  });

  it('validates cameraView in setConfig and broadcasts it', () => {
    const h = harness();
    expect(h.controller.getConfig().cameraView).toBe('front');
    h.controller.setConfig({ cameraView: 'side' });
    expect(h.controller.getConfig().cameraView).toBe('side');
    h.controller.setConfig({ cameraView: 'diagonal' as never });
    expect(h.controller.getConfig().cameraView).toBe('side');
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].config.cameraView).toBe('side');
    h.controller.dispose();
  });

  it('validates repScreenshots in setConfig and broadcasts it', () => {
    const h = harness();
    expect(h.controller.getConfig().repScreenshots).toBe(false);
    h.controller.setConfig({ repScreenshots: true });
    expect(h.controller.getConfig().repScreenshots).toBe(true);
    h.controller.setConfig({ repScreenshots: 'yes' as never });
    expect(h.controller.getConfig().repScreenshots).toBe(true);
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].config.repScreenshots).toBe(true);
    h.controller.dispose();
  });

  it('validates milestoneFx in setConfig and broadcasts it', () => {
    const h = harness();
    expect(h.controller.getConfig().milestoneFx).toBe(true);
    h.controller.setConfig({ milestoneFx: false });
    expect(h.controller.getConfig().milestoneFx).toBe(false);
    h.controller.setConfig({ milestoneFx: 'yes' as never });
    expect(h.controller.getConfig().milestoneFx).toBe(false);
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].config.milestoneFx).toBe(false);
    h.controller.dispose();
  });

  it('validates repFloatText in setConfig and carries it into HUD snapshots', async () => {
    const h = harness();
    expect(h.controller.getConfig().repFloatText).toBe(true);
    h.controller.setConfig({ repFloatText: false });
    expect(h.controller.getConfig().repFloatText).toBe(false);
    h.controller.setConfig({ repFloatText: 'yes' as never });
    expect(h.controller.getConfig().repFloatText).toBe(false);
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].config.repFloatText).toBe(false);
    // The flag rides the held HUD snapshots the renderer reads.
    await playingHeat(h);
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.repFloatText).toBe(false);
    h.controller.setConfig({ repFloatText: true });
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.repFloatText).toBe(true);
    h.controller.dispose();
  });

  it('fires the milestone fx on every 5th rep of an exercise and expires it', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    for (let i = 1; i <= 5; i++) h.rep(in1, i, 'swing');
    // Snapshots apply ~3s late (HUD hold): flush past FX_MS + the hold.
    await vi.advanceTimersByTimeAsync(6500);

    const withFx = h.hudApplies.filter((s) => s.tiles[in1]?.fx != null);
    expect(withFx.length).toBeGreaterThan(0);
    const first = withFx[0].tiles[in1].fx!;
    expect(first.exercise).toBe('swing');
    expect(first.color).toBe('#38E08A');
    expect(first.p).toBeLessThan(0.2);
    // Progress advances with the 10 Hz publishes, then the effect expires.
    const last = withFx[withFx.length - 1].tiles[in1].fx!;
    expect(last.p).toBeGreaterThan(first.p);
    expect(h.lastHud()!.tiles[in1].fx ?? null).toBeNull();
    h.controller.dispose();
  });

  it('never fires the milestone fx when milestoneFx is off', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.setConfig({ milestoneFx: false });
    for (let i = 1; i <= 10; i++) h.rep(in1, i, 'swing');
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.hudApplies.some((s) => s.tiles[in1]?.fx != null)).toBe(false);
    h.controller.dispose();
  });

  it('arms the coach with a heat-size analysis rate on start_heat and disarms after the heat', async () => {
    const h = harness();
    h.controller.setConfig({ cameraView: 'side', repScreenshots: true });
    const { in1 } = await playingHeat(h);
    const enables = h.aiCalls.filter((c) => c.enabled);
    expect(enables.map((c) => c.inputId)).toContain(in1);
    expect(enables[0].params?.analysisFps).toBe(14);
    expect(enables[0].params?.cameraView).toBe('side');
    expect(enables[0].params?.captureRepFrames).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000 + 500); // AMRAP + rep grace
    const disables = h.aiCalls.filter((c) => !c.enabled);
    expect(disables.map((c) => c.inputId)).toContain(in1);
    h.controller.dispose();
  });

  it('scores reps by config during playing and ignores idle/intro/countdown reps', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0);
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    h.controller.handleMessage('p2', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
    const in1 = h.camOfferFor('p1')!.inputId;

    h.rep(in1, 1); // intro — must not score
    h.controller.controlMatch({ action: 'begin_heat' });
    h.rep(in1, 2); // countdown — must not score
    expect(h.ofType('kbt_rep')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3100); // playing
    h.rep(in1, 3, 'swing');
    h.rep(in1, 4, 'clean');
    h.rep(in1, 5, 'snatch');
    h.rep(in1, 6, 'idle' as KettlebellExercise);
    const reps = h.ofType('kbt_rep');
    expect(reps.map((r) => r.points)).toEqual([1, 2, 3]);
    expect(reps[2].totalPoints).toBe(6);
    h.controller.dispose();
  });

  it('applies disabled-exercise zero points and strict-technique halving', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.setConfig({
      scoring: { clean: { enabled: false }, snatch: { points: 5 } },
      strictTechnique: true,
    });
    h.rep(in1, 1, 'clean'); // disabled → 0 points, rep still tallied
    h.rep(in1, 2, 'snatch', 'incorrect', ['soft_lockout']); // floor(5/2) = 2
    const reps = h.ofType('kbt_rep');
    expect(reps.map((r) => r.points)).toEqual([0, 2]);
    const match = h.controller.getMatchSnapshot();
    const sheet = Object.values(match.scores)[0];
    expect(sheet.reps.clean).toBe(1);
    expect(sheet.incorrectReps).toBe(1);
    h.controller.dispose();
  });

  it('validates countIncorrectReps in setConfig and carries it into HUD snapshots', async () => {
    const h = harness();
    expect(h.controller.getConfig().countIncorrectReps).toBe(true);
    h.controller.setConfig({ countIncorrectReps: false });
    expect(h.controller.getConfig().countIncorrectReps).toBe(false);
    h.controller.setConfig({ countIncorrectReps: 'yes' as never });
    expect(h.controller.getConfig().countIncorrectReps).toBe(false);
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].config.countIncorrectReps).toBe(false);
    // The flag rides the held HUD snapshots the renderer reads.
    await playingHeat(h);
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.countIncorrectReps).toBe(false);
    h.controller.setConfig({ countIncorrectReps: true });
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.countIncorrectReps).toBe(true);
    h.controller.dispose();
  });

  it('no-count mode: incorrect reps score nothing and skip the rep tally', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.setConfig({
      countIncorrectReps: false,
      strictTechnique: true,
    });
    h.rep(in1, 1, 'snatch');
    h.rep(in1, 2, 'snatch', 'incorrect', ['soft_lockout']);
    const reps = h.ofType('kbt_rep');
    // Not counting beats strict halving: 0, not floor(3/2).
    expect(reps.map((r) => r.points)).toEqual([3, 0]);
    expect(reps[1].streak).toBe(0);
    expect(reps[1].totalPoints).toBe(3);
    const sheet = Object.values(h.controller.getMatchSnapshot().scores)[0];
    expect(sheet.reps.snatch).toBe(1);
    expect(sheet.incorrectReps).toBe(1);
    expect(sheet.points).toBe(3);
    // HUD: the rep counter stands still while the attempt clock advances,
    // so the floater still spawns (struck-out style).
    await vi.advanceTimersByTimeAsync(3500);
    const tile = h.lastHud()!.tiles[in1];
    expect(tile.reps).toBe(1);
    expect(tile.repSeq).toBe(2);
    expect(tile.lastRepPoints).toBe(0);
    h.controller.dispose();
  });

  it('counted mode (default): incorrect reps tally and pay like before', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1, 'snatch', 'incorrect', ['soft_lockout']);
    // strictTechnique off → full points despite the verdict.
    expect(h.ofType('kbt_rep').map((r) => r.points)).toEqual([3]);
    await vi.advanceTimersByTimeAsync(3500);
    const tile = h.lastHud()!.tiles[in1];
    expect(tile.reps).toBe(1);
    expect(tile.repSeq).toBe(1);
    h.controller.dispose();
  });

  it('no-count mode: skipped reps advance neither the milestone clock nor RPM', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.setConfig({ countIncorrectReps: false });
    for (let i = 1; i <= 4; i++) h.rep(in1, i, 'swing');
    h.rep(in1, 5, 'swing', 'incorrect', ['too_low']); // attempt 5, counted 4
    await vi.advanceTimersByTimeAsync(4000);
    expect(h.hudApplies.some((s) => s.tiles[in1]?.fx != null)).toBe(false);
    h.rep(in1, 6, 'swing'); // counted rep #5 → fx fires
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.hudApplies.some((s) => s.tiles[in1]?.fx != null)).toBe(true);
    h.controller.dispose();
  });

  it('no-count mode: only counted reps drive the rep counter and RPM', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.setConfig({ countIncorrectReps: false });
    for (let i = 1; i <= 3; i++) {
      h.rep(in1, i, 'swing', 'incorrect', ['too_low']);
    }
    await vi.advanceTimersByTimeAsync(3500);
    const tile = h.lastHud()!.tiles[in1];
    expect(tile.reps).toBe(0);
    expect(tile.repSeq).toBe(3);
    expect(tile.rpm).toBe(0);
    h.controller.dispose();
  });

  it('restart_heat resets the attempt clock the floaters key on', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    h.rep(in1, 2, 'swing', 'incorrect', ['too_low']);
    h.controller.controlMatch({ action: 'restart_heat' });
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.tiles[in1]?.repSeq).toBe(0);
    h.controller.dispose();
  });

  it('carries rep screenshots into kbt_rep, the score sheet and the player after the heat', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1, 'snatch', 'correct', [], '/kbt-rep-frames/a-r0001.jpg');
    h.rep(
      in1,
      2,
      'swing',
      'incorrect',
      ['too_low'],
      '/kbt-rep-frames/a-r0002.jpg',
    );
    h.rep(in1, 3, 'swing'); // no still — must not add a shot
    const reps = h.ofType('kbt_rep');
    expect(reps.map((r) => r.screenshotUrl)).toEqual([
      '/kbt-rep-frames/a-r0001.jpg',
      '/kbt-rep-frames/a-r0002.jpg',
      undefined,
    ]);
    const sheet = Object.values(h.controller.getMatchSnapshot().scores)[0];
    expect(sheet.repShots).toEqual([
      {
        repIndex: 1,
        url: '/kbt-rep-frames/a-r0001.jpg',
        exercise: 'snatch',
        verdict: 'correct',
        points: 3,
      },
      {
        repIndex: 2,
        url: '/kbt-rep-frames/a-r0002.jpg',
        exercise: 'swing',
        verdict: 'incorrect',
        points: 1,
        issues: ['too_low'],
      },
    ]);
    // After the heat ends the shots stick to the player (podium feed).
    await vi.advanceTimersByTimeAsync(30_000 + 500);
    const player = h.controller
      .stateSnapshot()
      .players.find((p) => p.clientId === 'p1');
    expect(player?.repShots?.map((s) => s.repIndex)).toEqual([1, 2]);
    h.controller.dispose();
  });

  it('accepts a buzzer-beater rep inside the grace window, then freezes', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    await vi.advanceTimersByTimeAsync(30_000); // clock hits zero → ended
    expect(h.controller.getMatchSnapshot().phase).toBe('ended');
    h.rep(in1, 2); // within REP_GRACE_MS
    await vi.advanceTimersByTimeAsync(500); // grace closes → finalized
    h.rep(in1, 3); // too late
    const reps = h.ofType('kbt_rep');
    expect(reps).toHaveLength(2);
    const match = h.controller.getMatchSnapshot();
    expect(match.winner?.name).toBe('ANIA');
    expect(match.winner?.points).toBe(2);
    h.controller.dispose();
  });

  it('rolls heat results into bestScore and start_final picks the top players', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    h.rep(in1, 2);
    await vi.advanceTimersByTimeAsync(31_000);
    const state = h.controller.stateSnapshot();
    const ania = state.players.find((p) => p.name === 'ANIA')!;
    expect(ania.bestScore).toBe(2);
    h.controller.controlMatch({ action: 'start_final' });
    const after = h.controller.stateSnapshot();
    expect(after.tournamentPhase).toBe('final');
    const finalHeat = after.heats[after.heats.length - 1];
    expect(finalHeat.final).toBe(true);
    expect(finalHeat.playerIds).toContain('p1');
    expect(finalHeat.playerIds).toContain('p2');
    h.controller.dispose();
  });

  it('broadcasts a lead change when a player is dethroned (not on ties)', async () => {
    const h = harness();
    const { in1, in2 } = await playingHeat(h);
    h.rep(in1, 1); // ANIA leads (first sole leader)
    h.rep(in2, 1); // tie — no new leader
    h.rep(in2, 2); // BARTEK dethrones
    const changes = h.ofType('kbt_lead_change');
    expect(changes.map((c) => c.name)).toEqual(['ANIA', 'BARTEK']);
    h.controller.dispose();
  });

  it('fires a streak milestone every 5 consecutive correct reps', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    for (let i = 1; i <= 5; i++) h.rep(in1, i);
    expect(h.ofType('kbt_streak')).toHaveLength(1);
    expect(h.ofType('kbt_streak')[0].count).toBe(5);
    h.rep(in1, 6, 'swing', 'incorrect'); // breaks the streak
    for (let i = 7; i <= 11; i++) h.rep(in1, i);
    expect(h.ofType('kbt_streak')).toHaveLength(2);
    h.controller.dispose();
  });

  it('holds the burned-in HUD by ~3s so it lands on the delayed video', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    expect(h.hudApplies.length).toBe(0);
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0);
    // Publishes are scheduled from t=0, but nothing APPLIES inside the hold.
    await vi.advanceTimersByTimeAsync(2800);
    expect(h.hudApplies.length).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hudApplies.length).toBeGreaterThan(0);
    expect(h.lastHud()?.match?.phase).toBe('intro');
    expect(Object.keys(h.lastHud()?.tiles ?? {})).toHaveLength(2);
    h.controller.dispose();
  });

  it('adopts a disconnected player on same-name rejoin, keeping the heat slot and scores', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    h.controller.handleDisconnect('p1');
    h.controller.join('p1-new-socket', 'ANIA');
    const state = h.controller.stateSnapshot();
    expect(state.players.some((p) => p.clientId === 'p1')).toBe(false);
    const adopted = state.players.find((p) => p.clientId === 'p1-new-socket');
    expect(adopted?.name).toBe('ANIA');
    const heat = state.heats[state.currentHeatIndex!];
    expect(heat.playerIds).toContain('p1-new-socket');
    expect(heat.scores['p1-new-socket'].points).toBe(1);
    h.controller.dispose();
  });

  it('runs a solo challenge: one heat of one, solo winner crowned', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    const drawn = h.controller.stateSnapshot();
    expect(drawn.heats).toHaveLength(1);
    expect(drawn.heats[0].playerIds).toEqual(['p1']);
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0);
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
    h.controller.controlMatch({ action: 'begin_heat' });
    await vi.advanceTimersByTimeAsync(3100);
    const in1 = h.camOfferFor('p1')!.inputId;
    h.rep(in1, 1);
    h.rep(in1, 2, 'snatch');
    await vi.advanceTimersByTimeAsync(31_000);
    const match = h.controller.getMatchSnapshot();
    expect(match.winner?.name).toBe('ANIA');
    expect(match.winner?.points).toBe(4);
    const state = h.controller.stateSnapshot();
    expect(state.players[0].bestScore).toBe(4);
    // A final needs at least two scored players — must be a no-op solo.
    h.controller.controlMatch({ action: 'start_final' });
    const after = h.controller.stateSnapshot();
    expect(after.heats).toHaveLength(1);
    expect(after.tournamentPhase).not.toBe('final');
    h.controller.dispose();
  });

  it('refuses begin_heat until every heat player briefed with a live camera', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected

    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('intro'); // nobody briefed

    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('intro'); // p2 missing

    h.controller.handleMessage('p2', { type: 'kbt_briefed' });
    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('countdown');
    h.controller.dispose();
  });

  it('clears briefed on disconnect so an adopted rejoin must re-brief before begin_heat', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    h.controller.handleMessage('p2', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100);

    h.controller.handleDisconnect('p1');
    h.controller.join('p1-new-socket', 'ANIA'); // adoption keeps the input
    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('intro');

    h.controller.handleMessage('p1-new-socket', { type: 'kbt_briefed' });
    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('countdown');
    h.controller.dispose();
  });

  it('reports briefed in kbt_state and clears it on kbt_cam_stop', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    expect(h.controller.stateSnapshot().players[0].briefed).toBe(false);
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    expect(h.controller.stateSnapshot().players[0].briefed).toBe(true);
    h.controller.handleMessage('p1', { type: 'kbt_cam_stop' });
    expect(h.controller.stateSnapshot().players[0].briefed).toBe(false);
    h.controller.dispose();
  });

  it('lays portrait cams out as centered aspect-true columns', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1', { width: 720, height: 1280 });
    await h.controller.startCamera('p2', { width: 720, height: 1280 });
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0);
    const tiles = h.layouts[h.layouts.length - 1];
    expect(tiles).toHaveLength(2);
    // 9:16 at 1080 high = 607.5 wide; the pair centered on 1920: x ~352/960.
    expect(Math.abs(tiles[0].width - 608)).toBeLessThanOrEqual(1);
    expect(Math.abs(tiles[0].x - 352)).toBeLessThanOrEqual(1);
    expect(Math.abs(tiles[1].x - 960)).toBeLessThanOrEqual(1);
    h.controller.dispose();
  });

  it('simulateRep scores through the same path as coach events', async () => {
    const h = harness();
    await playingHeat(h);
    expect(h.controller.simulateRep('p1', 'snatch', 'correct')).toBe(true);
    const reps = h.ofType('kbt_rep');
    expect(reps).toHaveLength(1);
    expect(reps[0].points).toBe(3);
    h.controller.dispose();
  });

  describe('attachExternalCam (KBT_SIM mp4 cams)', () => {
    it('adopts the input and rejects unknown players', async () => {
      const h = harness();
      h.controller.join('p1', 'ANIA');
      expect(h.controller.attachExternalCam('ghost', 'room-1::mp4::x')).toBe(
        false,
      );
      h.connected.add('room-1::mp4::a');
      expect(
        h.controller.attachExternalCam('p1', 'room-1::mp4::a', {
          width: 720,
          height: 1280,
        }),
      ).toBe(true);
      await vi.advanceTimersByTimeAsync(1100); // cam poll
      expect(h.controller.stateSnapshot().players[0].camConnected).toBe(true);
      h.controller.dispose();
    });

    it('re-attach retires the previous input', async () => {
      const h = harness();
      h.controller.join('p1', 'ANIA');
      await h.controller.startCamera('p1');
      const whipId = h.camOfferFor('p1')!.inputId;
      h.connected.add('room-1::mp4::a');
      expect(h.controller.attachExternalCam('p1', 'room-1::mp4::a')).toBe(true);
      await vi.advanceTimersByTimeAsync(0); // flush best-effort retire
      expect(h.connected.has(whipId)).toBe(false); // removeInput ran
      expect(h.aiCalls).toContainEqual({
        inputId: whipId,
        enabled: false,
        params: undefined,
      });
      h.controller.dispose();
    });

    it('scores model reps and simulateRep through the attached input', async () => {
      const h = harness();
      h.controller.join('p1', 'ANIA');
      h.controller.join('p2', 'BARTEK');
      h.connected.add('room-1::mp4::a');
      h.connected.add('room-1::mp4::b');
      h.controller.attachExternalCam('p1', 'room-1::mp4::a');
      h.controller.attachExternalCam('p2', 'room-1::mp4::b');
      h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
      h.controller.controlMatch({ action: 'assign_heats' });
      h.controller.controlMatch({ action: 'start_heat' });
      await vi.advanceTimersByTimeAsync(0); // flush stageActiveHeat
      // Staging arms the coach on the mp4 inputs like any WHIP cam.
      expect(h.aiCalls.filter((c) => c.enabled).map((c) => c.inputId)).toEqual([
        'room-1::mp4::a',
        'room-1::mp4::b',
      ]);
      h.controller.handleMessage('p1', { type: 'kbt_briefed' });
      h.controller.handleMessage('p2', { type: 'kbt_briefed' });
      await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
      h.controller.controlMatch({ action: 'begin_heat' });
      await vi.advanceTimersByTimeAsync(3100); // countdown → playing
      h.rep('room-1::mp4::a', 0);
      expect(h.controller.simulateRep('p2', 'clean', 'correct')).toBe(true);
      const reps = h.ofType('kbt_rep');
      expect(reps).toHaveLength(2);
      h.controller.dispose();
    });
  });

  // ── Broadcast scenes (kb_design port) ─────────────────────────────────────

  it('publishes the lobby scene in roster with the joined list and QR', async () => {
    const h = harness();
    h.controller.setConfig({ joinUrl: 'https://x.dev/mobile/r/lift' });
    expect(h.qrCalls).toEqual(['https://x.dev/mobile/r/lift']);
    h.controller.join('p1', 'ANIA');
    await vi.advanceTimersByTimeAsync(3100); // hud hold
    const hud = h.lastHud()!;
    expect(hud.scene).toBe('lobby');
    expect(hud.lobby?.qrImageId).toBe('kbt-qr-test-1');
    expect(hud.lobby?.joinLabel).toBe('x.dev');
    expect(hud.lobby?.joined.map((j) => j.name)).toEqual(['ANIA']);
    h.controller.dispose();
  });

  it('publishes solo for a one-player heat and grid for two, with rank and per-exercise reps', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1, 'snatch');
    h.rep(in1, 2, 'snatch');
    await vi.advanceTimersByTimeAsync(3100);
    const hud = h.lastHud()!;
    expect(hud.scene).toBe('grid');
    const ania = Object.values(hud.tiles).find((t) => t.name === 'ANIA')!;
    expect(ania.rank).toBe(1);
    expect(ania.repsByExercise.snatch).toBe(2);
    expect(ania.rpm).toBeGreaterThan(0);
    h.controller.dispose();

    const solo = harness();
    solo.controller.join('p1', 'ANIA');
    await solo.controller.startCamera('p1');
    solo.controller.setConfig({ heatDurationMs: 30_000 });
    solo.controller.controlMatch({ action: 'assign_heats' });
    solo.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(3100);
    expect(solo.lastHud()?.scene).toBe('solo');
    solo.controller.dispose();
  });

  it('flips to the standings board after the ended linger, with ranked rows', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1, 'snatch');
    await vi.advanceTimersByTimeAsync(30_000); // buzzer
    await vi.advanceTimersByTimeAsync(5_200 + 3_100); // linger + hold
    const hud = h.lastHud()!;
    expect(hud.scene).toBe('board');
    expect(hud.board?.rows[0]).toMatchObject({
      rank: 1,
      name: 'ANIA',
      points: 3,
    });
    h.controller.dispose();
  });

  it('publishes the podium scene with the top three', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1, 'snatch');
    await vi.advanceTimersByTimeAsync(31_000);
    h.controller.controlMatch({ action: 'podium' });
    await vi.advanceTimersByTimeAsync(3_100);
    const hud = h.lastHud()!;
    expect(hud.scene).toBe('podium');
    expect(hud.podium?.rows[0]).toMatchObject({ rank: 1, name: 'ANIA' });
    h.controller.dispose();
  });

  // ── Commentator ───────────────────────────────────────────────────────────

  it('offers the commentator a WHIP input and appends it to every layout', async () => {
    const h = harness();
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const offer = h.camOfferFor('c1');
    expect(offer).not.toBeNull();
    const casterInput = offer!.inputId;

    // Roster mosaic must include the caster tile (visible lower-third rect).
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    const rosterTiles = h.layouts[h.layouts.length - 1];
    expect(rosterTiles.map((t) => t.inputId)).toContain(casterInput);

    // During a heat the caster tile shrinks offscreen but STAYS in the layer
    // (audio keeps mixing).
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0);
    const heatTiles = h.layouts[h.layouts.length - 1];
    const caster = heatTiles.find((t) => t.inputId === casterInput);
    expect(caster).toBeDefined();
    expect(caster!.width).toBe(1);
    h.controller.dispose();
  });

  it('keeps the commentator input through a WS drop and adopts a same-name rejoin', async () => {
    const h = harness();
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const inputId = h.camOfferFor('c1')!.inputId;
    h.controller.handleDisconnect('c1');
    expect(h.connected.has(inputId)).toBe(true); // input survives
    h.controller.joinCommentator('c2', 'MAREK');
    const state = h.controller.stateSnapshot();
    expect(state.commentator?.name).toBe('MAREK');
    // The adopted slot still owns the same input — no new offer needed.
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.connected.has(inputId)).toBe(true);
    h.controller.dispose();
  });

  // ── Commentator view override + show control (the moderator panel) ────────

  it('forces the caster scene fullscreen with an immediate HUD cut and restores AUTO', async () => {
    const h = harness();
    const { in1, in2 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const casterInput = h.camOfferFor('c1')!.inputId;
    await vi.advanceTimersByTimeAsync(0); // flush restage

    const applied = h.hudApplies.length;
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_view',
      override: { mode: 'caster' },
    });
    await vi.advanceTimersByTimeAsync(0); // flush restage (no held timers!)

    // The cut lands without the 3s hold…
    expect(h.hudApplies.length).toBeGreaterThan(applied);
    expect(h.lastHud()?.scene).toBe('caster');
    // …the caster fills the stage exactly once (audio keeps mixing), with a
    // hard cut on the FIRST apply that changed geometry (it grew out of the
    // 1×1 park — no scale-up animation; the override triggers a second,
    // geometry-identical apply whose transition value is a visual no-op)…
    const tiles = h.layouts.find(
      (l) => l[0]?.inputId === casterInput && l[0].width === 1920,
    )!;
    expect(tiles[0]).toEqual({
      inputId: casterInput,
      x: 0,
      width: 1920,
      transitionDurationMs: 0,
    });
    // …while the lifters stay mentioned as 1×1 parks (dropping them would
    // let RoomState auto-append them back on top of the caster).
    expect(
      tiles.slice(1).map((t) => ({ inputId: t.inputId, width: t.width })),
    ).toEqual([
      { inputId: in1, width: 1 },
      { inputId: in2, width: 1 },
    ]);
    // …and the panel gets the echo to highlight the button.
    const states = h.ofType('kbt_state');
    expect(states[states.length - 1].scene).toBe('caster');
    expect(states[states.length - 1].viewOverride).toEqual({ mode: 'caster' });

    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_view',
      override: { mode: 'auto' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastHud()?.scene).toBe('grid');
    const restored = h.layouts[h.layouts.length - 1];
    expect(restored.map((t) => t.inputId)).toEqual(
      expect.arrayContaining([in1, in2, casterInput]),
    );
    expect(restored.find((t) => t.inputId === casterInput)!.width).toBe(1); // offscreen again
    h.controller.dispose();
  });

  it('ignores view overrides from anyone but the joined commentator', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_view',
      override: { mode: 'caster' },
    });
    expect(h.controller.stateSnapshot().viewOverride).toEqual({ mode: 'auto' });
    expect(h.controller.stateSnapshot().scene).toBe('grid');
    h.controller.dispose();
  });

  it('frames one athlete on player_solo (filtered tiles) and clears when they leave', async () => {
    const h = harness();
    const { in1, in2 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const casterInput = h.camOfferFor('c1')!.inputId;
    await vi.advanceTimersByTimeAsync(0);

    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_view',
      override: { mode: 'player_solo', playerId: 'p1' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastHud()?.scene).toBe('solo');
    expect(Object.keys(h.lastHud()?.tiles ?? {})).toEqual([in1]);
    const tiles = h.layouts[h.layouts.length - 1];
    expect(tiles.map((t) => t.inputId)).toEqual([in1, casterInput, in2]);
    expect(tiles.find((t) => t.inputId === casterInput)!.width).toBe(1);
    // The unfeatured lifter is parked at 1×1, not visible on stage.
    expect(tiles.find((t) => t.inputId === in2)!.width).toBe(1);

    h.controller.leave('p1');
    expect(h.controller.stateSnapshot().viewOverride).toEqual({ mode: 'auto' });
    h.controller.dispose();
  });

  it('stages caster + featured lifter side by side on split, caster exactly once', async () => {
    const h = harness();
    const { in1, in2 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const casterInput = h.camOfferFor('c1')!.inputId;
    await vi.advanceTimersByTimeAsync(0);

    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_view',
      override: { mode: 'split', playerId: 'p1' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.lastHud()?.scene).toBe('split');
    expect(Object.keys(h.lastHud()?.tiles ?? {})).toEqual([in1]);
    // First apply that put the caster on stage (the override restages twice;
    // the second apply is geometry-identical, so its transitions are no-ops).
    const tiles = h.layouts.find(
      (l) => l[0]?.inputId === casterInput && l[0].width === 960,
    )!;
    // Two 16:9 halves, the caster staged once, the other lifter parked.
    expect(tiles.map((t) => t.inputId)).toEqual([casterInput, in1, in2]);
    expect(tiles.filter((t) => t.inputId === casterInput)).toHaveLength(1);
    expect(tiles[0].width).toBe(960);
    expect(tiles[1].x).toBe(960);
    expect(tiles[2].width).toBe(1);
    // Transition decoration: entering from park = hard cut, staged→staged
    // move glides, parking = hard cut (no shrink-to-dot).
    expect(tiles[0].transitionDurationMs).toBe(0);
    expect(tiles[1]).toMatchObject({
      transitionDurationMs: 300,
      transitionEasing: 'cubic_bezier_ease_in_out',
    });
    expect(tiles[2].transitionDurationMs).toBe(0);
    h.controller.dispose();
  });

  it('parks off-heat lifter cams at 1×1 instead of dropping them', async () => {
    const h = harness();
    for (let i = 1; i <= 5; i++) h.controller.join(`p${i}`, `P${i}`);
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    await h.controller.startCamera('p3');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    await vi.advanceTimersByTimeAsync(0); // flush stageActiveHeat
    const in1 = h.camOfferFor('p1')!.inputId;
    const in2 = h.camOfferFor('p2')!.inputId;
    const in3 = h.camOfferFor('p3')!.inputId; // heat 2 — off stage now
    const tiles = h.layouts[h.layouts.length - 1];
    expect(tiles.map((t) => t.inputId)).toEqual(
      expect.arrayContaining([in1, in2, in3]),
    );
    expect(tiles.find((t) => t.inputId === in1)!.width).toBeGreaterThan(1);
    expect(tiles.find((t) => t.inputId === in2)!.width).toBeGreaterThan(1);
    expect(tiles.find((t) => t.inputId === in3)!.width).toBe(1);
    h.controller.dispose();
  });

  it('returns the view to AUTO on every match action', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_view',
      override: { mode: 'board' },
    });
    expect(h.controller.stateSnapshot().viewOverride).toEqual({
      mode: 'board',
    });
    h.controller.controlMatch({ action: 'stop_heat' });
    expect(h.controller.stateSnapshot().viewOverride).toEqual({ mode: 'auto' });
    h.controller.dispose();
  });

  it('runs match actions over kbt_commentator_match, gated on the commentator', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    h.controller.handleMessage('p2', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
    h.controller.joinCommentator('c1', 'MAREK');

    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_match',
      action: 'begin_heat',
    });
    expect(h.controller.getMatchSnapshot().phase).toBe('intro'); // not the commentator

    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_match',
      action: 'begin_heat',
    });
    expect(h.controller.getMatchSnapshot().phase).toBe('countdown');
    h.controller.dispose();
  });

  it('reports the commentator in kbt_state and clears it on leave', async () => {
    const h = harness();
    h.controller.joinCommentator('c1', 'MAREK');
    await h.controller.startCommentatorCamera('c1');
    const inputId = h.camOfferFor('c1')!.inputId;
    await vi.advanceTimersByTimeAsync(1100); // cam poll flips camConnected
    expect(h.controller.stateSnapshot().commentator).toMatchObject({
      name: 'MAREK',
      camConnected: true,
    });
    h.controller.leaveCommentator('c1');
    expect(h.controller.stateSnapshot().commentator).toBeNull();
    expect(h.connected.has(inputId)).toBe(false);
    h.controller.dispose();
  });
});

describe('resilience: playerKey identity, error channel, host recovery', () => {
  it('replies kbt_joined with the resume snapshot on every join', async () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'kbt_join', name: 'ANIA' });
    const joined = h.joinedFor('p1');
    expect(joined).toMatchObject({
      clientId: 'p1',
      name: 'ANIA',
      role: 'player',
      briefed: false,
      camInputActive: false,
      inCurrentHeat: false,
      tournamentPhase: 'roster',
      heatPhase: 'idle',
    });
    expect(joined!.playerKey).toBeTruthy();
    await h.controller.startCamera('p1');
    h.controller.handleMessage('p1', { type: 'kbt_join', name: 'ANIA' });
    expect(h.joinedFor('p1')!.camInputActive).toBe(true);
    h.controller.dispose();
  });

  it('adopts by playerKey even while the old entry still looks connected (refresh fork)', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    const key = h.joinedFor('p1')!.playerKey;
    // Fast refresh: the new socket joins with the key BEFORE the old socket's
    // close arrives — no !connected orphan exists to adopt by name.
    h.controller.handleMessage('p1-refreshed', {
      type: 'kbt_join',
      name: 'ANIA',
      playerKey: key,
    });
    let state = h.controller.stateSnapshot();
    expect(state.players).toHaveLength(2); // ANIA + BARTEK, no duplicate
    const adopted = state.players.find((p) => p.clientId === 'p1-refreshed');
    expect(adopted?.name).toBe('ANIA');
    const heat = state.heats[state.currentHeatIndex!];
    expect(heat.playerIds).toContain('p1-refreshed');
    expect(heat.scores['p1-refreshed'].points).toBe(1);
    // The key survives adoption — the next refresh resumes the same entry.
    expect(h.joinedFor('p1-refreshed')!.playerKey).toBe(key);
    // The stale socket's late close hits a missing entry and must not touch
    // the adopted player's state (this used to wedge the ready gate).
    h.controller.handleMessage('p1-refreshed', { type: 'kbt_briefed' });
    h.controller.handleDisconnect('p1');
    state = h.controller.stateSnapshot();
    const after = state.players.find((p) => p.clientId === 'p1-refreshed');
    expect(after?.briefed).toBe(true);
    expect(after?.connected).toBe(true);
    h.controller.dispose();
  });

  it('a join with an unknown key never hijacks a same-name entry', () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'kbt_join', name: 'ANIA' });
    h.controller.handleMessage('p2', {
      type: 'kbt_join',
      name: 'ANIA',
      playerKey: 'some-other-room-key',
    });
    const state = h.controller.stateSnapshot();
    expect(state.players).toHaveLength(2);
    h.controller.dispose();
  });

  it('legacy name adoption (no key) still works for disconnected entries', () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'kbt_join', name: 'ANIA' });
    h.controller.handleDisconnect('p1');
    h.controller.handleMessage('p2', { type: 'kbt_join', name: 'ANIA' });
    const state = h.controller.stateSnapshot();
    expect(state.players).toHaveLength(1);
    expect(state.players[0].clientId).toBe('p2');
    h.controller.dispose();
  });

  it('attaches a photo by playerKey ahead of a colliding name match', () => {
    const h = harness();
    h.controller.handleMessage('p1', { type: 'kbt_join', name: 'ANIA' });
    h.controller.handleMessage('p2', { type: 'kbt_join', name: 'ANIA' });
    const keyOfP2 = h.joinedFor('p2')!.playerKey;
    h.controller.setPlayerPhoto(
      'ANIA',
      {
        photoUrl: '/kbt-photos/x.jpg',
        photoPath: '/tmp/x.jpg',
        photoHash: 'h1',
      },
      keyOfP2,
    );
    const state = h.controller.stateSnapshot();
    expect(state.players.find((p) => p.clientId === 'p2')?.photoUrl).toBe(
      '/kbt-photos/x.jpg',
    );
    expect(state.players.find((p) => p.clientId === 'p1')?.photoUrl).toBeNull();
    h.controller.dispose();
  });

  it('sends kbt_error to a cam request before joining', () => {
    const h = harness();
    h.controller.handleMessage('ghost', { type: 'kbt_cam_request' });
    expect(h.errorsFor('ghost').map((e) => e.code)).toContain('not_joined');
    h.controller.dispose();
  });

  it('controlMatch returns the blocked-begin reason with offender names', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100);
    const { error } = h.controller.controlMatch({ action: 'begin_heat' });
    expect(error?.code).toBe('not_ready');
    expect(error?.message).toContain('BARTEK');
    h.controller.dispose();
  });

  it('kick_player frees the ready gate so begin_heat can start', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    await h.controller.startCamera('p2');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100);
    const p2Input = h.camOfferFor('p2')!.inputId;
    h.controller.handleDisconnect('p2'); // BARTEK's phone died for good
    const kicked = h.controller.controlMatch({
      action: 'kick_player',
      clientId: 'p2',
    });
    expect(kicked.error).toBeUndefined();
    expect(h.connected.has(p2Input)).toBe(false); // input retired
    const state = h.controller.stateSnapshot();
    expect(state.players.map((p) => p.name)).toEqual(['ANIA']);
    expect(state.heats[0].playerIds).toEqual(['p1']);
    h.controller.controlMatch({ action: 'begin_heat' });
    expect(h.controller.getMatchSnapshot().phase).toBe('countdown');
    h.controller.dispose();
  });

  it('kick_player keeps score rows of a playing heat', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    h.controller.controlMatch({ action: 'kick_player', clientId: 'p1' });
    const match = h.controller.getMatchSnapshot();
    expect(match.scores['p1']).toBeDefined(); // snapshot row survives
    expect(h.controller.stateSnapshot().heats[0].playerIds).not.toContain('p1');
    h.controller.dispose();
  });

  it('restart_heat wipes the sheets and returns to a fresh intro', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.rep(in1, 1);
    const { error } = h.controller.controlMatch({ action: 'restart_heat' });
    expect(error).toBeUndefined();
    const match = h.controller.getMatchSnapshot();
    expect(match.phase).toBe('intro');
    expect(match.scores['p1'].points).toBe(0);
    h.controller.dispose();
  });

  it('force_begin starts despite an unready player but needs one live camera', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    await h.controller.startCamera('p1');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    h.controller.handleMessage('p1', { type: 'kbt_briefed' });
    await vi.advanceTimersByTimeAsync(1100);
    // BARTEK has no camera and never briefed — normal begin is refused…
    expect(
      h.controller.controlMatch({ action: 'begin_heat' }).error?.code,
    ).toBe('not_ready');
    // …but the host's explicit override starts the heat.
    const forced = h.controller.controlMatch({ action: 'force_begin' });
    expect(forced.error).toBeUndefined();
    expect(h.controller.getMatchSnapshot().phase).toBe('countdown');
    h.controller.dispose();
  });

  it('force_begin with zero live cameras is refused', async () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    h.controller.join('p2', 'BARTEK');
    h.controller.setConfig({ heatDurationMs: 30_000, heatSize: 2 });
    h.controller.controlMatch({ action: 'assign_heats' });
    h.controller.controlMatch({ action: 'start_heat' });
    const forced = h.controller.controlMatch({ action: 'force_begin' });
    expect(forced.error?.code).toBe('no_live_camera');
    expect(h.controller.getMatchSnapshot().phase).toBe('intro');
    h.controller.dispose();
  });

  it('start_final with too few ranked players returns too_few_finalists', () => {
    const h = harness();
    h.controller.join('p1', 'ANIA');
    const { error } = h.controller.controlMatch({ action: 'start_final' });
    expect(error?.code).toBe('too_few_finalists');
    h.controller.dispose();
  });

  it('camConnected follows publish liveness and clears poseTracked when it drops', async () => {
    const h = harness({ withLiveness: true });
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    const inputId = h.camOfferFor('p1')!.inputId;
    // Registered (isInputConnected true) but never acked → not live.
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.controller.stateSnapshot().players[0].camConnected).toBe(false);
    h.live.add(inputId);
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.controller.stateSnapshot().players[0].camConnected).toBe(true);
    h.controller.onPoseSample(inputId, true);
    await vi.advanceTimersByTimeAsync(800); // pose debounce
    h.controller.onPoseSample(inputId, true);
    expect(h.controller.stateSnapshot().players[0].poseTracked).toBe(true);
    // Acks stop: camConnected drops and the stale POSE ✓ goes with it.
    h.live.delete(inputId);
    await vi.advanceTimersByTimeAsync(1100);
    const p = h.controller.stateSnapshot().players[0];
    expect(p.camConnected).toBe(false);
    expect(p.poseTracked).toBe(false);
    h.controller.dispose();
  });

  it('clears a player_solo override pinned to a dead camera after the grace', async () => {
    const h = harness({ withLiveness: true });
    h.controller.join('p1', 'ANIA');
    await h.controller.startCamera('p1');
    const inputId = h.camOfferFor('p1')!.inputId;
    h.live.add(inputId);
    h.controller.joinCommentator('c1', 'MAREK');
    await vi.advanceTimersByTimeAsync(1100);
    h.controller.setViewOverride('c1', {
      mode: 'player_solo',
      playerId: 'p1',
    });
    expect(h.controller.stateSnapshot().viewOverride?.mode).toBe('player_solo');
    // Camera dies; after the 10s grace the override falls back to AUTO.
    h.live.delete(inputId);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(h.controller.stateSnapshot().viewOverride?.mode).toBe('auto');
    h.controller.dispose();
  });

  // ── Commentator output overlay (rep cam / spotlight / h2h / banners) ──────

  it('gates overlay, banner and skeleton messages on the joined commentator', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_overlay',
      overlay: { kind: 'spotlight', playerId: 'p1' },
    });
    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_banner',
      bannerId: 'new_leader',
    });
    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_skeleton',
      mode: 'off',
    });
    h.controller.handleMessage('p1', {
      type: 'kbt_commentator_rep_float',
      enabled: false,
    });
    expect(
      h.errorsFor('p1').filter((e) => e.code === 'not_commentator'),
    ).toHaveLength(4);
    expect(h.controller.stateSnapshot().commentatorOverlay).toEqual({
      kind: 'none',
    });
    expect(h.controller.stateSnapshot().skeletonMode).toBe('neon');
    expect(h.controller.stateSnapshot().config.repFloatText).toBe(true);
    h.controller.dispose();
  });

  it('fires a hype banner immediately, refuses unknown ids, expires after BANNER_MS', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    const applied = h.hudApplies.length;
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_banner',
      bannerId: 'new_leader',
    });
    // Immediate publish — no 3s hold.
    expect(h.hudApplies.length).toBeGreaterThan(applied);
    expect(h.lastHud()?.banner).toMatchObject({
      kind: 'hype',
      text: 'NEW LEADER!',
    });
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_banner',
      bannerId: 'nope',
    });
    expect(
      h.errorsFor('c1').filter((e) => e.code === 'invalid_overlay'),
    ).toHaveLength(1);
    expect(h.lastHud()?.banner).toMatchObject({ kind: 'hype' });
    // The 10 Hz tick keeps publishing; past the TTL the banner drops out
    // (plus the 3s HUD hold before a held snapshot lands).
    await vi.advanceTimersByTimeAsync(4200 + 3200);
    expect(h.lastHud()?.banner).toBeNull();
    h.controller.dispose();
  });

  it('spotlight tracks live scores and is cleared by a match action', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    h.rep(in1, 1, 'swing', 'correct');
    h.rep(in1, 2, 'swing', 'correct');
    h.rep(in1, 3, 'swing', 'correct');
    h.rep(in1, 4, 'swing', 'incorrect');
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: { kind: 'spotlight', playerId: 'p1' },
    });
    const hud = h.lastHud();
    expect(hud?.overlay).toMatchObject({ kind: 'spotlight', live: true });
    if (hud?.overlay?.kind === 'spotlight') {
      expect(hud.overlay.side.name).toBe('ANIA');
      expect(hud.overlay.side.reps).toBe(4);
      expect(hud.overlay.side.accuracy).toBeCloseTo(0.75);
      expect(hud.overlay.side.points).toBe(4);
    }
    // Live stats keep flowing through held tick publishes too.
    h.rep(in1, 5, 'swing', 'correct');
    await vi.advanceTimersByTimeAsync(3200);
    const later = h.lastHud();
    if (later?.overlay?.kind === 'spotlight') {
      expect(later.overlay.side.reps).toBe(5);
    }
    // Every show action returns the output to a clean scene.
    h.controller.controlMatch({ action: 'stop_heat' });
    expect(h.controller.stateSnapshot().commentatorOverlay).toEqual({
      kind: 'none',
    });
    expect(h.lastHud()?.overlay).toBeNull();
    h.controller.dispose();
  });

  it('h2h compares two players and clears when a referenced player leaves', async () => {
    const h = harness();
    const { in1, in2 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    h.rep(in1, 1, 'snatch', 'correct'); // 3 pts
    h.rep(in2, 1, 'swing', 'correct'); // 1 pt
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: { kind: 'h2h', playerIdA: 'p1', playerIdB: 'p2' },
    });
    const hud = h.lastHud();
    expect(hud?.overlay).toMatchObject({ kind: 'h2h', live: true });
    if (hud?.overlay?.kind === 'h2h') {
      expect(hud.overlay.a.name).toBe('ANIA');
      expect(hud.overlay.a.points).toBe(3);
      expect(hud.overlay.b.name).toBe('BARTEK');
      expect(hud.overlay.b.points).toBe(1);
    }
    // Same player on both sides is refused.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: { kind: 'h2h', playerIdA: 'p1', playerIdB: 'p1' },
    });
    expect(
      h.errorsFor('c1').filter((e) => e.code === 'invalid_overlay'),
    ).toHaveLength(1);
    h.controller.leave('p2');
    expect(h.controller.stateSnapshot().commentatorOverlay).toEqual({
      kind: 'none',
    });
    h.controller.dispose();
  });

  it('rep cam persists issues, clamps the index, and resolves engine images', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    h.rep(in1, 1, 'swing', 'correct', [], '/kbt-rep-frames/a.jpg');
    h.rep(
      in1,
      2,
      'snatch',
      'incorrect',
      ['bent_arms'],
      '/kbt-rep-frames/b.jpg',
    );
    // Issues ride the persisted shot, not just the live kbt_rep event.
    const scores = h.controller.getMatchSnapshot().scores;
    expect(scores['p1'].repShots).toHaveLength(2);
    expect(scores['p1'].repShots![1].issues).toEqual(['bent_arms']);
    // No shots → refused.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: {
        kind: 'rep_shot',
        playerId: 'p2',
        index: 0,
        showVerdict: true,
      },
    });
    expect(
      h.errorsFor('c1').filter((e) => e.code === 'invalid_overlay'),
    ).toHaveLength(1);
    // Out-of-range index clamps to the newest shot.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: {
        kind: 'rep_shot',
        playerId: 'p1',
        index: 99,
        showVerdict: true,
      },
    });
    await vi.advanceTimersByTimeAsync(0); // flush registration → re-cut
    const hud = h.lastHud();
    expect(hud?.overlay?.kind).toBe('rep_shot');
    if (hud?.overlay?.kind === 'rep_shot') {
      expect(hud.overlay.index).toBe(1);
      expect(hud.overlay.total).toBe(2);
      expect(hud.overlay.shot.imageId).toBe('img-1');
      expect(hud.overlay.shot.verdict).toBe('incorrect');
      // Snapshot carries display-ready labels, not codes.
      expect(hud.overlay.shot.issues).toEqual(['Arms bent during upswing']);
    }
    // The neighbor got pre-registered for instant stepping.
    expect(h.repShotRegisters).toEqual([
      '/kbt-rep-frames/b.jpg',
      '/kbt-rep-frames/a.jpg',
    ]);
    // Clearing drops the overlay from both snapshots.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_overlay',
      overlay: { kind: 'none' },
    });
    expect(h.lastHud()?.overlay).toBeNull();
    expect(h.controller.stateSnapshot().commentatorOverlay).toEqual({
      kind: 'none',
    });
    h.controller.dispose();
    expect(h.repShotUnregisters).toEqual(['img-1', 'img-2']);
  });

  it('skeleton toggle re-pushes FULL coach params live and sticks for later heats', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    // Heat staging already carries the mode (params replace wholesale).
    const staged = h.aiCalls.filter((c) => c.enabled);
    expect(staged.length).toBeGreaterThan(0);
    for (const call of staged) {
      expect(call.params?.skeleton).toBe('neon');
    }
    h.aiCalls.length = 0;
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_skeleton',
      mode: 'off',
    });
    // One live re-push per heat player, with the complete param set — a
    // partial push would silently reset fps/cameraView/captureRepFrames.
    expect(h.aiCalls).toHaveLength(2);
    for (const call of h.aiCalls) {
      expect(call.enabled).toBe(true);
      expect(call.params).toMatchObject({
        skeleton: 'off',
        analysisFps: 14,
        cameraView: 'front',
        captureRepFrames: 0,
      });
    }
    expect(h.controller.stateSnapshot().skeletonMode).toBe('off');
    // Unknown mode → refused, mode unchanged.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_skeleton',
      mode: 'sparkles',
    });
    expect(
      h.errorsFor('c1').filter((e) => e.code === 'invalid_overlay'),
    ).toHaveLength(1);
    expect(h.controller.stateSnapshot().skeletonMode).toBe('off');
    h.controller.dispose();
  });

  it('commentator rep-text toggle flips config.repFloatText and reaches the HUD', async () => {
    const h = harness();
    await playingHeat(h);
    h.controller.joinCommentator('c1', 'MAREK');
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_rep_float',
      enabled: false,
    });
    expect(h.controller.stateSnapshot().config.repFloatText).toBe(false);
    // The toggle publishes a held snapshot immediately (no rep needed).
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.repFloatText).toBe(false);
    // Non-boolean payload → refused, config unchanged.
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_rep_float',
      enabled: 'nope' as never,
    });
    expect(
      h.errorsFor('c1').filter((e) => e.code === 'invalid_overlay'),
    ).toHaveLength(1);
    expect(h.controller.stateSnapshot().config.repFloatText).toBe(false);
    h.controller.handleMessage('c1', {
      type: 'kbt_commentator_rep_float',
      enabled: true,
    });
    await vi.advanceTimersByTimeAsync(3500);
    expect(h.lastHud()!.repFloatText).toBe(true);
    h.controller.dispose();
  });
});
