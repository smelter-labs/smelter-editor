import type { BbTeamId } from '@smelter-editor/types';

/**
 * Ground-truth events for a clip (scripts/apidis-events.mjs and
 * scripts/basketball-synth-clip.mjs write this shape next to the mp4s).
 * Pure parsing + selection; no fs here so the controller tests stay in-memory.
 */

export type BbGtBasket = 'left' | 'right';
export type BbReplayBasket = BbGtBasket | 'both';

export type BbGtThrow = {
  /** Clip media time (ms) of the make / miss. */
  tMs: number;
  made: boolean;
  /** Annotated value: 1 (free throw), 2, 3; 0 for misses. */
  points: 0 | 1 | 2 | 3;
  team: BbTeamId | null;
  shotType?: string;
  basket?: BbGtBasket;
  playerNo?: string | null;
};

export type BbGroundTruth = {
  t0Utc: number | null;
  throws: BbGtThrow[];
  /** Non-throw events in the file (rebounds, fouls, …), just counted. */
  otherEvents: number;
  /** Camera numbers that see each basket (`baskets.<side>.cams`), when listed. */
  basketCams: Record<BbGtBasket, number[]>;
};

/** What the replay scheduler fires: already mapped onto the 3x3 ledger. */
export type ReplayShot = {
  tMs: number;
  made: boolean;
  team: BbTeamId | null;
  /** Ledger value (1 inside the arc, `arcPoints` behind it). */
  points: 1 | 2;
  /** Annotated value, kept for the play-by-play. */
  gtPoints: 1 | 2 | 3;
  basket?: BbGtBasket;
};

const isTeam = (v: unknown): v is BbTeamId => v === 'A' || v === 'B';
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export function parseBbGroundTruth(json: unknown): BbGroundTruth {
  if (!isRecord(json) || !Array.isArray(json.events)) {
    throw new Error('events.json: expected an object with an `events` array');
  }
  const throws: BbGtThrow[] = [];
  let otherEvents = 0;
  json.events.forEach((raw, i) => {
    if (!isRecord(raw))
      throw new Error(`events.json: event #${i} is not an object`);
    if (raw.kind !== 'throw') {
      otherEvents++;
      return;
    }
    const tMs = Number(raw.tMs);
    if (!Number.isFinite(tMs) || tMs < 0) {
      throw new Error(`events.json: throw #${i} has no valid tMs`);
    }
    const pointsRaw = Number(raw.points ?? 0);
    const points = ([0, 1, 2, 3] as const).find((p) => p === pointsRaw);
    if (points == null) {
      throw new Error(
        `events.json: throw #${i} has points ${String(raw.points)}`,
      );
    }
    const made = raw.made == null ? points > 0 : Boolean(raw.made);
    const basket =
      raw.basket === 'left' || raw.basket === 'right' ? raw.basket : undefined;
    throws.push({
      tMs: Math.round(tMs),
      made,
      points: made ? points : 0,
      team: isTeam(raw.team) ? raw.team : null,
      ...(typeof raw.shotType === 'string' ? { shotType: raw.shotType } : {}),
      ...(basket ? { basket } : {}),
      ...(typeof raw.playerNo === 'string' ? { playerNo: raw.playerNo } : {}),
    });
  });
  throws.sort((a, b) => a.tMs - b.tMs);
  const t0 = Number(json.t0Utc);
  const basketCams: Record<BbGtBasket, number[]> = { left: [], right: [] };
  if (isRecord(json.baskets)) {
    for (const side of ['left', 'right'] as const) {
      const entry = json.baskets[side];
      const cams = isRecord(entry) ? entry.cams : undefined;
      if (Array.isArray(cams)) {
        basketCams[side] = cams
          .map((c) => Number(c))
          .filter((c) => Number.isInteger(c));
      }
    }
  }
  return {
    t0Utc: Number.isFinite(t0) ? t0 : null,
    throws,
    otherEvents,
    basketCams,
  };
}

/**
 * Which basket a clip shows, for the Ultra AI basket filter: the `cam<N>`
 * number of the clip against the file's `baskets.<side>.cams`, else a
 * `left` / `right` token in the clip's folder name, else both baskets.
 */
export function deriveClipBasket(
  gt: Pick<BbGroundTruth, 'basketCams'>,
  clipFileName: string,
): BbReplayBasket {
  const cam = /(?:^|\/)cam(\d+)\.mp4$/i.exec(clipFileName);
  if (cam) {
    const n = Number(cam[1]);
    if (gt.basketCams.left.includes(n)) return 'left';
    if (gt.basketCams.right.includes(n)) return 'right';
  }
  const dir = clipFileName.includes('/')
    ? clipFileName.slice(0, clipFileName.lastIndexOf('/'))
    : '';
  const hint = /(?:^|[\/_-])(left|right)(?=$|[\/_-])/i.exec(dir);
  if (hint) return hint[1].toLowerCase() as BbGtBasket;
  return 'both';
}

/**
 * Ultra AI: the plays of a clip's events file for the basket the clip shows;
 * falls back to every basket when the derived side has no throws.
 */
export function selectUltraShots(
  gt: BbGroundTruth,
  clipFileName: string,
  arcPoints: 1 | 2,
): { shots: ReplayShot[]; basket: BbReplayBasket } {
  let basket = deriveClipBasket(gt, clipFileName);
  let shots = selectReplayShots(gt, { basket, arcPoints });
  if (shots.length === 0 && basket !== 'both') {
    basket = 'both';
    shots = selectReplayShots(gt, { basket, arcPoints });
  }
  return { shots, basket };
}

/**
 * The "model confidence" an Ultra AI make reports: deterministic per play
 * (stable across clip loops), 0.90–0.99 for an annotated team, 0.5 when the
 * file names nobody (→ REF CALL, like a weak live guess).
 */
export function ultraConfidence(tMs: number, team: BbTeamId | null): number {
  if (!team) return 0.5;
  return 0.9 + (Math.floor(tMs / 50) % 10) / 100;
}

export type ReplaySelectOptions = {
  basket: BbReplayBasket;
  /** Ledger value of a shot from behind the arc (config.arcPoints). */
  arcPoints: 1 | 2;
  /** Override the annotated → ledger points mapping (keys '1' | '2' | '3'). */
  pointsMap?: Partial<Record<'1' | '2' | '3', 1 | 2>>;
  /** Remap annotated team letters onto ledger teams. */
  teamMap?: Partial<Record<BbTeamId, BbTeamId>>;
};

/**
 * Pick the throws a replay should fire and map them onto the 3x3 ledger:
 * free throws and 2-pt field goals score 1, 3-pt field goals score
 * `arcPoints`. Throws without a `basket` are kept for every basket filter.
 */
export function selectReplayShots(
  gt: BbGroundTruth,
  opts: ReplaySelectOptions,
): ReplayShot[] {
  const out: ReplayShot[] = [];
  for (const t of gt.throws) {
    if (opts.basket !== 'both' && t.basket && t.basket !== opts.basket)
      continue;
    // Misses carry 0 annotated points; take the value from the shot type.
    const gtPoints: 1 | 2 | 3 =
      t.points !== 0
        ? t.points
        : t.shotType === 'three'
          ? 3
          : t.shotType === 'free'
            ? 1
            : 2;
    const mapped = opts.pointsMap?.[String(gtPoints) as '1' | '2' | '3'];
    const points: 1 | 2 = mapped ?? (gtPoints === 3 ? opts.arcPoints : 1);
    const team = t.team ? (opts.teamMap?.[t.team] ?? t.team) : null;
    out.push({
      tMs: t.tMs,
      made: t.made,
      team,
      points,
      gtPoints,
      ...(t.basket ? { basket: t.basket } : {}),
    });
  }
  return out;
}
