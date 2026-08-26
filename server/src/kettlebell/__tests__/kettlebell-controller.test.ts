import { describe, expect, it } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import { KettlebellCoachController } from '../KettlebellCoachController';

const INPUT = 'input-1';

function harness() {
  const events: RoomEvent[] = [];
  let now = 0;
  const controller = new KettlebellCoachController(
    'room-1',
    (_roomId, event) => events.push(event),
    () => now,
  );
  return {
    controller,
    events,
    advance(ms: number) {
      now += ms;
    },
    ofType<T extends RoomEvent['type']>(type: T) {
      return events.filter((e) => e.type === type) as Extract<
        RoomEvent,
        { type: T }
      >[];
    },
  };
}

function rep(index: number, issues: string[] = []) {
  return {
    type: 'rep_completed',
    index,
    verdict: issues.length ? 'incorrect' : 'correct',
    issues,
  };
}

describe('KettlebellCoachController', () => {
  it('broadcasts reps and dedupes replayed indices after a reconnect', () => {
    const h = harness();
    h.controller.handleResult(INPUT, { events: [rep(1), rep(2)] });
    // Worker restarts and replays reps 1-2, then continues with 3.
    h.controller.handleResult(INPUT, { events: [rep(1), rep(2), rep(3)] });
    const reps = h.ofType('kettlebell_rep_completed');
    expect(reps.map((r) => r.repIndex)).toEqual([1, 2, 3]);
    expect(reps[0].verdict).toBe('correct');
  });

  it('carries verdict and issues through to the bus event', () => {
    const h = harness();
    h.controller.handleResult(INPUT, { events: [rep(1, ['bent_arms'])] });
    const [event] = h.ofType('kettlebell_rep_completed');
    expect(event.verdict).toBe('incorrect');
    expect(event.issues).toEqual(['bent_arms']);
    expect(event.inputId).toBe(INPUT);
  });

  it('maps a worker frameFile to a served screenshotUrl', () => {
    const h = harness();
    h.controller.handleResult(INPUT, {
      events: [{ ...rep(1), topT: 1.02, frameFile: 'room__whip__a-s1-r0001.jpg' }],
    });
    const [event] = h.ofType('kettlebell_rep_completed');
    expect(event.screenshotUrl).toBe(
      '/kbt-rep-frames/room__whip__a-s1-r0001.jpg',
    );
  });

  it('drops frameFile names that fail the traversal guard', () => {
    const h = harness();
    h.controller.handleResult(INPUT, {
      events: [
        { ...rep(1), frameFile: '../secrets.jpg' },
        { ...rep(2), frameFile: 'a/b.jpg' },
        { ...rep(3), frameFile: 'shot.png' },
      ],
    });
    const reps = h.ofType('kettlebell_rep_completed');
    expect(reps).toHaveLength(3);
    expect(reps.every((r) => r.screenshotUrl === undefined)).toBe(true);
  });

  it('fires a technique alert on 3 of the last 5 reps, then cools down', () => {
    const h = harness();
    h.controller.handleResult(INPUT, { events: [rep(1, ['squatting'])] });
    h.controller.handleResult(INPUT, { events: [rep(2)] });
    h.controller.handleResult(INPUT, { events: [rep(3, ['squatting'])] });
    expect(h.ofType('kettlebell_technique_alert')).toHaveLength(0);

    h.controller.handleResult(INPUT, { events: [rep(4, ['squatting'])] });
    const alerts = h.ofType('kettlebell_technique_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].issue).toBe('squatting');
    expect(alerts[0].occurrences).toBe(3);

    // Within the 10s cooldown the same issue must stay silent.
    h.advance(5_000);
    h.controller.handleResult(INPUT, { events: [rep(5, ['squatting'])] });
    expect(h.ofType('kettlebell_technique_alert')).toHaveLength(1);

    // After the cooldown it may fire again.
    h.advance(6_000);
    h.controller.handleResult(INPUT, { events: [rep(6, ['squatting'])] });
    expect(h.ofType('kettlebell_technique_alert')).toHaveLength(2);
  });

  it('alerts independently per issue code', () => {
    const h = harness();
    for (let i = 1; i <= 3; i++) {
      h.controller.handleResult(INPUT, {
        events: [rep(i, ['squatting', 'bent_arms'])],
      });
    }
    const alerts = h.ofType('kettlebell_technique_alert');
    expect(alerts.map((a) => a.issue).sort()).toEqual([
      'bent_arms',
      'squatting',
    ]);
  });

  it('broadcasts exercise changes and drops replayed no-ops', () => {
    const h = harness();
    h.advance(10_000);
    h.controller.handleResult(INPUT, {
      events: [{ type: 'exercise_changed', exercise: 'swing', prev: 'idle' }],
    });
    // Replay after a worker reconnect — already in this state.
    h.controller.handleResult(INPUT, {
      events: [{ type: 'exercise_changed', exercise: 'swing', prev: 'idle' }],
    });
    const changes = h.ofType('kettlebell_exercise_changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ exercise: 'swing', prevExercise: 'idle' });
  });

  it('parks a too-soon change and flushes it on a later result', () => {
    const h = harness();
    h.advance(10_000);
    h.controller.handleResult(INPUT, {
      events: [{ type: 'exercise_changed', exercise: 'swing', prev: 'idle' }],
    });
    // 0.5s later — under the 2s min interval, so parked instead of broadcast.
    h.advance(500);
    h.controller.handleResult(INPUT, {
      events: [{ type: 'exercise_changed', exercise: 'clean', prev: 'swing' }],
    });
    expect(h.ofType('kettlebell_exercise_changed')).toHaveLength(1);

    // Any later result past the interval flushes the parked state.
    h.advance(2_000);
    h.controller.handleResult(INPUT, { events: [] });
    const changes = h.ofType('kettlebell_exercise_changed');
    expect(changes).toHaveLength(2);
    expect(changes[1]).toMatchObject({ exercise: 'clean', prevExercise: 'swing' });
  });

  it('reset() clears rep dedupe and exercise state for the input', () => {
    const h = harness();
    h.advance(10_000);
    h.controller.handleResult(INPUT, {
      events: [
        rep(5),
        { type: 'exercise_changed', exercise: 'swing', prev: 'idle' },
      ],
    });
    h.controller.reset(INPUT);
    h.advance(10_000);
    // A fresh worker session starts counting from 1 again.
    h.controller.handleResult(INPUT, {
      events: [
        rep(1),
        { type: 'exercise_changed', exercise: 'swing', prev: 'idle' },
      ],
    });
    expect(h.ofType('kettlebell_rep_completed').map((r) => r.repIndex)).toEqual(
      [5, 1],
    );
    expect(h.ofType('kettlebell_exercise_changed')).toHaveLength(2);
  });

  it('tracks state per input independently', () => {
    const h = harness();
    h.controller.handleResult('a', { events: [rep(1)] });
    h.controller.handleResult('b', { events: [rep(1)] });
    expect(h.ofType('kettlebell_rep_completed')).toHaveLength(2);
  });

  it('resets the rep dedupe when the worker session changes', () => {
    const h = harness();
    h.controller.handleResult(INPUT, {
      session: 'a',
      events: [rep(1), rep(2), rep(3)],
    });
    // Worker restarted (or the stream reconnected): indices start over at 1.
    // Without the session reset the dedupe swallowed every rep from here on.
    h.controller.handleResult(INPUT, { session: 'b', events: [rep(1)] });
    expect(h.ofType('kettlebell_rep_completed').map((r) => r.repIndex)).toEqual(
      [1, 2, 3, 1],
    );
  });

  it('still dedupes replayed indices within one session', () => {
    const h = harness();
    h.controller.handleResult(INPUT, { session: 'a', events: [rep(1), rep(2)] });
    h.controller.handleResult(INPUT, {
      session: 'a',
      events: [rep(1), rep(2), rep(3)],
    });
    expect(h.ofType('kettlebell_rep_completed').map((r) => r.repIndex)).toEqual(
      [1, 2, 3],
    );
  });

  it('clears the technique-alert window across sessions', () => {
    const h = harness();
    h.controller.handleResult(INPUT, {
      session: 'a',
      events: [rep(1, ['squatting']), rep(2, ['squatting'])],
    });
    // Two of the three occurrences belong to the dead session — no alert.
    h.controller.handleResult(INPUT, {
      session: 'b',
      events: [rep(1, ['squatting'])],
    });
    expect(h.ofType('kettlebell_technique_alert')).toHaveLength(0);
  });
});
