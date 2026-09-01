import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RoomEvent,
  ShooterCharacterId,
  ShooterTopScoreEntry,
} from '@smelter-editor/types';
import type { StoreApi } from 'zustand';
import type { PersonBoxes, RoomStore, ShooterOverlay } from '../../app/store';
import { DuckHunterController } from '../DuckHunterController';
import { MAX_DUCKS } from '../duckFlight';
import {
  DOG_FREEZE_MS,
  DOG_POSE_ASPECT,
  DOG_RISE_MS,
  DOG_WIDTH_FRAC,
} from '../dogTaunt';

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
  /** Character-clip claims in order; `null` = an explicit unmount-everything. */
  const clipCalls: (ShooterCharacterId[] | null)[] = [];
  // In-memory stand-in for the global TopScoresStore (same sort + cap).
  const topScores: ShooterTopScoreEntry[] = [];
  /** URLs handed to registerJoinQr, in order. */
  const qrCalls: string[] = [];
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
    recordTopScore: (entry) => {
      const full: ShooterTopScoreEntry = { initials: 'AAA', ...entry };
      topScores.push(full);
      topScores.sort((a, b) => b.score - a.score || a.at - b.at);
      topScores.splice(10);
      const rank = topScores.indexOf(full);
      return { rank: rank === -1 ? null : rank + 1 };
    },
    readTopScores: (mode) => topScores.filter((e) => e.mode === mode),
    mountCharacterClips: (ids) => clipCalls.push(ids),
    unmountCharacterClips: () => clipCalls.push(null),
    registerJoinQr: async (url) => {
      qrCalls.push(url);
      return `qr-${qrCalls.length}`;
    },
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
    topScores,
    clipCalls,
    qrCalls,
    /** The clip set currently on air (`[]` once everything is released). */
    clipsNow(): string[] {
      const last = clipCalls[clipCalls.length - 1];
      return last == null ? [] : last;
    },
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

  it('characterId rides join, survives adoption, and re-picks via setCharacter', () => {
    const h = harness();
    h.controller.join('c1', 'Bob', undefined, 'crane-hunter');
    expect(h.joinedFor('c1')!.characterId).toBe('crane-hunter');
    expect(h.lastState()!.players[0].characterId).toBe('crane-hunter');

    // Adoption keeps the pick when the re-join doesn't carry one…
    const key = h.joinedFor('c1')!.playerKey;
    h.controller.handleDisconnect('c1');
    h.controller.join('c2', 'Bob', key);
    expect(h.joinedFor('c2')!.characterId).toBe('crane-hunter');

    // …and a re-join carrying one refreshes it (same for the joined fast path).
    h.controller.join('c2', 'Bob', key, 'pink-spotter');
    expect(h.joinedFor('c2')!.characterId).toBe('pink-spotter');

    h.controller.setCharacter('c2', 'improwizator');
    expect(h.lastState()!.players[0].characterId).toBe('improwizator');
    h.controller.dispose();
  });

  it('a join without a character leaves it unset', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    expect(h.joinedFor('c1')!.characterId).toBeUndefined();
    expect(h.lastState()!.players[0].characterId).toBeUndefined();
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
    const failing = new DuckHunterController(
      ROOM,
      {
        getState: () => h.sceneState,
      } as unknown as StoreApi<RoomStore>,
      {
        broadcast: (e) => h.events.push(e),
        sendTo: (clientId, event) => h.sent.push({ clientId, event }),
        registerShooterCam: () => Promise.reject(new Error('boom')),
        removeInput: async () => {},
        isInputLive: () => false,
      },
    );
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

  it('records the winner into TOP SCORES exactly once, repeat stops no-op', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob', undefined, 'crane-hunter');
    h.controller.join('c2', 'Eve');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.fire('c1');
    h.controller.controlMatch({ action: 'stop' });
    // The double-submit paths that used to duplicate rows (host refresh,
    // StrictMode remount) all funnel through stop/endMatch — repeat it.
    h.controller.controlMatch({ action: 'stop' });
    expect(h.topScores).toHaveLength(1);
    expect(h.topScores[0]).toMatchObject({
      name: 'Bob',
      score: 1,
      mode: 'time',
      characterId: 'crane-hunter',
    });
    const snap = h.controller.getMatchSnapshot();
    expect(snap.topScores).toHaveLength(1);
    expect(snap.topScoreRank).toBe(1);
    h.controller.dispose();
  });

  it('the ended overlay carries the results-scene payload', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob', undefined, 'improwizator');
    h.controller.join('c2', 'Eve');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.fire('c1');
    h.controller.controlMatch({ action: 'stop' });
    const overlay = h.lastOverlay();
    expect(overlay?.match?.phase).toBe('ended');
    expect(overlay?.match?.winner).toMatchObject({
      name: 'Bob',
      characterId: 'improwizator',
    });
    expect(overlay?.match?.finalScores).toHaveLength(2);
    expect(overlay?.match?.topScores).toHaveLength(1);
    expect(overlay?.match?.topScoreRank).toBe(1);
    expect(overlay?.match?.endedAt).not.toBeNull();
    h.controller.dispose();
  });

  it('a draw records no top score but still snapshots the table', async () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.controlMatch({ action: 'stop' });
    expect(h.topScores).toHaveLength(0);
    const snap = h.controller.getMatchSnapshot();
    expect(snap.topScores).toEqual([]);
    expect(snap.topScoreRank).toBeNull();
    h.controller.dispose();
  });
});

describe('armed lobby / opening screen', () => {
  it('publishes the opening screen with no target and no players', async () => {
    const h = harness();
    // Exactly the window right after OPEN LOBBY: the YOLO sidecar has not
    // pushed a single peopleBoxes yet, so there is no target to hang on.
    h.controller.controlMatch({
      action: 'lobby',
      mode: 'time',
      durationMs: 90_000,
    });
    const overlay = h.lastOverlay();
    expect(overlay).not.toBeNull();
    expect(overlay!.lobbyArmed).toBe(true);
    expect(overlay!.match).toBeNull();
    expect(overlay!.targetInputId).toBe('');
    expect(overlay!.ducks).toEqual([]);
    expect(overlay!.lobby?.setup).toEqual({
      mode: 'time',
      durationMs: 90_000,
      targetScore: null,
    });
    // And the loop keeps running, so the scene does not freeze.
    const publishes = h.shooterSets.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.shooterSets.length).toBeGreaterThan(publishes);
    h.controller.dispose();
  });

  it('clamps the staged round like a start does', () => {
    const h = harness();
    h.controller.controlMatch({ action: 'lobby', mode: 'time', durationMs: 5 });
    expect(h.lastOverlay()!.lobby?.setup?.durationMs).toBe(10_000);

    h.controller.controlMatch({
      action: 'lobby',
      mode: 'points',
      targetScore: 999,
    });
    expect(h.lastOverlay()!.lobby?.setup).toEqual({
      mode: 'points',
      durationMs: null,
      targetScore: 200,
    });
    h.controller.dispose();
  });

  it('a bare lobby arm keeps the staged round (older editors)', () => {
    const h = harness();
    h.controller.controlMatch({
      action: 'lobby',
      mode: 'points',
      targetScore: 25,
    });
    h.controller.controlMatch({ action: 'lobby' });
    expect(h.lastOverlay()!.lobby?.setup?.targetScore).toBe(25);
    // A reset drops back to free-play, so nothing is staged any more.
    h.controller.controlMatch({ action: 'reset' });
    h.controller.controlMatch({ action: 'lobby' });
    expect(h.lastOverlay()!.lobby?.setup).toBeNull();
    h.controller.dispose();
  });

  it('shows only the staged mode in the lobby TOP SCORES', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.fire('c1'); // any score at all, so the table is non-empty
    h.controller.controlMatch({ action: 'stop' });

    h.controller.controlMatch({ action: 'lobby', mode: 'time' });
    const timeRows = h.lastOverlay()!.lobby!.topScores;
    expect(timeRows.every((e) => e.mode === 'time')).toBe(true);

    h.controller.controlMatch({ action: 'lobby', mode: 'points' });
    expect(h.lastOverlay()!.lobby!.topScores).toEqual([]);
    h.controller.dispose();
  });

  it('free-play with no target and no players still publishes nothing', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'lobby' });
    expect(h.lastOverlay()).not.toBeNull();
    h.controller.controlMatch({ action: 'reset' });
    expect(h.lastOverlay()).toBeNull();
    h.controller.dispose();
  });

  it('renders the join QR once per distinct URL', async () => {
    const h = harness();
    h.controller.controlMatch({ action: 'lobby', mode: 'time' });
    h.controller.setJoinLink({ joinUrl: 'https://arcade.example/x/shoot' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.qrCalls).toEqual(['https://arcade.example/x/shoot']);
    expect(h.lastOverlay()!.lobby?.qrImageId).toBe('qr-1');
    // Label defaults to the URL host when the host page sends none.
    expect(h.lastOverlay()!.lobby?.joinLabel).toBe('arcade.example');

    // Re-pushing the same URL must not mint a second (immutable) image.
    h.controller.setJoinLink({ joinUrl: 'https://arcade.example/x/shoot' });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.qrCalls).toHaveLength(1);
    h.controller.dispose();
  });
});

describe('character clips on the broadcast', () => {
  it('the armed lobby claims every joined hunter, deduped', () => {
    const h = harness();
    h.controller.join('c1', 'Bob', undefined, 'improwizator');
    h.controller.join('c2', 'Eve', undefined, 'crane-hunter');
    // Same hunter as Bob: one clip serves both players.
    h.controller.join('c3', 'Ann', undefined, 'improwizator');
    h.controller.join('c4', 'Zed'); // no pick — contributes nothing
    expect(h.clipsNow()).toEqual([]); // free-play shows no lineup

    h.controller.controlMatch({ action: 'lobby' });
    expect(h.clipsNow()).toEqual(['crane-hunter', 'improwizator']);
    h.controller.dispose();
  });

  it('a late pick in the lobby joins the lineup', () => {
    const h = harness();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({ action: 'lobby' });
    expect(h.clipsNow()).toEqual([]);

    h.controller.setCharacter('c1', 'pink-spotter');
    expect(h.clipsNow()).toEqual(['pink-spotter']);
    h.controller.dispose();
  });

  it('the countdown keeps the lineup, live play releases it', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob', undefined, 'improwizator');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    expect(h.clipsNow()).toEqual(['improwizator']);

    await vi.advanceTimersByTimeAsync(3100); // countdown → playing
    expect(h.clipsNow()).toEqual([]);
    h.controller.dispose();
  });

  it('the podium claims only the top three finishers', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    const picks: ShooterCharacterId[] = [
      'improwizator',
      'crane-hunter',
      'pink-spotter',
      'crane-hunter',
    ];
    picks.forEach((id, i) =>
      h.controller.join(`c${i}`, `P${i}`, undefined, id),
    );
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    // Rank the roster: c0 > c1 > c2 > c3 (last one never scores).
    for (let i = 0; i < 3; i++) h.controller.fire('c0');
    for (let i = 0; i < 2; i++) h.controller.fire('c1');
    h.controller.fire('c2');
    h.controller.controlMatch({ action: 'stop' });

    const overlay = h.lastOverlay();
    expect(overlay?.match?.finalScores.map((p) => p.name)).toEqual([
      'P0',
      'P1',
      'P2',
      'P3',
    ]);
    // Fourth place's hunter is already on the podium through P1, so the
    // deduped claim is exactly the three distinct top-three characters.
    expect(h.clipsNow()).toEqual([
      'crane-hunter',
      'improwizator',
      'pink-spotter',
    ]);
    h.controller.dispose();
  });

  it('leaving the results releases the clips, and so does dispose', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = ghostTarget();
    h.controller.join('c1', 'Bob', undefined, 'improwizator');
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.fire('c1');
    h.controller.controlMatch({ action: 'stop' });
    expect(h.clipsNow()).toEqual(['improwizator']);

    h.controller.controlMatch({ action: 'reset' });
    expect(h.clipsNow()).toEqual([]);

    h.controller.controlMatch({ action: 'lobby' });
    expect(h.clipsNow()).toEqual(['improwizator']);
    h.controller.dispose();
    expect(h.clipCalls[h.clipCalls.length - 1]).toBeNull();
  });

  it('a parked loop drops its claim instead of decoding forever', async () => {
    const h = harness();
    // No players and no target: only the match holds the loop alive.
    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(3100);
    h.controller.controlMatch({ action: 'stop' });
    await vi.advanceTimersByTimeAsync(6000); // ended linger elapses
    expect(h.shooterSets[h.shooterSets.length - 1]).toBeNull();
    expect(h.clipsNow()).toEqual([]);
    h.controller.dispose();
  });

  it('claims are only re-sent when the set actually changes', () => {
    const h = harness();
    h.controller.join('c1', 'Bob', undefined, 'improwizator');
    h.controller.controlMatch({ action: 'lobby' });
    const calls = h.clipCalls.length;
    // Aim/publish churn must not re-register the same clip 30 times a second.
    for (let i = 0; i < 10; i++) h.controller.aim('c1', 0.5, 0.5);
    expect(h.clipCalls.length).toBe(calls);
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
    const before = h.lastOverlay()!.ducks.find((d) => d.id === 2)!.spawnAt;

    h.controller.fire('c1'); // kills duck 1 → hang starts (hit-stop)
    await vi.advanceTimersByTimeAsync(100);
    const after = h.lastOverlay()!.ducks.find((d) => d.id === 2)!.spawnAt;
    expect(after).toBeGreaterThan(before); // clock pushed → flight frozen
    h.controller.dispose();
  });

  // The hit flash is tinted to whoever pulled the trigger, so a frame with two
  // simultaneous kills says *who* got which duck.
  it('a shot duck carries the shooting player’s color', async () => {
    const h = harness();
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
    await vi.advanceTimersByTimeAsync(50);
    const shooter = h
      .lastOverlay()!
      .scores.find((s) => s.clientId === 'c1')!.color;

    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(50);
    const ducks = h.lastOverlay()!.ducks;
    const shot = ducks.find((d) => d.id === 1)!;
    expect(shot.diedAt).toBeDefined();
    expect(shot.hitColor).toBe(shooter);
    // A duck still in flight has no shooter attached.
    expect(ducks.find((d) => d.id === 2)!.hitColor).toBeUndefined();
    h.controller.dispose();
  });
});

/**
 * A bird-sprite target with one duck parked in the top-left corner: a long pause
 * keeps it frozen at its spawn, well clear of the centre, so every shot aimed at
 * the middle of the frame is a genuine miss without the flock drifting into it.
 */
function birdTarget(): PersonBoxes {
  return {
    boxes: [{ id: 1, x: 0.02, y: 0.02, w: 0.06, h: 0.06, color: 0 }],
    frameW: 1920,
    frameH: 1080,
    ghost: true,
    sprite: 'bird',
    duckPauseMs: 100_000,
  };
}

// Center of the taunting dog in content space: it is DOG_WIDTH_FRAC of the
// output wide, laugh-aspect tall, and stands on the bottom edge.
const DOG_W = Math.round(1920 * DOG_WIDTH_FRAC);
const DOG_H = Math.round(DOG_W * DOG_POSE_ASPECT.laugh);
const DOG_AIM_Y = (1080 - DOG_H / 2) / 1080;

/** Settle the eased crosshair onto `(x, y)` — fire() shoots at dispX/dispY. */
async function aimAt(
  h: ReturnType<typeof harness>,
  clientId: string,
  x: number,
  y: number,
) {
  h.controller.aim(clientId, x, y);
  await vi.advanceTimersByTimeAsync(400); // ~12 eased ticks; error < 1e-4
}

function dogsNow(h: ReturnType<typeof harness>) {
  return h.lastOverlay()?.dogs ?? [];
}

describe('taunting dog', () => {
  it('pops up after two misses in a row, not one', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);

    h.controller.fire('c1'); // miss 1
    expect(dogsNow(h)).toHaveLength(0);
    h.controller.fire('c1'); // miss 2 → the dog comes out to laugh
    expect(dogsNow(h)).toHaveLength(1);
    h.controller.dispose();
  });

  it('only lets itself be shot while laughing', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1'); // dog summoned, still springing up

    h.controller.fire('c1'); // shot during the rise — too early
    expect(dogsNow(h)[0]?.diedAt).toBeUndefined();
    expect(h.lastOverlay()!.scores[0].dogScore).toBe(0);

    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100); // now laughing
    h.controller.fire('c1');
    expect(dogsNow(h)[0]?.diedAt).toBeGreaterThan(0);
    expect(h.lastOverlay()!.scores[0].dogScore).toBe(1);
    h.controller.dispose();
  });

  it('spends a round and leaves the duck score untouched', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100);

    const before = h.lastOverlay()!.scores[0].ammo;
    h.controller.fire('c1');
    const row = h.lastOverlay()!.scores[0];
    expect(row.ammo).toBe(before - 1); // a dog costs a round like anything else
    expect(row.dogScore).toBe(1);
    expect(row.score).toBe(0); // ...but never the duck score
    expect(h.lastState()!.players[0].score).toBe(0);

    const hit = h.sent
      .map((s) => s.event)
      .filter((e) => e.type === 'shooter_hit')
      .pop() as Extract<RoomEvent, { type: 'shooter_hit' }>;
    expect(hit.target).toBe('dog');
    expect(hit.dogScore).toBe(1);
    expect(hit.score).toBe(0);
    h.controller.dispose();
  });

  it('cannot be shot twice', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100);

    h.controller.fire('c1');
    h.controller.fire('c1'); // same spot, mid death beat
    expect(h.lastOverlay()!.scores[0].dogScore).toBe(1);
    h.controller.dispose();
  });

  it('never wins a points round', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    h.controller.controlMatch({
      action: 'start',
      mode: 'points',
      targetScore: 1,
    });
    await vi.advanceTimersByTimeAsync(3100); // countdown → playing
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100);
    h.controller.fire('c1');

    expect(h.lastOverlay()!.scores[0].dogScore).toBe(1);
    expect(h.controller.getMatchSnapshot().phase).toBe('playing');
    expect(h.controller.getMatchSnapshot().winner).toBeFalsy();
    h.controller.dispose();
  });

  it('freezes the flock for the yelp, then lets it resume', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100);
    h.controller.fire('c1'); // dog down — hit-stop begins

    const atHit = h.lastOverlay()!.ducks[0].spawnAt;
    await vi.advanceTimersByTimeAsync(DOG_FREEZE_MS / 2);
    const frozen = h.lastOverlay()!.ducks[0].spawnAt;
    // Frozen: the duck's clock is pushed forward with wall time, so it resumes
    // in place rather than teleporting once the beat ends.
    expect(frozen).toBeGreaterThan(atHit);

    await vi.advanceTimersByTimeAsync(DOG_FREEZE_MS);
    const resumed = h.lastOverlay()!.ducks[0].spawnAt;
    await vi.advanceTimersByTimeAsync(200);
    expect(h.lastOverlay()!.ducks[0].spawnAt).toBe(resumed);
    h.controller.dispose();
  });

  it('is cleared, along with the dog tally, when a fresh round starts', async () => {
    const h = harness();
    h.sceneState.peopleBoxes['stage'] = birdTarget();
    h.controller.join('c1', 'Bob');
    await aimAt(h, 'c1', 0.5, DOG_AIM_Y);
    h.controller.fire('c1');
    h.controller.fire('c1');
    await vi.advanceTimersByTimeAsync(DOG_RISE_MS + 100);
    h.controller.fire('c1');
    expect(h.lastOverlay()!.scores[0].dogScore).toBe(1);

    h.controller.controlMatch({ action: 'start', mode: 'time' });
    await vi.advanceTimersByTimeAsync(100);
    expect(dogsNow(h)).toHaveLength(0);
    expect(h.lastOverlay()!.scores[0].dogScore).toBe(0);
    h.controller.dispose();
  });
});
