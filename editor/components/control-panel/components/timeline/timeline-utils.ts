import type { Input } from '@/lib/types';
import type {
  BlockSettings,
  Clip,
  Track,
} from '../../hooks/use-timeline-state';
import {
  OUTPUT_TRACK_INPUT_ID,
} from '../../hooks/use-timeline-state';
import { formatMs } from '@/lib/format-utils';

/** Base HSL values per input type: [hue, saturation%, lightness%] */
export const TYPE_HSL: Record<Input['type'], [number, number, number]> = {
  'twitch-channel': [271, 81, 56],
  'kick-channel': [142, 71, 45],
  hls: [24, 95, 50],
  whip: [217, 91, 60],
  'local-mp4': [25, 95, 53],
  image: [48, 96, 53],
  'text-input': [330, 81, 60],
  game: [0, 72, 51],
  hands: [180, 90, 50],
};

const LIGHTNESS_STEP = 10;

export type InputColorEntry = {
  dot: string;
  segBg: string;
  segBorder: string;
  ring: string;
};

/**
 * Build a per-inputId color map: inputs of the same type get the same hue
 * but shifted lightness so they are visually distinguishable.
 */
export function buildInputColorMap(inputs: Input[]) {
  const countByType = new Map<Input['type'], number>();
  const map = new Map<string, InputColorEntry>();

  map.set(OUTPUT_TRACK_INPUT_ID, {
    dot: 'hsl(270 60% 50%)',
    segBg: 'hsla(270, 60%, 50%, 0.15)',
    segBorder: 'hsla(270, 60%, 55%, 0.3)',
    ring: 'hsla(270, 60%, 60%, 0.6)',
  });

  for (const input of inputs) {
    const idx = countByType.get(input.type) ?? 0;
    countByType.set(input.type, idx + 1);

    const [h, s, baseL] = TYPE_HSL[input.type];
    const l = Math.min(
      85,
      Math.max(
        25,
        baseL + (idx % 2 === 0 ? 1 : -1) * Math.ceil(idx / 2) * LIGHTNESS_STEP,
      ),
    );

    map.set(input.inputId, {
      dot: `hsl(${h} ${s}% ${l}%)`,
      segBg: `hsla(${h}, ${s}%, ${l}%, 0.18)`,
      segBorder: `hsla(${h}, ${s}%, ${l}%, 0.35)`,
      ring: `hsla(${h}, ${s}%, ${Math.min(90, l + 10)}%, 0.7)`,
    });
  }
  return map;
}

// ── Constants ────────────────────────────────────────────

export const MIN_HEIGHT = 120;
export const MAX_HEIGHT_VH = 0.6;
export const DEFAULT_HEIGHT = 250;
export const TRACK_HEIGHT = 40;
export const SOURCES_WIDTH = 180;
export const MIN_SOURCES_WIDTH = 100;
export const MAX_SOURCES_WIDTH = 400;
export const SNAP_THRESHOLD_PX = 8;
export const RESIZE_HANDLE_PX = 5;
export const MIN_MOVABLE_KEYFRAME_MS = 1;
export const LONG_PRESS_MS = 500;

export const TIMELINE_COLOR_PRESETS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f5f5f5',
  '#6b7280',
];

// ── Keyframe diff ────────────────────────────────────────

export function computeKeyframeDiff(
  prev: BlockSettings,
  next: BlockSettings,
): string[] {
  const diffs: string[] = [];

  const fmtNum = (v: number) =>
    Number.isInteger(v) ? String(v) : v.toFixed(2);
  const fmtBool = (v: boolean) => (v ? 'on' : 'off');

  const primitiveKeys: {
    key: keyof BlockSettings;
    label: string;
    fmt?: (v: unknown) => string;
  }[] = [
    { key: 'volume', label: 'volume', fmt: (v) => fmtNum(v as number) },
    { key: 'showTitle', label: 'showTitle', fmt: (v) => fmtBool(v as boolean) },
    { key: 'text', label: 'text' },
    { key: 'textAlign', label: 'textAlign' },
    { key: 'textColor', label: 'textColor' },
    {
      key: 'textMaxLines',
      label: 'textMaxLines',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'textScrollSpeed',
      label: 'textScrollSpeed',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'textScrollLoop',
      label: 'textScrollLoop',
      fmt: (v) => fmtBool(v as boolean),
    },
    {
      key: 'textFontSize',
      label: 'textFontSize',
      fmt: (v) => fmtNum(v as number),
    },
    { key: 'borderColor', label: 'borderColor' },
    {
      key: 'borderWidth',
      label: 'borderWidth',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'absolutePosition',
      label: 'absolutePosition',
      fmt: (v) => fmtBool(v as boolean),
    },
    {
      key: 'absoluteTop',
      label: 'absoluteTop',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'absoluteLeft',
      label: 'absoluteLeft',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'absoluteWidth',
      label: 'absoluteWidth',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'absoluteHeight',
      label: 'absoluteHeight',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'absoluteTransitionDurationMs',
      label: 'absTrDuration',
      fmt: (v) => `${v}ms`,
    },
    { key: 'absoluteTransitionEasing', label: 'absTrEasing' },
    { key: 'cropTop', label: 'cropTop', fmt: (v) => fmtNum(v as number) },
    { key: 'cropLeft', label: 'cropLeft', fmt: (v) => fmtNum(v as number) },
    {
      key: 'cropRight',
      label: 'cropRight',
      fmt: (v) => fmtNum(v as number),
    },
    {
      key: 'cropBottom',
      label: 'cropBottom',
      fmt: (v) => fmtNum(v as number),
    },
    { key: 'mp4PlayFromMs', label: 'mp4PlayFrom', fmt: (v) => `${v}ms` },
    { key: 'mp4Loop', label: 'mp4Loop', fmt: (v) => fmtBool(v as boolean) },
    { key: 'forceInterpolation', label: 'interpolation' },
    { key: 'gameBackgroundColor', label: 'gameBgColor' },
    {
      key: 'gameCellGap',
      label: 'gameCellGap',
      fmt: (v) => fmtNum(v as number),
    },
    { key: 'gameBoardBorderColor', label: 'gameBorderColor' },
    {
      key: 'gameBoardBorderWidth',
      label: 'gameBorderWidth',
      fmt: (v) => fmtNum(v as number),
    },
    { key: 'gameGridLineColor', label: 'gameGridColor' },
    {
      key: 'gameGridLineAlpha',
      label: 'gameGridAlpha',
      fmt: (v) => fmtNum(v as number),
    },
  ];

  for (const { key, label, fmt } of primitiveKeys) {
    const a = prev[key];
    const b = next[key];
    if (a === b) continue;
    if (a == null && b == null) continue;
    const format = fmt ?? ((v: unknown) => String(v));
    if (a == null) {
      diffs.push(`${label}: → ${format(b)}`);
    } else if (b == null) {
      diffs.push(`${label}: ${format(a)} → (none)`);
    } else {
      diffs.push(`${label}: ${format(a)} → ${format(b)}`);
    }
  }

  const shaderSummary = (s: import('@/lib/types').ShaderConfig[]) =>
    s
      .filter((x) => x.enabled)
      .map((x) => x.shaderName)
      .join(', ') || '(none)';

  const shaderArrayKeys: {
    key: 'shaders' | 'snake1Shaders' | 'snake2Shaders';
    label: string;
  }[] = [
    { key: 'shaders', label: 'shaders' },
    { key: 'snake1Shaders', label: 'snake1Shaders' },
    { key: 'snake2Shaders', label: 'snake2Shaders' },
  ];
  for (const { key, label } of shaderArrayKeys) {
    const a = prev[key] ?? [];
    const b = next[key] ?? [];
    const sa = shaderSummary(a);
    const sb = shaderSummary(b);
    if (sa !== sb) diffs.push(`${label}: ${sa} → ${sb}`);
  }

  const trSummary = (t?: { type: string; durationMs: number }) =>
    t ? `${t.type} ${t.durationMs}ms` : '(none)';
  for (const key of ['introTransition', 'outroTransition'] as const) {
    const sa = trSummary(prev[key]);
    const sb = trSummary(next[key]);
    if (sa !== sb) diffs.push(`${key}: ${sa} → ${sb}`);
  }

  const prevEvents = prev.snakeEventShaders;
  const nextEvents = next.snakeEventShaders;
  if (JSON.stringify(prevEvents) !== JSON.stringify(nextEvents)) {
    diffs.push(
      `snakeEventShaders: ${prevEvents ? 'configured' : '(none)'} → ${nextEvents ? 'configured' : '(none)'}`,
    );
  }

  const prevAttached = (prev.attachedInputIds ?? []).join(',');
  const nextAttached = (next.attachedInputIds ?? []).join(',');
  if (prevAttached !== nextAttached) {
    diffs.push(`attachedInputIds changed`);
  }

  return diffs;
}

// ── Ruler tick computation ───────────────────────────────

export function computeRulerTicks(
  totalDurationMs: number,
  pixelsPerSecond: number,
): { timeMs: number; label: string }[] {
  const totalWidthPx = (totalDurationMs / 1000) * pixelsPerSecond;
  const desiredTickCount = Math.max(4, Math.min(20, totalWidthPx / 80));
  const roughIntervalMs = totalDurationMs / desiredTickCount;

  const niceIntervals = [
    5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  ];
  const intervalMs =
    niceIntervals.find((n) => n >= roughIntervalMs) ??
    niceIntervals[niceIntervals.length - 1];

  const ticks: { timeMs: number; label: string }[] = [];
  for (let t = 0; t <= totalDurationMs; t += intervalMs) {
    ticks.push({ timeMs: t, label: formatMs(t) });
  }
  return ticks;
}

// ── Content extent ───────────────────────────────────────

/** Returns the rightmost clip endMs across all tracks, or 0 if empty. */
export function getContentExtentMs(tracks: Track[]): number {
  let maxEnd = 0;
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.endMs > maxEnd) maxEnd = clip.endMs;
    }
  }
  return maxEnd;
}

// ── Overlap check ────────────────────────────────────────

export function hasOverlapOnTrack(
  clips: Clip[],
  excludeClipId: string,
  startMs: number,
  endMs: number,
): boolean {
  return clips.some(
    (c) => c.id !== excludeClipId && startMs < c.endMs && endMs > c.startMs,
  );
}

// ── Snap helpers ─────────────────────────────────────────

export function computeSnapTargets(
  tracks: Track[],
  excludeClipId: string,
  playheadMs: number,
): number[] {
  const targets: number[] = [0, playheadMs];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push(clip.startMs, clip.endMs);
    }
  }
  return targets;
}

export function snapToNearest(
  ms: number,
  targets: number[],
  thresholdMs: number,
): number {
  let best = ms;
  let bestDist = Infinity;
  for (const t of targets) {
    const dist = Math.abs(ms - t);
    if (dist < bestDist && dist <= thresholdMs) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

export function clampKeyframeTimeMs(
  ms: number,
  clipDurationMs: number,
): number {
  return Math.max(
    MIN_MOVABLE_KEYFRAME_MS,
    Math.min(Math.round(ms), clipDurationMs),
  );
}

export function computeKeyframeSnapTargets(
  clip: Clip,
  excludeKeyframeId: string,
): number[] {
  return [
    0,
    clip.endMs - clip.startMs,
    ...clip.keyframes
      .filter((keyframe) => keyframe.id !== excludeKeyframeId)
      .map((keyframe) => keyframe.timeMs),
  ];
}

export function resolveKeyframeCollision(
  ms: number,
  occupiedTimes: Set<number>,
  clipDurationMs: number,
  deltaMs: number,
): number {
  if (!occupiedTimes.has(ms)) {
    return ms;
  }

  const preferredStep = deltaMs < 0 ? -1 : 1;
  for (const step of [preferredStep, -preferredStep]) {
    let candidate = ms;
    while (true) {
      candidate += step;
      if (candidate < MIN_MOVABLE_KEYFRAME_MS || candidate > clipDurationMs) {
        break;
      }
      if (!occupiedTimes.has(candidate)) {
        return candidate;
      }
    }
  }

  return ms;
}

// ── Orphaned-input detection ─────────────────────────────

export function findOrphanedInputIds(
  tracks: Track[],
  clipsToDelete: { trackId: string; clipId: string }[],
): string[] {
  const deleteSet = new Set(
    clipsToDelete.map((c) => `${c.trackId}:${c.clipId}`),
  );

  const deletedInputIds = new Set<string>();
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (deleteSet.has(`${track.id}:${clip.id}`)) {
        deletedInputIds.add(clip.inputId);
      }
    }
  }

  const orphaned: string[] = [];
  for (const inputId of deletedInputIds) {
    if (inputId === OUTPUT_TRACK_INPUT_ID) continue;
    const hasSurvivingClip = tracks.some((t) =>
      t.clips.some(
        (c) => c.inputId === inputId && !deleteSet.has(`${t.id}:${c.id}`),
      ),
    );
    if (!hasSurvivingClip) orphaned.push(inputId);
  }
  return orphaned;
}
