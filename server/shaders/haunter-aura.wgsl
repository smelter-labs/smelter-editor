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

// Menacing aura for the haunting ghosts (HaunterGhostsInput). Up to 8 slots,
// one per ghost; each slot carries the ghost's aura circle and the haunted
// person's ellipse, both in tile space (0..1) already mapped through the same
// rescale 'fill' (cover) transform the video uses. The two shapes are joined
// with a smooth-min so a scaring ghost and its person share one blob.
//
// The aura is a flame-like wavy rim (fbm-displaced boundary) with an outer
// glow, a darkened/desaturated interior, and a subtle heat-haze warp near the
// edge. `menace` (0..1, eased by the component) morphs a soft golden glow
// (idle) into a fiery orange-yellow blaze (scaring). `a{i}_hue` rotates the
// palette per ghost so each aura matches its sprite tint (ghost 0 = art yellow).
//   aura_count   - number of valid slots
//   a{i}_gx, a{i}_gy - ghost center (tile uv)
//   a{i}_gr          - ghost aura radius as a fraction of min(width, height)
//   a{i}_menace      - 0 idle .. 1 scaring (continuous)
//   a{i}_hue         - hue rotation in turns (0..1), same as haunter-ghost
//   a{i}_px, a{i}_py - haunted person center (tile uv), 0 when idle
//   a{i}_pw, a{i}_ph - person half-width / half-height (tile uv), 0 when idle
struct ShaderOptions {
    aura_count: f32,
    a0_gx: f32, a0_gy: f32, a0_gr: f32, a0_menace: f32, a0_hue: f32, a0_px: f32, a0_py: f32, a0_pw: f32, a0_ph: f32,
    a1_gx: f32, a1_gy: f32, a1_gr: f32, a1_menace: f32, a1_hue: f32, a1_px: f32, a1_py: f32, a1_pw: f32, a1_ph: f32,
    a2_gx: f32, a2_gy: f32, a2_gr: f32, a2_menace: f32, a2_hue: f32, a2_px: f32, a2_py: f32, a2_pw: f32, a2_ph: f32,
    a3_gx: f32, a3_gy: f32, a3_gr: f32, a3_menace: f32, a3_hue: f32, a3_px: f32, a3_py: f32, a3_pw: f32, a3_ph: f32,
    a4_gx: f32, a4_gy: f32, a4_gr: f32, a4_menace: f32, a4_hue: f32, a4_px: f32, a4_py: f32, a4_pw: f32, a4_ph: f32,
    a5_gx: f32, a5_gy: f32, a5_gr: f32, a5_menace: f32, a5_hue: f32, a5_px: f32, a5_py: f32, a5_pw: f32, a5_ph: f32,
    a6_gx: f32, a6_gy: f32, a6_gr: f32, a6_menace: f32, a6_hue: f32, a6_px: f32, a6_py: f32, a6_pw: f32, a6_ph: f32,
    a7_gx: f32, a7_gy: f32, a7_gr: f32, a7_menace: f32, a7_hue: f32, a7_px: f32, a7_py: f32, a7_pw: f32, a7_ph: f32,
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

struct Aura {
    ghost: vec2<f32>,
    radius: f32,
    menace: f32,
    hue: f32,
    pcenter: vec2<f32>,
    phalf: vec2<f32>,
};

fn get_aura(i: i32) -> Aura {
    var a: Aura;
    switch i {
        case 0:  { a.ghost = vec2(shader_options.a0_gx, shader_options.a0_gy); a.radius = shader_options.a0_gr; a.menace = shader_options.a0_menace; a.hue = shader_options.a0_hue; a.pcenter = vec2(shader_options.a0_px, shader_options.a0_py); a.phalf = vec2(shader_options.a0_pw, shader_options.a0_ph); }
        case 1:  { a.ghost = vec2(shader_options.a1_gx, shader_options.a1_gy); a.radius = shader_options.a1_gr; a.menace = shader_options.a1_menace; a.hue = shader_options.a1_hue; a.pcenter = vec2(shader_options.a1_px, shader_options.a1_py); a.phalf = vec2(shader_options.a1_pw, shader_options.a1_ph); }
        case 2:  { a.ghost = vec2(shader_options.a2_gx, shader_options.a2_gy); a.radius = shader_options.a2_gr; a.menace = shader_options.a2_menace; a.hue = shader_options.a2_hue; a.pcenter = vec2(shader_options.a2_px, shader_options.a2_py); a.phalf = vec2(shader_options.a2_pw, shader_options.a2_ph); }
        case 3:  { a.ghost = vec2(shader_options.a3_gx, shader_options.a3_gy); a.radius = shader_options.a3_gr; a.menace = shader_options.a3_menace; a.hue = shader_options.a3_hue; a.pcenter = vec2(shader_options.a3_px, shader_options.a3_py); a.phalf = vec2(shader_options.a3_pw, shader_options.a3_ph); }
        case 4:  { a.ghost = vec2(shader_options.a4_gx, shader_options.a4_gy); a.radius = shader_options.a4_gr; a.menace = shader_options.a4_menace; a.hue = shader_options.a4_hue; a.pcenter = vec2(shader_options.a4_px, shader_options.a4_py); a.phalf = vec2(shader_options.a4_pw, shader_options.a4_ph); }
        case 5:  { a.ghost = vec2(shader_options.a5_gx, shader_options.a5_gy); a.radius = shader_options.a5_gr; a.menace = shader_options.a5_menace; a.hue = shader_options.a5_hue; a.pcenter = vec2(shader_options.a5_px, shader_options.a5_py); a.phalf = vec2(shader_options.a5_pw, shader_options.a5_ph); }
        case 6:  { a.ghost = vec2(shader_options.a6_gx, shader_options.a6_gy); a.radius = shader_options.a6_gr; a.menace = shader_options.a6_menace; a.hue = shader_options.a6_hue; a.pcenter = vec2(shader_options.a6_px, shader_options.a6_py); a.phalf = vec2(shader_options.a6_pw, shader_options.a6_ph); }
        case 7:  { a.ghost = vec2(shader_options.a7_gx, shader_options.a7_gy); a.radius = shader_options.a7_gr; a.menace = shader_options.a7_menace; a.hue = shader_options.a7_hue; a.pcenter = vec2(shader_options.a7_px, shader_options.a7_py); a.phalf = vec2(shader_options.a7_pw, shader_options.a7_ph); }
        default: { a.ghost = vec2(0.0, 0.0); a.radius = 0.0; a.menace = 0.0; a.hue = 0.0; a.pcenter = vec2(0.0, 0.0); a.phalf = vec2(0.0, 0.0); }
    }
    return a;
}

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

/** Polynomial smooth-min: joins the ghost circle and the person ellipse into
 * one organic blob instead of two intersecting outlines. */
fn smin(a: f32, b: f32, k: f32) -> f32 {
    let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

/** Approximate signed distance (px) to an axis-aligned ellipse. */
fn ellipse_sd(p: vec2<f32>, c: vec2<f32>, h: vec2<f32>) -> f32 {
    if (h.x <= 0.0 || h.y <= 0.0) {
        return 1.0e6;
    }
    let d = length((p - c) / h);
    return (d - 1.0) * min(h.x, h.y);
}

// Aura palette tuned to the ghost sprite art (bright yellow body). Idle is a
// soft golden glow; scaring ramps to a fiery orange-yellow. Per-ghost hue
// rotation keeps the aura matched to each sprite tint.
const IDLE_COLOR: vec3<f32> = vec3<f32>(0.98, 0.88, 0.28);
const SCARE_COLOR: vec3<f32> = vec3<f32>(1.0, 0.62, 0.08);

// Global mood grade — this shader only runs while haunting mode is on, so the
// whole frame gets a subtle gray, darkened, cold (moonlit) cast plus a soft
// vignette. Kept gentle: the video should still read normally underneath.
const MOOD_DESAT: f32 = 0.28;
const MOOD_DARKEN: f32 = 0.9;
const MOOD_TINT: vec3<f32> = vec3<f32>(0.95, 0.98, 1.05);
const VIGNETTE_STRENGTH: f32 = 0.22;

fn rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let mx = max(rgb.r, max(rgb.g, rgb.b));
    let mn = min(rgb.r, min(rgb.g, rgb.b));
    let d = mx - mn;

    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let v: f32 = mx;

    if (mx > 0.0) {
        s = d / mx;
    }

    if (d > 0.0001) {
        if (mx == rgb.r) {
            h = (rgb.g - rgb.b) / d;
            if (rgb.g < rgb.b) { h = h + 6.0; }
        } else if (mx == rgb.g) {
            h = (rgb.b - rgb.r) / d + 2.0;
        } else {
            h = (rgb.r - rgb.g) / d + 4.0;
        }
        h = h / 6.0;
    }

    return vec3<f32>(h, s, v);
}

fn hsv_to_rgb(hsv: vec3<f32>) -> vec3<f32> {
    let h = fract(hsv.x) * 6.0;
    let c = hsv.z * hsv.y;
    let x = c * (1.0 - abs(h % 2.0 - 1.0));
    let m = hsv.z - c;
    var rgb: vec3<f32>;
    if (h < 1.0) { rgb = vec3(c, x, 0.0); }
    else if (h < 2.0) { rgb = vec3(x, c, 0.0); }
    else if (h < 3.0) { rgb = vec3(0.0, c, x); }
    else if (h < 4.0) { rgb = vec3(0.0, x, c); }
    else if (h < 5.0) { rgb = vec3(x, 0.0, c); }
    else { rgb = vec3(c, 0.0, x); }
    return rgb + vec3(m);
}

fn rotate_hue(rgb: vec3<f32>, shift: f32) -> vec3<f32> {
    var hsv = rgb_to_hsv(rgb);
    hsv.x = fract(hsv.x + shift);
    return hsv_to_rgb(hsv);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );
    let min_edge = min(res.x, res.y);
    let uv = input.tex_coords;
    let p = uv * res;
    let t = base_params.time;

    let count = i32(clamp(shader_options.aura_count, 0.0, 8.0));

    var rim_acc: f32 = 0.0;
    var glow_acc: f32 = 0.0;
    var inside_acc: f32 = 0.0;
    var warp_acc: f32 = 0.0;
    var col_acc = vec3<f32>(0.0);
    var w_acc: f32 = 0.0;

    for (var i: i32 = 0; i < count; i = i + 1) {
        let a = get_aura(i);
        if (a.radius <= 0.0) {
            continue;
        }
        let fi = f32(i);

        // Breathing radius — slow while idle, deeper and faster when scaring.
        let breathe =
            1.0 + (0.04 + 0.05 * a.menace) * sin(t * (2.0 + 1.5 * a.menace) + fi * 2.4);
        let r = a.radius * min_edge * breathe;

        let d_ghost = length(p - a.ghost * res) - r;
        let d_person = ellipse_sd(p, a.pcenter * res, a.phalf * res);
        let d = smin(d_ghost, d_person, r * 0.9);

        // Flame-like boundary: displace the iso-line with animated fbm.
        let n = fbm(p * vec2(6.0 / min_edge) + vec2(t * 0.35, -t * 0.55) + vec2(fi * 13.7, fi * 7.3));
        let dd = d + (n - 0.5) * r * 0.55;

        let strength = mix(0.25, 1.0, a.menace);
        // Irregular flicker keyed to the same noise so the rim "burns".
        let flicker =
            1.0 - (0.15 + 0.3 * a.menace) * (0.5 + 0.5 * sin(t * (7.0 + 3.0 * a.menace) + fi * 1.7 + n * 6.0));

        let rim = (1.0 - smoothstep(0.0, r * 0.16, abs(dd))) * strength * flicker;
        let glow = exp(-max(dd, 0.0) / (r * 0.5)) * 0.6 * strength * flicker;
        let inside = (1.0 - smoothstep(-r * 0.35, 0.0, dd)) * strength;

        let base_col = mix(IDLE_COLOR, SCARE_COLOR, a.menace);
        let col = rotate_hue(base_col, a.hue);
        let w = rim + glow;
        col_acc = col_acc + col * w;
        w_acc = w_acc + w;
        rim_acc = max(rim_acc, rim);
        glow_acc = max(glow_acc, glow);
        inside_acc = max(inside_acc, inside);
        warp_acc = max(warp_acc, exp(-abs(dd) / (r * 0.35)) * a.menace);
    }

    // Heat-haze warp near a scaring aura's boundary: the air itself trembles.
    var suv = uv;
    if (warp_acc > 0.003) {
        let w1 = fbm(p * vec2(9.0 / min_edge) + vec2(t * 0.9, t * 0.7));
        let w2 = fbm(p * vec2(9.0 / min_edge) + vec2(-t * 0.8, t * 1.1) + vec2(31.0, 47.0));
        suv = uv + (vec2(w1, w2) - vec2(0.5)) * (10.0 * warp_acc) / res;
    }
    let color = textureSample(textures[0], sampler_, clamp(suv, vec2<f32>(0.0), vec2<f32>(1.0)));
    var rgb = color.rgb;

    // Mood grade first, so the aura interior/glow composes on top of it.
    let mood_luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3<f32>(mood_luma), MOOD_DESAT) * MOOD_TINT * MOOD_DARKEN;
    let vd = distance(uv, vec2<f32>(0.5, 0.5));
    rgb = rgb * (1.0 - VIGNETTE_STRENGTH * smoothstep(0.4, 0.85, vd));

    // Interior: drain color and light so the haunted region reads as dangerous.
    let luma = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    let drained = mix(rgb, vec3<f32>(luma), 0.55) * 0.5;
    rgb = mix(rgb, drained, clamp(inside_acc, 0.0, 1.0) * 0.8);

    // Additive outer glow + bright wavy rim in the blended aura color.
    let aura_col = col_acc / max(w_acc, 1.0e-4);
    rgb = rgb + aura_col * (glow_acc * 0.75 + rim_acc * 1.1);

    return vec4<f32>(rgb, color.a);
}
