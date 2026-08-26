enable wgpu_binding_array;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) tex_coords: vec2<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
};

struct BaseShaderParameters {
    plane_id: i32,
    time: f32,
    output_resolution: vec2<u32>,
    texture_count: u32,
};

// Kettlebell Coach pose rig, drawn over the input stream.
//
// This replaces a per-bone rotated View. Rotated Views render displaced and
// oversized on this engine build (see the crosshair note in ShooterHud), so
// bones drifted off the joint dots they were meant to connect; here a bone and
// its endpoints are the same SDF over the same coordinates and cannot
// disagree. Driven by KettlebellSkeletonWrapper via buildSkeletonParams in
// src/inputs/kettlebellRig.ts — the field list below must stay in lockstep
// with SKELETON_PARAM_FIELDS there (kettlebellRig.test.ts diffs the two).
//
// There is no style flag: 'lines' is 'neon' with glow_w = 0, joint_hole = 0,
// head_v = 0 and one color repeated across the three palette slots, so both
// styles take the same path.
//
//   j{i}_x, j{i}_y  - COCO-17 joint in tile uv (0..1); j{i}_v < 0.5 = hidden
//   bone_w, glow_w  - HALF thickness of the solid bone / its halo, as a
//                     fraction of the tile height (glow_w = 0 disables it)
//   bone_a, glow_a  - their alpha
//   joint_rad       - joint marker outer radius (fraction of tile height)
//   joint_hole      - its inner radius; 0 = filled dot
//   joint_a         - joint marker alpha
//   head_x, head_y  - head circle center in tile uv (neon only)
//   head_rad        - OUTER radius; head_hole = inner. Stroked inward, unlike
//                     the View it replaces, whose border grew outward and so
//                     rendered head + 2*border across, off-center by border.
//   head_v          - 0 hides the head circle and un-hides the nose dot
//   bone_*/jnt_*    - palette per body part, indexed 0 arm, 1 leg, 2 core
//   aura_r/g/b      - milestone aura color (every-5th-rep celebration)
//   aura_i          - aura intensity 0..1; 0 disables the whole aura pass
struct ShaderOptions {
    j0_x: f32, j0_y: f32, j0_v: f32,
    j1_x: f32, j1_y: f32, j1_v: f32,
    j2_x: f32, j2_y: f32, j2_v: f32,
    j3_x: f32, j3_y: f32, j3_v: f32,
    j4_x: f32, j4_y: f32, j4_v: f32,
    j5_x: f32, j5_y: f32, j5_v: f32,
    j6_x: f32, j6_y: f32, j6_v: f32,
    j7_x: f32, j7_y: f32, j7_v: f32,
    j8_x: f32, j8_y: f32, j8_v: f32,
    j9_x: f32, j9_y: f32, j9_v: f32,
    j10_x: f32, j10_y: f32, j10_v: f32,
    j11_x: f32, j11_y: f32, j11_v: f32,
    j12_x: f32, j12_y: f32, j12_v: f32,
    j13_x: f32, j13_y: f32, j13_v: f32,
    j14_x: f32, j14_y: f32, j14_v: f32,
    j15_x: f32, j15_y: f32, j15_v: f32,
    j16_x: f32, j16_y: f32, j16_v: f32,
    bone_w: f32,
    glow_w: f32,
    bone_a: f32,
    glow_a: f32,
    joint_rad: f32,
    joint_hole: f32,
    joint_a: f32,
    head_x: f32,
    head_y: f32,
    head_rad: f32,
    head_hole: f32,
    head_v: f32,
    bone_arm_r: f32, bone_arm_g: f32, bone_arm_b: f32,
    bone_leg_r: f32, bone_leg_g: f32, bone_leg_b: f32,
    bone_core_r: f32, bone_core_g: f32, bone_core_b: f32,
    jnt_arm_r: f32, jnt_arm_g: f32, jnt_arm_b: f32,
    jnt_leg_r: f32, jnt_leg_g: f32, jnt_leg_b: f32,
    jnt_core_r: f32, jnt_core_g: f32, jnt_core_b: f32,
    aura_r: f32, aura_g: f32, aura_b: f32,
    aura_i: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Mirrors BONES in src/inputs/kettlebellRig.ts. Group: 0 arm, 1 leg, 2 core.
// Eyes and ears (joints 1-4) have no bones — at overlay scale a face-width
// segment reads as a scribble, so the nose connects through the neck instead.
const BONE_A = array<i32, 12>( 5, 5, 7, 6,  8,  5,  6, 11, 11, 13, 12, 14);
const BONE_B = array<i32, 12>( 6, 7, 9, 8, 10, 11, 12, 12, 13, 15, 14, 16);
const BONE_G = array<i32, 12>( 2, 0, 0, 0,  0,  2,  2,  2,  1,  1,  1,  1);
// Mirrors JOINT_GROUP; 1-4 are never supplied as visible.
const JOINT_G = array<i32, 17>(2, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0, 2, 2, 1, 1, 1, 1);

/// Joint `idx` as (x, y, valid). Positions arrive in uv and are scaled to
/// pixels by the caller so distances stay isotropic on non-square tiles.
fn joint(idx: i32) -> vec3<f32> {
    switch idx {
        case 0: { return vec3(shader_options.j0_x, shader_options.j0_y, shader_options.j0_v); }
        case 1: { return vec3(shader_options.j1_x, shader_options.j1_y, shader_options.j1_v); }
        case 2: { return vec3(shader_options.j2_x, shader_options.j2_y, shader_options.j2_v); }
        case 3: { return vec3(shader_options.j3_x, shader_options.j3_y, shader_options.j3_v); }
        case 4: { return vec3(shader_options.j4_x, shader_options.j4_y, shader_options.j4_v); }
        case 5: { return vec3(shader_options.j5_x, shader_options.j5_y, shader_options.j5_v); }
        case 6: { return vec3(shader_options.j6_x, shader_options.j6_y, shader_options.j6_v); }
        case 7: { return vec3(shader_options.j7_x, shader_options.j7_y, shader_options.j7_v); }
        case 8: { return vec3(shader_options.j8_x, shader_options.j8_y, shader_options.j8_v); }
        case 9: { return vec3(shader_options.j9_x, shader_options.j9_y, shader_options.j9_v); }
        case 10: { return vec3(shader_options.j10_x, shader_options.j10_y, shader_options.j10_v); }
        case 11: { return vec3(shader_options.j11_x, shader_options.j11_y, shader_options.j11_v); }
        case 12: { return vec3(shader_options.j12_x, shader_options.j12_y, shader_options.j12_v); }
        case 13: { return vec3(shader_options.j13_x, shader_options.j13_y, shader_options.j13_v); }
        case 14: { return vec3(shader_options.j14_x, shader_options.j14_y, shader_options.j14_v); }
        case 15: { return vec3(shader_options.j15_x, shader_options.j15_y, shader_options.j15_v); }
        case 16: { return vec3(shader_options.j16_x, shader_options.j16_y, shader_options.j16_v); }
        default: { return vec3(0.0, 0.0, 0.0); }
    }
}

fn bone_color(group: i32) -> vec3<f32> {
    switch group {
        case 0: { return vec3(shader_options.bone_arm_r, shader_options.bone_arm_g, shader_options.bone_arm_b); }
        case 1: { return vec3(shader_options.bone_leg_r, shader_options.bone_leg_g, shader_options.bone_leg_b); }
        default: { return vec3(shader_options.bone_core_r, shader_options.bone_core_g, shader_options.bone_core_b); }
    }
}

fn joint_color(group: i32) -> vec3<f32> {
    switch group {
        case 0: { return vec3(shader_options.jnt_arm_r, shader_options.jnt_arm_g, shader_options.jnt_arm_b); }
        case 1: { return vec3(shader_options.jnt_leg_r, shader_options.jnt_leg_g, shader_options.jnt_leg_b); }
        default: { return vec3(shader_options.jnt_core_r, shader_options.jnt_core_g, shader_options.jnt_core_b); }
    }
}

// Value noise (from haunter-aura.wgsl) — displaces the aura's iso-line so it
// reads as flame licking the rig, not a uniform outline.
fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2(123.34, 456.21));
    q = q + vec2(dot(q, q + vec2(45.32, 45.32)));
    return fract(q.x * q.y);
}

fn vnoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2(1.0, 0.0));
    let c = hash21(i + vec2(0.0, 1.0));
    let d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var v: f32 = 0.0;
    var amp: f32 = 0.5;
    var q = p;
    for (var i: i32 = 0; i < 3; i = i + 1) {
        v = v + amp * vnoise(q);
        q = q * 2.03 + vec2(17.0, 9.0);
        amp = amp * 0.5;
    }
    return v;
}

/// Distance from point p to line segment ab.
fn dist_to_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let ap = p - a;
    let len_sq = dot(ab, ab);
    if len_sq < 0.000001 {
        return length(ap);
    }
    let t = clamp(dot(ap, ab) / len_sq, 0.0, 1.0);
    return length(p - (a + ab * t));
}

/// Straight-alpha source-over. The Views this replaces composited in child
/// order, so the shader does too. A per-channel max() accumulator (as the
/// hand-skeleton shader uses) would invent color where two differently-hued
/// bones cross — the core-yellow shoulder line over a cyan arm would go white.
fn over(dst: vec4<f32>, col: vec3<f32>, a: f32) -> vec4<f32> {
    if a <= 0.0 {
        return dst;
    }
    let src_a = clamp(a, 0.0, 1.0);
    let out_a = src_a + dst.a * (1.0 - src_a);
    let rgb = (col * src_a + dst.rgb * dst.a * (1.0 - src_a)) / max(out_a, 0.00001);
    return vec4(rgb, out_a);
}

/// Falls from 1 to 0 across [edge - band, edge], in pixels. smoothstep is only
/// defined for low < high, so the band is widened rather than allowed to
/// collapse — a zero-width band would otherwise appear wherever a radius
/// rounds down to its feather.
fn falloff(edge: f32, band: f32, d: f32) -> f32 {
    let lo = max(edge - band, 0.0);
    let hi = max(edge, lo + 0.001);
    return 1.0 - smoothstep(lo, hi, d);
}

/// Coverage of a round-capped bar of half-width `hw` along a→b. `feather` is
/// the falloff band: ~1px for a solid bone (antialiasing only), most of the
/// half-width for the halo, which is what makes the glow an actual gradient
/// rather than the flat translucent slab the View version stacked underneath.
fn bar_cov(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, hw: f32, feather: f32) -> f32 {
    return falloff(hw, feather, dist_to_segment(p, a, b));
}

/// Coverage of a ring of outer radius `r`; `hole` <= 0 fills the disc.
fn ring_cov(p: vec2<f32>, c: vec2<f32>, r: f32, hole: f32) -> f32 {
    let d = length(p - c);
    var cov = falloff(r, 1.0, d);
    if hole > 0.0 {
        cov = cov * (1.0 - falloff(hole, 1.0, d));
    }
    return cov;
}

/// One pass over every bone plus the neck, at a given half-width and alpha.
/// Called twice in neon (halo, then solid) so the glow never paints over a
/// bone, and once in lines mode.
fn draw_bones(acc_in: vec4<f32>, p: vec2<f32>, res: vec2<f32>, hw: f32, feather: f32, alpha: f32) -> vec4<f32> {
    var acc = acc_in;
    for (var i = 0; i < 12; i = i + 1) {
        let ja = joint(BONE_A[i]);
        let jb = joint(BONE_B[i]);
        if ja.z < 0.5 || jb.z < 0.5 {
            continue;
        }
        let a = ja.xy * res;
        let b = jb.xy * res;
        // Same floor as the View version: sub-2px segments are noise.
        if distance(a, b) < 2.0 {
            continue;
        }
        acc = over(acc, bone_color(BONE_G[i]), bar_cov(p, a, b, hw, feather) * alpha);
    }

    // Neck: nose → shoulder midpoint. The midpoint is derived here rather than
    // passed in, so it cannot drift from the shoulder joints.
    let nose = joint(0);
    let ls = joint(5);
    let rs = joint(6);
    if nose.z >= 0.5 && ls.z >= 0.5 && rs.z >= 0.5 {
        let a = nose.xy * res;
        let b = (ls.xy + rs.xy) * 0.5 * res;
        if distance(a, b) >= 2.0 {
            acc = over(acc, bone_color(2), bar_cov(p, a, b, hw, feather) * alpha);
        }
    }
    return acc;
}

/// Distance (px) from p to the rig: min over the bone segments plus the neck,
/// with the same visibility guards as draw_bones. 1e6 when nothing is visible.
fn rig_dist(p: vec2<f32>, res: vec2<f32>) -> f32 {
    var d = 1000000.0;
    for (var i = 0; i < 12; i = i + 1) {
        let ja = joint(BONE_A[i]);
        let jb = joint(BONE_B[i]);
        if ja.z < 0.5 || jb.z < 0.5 {
            continue;
        }
        d = min(d, dist_to_segment(p, ja.xy * res, jb.xy * res));
    }
    let nose = joint(0);
    let ls = joint(5);
    let rs = joint(6);
    if nose.z >= 0.5 && ls.z >= 0.5 && rs.z >= 0.5 {
        d = min(d, dist_to_segment(p, nose.xy * res, (ls.xy + rs.xy) * 0.5 * res));
    }
    return d;
}

/// Milestone aura: a flame-displaced iso-line around the rig plus an outer
/// glow, in the exercise's color, faded by aura_i (eased on the CPU side).
fn draw_aura(acc_in: vec4<f32>, p: vec2<f32>, res: vec2<f32>, t: f32) -> vec4<f32> {
    let body_r = 0.055 * res.y;
    let d = rig_dist(p, res) - body_r;
    if d > body_r * 4.0 {
        return acc_in;
    }
    let n = fbm(p * (6.0 / min(res.x, res.y)) + vec2(t * 0.4, -t * 0.6));
    let dd = d + (n - 0.5) * body_r * 0.8;
    let rim = 1.0 - smoothstep(0.0, body_r * 0.35, abs(dd));
    let glow = exp(-max(dd, 0.0) / (body_r * 0.9));
    let aura = vec3(shader_options.aura_r, shader_options.aura_g, shader_options.aura_b);
    return over(acc_in, aura, clamp((rim * 0.9 + glow * 0.5) * shader_options.aura_i, 0.0, 1.0));
}

fn draw_joints(acc_in: vec4<f32>, p: vec2<f32>, res: vec2<f32>) -> vec4<f32> {
    var acc = acc_in;
    let rad = shader_options.joint_rad * res.y;
    let hole = shader_options.joint_hole * res.y;
    for (var i = 0; i < 17; i = i + 1) {
        // In neon the head circle stands in for the nose.
        if i == 0 && shader_options.head_v > 0.5 {
            continue;
        }
        let j = joint(i);
        if j.z < 0.5 {
            continue;
        }
        let cov = ring_cov(p, j.xy * res, rad, hole);
        acc = over(acc, joint_color(JOINT_G[i]), cov * shader_options.joint_a);
    }
    return acc;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let src = textureSample(textures[0], sampler_, uv);
    if base_params.texture_count != 1u {
        return src;
    }

    // Everything below is in PIXELS. Working in raw uv (as the hand-skeleton
    // shader does) makes a bone's thickness depend on its angle — on a 16:9
    // tile a vertical bone comes out ~44% thinner than a horizontal one, and
    // joint dots come out elliptical.
    let res = vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));
    let p = uv * res;

    var acc = vec4(0.0, 0.0, 0.0, 0.0);

    // Milestone aura sits under the skeleton so the rig stays crisp on top.
    if shader_options.aura_i > 0.001 {
        acc = draw_aura(acc, p, res, base_params.time);
    }

    // Same four layers, in the same order, as the Views this replaces.
    let glow_hw = shader_options.glow_w * res.y;
    if glow_hw > 0.0 {
        acc = draw_bones(acc, p, res, glow_hw, glow_hw * 0.8, shader_options.glow_a);
    }
    acc = draw_bones(acc, p, res, shader_options.bone_w * res.y, 1.0, shader_options.bone_a);
    acc = draw_joints(acc, p, res);
    if shader_options.head_v > 0.5 {
        let cov = ring_cov(
            p,
            vec2(shader_options.head_x, shader_options.head_y) * res,
            shader_options.head_rad * res.y,
            shader_options.head_hole * res.y,
        );
        acc = over(acc, joint_color(2), cov * shader_options.joint_a);
    }

    // An overlay, not a look: the source is not dimmed, tinted or scanlined.
    return vec4(mix(src.rgb, acc.rgb, acc.a), max(src.a, acc.a));
}
