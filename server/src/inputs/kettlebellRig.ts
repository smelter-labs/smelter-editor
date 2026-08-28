/**
 * Kettlebell Coach pose rig: topology, palette and the `kettlebell-skeleton`
 * shader uniform.
 *
 * The skeleton used to be drawn as Views — one thin bar per bone, rotated to
 * the segment angle. Rotated Views render displaced and oversized on this
 * engine build (the same breakage the duck-hunter crosshair works around, see
 * ShooterHud in inputs.tsx), so the bars drifted off the very joint dots they
 * were supposed to connect. It is drawn in a fragment shader now, where bones
 * and joints are the same SDF evaluation of the same coordinates and cannot
 * disagree.
 *
 * Everything here is pure and free of React/Smelter imports so the uniform
 * builder can be unit-tested — a field-order mismatch with the WGSL struct is
 * a runtime scene-update error, not a compile error, so it needs a test.
 */

import type { ShaderParamStructField } from '@swmansion/smelter';
import type { MotionPredictorOptions } from './motionPredictor';

/** Which part of the body a segment belongs to — drives the neon palette. */
export type BoneGroup = 'arm' | 'leg' | 'core';

/** Group index as the shader indexes its palette: 0 arm, 1 leg, 2 core. */
const GROUP_INDEX: Record<BoneGroup, number> = { arm: 0, leg: 1, core: 2 };

/**
 * COCO-17 bone segments (keypoint index pairs).
 *
 * Eyes and ears (1–4) are deliberately absent: their bones are the width of a
 * face, so at overlay scale they read as a scribble over the athlete's head
 * rather than as anatomy. The nose is kept and joined to the shoulder line
 * through NECK below, which reads as a neck.
 *
 * Mirrored by BONE_A/BONE_B/BONE_G in shaders/kettlebell-skeleton.wgsl.
 */
export const BONES: [number, number, BoneGroup][] = [
  [5, 6, 'core'], // shoulder line
  [5, 7, 'arm'],
  [7, 9, 'arm'], // left arm
  [6, 8, 'arm'],
  [8, 10, 'arm'], // right arm
  [5, 11, 'core'],
  [6, 12, 'core'], // torso
  [11, 12, 'core'], // hip line
  [11, 13, 'leg'],
  [13, 15, 'leg'], // left leg
  [12, 14, 'leg'],
  [14, 16, 'leg'], // right leg
];

/** Joints that get a marker — the drawn skeleton's endpoints, sans eyes/ears. */
export const DRAWN_JOINTS = [0, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

/**
 * Body part each drawn joint belongs to (same palette as its bones).
 * Mirrored by JOINT_G in the shader; kettlebellRig.test.ts diffs the two.
 */
export const JOINT_GROUP: Record<number, BoneGroup> = {
  0: 'core',
  5: 'core',
  6: 'core',
  7: 'arm',
  8: 'arm',
  9: 'arm',
  10: 'arm',
  11: 'core',
  12: 'core',
  13: 'leg',
  14: 'leg',
  15: 'leg',
  16: 'leg',
};

/** Nose → midpoint of the shoulders, drawn like a bone (see BONES). */
export const NECK: [number, number, number] = [0, 5, 6];

/** Hip keypoints — the rig's root (see KettlebellSkeletonWrapper). */
export const L_HIP = 11;
export const R_HIP = 12;

/** Number of COCO keypoints the rig carries. */
export const JOINT_COUNT = 17;

// Joints below this confidence are hidden. Matches the worker's own floor
// (analysis.py KPT_CONF_MIN); a stricter one here only makes joints hovering
// around it blink out and re-snap.
export const KPT_CONF_MIN = 0.3;

// Smooth-motion tuning (same shape as SmoothedBoxes): results arrive at
// ~12-16/s while the output renders at 60fps, so the pose is dead-reckoned
// along its estimated velocity every tick and the drawn position eased toward
// that moving target — the skeleton glides with the athlete instead of
// stepping behind them.
export const TICK_MS = 16;
export const SMOOTH = 0.35;
/**
 * Lead cap for the root predictor. A swinging athlete covers most of a body
 * height in ~300ms and reverses at both ends of the arc, so the default
 * car-scale cap (1.5 intervals / 600ms) launches the rig off the athlete
 * whenever results are late — which is exactly when it kicks in. One interval
 * capped at 150ms keeps the glide between results without letting a stall turn
 * into a flying skeleton; the overlay is already time-aligned to its frame by
 * RoomState's hold, so leading further is not what keeps it in sync.
 */
export const PREDICT_OPTS: MotionPredictorOptions = {
  maxExtrapIntervals: 1,
  maxExtrapMs: 150,
};
/** MotionPredictor ids: the rig root and the bell box. */
export const ROOT_TRACK_ID = 99;
export const BELL_TRACK_ID = 100;

export const BONE_COLOR = '#22D3EEDD';
export const JOINT_COLOR = '#E0F2FEEE';
export const BELL_COLOR = '#F97316FF';

/** Neon-rig palette: one hue per body part, plus its wide glow underlay. */
export const NEON_BONE: Record<BoneGroup, string> = {
  arm: '#22D3EEFF',
  leg: '#A78BFAFF',
  core: '#FBBF24FF',
};
export const NEON_GLOW: Record<BoneGroup, string> = {
  arm: '#22D3EE38',
  leg: '#A78BFA38',
  core: '#FBBF2438',
};

/**
 * Which palette family the rig draws with. 'default' is the standalone
 * kettlebell-coach look (cyan/violet/amber); 'kbt' restyles tournament tiles
 * to the broadcast theme (kb_design): cream bones, ember joints — one look
 * for every group in both styles (the glow rides the bone color, so neon
 * gets a cream halo).
 */
export type SkeletonTheme = 'default' | 'kbt';
export const KBT_BONE_COLOR = '#E8E4DADD';
export const KBT_JOINT_COLOR = '#FF5A1FEE';

export type Parent = { width: number; height: number };

/** The rescale-'fill' (cover) transform the video uses, precomputed. */
export function coverTransform(
  parent: Parent,
  frameW: number,
  frameH: number,
): { offX: number; offY: number; dispW: number; dispH: number } {
  const scale = Math.max(parent.width / frameW, parent.height / frameH);
  const dispW = frameW * scale;
  const dispH = frameH * scale;
  return {
    offX: (parent.width - dispW) / 2,
    offY: (parent.height - dispH) / 2,
    dispW,
    dispH,
  };
}

/**
 * The rig's anchor point in pixels: the hip midpoint, or whatever is left of
 * it. Everything else is drawn relative to this, so the whole figure shares
 * one clock (see KettlebellSkeletonWrapper).
 */
export function rootOf(px: (number[] | null)[]): number[] | null {
  const l = px[L_HIP];
  const r = px[R_HIP];
  if (l && r) return [(l[0] + r[0]) / 2, (l[1] + r[1]) / 2];
  if (l || r) return [...(l ?? r!)];
  const seen = px.filter((p): p is number[] => p !== null);
  if (!seen.length) return null;
  return [
    seen.reduce((s, p) => s + p[0], 0) / seen.length,
    seen.reduce((s, p) => s + p[1], 0) / seen.length,
  ];
}

/**
 * `#RRGGBB` / `#RRGGBBAA` → 0..1 components. shaderUtils' hexToRgb drops the
 * alpha, and every palette entry here carries one; importing that module would
 * also drag React and the shader registry's fs reads into a unit test.
 */
export function parseColor(hex: string): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/** How the rig is styled. buildSkeletonParams also accepts 'off' (all rig
 * alphas zeroed) so the shader can stay mounted for the milestone aura alone. */
export type SkeletonStyle = 'lines' | 'neon';

/**
 * Field names of the `kettlebell-skeleton` uniform, in declaration order.
 *
 * The engine matches struct fields by name against the WGSL declaration, so
 * this list and ShaderOptions in shaders/kettlebell-skeleton.wgsl must stay in
 * lockstep. kettlebellRig.test.ts asserts buildSkeletonParams emits exactly
 * this, which is the only place the mismatch can be caught before runtime.
 */
export const SKELETON_PARAM_FIELDS: string[] = [
  ...Array.from({ length: JOINT_COUNT }, (_, i) => [
    `j${i}_x`,
    `j${i}_y`,
    `j${i}_v`,
  ]).flat(),
  'bone_w',
  'glow_w',
  'bone_a',
  'glow_a',
  'joint_rad',
  'joint_hole',
  'joint_a',
  'head_x',
  'head_y',
  'head_rad',
  'head_hole',
  'head_v',
  'bone_arm_r',
  'bone_arm_g',
  'bone_arm_b',
  'bone_leg_r',
  'bone_leg_g',
  'bone_leg_b',
  'bone_core_r',
  'bone_core_g',
  'bone_core_b',
  'jnt_arm_r',
  'jnt_arm_g',
  'jnt_arm_b',
  'jnt_leg_r',
  'jnt_leg_g',
  'jnt_leg_b',
  'jnt_core_r',
  'jnt_core_g',
  'jnt_core_b',
  'aura_r',
  'aura_g',
  'aura_b',
  'aura_i',
  'aura_s',
];

/** Palette order the shader indexes with BONE_G / JOINT_G. */
const GROUP_ORDER: BoneGroup[] = ['arm', 'leg', 'core'];

/**
 * Build the `kettlebell-skeleton` uniform from the eased rig.
 *
 * `joints` are the currently-drawn joint positions in tile pixels, indexed by
 * COCO keypoint; null means "not visible" and switches the joint off in the
 * shader, which also drops every bone that would touch it.
 *
 * Positions go out normalized (tile uv) and every radius/thickness as a
 * fraction of the tile HEIGHT, so the shader can scale them by its own
 * output_resolution and stay correct even if it renders at a size other than
 * `parent`. Thicknesses are half-widths: the shader strokes outward from the
 * segment, so half-widths are what an SDF compares against.
 */
export function buildSkeletonParams(
  joints: readonly (number[] | null)[],
  style: SkeletonStyle | 'off',
  parent: Parent,
  aura?: { r: number; g: number; b: number; i: number },
  theme: SkeletonTheme = 'default',
): ShaderParamStructField[] {
  const neon = style === 'neon';
  const off = style === 'off';
  const W = parent.width;
  const H = parent.height;
  const params: ShaderParamStructField[] = [];
  const f32 = (fieldName: string, value: number) =>
    params.push({ type: 'f32', fieldName, value });

  // Joints. 1–4 (eyes/ears) are never drawn, so they never validate — see the
  // note on BONES.
  const drawn = new Set(DRAWN_JOINTS);
  const visible = (i: number): number[] | null =>
    drawn.has(i) ? (joints[i] ?? null) : null;
  for (let i = 0; i < JOINT_COUNT; i++) {
    const p = visible(i);
    f32(`j${i}_x`, p ? p[0] / W : 0);
    f32(`j${i}_y`, p ? p[1] / H : 0);
    f32(`j${i}_v`, p ? 1 : 0);
  }

  // Stroke geometry — the same arithmetic the View version used, so the rig
  // keeps its proportions at every output resolution.
  const thickness = Math.max(3, Math.round(H * 0.006));
  const boneH = neon ? Math.max(3, Math.round(thickness * 1.5)) : thickness;
  const glowH = neon ? Math.max(4, Math.round(thickness * 2.4)) : 0;
  f32('bone_w', boneH / 2 / H);
  f32('glow_w', glowH / 2 / H);

  // Bone and glow alpha are single scalars because within a style every group
  // shares one: NEON_GLOW is NEON_BONE at 0x38, and 'lines' is BONE_COLOR
  // throughout. That is also why the shader needs no style flag. The 'kbt'
  // theme uses one bone color for all groups in both styles.
  const kbt = theme === 'kbt';
  const bonePalette = kbt
    ? GROUP_ORDER.map(() => parseColor(KBT_BONE_COLOR))
    : neon
      ? GROUP_ORDER.map((g) => parseColor(NEON_BONE[g]))
      : GROUP_ORDER.map(() => parseColor(BONE_COLOR));
  const glowAlpha = neon ? parseColor(NEON_GLOW.core).a : 0;
  f32('bone_a', off ? 0 : bonePalette[0].a);
  f32('glow_a', off ? 0 : glowAlpha);

  // Joint markers: hollow rings in neon, filled dots in lines. `hole` is the
  // inner radius; 0 fills the disc.
  const ring = Math.max(6, Math.round(thickness * 3));
  const ringBorder = Math.max(2, Math.round(thickness * 0.7));
  const dot = thickness * 2;
  const jointPalette = kbt
    ? GROUP_ORDER.map(() => parseColor(KBT_JOINT_COLOR))
    : neon
      ? GROUP_ORDER.map((g) => parseColor(NEON_BONE[g]))
      : GROUP_ORDER.map(() => parseColor(JOINT_COLOR));
  f32('joint_rad', (neon ? ring / 2 : dot / 2) / H);
  f32('joint_hole', neon ? (ring / 2 - ringBorder) / H : 0);
  f32('joint_a', off ? 0 : jointPalette[0].a);

  // Head circle (neon only; it stands in for the nose dot). Size comes from
  // the athlete, not the output resolution: shoulder span drives it head-on,
  // and side-on — where the shoulders overlap and the span collapses — the
  // neck length carries it. The nose sits at the face rather than the middle
  // of the skull, so the circle is pushed back along the neck axis to ring the
  // head instead of the chin. Its color is the core hue, i.e. jnt_core_*.
  const nose = neon ? visible(NECK[0]) : null;
  const ls = visible(NECK[1]);
  const rs = visible(NECK[2]);
  const neck =
    ls && rs ? [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2] : undefined;
  if (nose) {
    const span = ls && rs ? Math.hypot(rs[0] - ls[0], rs[1] - ls[1]) : 0;
    const neckLen = neck ? Math.hypot(neck[0] - nose[0], neck[1] - nose[1]) : 0;
    const head = Math.max(
      thickness * 5,
      Math.round(Math.max(span * 0.55, neckLen * 1.4)),
    );
    const away = neck ? [nose[0] - neck[0], nose[1] - neck[1]] : [0, -1];
    const len = Math.hypot(away[0], away[1]) || 1;
    const headBorder = Math.max(2, Math.round(thickness * 0.9));
    f32('head_x', (nose[0] + (away[0] / len) * head * 0.2) / W);
    f32('head_y', (nose[1] + (away[1] / len) * head * 0.2) / H);
    // head/2 is the OUTER radius and the ring is stroked inward. The View
    // version put `head` in width and the border outside it, so it actually
    // drew head + 2*headBorder across, off-center by headBorder — don't
    // "restore" that.
    f32('head_rad', head / 2 / H);
    f32('head_hole', Math.max(0, head / 2 - headBorder) / H);
    f32('head_v', 1);
  } else {
    f32('head_x', 0);
    f32('head_y', 0);
    f32('head_rad', 0);
    f32('head_hole', 0);
    f32('head_v', 0);
  }

  for (const [prefix, palette] of [
    ['bone', bonePalette],
    ['jnt', jointPalette],
  ] as const) {
    GROUP_ORDER.forEach((group, i) => {
      f32(`${prefix}_${group}_r`, palette[i].r);
      f32(`${prefix}_${group}_g`, palette[i].g);
      f32(`${prefix}_${group}_b`, palette[i].b);
    });
  }

  // Milestone aura — always emitted so the field list stays exact.
  f32('aura_r', aura?.r ?? 0);
  f32('aura_g', aura?.g ?? 0);
  f32('aura_b', aura?.b ?? 0);
  f32('aura_i', aura?.i ?? 0);

  // Aura shell radius as a fraction of H, derived from the athlete like the
  // head circle is. A fixed radius merged the limbs on a distant athlete but
  // fell apart into per-limb outlines once the athlete filled the tile.
  // Torso length (hip mid ↔ shoulder mid) is ~0.25·H at the framing the
  // fixed 0.055·H was tuned at, and 0.22 × 0.25 = 0.055 — so that look is
  // preserved while a tile-filling athlete gets a shell wide enough for the
  // capsules to keep merging. Shoulder span (~torso/1.4) carries it when the
  // hips are hidden; no reference at all emits 0 and the shader falls back
  // to the fixed radius. Clamped here, not in the shader, so tests can pin it.
  const lh = visible(L_HIP);
  const rh = visible(R_HIP);
  const hip =
    lh && rh ? [(lh[0] + rh[0]) / 2, (lh[1] + rh[1]) / 2] : (lh ?? rh);
  const shoulder = ls && rs ? neck : (ls ?? rs);
  const span = ls && rs ? Math.hypot(rs[0] - ls[0], rs[1] - ls[1]) : 0;
  const torso =
    hip && shoulder
      ? Math.hypot(shoulder[0] - hip[0], shoulder[1] - hip[1])
      : span * 1.4;
  f32(
    'aura_s',
    torso ? Math.min(0.11, Math.max(0.025, (0.22 * torso) / H)) : 0,
  );

  return params;
}

/** Group index the shader uses for a bone — exported for the topology test. */
export function boneGroupIndex(group: BoneGroup): number {
  return GROUP_INDEX[group];
}
