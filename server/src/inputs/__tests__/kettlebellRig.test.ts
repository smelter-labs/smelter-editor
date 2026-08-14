import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  BONES,
  JOINT_COUNT,
  JOINT_GROUP,
  SKELETON_PARAM_FIELDS,
  boneGroupIndex,
  buildSkeletonParams,
  coverTransform,
  parseColor,
  rootOf,
} from '../kettlebellRig';
import type { Parent } from '../kettlebellRig';

const WGSL = fs.readFileSync(
  path.join(__dirname, '../../../shaders/kettlebell-skeleton.wgsl'),
  'utf8',
);

/** Field names of `struct ShaderOptions`, in declaration order. */
function wgslStructFields(): string[] {
  const body = /struct ShaderOptions \{([\s\S]*?)\n\};/.exec(WGSL);
  if (!body) throw new Error('ShaderOptions not found in the shader');
  return [...body[1].matchAll(/(\w+)\s*:\s*f32/g)].map((m) => m[1]);
}

/** A `const NAME = array<i32, N>(…)` literal from the shader, as numbers. */
function wgslConstArray(name: string): number[] {
  const m = new RegExp(`const ${name} = array<i32, \\d+>\\(([^)]*)\\)`).exec(
    WGSL,
  );
  if (!m) throw new Error(`${name} not found in the shader`);
  return m[1].split(',').map((v) => Number(v.trim()));
}

const PARENT: Parent = { width: 1080, height: 1920 };
/** A pose with every drawn joint present, roughly athlete-shaped. */
function pose(): (number[] | null)[] {
  const joints: (number[] | null)[] = new Array(JOINT_COUNT).fill(null);
  joints[0] = [540, 300]; // nose
  joints[5] = [460, 480]; // shoulders
  joints[6] = [620, 480];
  joints[7] = [430, 700]; // elbows
  joints[8] = [650, 700];
  joints[9] = [420, 900]; // wrists
  joints[10] = [660, 900];
  joints[11] = [490, 1000]; // hips
  joints[12] = [590, 1000];
  joints[13] = [480, 1300]; // knees
  joints[14] = [600, 1300];
  joints[15] = [475, 1600]; // ankles
  joints[16] = [605, 1600];
  return joints;
}

function byName(
  params: ReturnType<typeof buildSkeletonParams>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) {
    if (p.type === 'f32') out[p.fieldName] = p.value;
  }
  return out;
}

// The engine matches struct fields by name at scene-update time, so a TS/WGSL
// mismatch is a runtime error in a running stream, not a compile error. These
// three tests are the only place it can be caught earlier.
describe('kettlebell-skeleton uniform', () => {
  it('emits exactly the fields the shader declares, in order', () => {
    expect(SKELETON_PARAM_FIELDS).toEqual(wgslStructFields());
  });

  it('builds those fields for both styles', () => {
    for (const style of ['lines', 'neon'] as const) {
      const params = buildSkeletonParams(pose(), style, PARENT);
      expect(params.map((p) => p.fieldName)).toEqual(SKELETON_PARAM_FIELDS);
      expect(params.every((p) => p.type === 'f32')).toBe(true);
      expect(params.every((p) => Number.isFinite(p.value))).toBe(true);
    }
  });

  it('mirrors the bone topology into the shader constants', () => {
    expect(wgslConstArray('BONE_A')).toEqual(BONES.map(([a]) => a));
    expect(wgslConstArray('BONE_B')).toEqual(BONES.map(([, b]) => b));
    expect(wgslConstArray('BONE_G')).toEqual(
      BONES.map(([, , g]) => boneGroupIndex(g)),
    );
    // JOINT_G covers all 17 slots; the undrawn eyes/ears (1-4) are never
    // supplied as visible, so their group is arbitrary but must be present.
    const jointG = wgslConstArray('JOINT_G');
    expect(jointG).toHaveLength(JOINT_COUNT);
    for (const [i, group] of Object.entries(JOINT_GROUP)) {
      expect(jointG[Number(i)]).toBe(boneGroupIndex(group));
    }
  });
});

describe('buildSkeletonParams', () => {
  it('normalizes joint positions into tile uv and flags visibility', () => {
    const joints: (number[] | null)[] = new Array(JOINT_COUNT).fill(null);
    joints[5] = [PARENT.width / 2, PARENT.height / 2];
    const p = byName(buildSkeletonParams(joints, 'lines', PARENT));

    expect(p.j5_x).toBeCloseTo(0.5, 6);
    expect(p.j5_y).toBeCloseTo(0.5, 6);
    expect(p.j5_v).toBe(1);
    // Absent joint: zeroed and switched off, which also drops its bones.
    expect(p.j9_v).toBe(0);
    expect(p.j9_x).toBe(0);
  });

  it('never validates the eye and ear joints', () => {
    const joints: (number[] | null)[] = new Array(JOINT_COUNT).fill([100, 100]);
    const p = byName(buildSkeletonParams(joints, 'neon', PARENT));
    for (const i of [1, 2, 3, 4]) {
      expect(p[`j${i}_v`]).toBe(0);
      expect(p[`j${i}_x`]).toBe(0);
      expect(p[`j${i}_y`]).toBe(0);
    }
    expect(p.j5_v).toBe(1);
  });

  it('draws flat bars and filled dots in lines mode', () => {
    const p = byName(buildSkeletonParams(pose(), 'lines', PARENT));
    expect(p.glow_w).toBe(0);
    expect(p.glow_a).toBe(0);
    expect(p.joint_hole).toBe(0); // filled disc
    expect(p.head_v).toBe(0); // no head circle; the nose dot draws instead
    expect(p.bone_w).toBeGreaterThan(0);
    expect(p.bone_a).toBeCloseTo(0xdd / 255, 6); // BONE_COLOR
    expect(p.joint_a).toBeCloseTo(0xee / 255, 6); // JOINT_COLOR
    // One color across all three palette slots is what lets the shader run a
    // single path for both styles.
    expect([p.bone_arm_r, p.bone_leg_r, p.bone_core_r]).toEqual([
      p.bone_arm_r,
      p.bone_arm_r,
      p.bone_arm_r,
    ]);
  });

  it('draws a halo, hollow rings and a head circle in neon mode', () => {
    const p = byName(buildSkeletonParams(pose(), 'neon', PARENT));
    expect(p.glow_w).toBeGreaterThan(p.bone_w);
    expect(p.bone_w).toBeGreaterThan(0);
    expect(p.glow_a).toBeCloseTo(0x38 / 255, 6);
    expect(p.joint_rad).toBeGreaterThan(p.joint_hole);
    expect(p.joint_hole).toBeGreaterThan(0); // ring, not a disc
    expect(p.head_v).toBe(1);
    expect(p.head_rad).toBeGreaterThan(p.head_hole);
    expect(p.head_hole).toBeGreaterThan(0);
    // Per-body-part hues.
    expect(p.bone_arm_r).not.toBe(p.bone_leg_r);
    expect(p.bone_core_r).not.toBe(p.bone_leg_r);
  });

  it('pushes the head circle back along the neck axis, off the chin', () => {
    const p = byName(buildSkeletonParams(pose(), 'neon', PARENT));
    // Nose at y=300, shoulders at y=480: the circle moves up, away from the
    // shoulder midpoint, so it rings the skull rather than the face.
    expect(p.head_y * PARENT.height).toBeLessThan(300);
    expect(p.head_x).toBeCloseTo(540 / PARENT.width, 6);
  });

  it('hides the head circle when the nose is not visible', () => {
    const joints = pose();
    joints[0] = null;
    const p = byName(buildSkeletonParams(joints, 'neon', PARENT));
    expect(p.head_v).toBe(0);
    expect(p.head_rad).toBe(0);
  });
});

describe('coverTransform', () => {
  it('lands the frame center at the tile center for either orientation', () => {
    for (const [frameW, frameH] of [
      [1920, 1080],
      [1080, 1920],
      [640, 640],
    ]) {
      const { offX, offY, dispW, dispH } = coverTransform(
        PARENT,
        frameW,
        frameH,
      );
      expect(offX + 0.5 * dispW).toBeCloseTo(PARENT.width / 2, 6);
      expect(offY + 0.5 * dispH).toBeCloseTo(PARENT.height / 2, 6);
      // Cover: the displayed frame never leaves a gap.
      expect(dispW).toBeGreaterThanOrEqual(PARENT.width - 1e-6);
      expect(dispH).toBeGreaterThanOrEqual(PARENT.height - 1e-6);
    }
  });
});

describe('rootOf', () => {
  it('anchors on the hip midpoint', () => {
    const joints = pose();
    expect(rootOf(joints)).toEqual([540, 1000]);
  });

  it('falls back to the single visible hip, then to the pose centroid', () => {
    const oneHip: (number[] | null)[] = new Array(JOINT_COUNT).fill(null);
    oneHip[11] = [490, 1000];
    expect(rootOf(oneHip)).toEqual([490, 1000]);

    const noHips: (number[] | null)[] = new Array(JOINT_COUNT).fill(null);
    noHips[5] = [400, 500];
    noHips[6] = [600, 700];
    expect(rootOf(noHips)).toEqual([500, 600]);

    expect(rootOf(new Array(JOINT_COUNT).fill(null))).toBeNull();
  });
});

describe('parseColor', () => {
  it('reads the alpha the palette constants carry', () => {
    expect(parseColor('#22D3EEDD')).toEqual({
      r: 0x22 / 255,
      g: 0xd3 / 255,
      b: 0xee / 255,
      a: 0xdd / 255,
    });
    expect(parseColor('#22D3EE').a).toBe(1);
  });
});
