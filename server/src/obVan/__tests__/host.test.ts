import { describe, expect, it } from 'vitest';
import type { ObSignalState } from '../contracts';
import {
  OB_DENIED_RECHECK_MS,
  OB_HOST_LOST_MS,
  OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS,
  OB_SNAPSHOT_TIMEOUT_MS,
  ObHostTracker,
  type ObHostIdentify,
} from '../host';
import { ObLlmError } from '../llm/errors';
import { sig } from './ob-brain-fixtures';
import { flush } from './llm-fixtures';

const T0 = 1_000_000;

type SetHostCall = { camId: string | null; trackId?: number | null };

function harness() {
  const t = { now: T0 };
  const calls = {
    snapshots: [] as { camId: string; requestId: string }[],
    identifies: [] as string[],
    setHost: [] as SetHostCall[],
    logs: [] as string[],
  };
  const script: (ObHostIdentify | null | Error)[] = [];
  let snapshotOk = true;
  const tracker = new ObHostTracker({
    requestSnapshot: (camId, requestId) => {
      calls.snapshots.push({ camId, requestId });
      return snapshotOk;
    },
    identify: (camId) => {
      calls.identifies.push(camId);
      const next = script.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(
        next ?? { isHost: true, confidence: 0.9, reason: 'gold cap' },
      );
    },
    setHost: (camId, info) =>
      calls.setHost.push({ camId, trackId: info?.trackId }),
    log: (text) => calls.logs.push(text),
    onChange: () => {},
    now: () => t.now,
  });
  return {
    t,
    calls,
    tracker,
    script,
    setSnapshotOk: (ok: boolean) => {
      snapshotOk = ok;
    },
  };
}

function view(
  ...cams: { camId: string; trackIds?: number[]; offline?: boolean }[]
): Record<string, ObSignalState> {
  const out: Record<string, ObSignalState> = {};
  for (const c of cams) {
    const tracks = (c.trackIds ?? []).map((id) => ({
      x: 0.3,
      y: 0.2,
      w: 0.2,
      h: 0.6,
      id,
    }));
    out[c.camId] = sig(c.camId, T0, {
      offline: c.offline ?? false,
      people: {
        count: tracks.length,
        largest: tracks[0] ?? null,
        centroid: tracks.length ? { x: 0.4, y: 0.5 } : null,
        tracks,
      },
    });
  }
  return out;
}

const ctx = (
  events: { camId: string; trackId: number; airMs: number }[],
  v: Record<string, ObSignalState>,
  over: Partial<{ active: boolean; llmAvailable: boolean }> = {},
) => ({ active: true, llmAvailable: true, events, view: v, ...over });

const event = (camId: string, trackId: number) => ({
  camId,
  trackId,
  airMs: T0,
});

/** Snapshot answer for the newest request. */
function answer(h: ReturnType<typeof harness>, jpegB64 = 'aW1n') {
  const req = h.calls.snapshots.at(-1)!;
  h.tracker.onSnapshot(req.camId, {
    kind: 'snapshot',
    requestId: req.requestId,
    jpegB64,
  });
}

describe('ObHostTracker', () => {
  it('new person → snapshot → identify → confirmed host', async () => {
    const h = harness();
    const v = view({ camId: 'c1', trackIds: [7] });
    h.tracker.tick(ctx([event('c1', 7)], v));
    expect(h.calls.snapshots).toHaveLength(1);
    expect(h.tracker.state().status).toBe('identifying');
    answer(h);
    await flush();
    expect(h.calls.identifies).toEqual(['c1']);
    expect(h.calls.setHost).toEqual([{ camId: 'c1', trackId: 7 }]);
    expect(h.tracker.state()).toMatchObject({
      camId: 'c1',
      trackId: 7,
      status: 'confirmed',
      confidence: 0.9,
    });
    expect(h.tracker.hostCamId()).toBe('c1');
  });

  it('a soft yes (low confidence) does not confirm', async () => {
    const h = harness();
    h.script.push({ isHost: true, confidence: 0.4, reason: 'maybe' });
    h.tracker.tick(ctx([event('c1', 1)], view({ camId: 'c1', trackIds: [1] })));
    answer(h);
    await flush();
    expect(h.calls.setHost).toEqual([]);
    expect(h.tracker.state().status).toBe('idle');
  });

  it('per-camera cooldown gates retries; a denied track gets one recheck', async () => {
    const h = harness();
    h.script.push({ isHost: false, confidence: 0.9, reason: 'no cap' });
    const v = view({ camId: 'c1', trackIds: [1] });
    h.tracker.tick(ctx([event('c1', 1)], v));
    answer(h);
    await flush();
    expect(h.tracker.state().status).toBe('idle');
    // A second person on the same camera inside the cooldown: queued, not asked.
    h.t.now += 1000;
    h.tracker.tick(
      ctx([event('c1', 2)], view({ camId: 'c1', trackIds: [1, 2] })),
    );
    expect(h.calls.snapshots).toHaveLength(1);
    // Past the cooldown the queued candidate goes out.
    h.t.now += OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS;
    h.script.push({ isHost: false, confidence: 0.9, reason: 'no cap' });
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [1, 2] })));
    expect(h.calls.snapshots).toHaveLength(2);
    answer(h);
    await flush();
    // The denied first track is rechecked once, when it is still in frame.
    h.t.now += OB_DENIED_RECHECK_MS;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [1, 2] })));
    expect(h.calls.snapshots).toHaveLength(3);
    answer(h);
    await flush();
    h.t.now += OB_DENIED_RECHECK_MS + OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [1, 2] })));
    expect(h.calls.snapshots).toHaveLength(3);
  });

  it('host loss: 3 s without the track clears; the grid comes back', async () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 7)], view({ camId: 'c1', trackIds: [7] })));
    answer(h);
    await flush();
    // Make the confirm old enough to leave the rebind grace.
    h.t.now += 5000;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [7] })));
    expect(h.tracker.state().status).toBe('confirmed');
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [] })));
    h.t.now += OB_HOST_LOST_MS - 1;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [] })));
    expect(h.tracker.state().status).toBe('confirmed');
    h.t.now += 2;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [] })));
    expect(h.tracker.state().status).toBe('idle');
    expect(h.calls.setHost.at(-1)).toEqual({ camId: null, trackId: undefined });
  });

  it('right after a confirm a vanished candidate track rebinds to the largest', async () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 7)], view({ camId: 'c1', trackIds: [7] })));
    answer(h);
    await flush();
    // Track 7 evaporated; track 9 is there — inside the grace it rebinds.
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [9] })));
    expect(h.tracker.state()).toMatchObject({
      status: 'confirmed',
      trackId: 9,
    });
    expect(h.calls.setHost.at(-1)).toEqual({ camId: 'c1', trackId: 9 });
  });

  it('host walks from camera A to camera B', async () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 7)], view({ camId: 'c1', trackIds: [7] })));
    answer(h);
    await flush();
    h.t.now += 5000;
    // Leaves A: one tick notices, the next (3 s later) clears.
    h.tracker.tick(
      ctx([], view({ camId: 'c1', trackIds: [] }, { camId: 'c2' })),
    );
    h.t.now += OB_HOST_LOST_MS + 1;
    h.tracker.tick(
      ctx([], view({ camId: 'c1', trackIds: [] }, { camId: 'c2' })),
    );
    expect(h.tracker.state().status).toBe('idle');
    // …appears on B.
    h.tracker.tick(
      ctx(
        [event('c2', 3)],
        view({ camId: 'c1' }, { camId: 'c2', trackIds: [3] }),
      ),
    );
    answer(h);
    await flush();
    expect(h.tracker.state()).toMatchObject({
      camId: 'c2',
      status: 'confirmed',
    });
  });

  it('a snapshot that never answers times out and frees the slot', () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 1)], view({ camId: 'c1', trackIds: [1] })));
    expect(h.tracker.state().status).toBe('identifying');
    h.t.now += OB_SNAPSHOT_TIMEOUT_MS + 1;
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [1] })));
    expect(h.tracker.state().status).toBe('idle');
    // A late answer for the expired request is ignored.
    answer(h);
    expect(h.calls.identifies).toEqual([]);
  });

  it('budget exhaustion turns detection off for the event; reset re-arms it', async () => {
    const h = harness();
    h.script.push(new ObLlmError('budget', 'spent'));
    h.tracker.tick(ctx([event('c1', 1)], view({ camId: 'c1', trackIds: [1] })));
    answer(h);
    await flush();
    h.tracker.tick(ctx([], view({ camId: 'c1', trackIds: [1] })));
    expect(h.tracker.state().status).toBe('off');
    h.tracker.tick(
      ctx([event('c1', 2)], view({ camId: 'c1', trackIds: [1, 2] })),
    );
    expect(h.calls.snapshots).toHaveLength(1);
    h.tracker.reset();
    h.tracker.tick(ctx([event('c1', 3)], view({ camId: 'c1', trackIds: [3] })));
    expect(h.calls.snapshots).toHaveLength(2);
  });

  it('a transient error (busy / rate) only drops this attempt', async () => {
    const h = harness();
    h.script.push(new ObLlmError('busy', 'brief running'));
    h.tracker.tick(ctx([event('c1', 1)], view({ camId: 'c1', trackIds: [1] })));
    answer(h);
    await flush();
    expect(h.tracker.state().status).toBe('idle');
    h.t.now += OB_IDENTIFY_MIN_INTERVAL_PER_CAM_MS + 1;
    h.tracker.tick(
      ctx([event('c1', 2)], view({ camId: 'c1', trackIds: [1, 2] })),
    );
    expect(h.calls.snapshots).toHaveLength(2);
  });

  it('inactive / no LLM: events are ignored and a confirmed host is cleared', async () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 7)], view({ camId: 'c1', trackIds: [7] })));
    answer(h);
    await flush();
    expect(h.tracker.state().status).toBe('confirmed');
    h.tracker.tick(
      ctx([event('c2', 1)], view({ camId: 'c1', trackIds: [7] }), {
        active: false,
      }),
    );
    expect(h.tracker.state().status).toBe('off');
    expect(h.calls.setHost.at(-1)?.camId).toBeNull();
    expect(h.calls.snapshots).toHaveLength(1);
  });

  it('removeCam clears a confirmed host on that camera', async () => {
    const h = harness();
    h.tracker.tick(ctx([event('c1', 7)], view({ camId: 'c1', trackIds: [7] })));
    answer(h);
    await flush();
    h.tracker.removeCam('c1');
    expect(h.tracker.state().status).toBe('idle');
    expect(h.calls.setHost.at(-1)?.camId).toBeNull();
  });

  it('a worker that is not connected fails the start quietly', () => {
    const h = harness();
    h.setSnapshotOk(false);
    h.tracker.tick(ctx([event('c1', 1)], view({ camId: 'c1', trackIds: [1] })));
    expect(h.tracker.state().status).toBe('idle');
    expect(h.calls.logs.some((l) => l.includes('worker not connected'))).toBe(
      true,
    );
  });
});
