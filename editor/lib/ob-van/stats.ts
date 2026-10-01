import type { ObActionSource, ObCam, ObStats } from '@smelter-editor/types';

// WRAP screen numbers: how long each camera was on program, cut counts by
// source, the show's length.

export type CamShareRow = {
  camId: string;
  number: number | null;
  name: string;
  ms: number;
  /** 0..1 of the summed on-air time (split shots count for every camera). */
  share: number;
};

/**
 * Per-camera share of on-air time, biggest first. Cameras that left the
 * show still count (they keep their id in `onAirMsByCam`), listed as `?`.
 */
export function camShare(
  stats: Pick<ObStats, 'onAirMsByCam'>,
  cams: readonly Pick<ObCam, 'id' | 'number' | 'name'>[],
): CamShareRow[] {
  const entries = Object.entries(stats.onAirMsByCam).filter(
    ([, ms]) => Number.isFinite(ms) && ms > 0,
  );
  const total = entries.reduce((sum, [, ms]) => sum + ms, 0);
  const rows = entries.map(([camId, ms]) => {
    const cam = cams.find((c) => c.id === camId);
    return {
      camId,
      number: cam?.number ?? null,
      name: cam?.name ?? 'left the show',
      ms,
      share: total > 0 ? ms / total : 0,
    };
  });
  // Cameras that never aired still get a row (0 %), after the rest.
  for (const cam of cams) {
    if (!rows.some((r) => r.camId === cam.id))
      rows.push({
        camId: cam.id,
        number: cam.number,
        name: cam.name,
        ms: 0,
        share: 0,
      });
  }
  return rows.sort(
    (a, b) => b.ms - a.ms || (a.number ?? 99) - (b.number ?? 99),
  );
}

/** Mean program hold: the server's figure, else show length / cuts. */
export function avgHoldMs(
  stats: Pick<ObStats, 'avgHoldMs' | 'cuts' | 'startedAtMs' | 'endedAtMs'>,
  nowMs: number,
): number {
  if (stats.avgHoldMs > 0) return stats.avgHoldMs;
  const len = showLengthMs(stats, nowMs);
  return stats.cuts > 0 ? len / (stats.cuts + 1) : len;
}

export function showLengthMs(
  stats: Pick<ObStats, 'startedAtMs' | 'endedAtMs'>,
  nowMs: number,
): number {
  if (stats.startedAtMs == null) return 0;
  return Math.max(0, (stats.endedAtMs ?? nowMs) - stats.startedAtMs);
}

const SOURCE_ORDER: ObActionSource[] = ['operator', 'auto', 'llm', 'system'];

/** Cut counts per source in a fixed order, with their share of all cuts. */
export function cutsBySource(
  stats: Pick<ObStats, 'bySource'>,
): { source: ObActionSource; count: number; share: number }[] {
  const total = SOURCE_ORDER.reduce(
    (sum, s) => sum + (stats.bySource[s] ?? 0),
    0,
  );
  return SOURCE_ORDER.map((source) => {
    const count = stats.bySource[source] ?? 0;
    return { source, count, share: total > 0 ? count / total : 0 };
  });
}

/** `42 %` */
export function pct(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)} %`;
}
