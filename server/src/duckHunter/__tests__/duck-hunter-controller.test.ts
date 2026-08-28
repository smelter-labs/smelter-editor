import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import type { StoreApi } from 'zustand';
import type { PersonBoxes, RoomStore, ShooterOverlay } from '../../app/store';
import { DuckHunterController } from '../DuckHunterController';
import { MAX_DUCKS } from '../duckFlight';

const ROOM = 'room-1';

type FakeSceneState = {
  peopleBoxes: Record<string, PersonBoxes>;
  resolution: { width: number; height: number };
  setShooter: (s: ShooterOverlay | null) => void;
};

function harness(opts?: { manualCam?: boolean }) {
  const events: RoomEvent[] = [];
  const sent: { clientId: string; event: RoomEvent }[] = [];
  const removed: string[] = [];
  const registered = new Set<string>();
  const live = new Set<string>();
  const pendingCams: (() => void)[] = [];
  const shooterSets: (ShooterOverlay | null)[] = [];
  let camSeq = 0;

  const sceneState: FakeSceneState = {
    peopleBoxes: {},
    resolution: { width: 1920, height: 1080 },
    setShooter: (s) => shooterSets.push(s),
  };
  const store = {
    getState: () => sceneState,
  } as unknown as StoreApi<RoomStore>;

  const mintCam = () => {
    const inputId = `${ROOM}::whip::cam-${++camSeq}`;
    registered.add(inputId);
    return {
      inputId,
      whipUrl: `http://smelter/whip/${inputId}`,
      bearerToken: 'token',
    };
  };

  const controller = new DuckHunterController(ROOM, store, {
    broadcast: (event) => events.push(event),
    sendTo: (clientId, event) => sent.push({ clientId, event }),
    registerShooterCam: () => {
      if (opts?.manualCam) {
        return new Promise((resolve) => {
          pendingCams.push(() => resolve(mintCam()));
        });
      }
      return Promise.resolve(mintCam());
    },
    removeInput: async (inputId) => {
      removed.push(inputId);
      registered.delete(inputId);
      live.delete(inputId);
    },
    isInputLive: (inputId) => live.has(inputId),
  });

  return {
    controller,
    events,
    sent,
    removed,
    registered,
    live,
    pendingCams,
    sceneState,
    shooterSets,
    joinedFor(clientId: string) {
      const found = [...sent]
        .reverse()
        .find(
          (s) => s.clientId === clientId && s.event.type === 'shooter_joined',
        );
      return found?.event.type === 'shooter_joined' ? found.event : null;
    },
    errorsFor(clientId: string) {
      return sent
        .filter(
          (s) => s.clientId === clientId && s.event.type === 'shooter_error',
        )
        .map((s) => s.event) as Extract<RoomEvent, { type: 'shooter_error' }>[];
    },
    offersFor(clientId: string) {
      return sent
        .filter(
          (s) =>
            s.clientId === clientId && s.event.type === 'shooter_cam_offer',
        )
        .map((s) => s.event) as Extract<
        RoomEvent,
        { type: 'shooter_cam_offer' }
      >[];
    },
    lastState() {
      const states = events.filter((e) => e.type === 'shooter_state');
      return states.length
        ? (states[states.length - 1] as Extract<
            RoomEvent,
            { type: 'shooter_state' }
          >)
        : null;
    },
    lastOverlay(): ShooterOverlay | null {
      return shooterSets.length ? shooterSets[shooterSets.length - 1] : null;
    },
  };
}

/** A ghost-sprite target with one box centered on screen (hit by default aim). */
function ghostTarget(): PersonBoxes {
  return {
    boxes: [{ id: 1, x: 0.45, y: 0.45, w: 0.1, h: 0.1, color: 0 }],
    frameW: 1920,
    frameH: 1080,
    ghost: true,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('join / adoption / disconnect grace', () => {
  it('acks a join with a minted playerKey and caps the roster at 6', () => {
    const h = harness();
    for (let i = 0; i < 6; i++) h.controller.join(`c${i}`, `P${i}`);
    expect(h.lastState()?.players).toHaveLength(6);
    const joined = h.joinedFor('c0');
    expect(joined?.playerKey).toBeTruthy();
    expect(joined?.color).toBeTruthy();

    h.controller.join('c6', 'Late');
    expect(h.errorsFor('c6').map((e) => e.code)).toContain('room_full');
    expect(h.lastState()?.players).toHaveLength(6);
    expect(h.joinedFor('c6')).toBeNull();
    h.controller.dispose();
  });

  it('adopts by playerKey after a disconnect: score, color and key survive', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    const first = h.joinedFor('c1')!;
    h.controller.handleDisconnect('c1');
    expect(
      h.lastState()?.players.find((p) => p.clientId === 'c1')?.connected,
    ).toBe(false);

    h.controller.join('c2', 'Bob', first.playerKey);
    const second = h.joinedFor('c2')!;
    expect(second.playerKey).toBe(first.playerKey);
    expect(second.color).toBe(first.color);
    const state = h.lastState()!;
    expect(state.players).toHaveLength(1);
    expect(state.players[0].clientId).toBe('c2');
    expect(state.players[0].connected).toBe(true);
    h.controller.dispose();
  });

  it('adopts by playerKey even when the old socket still looks connected', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    const key = h.joinedFor('c1')!.playerKey;
    // Fast refresh: the new socket joins before the old one closes.
    h.controller.join('c2', 'Bob', key);
    const state = h.lastState()!;
    expect(state.players).toHaveLength(1);
    expect(state.players[0].clientId).toBe('c2');
    h.controller.dispose();
  });

  it('name adoption only matches disconnected entries and keyless joins', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    const bobColor = h.joinedFor('c1')!.color;

    // Connected "Bob" + keyless join with the same name → a NEW player.
    h.controller.join('c2', 'Bob');
    expect(h.lastState()?.players).toHaveLength(2);
    expect(h.joinedFor('c2')!.color).not.toBe(bobColor);

    // A key that matches nothing must NOT fall back to name adoption.
    h.controller.handleDisconnect('c1');
    h.controller.join('c3', 'Bob', 'no-such-key');
    expect(h.lastState()?.players).toHaveLength(3);
    expect(h.joinedFor('c3')!.color).not.toBe(bobColor);

    // Keyless + disconnected + exact name → adopts the orphan.
    h.controller.join('c4', 'Bob');
    const state = h.lastState()!;
    expect(state.players).toHaveLength(3);
    expect(h.joinedFor('c4')!.color).toBe(bobColor);
    h.controller.dispose();
  });

  it('re-keys match winner and finalScores on adoption', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100); // countdown → playing
    h.controller.fire('c1'); // default aim (0.5, 0.5) hits the centered box
    h.controller.controlMatch({ action: 'stop' });
    expect(h.controller.getMatchSnapshot().winner?.clientId).toBe('c1');

    const key = h.joinedFor('c1')!.playerKey;
    h.controller.handleDisconnect('c1');
    h.controller.join('c2', 'Bob', key);
    const snap = h.controller.getMatchSnapshot();
    expect(snap.winner?.clientId).toBe('c2');
    expect(snap.finalScores?.map((r) => r.clientId)).toEqual(['c2']);
    expect(h.joinedFor('c2')!.score).toBe(1);
    h.controller.dispose();
  });

  it('reaps a disconnected player after the grace, but never mid-round', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.join('c2', 'Eve');
    // 10-minute round so the match is still 'playing' when the grace elapses.
    h.controller.controlMatch({
      action: 'start',
      mode: 'time',
      durationMs: 600_000,
    });
    await vi.advanceTimersByTimeAsync(3100); // playing
    h.controller.handleDisconnect('c1');
    await vi.advanceTimersByTimeAsync(150_000); // way past the grace
    expect(h.lastState()?.players).toHaveLength(2); // still on the board

    h.controller.controlMatch({ action: 'stop' });
    await vi.advanceTimersByTimeAsync(125_000); // idle → grace elapses
    expect(h.lastState()?.players.map((p) => p.clientId)).toEqual(['c2']);
    h.controller.dispose();
  });

  it('explicit shoot_leave removes the player immediately', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.leave('c1');
    expect(h.lastState()?.players).toHaveLength(0);
    h.controller.dispose();
  });
});

describe('camera lifecycle', () => {
  it('start → offer carries the InputManager-minted endpoint', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    await h.controller.startCamera('c1', { width: 720, height: 1280 });
    const offers = h.offersFor('c1');
    expect(offers).toHaveLength(1);
    expect(offers[0].inputId).toBe(`${ROOM}::whip::cam-1`);
    expect(offers[0].whipUrl).toContain(offers[0].inputId);
    h.controller.dispose();
  });

  it('stopCamera during an in-flight register cancels it (no leak, no offer)', async () => {
    const h = harness({ manualCam: true });
    h.controller.join('c1', 'Bob');
    const pending = h.controller.startCamera('c1');
    h.controller.stopCamera('c1'); // camInputId is still null here
    h.pendingCams.shift()!();
    await pending;
    expect(h.offersFor('c1')).toHaveLength(0);
    expect(h.removed).toEqual([`${ROOM}::whip::cam-1`]);
    expect(h.registered.size).toBe(0);
    h.controller.dispose();
  });

  it('a second start supersedes the first: late resolve cleans up, only the new input commits', async () => {
    const h = harness({ manualCam: true });
    h.controller.join('c1', 'Bob');
    const first = h.controller.startCamera('c1');
    const second = h.controller.startCamera('c1');
    h.pendingCams.shift()!(); // resolve the FIRST registration
    await first;
    h.pendingCams.shift()!();
    await second;
    const offers = h.offersFor('c1');
    expect(offers).toHaveLength(1);
    expect(offers[0].inputId).toBe(`${ROOM}::whip::cam-2`);
    expect(h.removed).toEqual([`${ROOM}::whip::cam-1`]);
    h.controller.dispose();
  });

  it('register failure surfaces a typed camera_failed error', async () => {
    const h = harness();
    const failing = new DuckHunterController(ROOM, {
      getState: () => h.sceneState,
    } as unknown as StoreApi<RoomStore>, {
      broadcast: (e) => h.events.push(e),
      sendTo: (clientId, event) => h.sent.push({ clientId, event }),
      registerShooterCam: () => Promise.reject(new Error('boom')),
      removeInput: async () => {},
      isInputLive: () => false,
    });
    failing.join('c1', 'Bob');
    await failing.startCamera('c1');
    expect(h.errorsFor('c1').map((e) => e.code)).toContain('camera_failed');
    failing.dispose();
    h.controller.dispose();
  });

  it('pollCameras reflects heartbeat liveness into camLive', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    await h.controller.startCamera('c1');
    const inputId = h.offersFor('c1')[0].inputId;
    expect(
      h.lastState()?.players.find((p) => p.clientId === 'c1')?.camLive,
    ).toBe(false);

    h.live.add(inputId);
    await vi.advanceTimersByTimeAsync(1100);
    expect(
      h.lastState()?.players.find((p) => p.clientId === 'c1')?.camLive,
    ).toBe(true);

    h.live.delete(inputId);
    await vi.advanceTimersByTimeAsync(1100);
    expect(
      h.lastState()?.players.find((p) => p.clientId === 'c1')?.camLive,
    ).toBe(false);
    h.controller.dispose();
  });

  it('onInputsRemoved (stale sweep) drops cam refs and re-broadcasts', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    await h.controller.startCamera('c1');
    const inputId = h.offersFor('c1')[0].inputId;
    h.live.add(inputId);
    await vi.advanceTimersByTimeAsync(1100);

    h.live.delete(inputId);
    h.controller.onInputsRemoved([inputId]);
    expect(
      h.lastState()?.players.find((p) => p.clientId === 'c1')?.camLive,
    ).toBe(false);
    // The input is already gone from the engine — no removeInput call.
    expect(h.removed).toHaveLength(0);
    h.controller.dispose();
  });
});

describe('match lifecycle and the 30 Hz loop', () => {
  it('stops the loop after ended + linger instead of ticking forever', async () => {
    const h = harness();
    // No players, no target: only the match holds the loop.
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100); // playing
    h.controller.controlMatch({ action: 'stop' });
    await vi.advanceTimersByTimeAsync(6000); // ended linger elapses
    expect(h.shooterSets[h.shooterSets.length - 1]).toBeNull();

    const eventCount = h.events.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.events.length).toBe(eventCount); // loop is dead
    // The match itself survives for results screens.
    expect(h.controller.getMatchSnapshot().phase).toBe('ended');
    h.controller.dispose();
  });

  it('keeps ticking during countdown/playing', async () => {
    const h = harness();
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    const before = h.events.filter((e) => e.type === 'shooter_match').length;
    await vi.advanceTimersByTimeAsync(2000); // still countdown
    const after = h.events.filter((e) => e.type === 'shooter_match').length;
    expect(after).toBeGreaterThan(before); // 1 Hz clock keeps broadcasting
    h.controller.dispose();
  });

  it('a lone zero-point player is a draw, not a winner', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.controlMatch({ action: 'stop' });
    const snap = h.controller.getMatchSnapshot();
    expect(snap.winner).toBeNull();
    expect(snap.finalScores).toHaveLength(1);
    h.controller.dispose();
  });

  it('a tie is a draw', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob');
    h.controller.join('c2', 'Eve');
    h.controller.controlMatch({ action: 'stop' }); // no live match → no-op
    expect(h.controller.getMatchSnapshot().phase).toBe('idle');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.controlMatch({ action: 'stop' });
    expect(h.controller.getMatchSnapshot().winner).toBeNull();
    h.controller.dispose();
  });

  it('a decisive score is crowned', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob');
    h.controller.join('c2', 'Eve');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.fire('c1');
    h.controller.controlMatch({ action: 'stop' });
    const snap = h.controller.getMatchSnapshot();
    expect(snap.winner?.clientId).toBe('c1');
    expect(snap.winner?.score).toBe(1);
    h.controller.dispose();
  });
});

describe('ducks', () => {
  function birdTarget(boxCount: number): PersonBoxes {
    return {
      boxes: Array.from({ length: boxCount }, (_, i) => ({
        id: i + 1,
        x: 0.05 + (i % 8) * 0.1,
        y: 0.05 + Math.floor(i / 8) * 0.2,
        w: 0.08,
        h: 0.08,
        color: i % 3,
      })),
      frameW: 1920,
      frameH: 1080,
      ghost: true,
      sprite: 'bird',
    };
  }

  it('caps the live flock at MAX_DUCKS even with more detections', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget(MAX_DUCKS + 8);
    h.controller.ensureActive();
    await vi.advanceTimersByTimeAsync(100);
    const overlay = h.lastOverlay();
    expect(overlay).not.toBeNull();
    expect(overlay!.ducks.length).toBeLessThanOrEqual(MAX_DUCKS);
    h.controller.dispose();
  });

  it('hit-stop freezes the surviving flock by pushing spawnAt forward', async () => {
    const h = harness();
    // Duck 1 sits centered (hittable at default aim); duck 2 far away.
    h.sceneState.peopleBoxes['stage'] = {
      boxes: [
        { id: 1, x: 0.45, y: 0.45, w: 0.1, h: 0.1, color: 0 },
        { id: 2, x: 0.05, y: 0.05, w: 0.1, h: 0.1, color: 1 },
      ],
      frameW: 1920,
      frameH: 1080,
      ghost: true,
      sprite: 'bird',
    };
    h.controller.join('c1', 'Bob');
    await vi.advanceTimersByTimeAsync(50); // spawn both ducks
    const before = h
      .lastOverlay()!
      .ducks.find((d) => d.id === 2)!.spawnAt;

    h.controller.fire('c1'); // kills duck 1 → hang starts (hit-stop)
    await vi.advanceTimersByTimeAsync(100);
    const after = h.lastOverlay()!.ducks.find((d) => d.id === 2)!.spawnAt;
    expect(after).toBeGreaterThan(before); // clock pushed → flight frozen
    h.controller.dispose();
  });
});
