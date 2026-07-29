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

// Per-sprite pass for the haunting ghosts (HaunterGhostsInput). The ghost PNGs
// ship with a solid green-screen backdrop (~#07B137) and no alpha channel, so
// this shader chroma-keys it out (fixed-key ultra-key: hue/sat/luma matte +
// despill), then gives each ghost its own identity:
//   hue_shift  - hue rotation in turns (0..1); 0 keeps the original art color
//   wave_phase - per-ghost phase so the pool doesn't wave in sync
//   wave_amp   - horizontal displacement as a fraction of the sprite width
//   wave_freq  - sine cycles across the sprite height
//   wave_speed - wave animation speed (rad/s)
struct ShaderOptions {
    hue_shift: f32,
    wave_phase: f32,
    wave_amp: f32,
    wave_freq: f32,
    wave_speed: f32,
    flip_x: f32,
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

const TAU: f32 = 6.2831853;

// Keying constants tuned for the ghosts' uniform synthetic backdrop (the same
// values previously passed to the generic ultra-key shader).
const KEY_RGB: vec3<f32> = vec3<f32>(0.0275, 0.6941, 0.2157); // #07B137
const HUE_WIDTH: f32 = 0.1;
const HUE_SOFTNESS: f32 = 0.08;
const SAT_THRESHOLD: f32 = 0.15;
const SAT_SOFTNESS: f32 = 0.1;
const LUMA_LOW: f32 = 0.02;
const LUMA_HIGH: f32 = 0.98;
const LUMA_SOFTNESS: f32 = 0.03;
const CLIP_LOW: f32 = 0.05;
const CLIP_HIGH: f32 = 0.95;
const DESPILL: f32 = 0.7;

const LUMA_WEIGHTS: vec3<f32> = vec3<f32>(0.299, 0.587, 0.114);

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

fn hue_distance(h1: f32, h2: f32) -> f32 {
    let d = abs(h1 - h2);
    return min(d, 1.0 - d);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }
    let t = base_params.time;

    // Jelly wobble: horizontal sine down the sprite plus a milder vertical
    // ripple, phase-offset per ghost so the pool doesn't move in lockstep.
    let ph = shader_options.wave_phase;
    let amp = shader_options.wave_amp;
    let freq = shader_options.wave_freq;
    let speed = shader_options.wave_speed;
    var uv = input.tex_coords;
    if (shader_options.flip_x > 0.5) {
        uv.x = 1.0 - uv.x;
    }
    uv.x = uv.x + sin(uv.y * freq * TAU + t * speed + ph) * amp;
    uv.y = uv.y + sin(uv.x * freq * 0.7 * TAU + t * speed * 0.8 + ph * 1.3) * amp * 0.6;

    // The wobble can push the lookup outside the sprite — sample clamped (a
    // conditional return here would break textureSample uniformity) and make
    // out-of-bounds pixels transparent via `inside`.
    let cuv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let c = textureSample(textures[0], sampler_, cuv);
    let inside =
        step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

    // ── Matte (3 independent HSV axes, as in ultra-key.wgsl) ──

    let pixel_hsv = rgb_to_hsv(c.rgb);
    let key_hsv = rgb_to_hsv(KEY_RGB);

    // Fade hue influence to zero for near-gray pixels where hue is undefined.
    let h_dist = hue_distance(pixel_hsv.x, key_hsv.x);
    let raw_hue_key = 1.0 - smoothstep(HUE_WIDTH, HUE_WIDTH + HUE_SOFTNESS, h_dist);
    let hue_key = raw_hue_key * smoothstep(0.0, 0.05, pixel_hsv.y);

    let sat_key = smoothstep(SAT_THRESHOLD, SAT_THRESHOLD + SAT_SOFTNESS, pixel_hsv.y);

    let luma = dot(c.rgb, LUMA_WEIGHTS);
    let luma_key = smoothstep(LUMA_LOW, LUMA_LOW + LUMA_SOFTNESS, luma)
        * (1.0 - smoothstep(LUMA_HIGH - LUMA_SOFTNESS, LUMA_HIGH, luma));

    var key_strength = hue_key * sat_key * luma_key;
    key_strength = clamp((key_strength - CLIP_LOW) / (CLIP_HIGH - CLIP_LOW), 0.0, 1.0);

    let alpha = (1.0 - key_strength) * c.a * inside;

    // ── Spill suppression (YCbCr projection toward the key chroma) ──

    let pixel_y = dot(c.rgb, LUMA_WEIGHTS);
    let pixel_chroma = vec2<f32>(c.b - pixel_y, c.r - pixel_y);
    let key_y = dot(KEY_RGB, LUMA_WEIGHTS);
    let key_chroma = vec2<f32>(KEY_RGB.b - key_y, KEY_RGB.r - key_y);
    let kc_len = length(key_chroma);
    let key_dir = key_chroma / kc_len;
    let suppress = min(max(dot(pixel_chroma, key_dir), 0.0), kc_len) * DESPILL;
    let new_cb = pixel_chroma.x - key_dir.x * suppress;
    let new_cr = pixel_chroma.y - key_dir.y * suppress;
    var rgb = clamp(
        vec3<f32>(
            new_cr + pixel_y,
            pixel_y - 0.50934 * new_cr - 0.19418 * new_cb,
            new_cb + pixel_y,
        ),
        vec3<f32>(0.0),
        vec3<f32>(1.0),
    );

    // ── Per-ghost tint: rotate hue, leaving grays/whites untouched ──

    var hsv = rgb_to_hsv(rgb);
    hsv.x = fract(hsv.x + shader_options.hue_shift);
    rgb = hsv_to_rgb(hsv);

    return vec4<f32>(rgb * alpha, alpha);
}
