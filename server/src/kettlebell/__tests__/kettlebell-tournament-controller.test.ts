import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  KettlebellExercise,
  KettlebellIssueCode,
  RoomEvent,
} from '@smelter-editor/types';
import type { KbtHudState } from '../../app/store';
import { KettlebellTournamentController } from '../KettlebellTournamentController';

const ROOM = 'room-1';

function harness() {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const aiCalls: {
    inputId: string;
    enabled: boolean;
    params?: Record<string, number | string>;
  }[] = [];
  const layouts: { inputId: string; x: number; width: number }[][] = [];
  const hudApplies: (KbtHudState | null)[] = [];
  const connected = new Set<string>();
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
      layouts.push(tiles.map(({ inputId, x, width }) => ({ inputId, x, width })));
    },
    isInputConnected: (inputId) => connected.has(inputId),
    getResolution: () => ({ width: 1920, height: 1080 }),
    publishHud: (state) => hudApplies.push(state),
  });

  return {
    controller,
    events,
    sent,
    aiCalls,
    layouts,
    hudApplies,
    connected,
    ofType<T extends RoomEvent['type']>(type: T) {
      return events.filter((e) => e.type === type) as Extract<
        RoomEvent,
        { type: T }
      >[];
    },
    lastHud(): KbtHudState | null {
      return hudApplies.length
        ? hudApplies[hudApplies.length - 1]
        : null;
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
    ) {
      controller.onCoachEvent({
        type: 'kettlebell_rep_completed',
        roomId: ROOM,
        inputId,
        repIndex,
        exercise,
        verdict,
        issues,
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

  it('arms the coach with a heat-size analysis rate on start_heat and disarms after the heat', async () => {
    const h = harness();
    const { in1 } = await playingHeat(h);
    const enables = h.aiCalls.filter((c) => c.enabled);
    expect(enables.map((c) => c.inputId)).toContain(in1);
    expect(enables[0].params?.analysisFps).toBe(14);
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
});
