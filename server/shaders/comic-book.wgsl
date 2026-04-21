struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) tex_coords: vec2<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) tex_coords: vec2<f32>,
}

struct BaseShaderParameters {
    plane_id: i32,
    time: f32,
    output_resolution: vec2<u32>,
    texture_count: u32,
}

struct ShaderOptions {
    ink_color_r: f32,
    ink_color_g: f32,
    ink_color_b: f32,
    edge_strength: f32,
    edge_thickness: f32,
    color_levels: f32,
    saturation_boost: f32,
    halftone_size: f32,
    halftone_strength: f32,
    ink_smoothness: f32,
    paper_warmth: f32,
    brightness: f32,
    speed_lines: f32,
    speed_line_density: f32,
}

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

fn sample_tex(uv: vec2<f32>) -> vec4<f32> {
    return textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

fn sample_lum(uv: vec2<f32>) -> f32 {
    let c = sample_tex(uv);
    return luma(c.rgb) * c.a;
}

fn sobel(uv: vec2<f32>, scale: f32, px: vec2<f32>) -> f32 {
    let p = px * scale;
    let tl = sample_lum(uv + vec2<f32>(-p.x, -p.y));
    let tc = sample_lum(uv + vec2<f32>(0.0, -p.y));
    let tr = sample_lum(uv + vec2<f32>(p.x, -p.y));
    let ml = sample_lum(uv + vec2<f32>(-p.x, 0.0));
    let mr = sample_lum(uv + vec2<f32>(p.x, 0.0));
    let bl = sample_lum(uv + vec2<f32>(-p.x, p.y));
    let bc = sample_lum(uv + vec2<f32>(0.0, p.y));
    let br = sample_lum(uv + vec2<f32>(p.x, p.y));
    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    return sqrt(gx * gx + gy * gy);
}

fn sobel_color(uv: vec2<f32>, scale: f32, px: vec2<f32>) -> f32 {
    let p = px * scale;
    var max_edge = 0.0;
    for (var ch = 0; ch < 3; ch = ch + 1) {
        let tl = sample_tex(uv + vec2<f32>(-p.x, -p.y))[ch];
        let tc = sample_tex(uv + vec2<f32>(0.0, -p.y))[ch];
        let tr = sample_tex(uv + vec2<f32>(p.x, -p.y))[ch];
        let ml = sample_tex(uv + vec2<f32>(-p.x, 0.0))[ch];
        let mr = sample_tex(uv + vec2<f32>(p.x, 0.0))[ch];
        let bl = sample_tex(uv + vec2<f32>(-p.x, p.y))[ch];
        let bc = sample_tex(uv + vec2<f32>(0.0, p.y))[ch];
        let br = sample_tex(uv + vec2<f32>(p.x, p.y))[ch];
        let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
        let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
        max_edge = max(max_edge, sqrt(gx * gx + gy * gy));
    }
    return max_edge;
}

fn hash21(p: vec2<f32>) -> f32 {
    var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
    p3 = p3 + vec3<f32>(dot(p3, vec3<f32>(p3.y + 33.33, p3.z + 33.33, p3.x + 33.33)));
    return fract((p3.x + p3.y) * p3.z);
}

fn rotate2d(uv: vec2<f32>, a: f32) -> vec2<f32> {
    let c = cos(a);
    let s = sin(a);
    return vec2<f32>(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
}

fn halftone_dot(pix_uv: vec2<f32>, size: f32, angle: f32, val: f32) -> f32 {
    let rotated = rotate2d(pix_uv, angle);
    let cell_uv = fract(rotated / size) - 0.5;
    let dist = length(cell_uv);
    let radius = sqrt(clamp(val, 0.0, 1.0)) * 0.48;
    return smoothstep(radius + 0.04, radius - 0.04, dist);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(base_params.output_resolution);
    let px = 1.0 / res;
    let t = base_params.time;

    let ink = vec3<f32>(
        shader_options.ink_color_r,
        shader_options.ink_color_g,
        shader_options.ink_color_b,
    );
    let edge_str = shader_options.edge_strength;
    let thickness = max(shader_options.edge_thickness, 1.0);
    let levels = max(shader_options.color_levels, 2.0);
    let sat_boost = shader_options.saturation_boost;
    let ht_size = shader_options.halftone_size;
    let ht_blend = shader_options.halftone_strength;
    let smoothness = clamp(shader_options.ink_smoothness, 0.0, 1.0);
    let warmth = shader_options.paper_warmth;
    let bright = shader_options.brightness;
    let speed = shader_options.speed_lines;
    let speed_dens = shader_options.speed_line_density;

    let original = textureSample(textures[0], sampler_, uv);

    // ── Multi-scale edge detection ──
    // Luma edges: captures structural contours
    let el1 = sobel(uv, 1.0, px);
    let el2 = sobel(uv, thickness, px);
    let el3 = sobel(uv, thickness * 2.0, px);
    let luma_edge = el1 * 0.25 + el2 * 0.5 + el3 * 0.25;

    // Color edges: catches boundaries between hues of similar brightness
    let ec1 = sobel_color(uv, 1.0, px);
    let ec2 = sobel_color(uv, thickness, px);
    let color_edge = ec1 * 0.4 + ec2 * 0.6;

    let combined = max(luma_edge, color_edge * 0.8);

    let lo = max(0.06 - smoothness * 0.05, 0.002);
    let hi = lo + smoothness * 0.2 + 0.08;
    let ink_mask = clamp(smoothstep(lo, hi, combined) * edge_str, 0.0, 1.0);

    // ── Posterization (gamma-aware quantization) ──
    let lin = pow(max(original.rgb, vec3<f32>(0.0)), vec3<f32>(2.2));
    let q = floor(lin * levels + 0.5) / levels;
    var color = pow(max(q, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));

    // ── Saturation boost ──
    let gray = luma(color);
    color = max(mix(vec3<f32>(gray), color, sat_boost), vec3<f32>(0.0));

    // ── Brightness ──
    color = color * bright;

    // ── CMYK-style halftone (Ben-Day dots) ──
    if (ht_size > 0.5) {
        let pix = uv * res;

        // Each color channel gets its own screen angle (classic print separation)
        let dot_r = halftone_dot(pix, ht_size, 0.2618, color.r);   // 15°
        let dot_g = halftone_dot(pix, ht_size, 1.309, color.g);    // 75°
        let dot_b = halftone_dot(pix, ht_size, 0.0, color.b);      // 0°

        // Black key screen for deep shadows
        let l = luma(color);
        let dot_k = halftone_dot(pix, ht_size, 0.7854, l);         // 45°

        let ht_color = vec3<f32>(dot_r, dot_g, dot_b);

        // Blend: heavier halftone in mid/shadow tones, lighter in highlights
        let tone_weight = 1.0 - smoothstep(0.6, 0.95, l);
        let effective_blend = ht_blend * tone_weight;
        color = mix(color, ht_color, effective_blend);

        // Black dot overlay deepens shadows
        let shadow_factor = (1.0 - dot_k) * ht_blend * (1.0 - l) * 0.5;
        color = color * (1.0 - shadow_factor);
    }

    // ── Paper warmth + grain ──
    if (warmth > 0.001) {
        let paper_tint = vec3<f32>(1.0, 0.97, 0.91);
        color = mix(color, color * paper_tint, warmth);

        // Subtle per-pixel grain like newsprint paper
        let grain = hash21(floor(uv * res * 0.5)) * 0.04 * warmth;
        color = color + vec3<f32>(grain);
    }

    // ── Speed / action lines (radial manga-style) ──
    if (speed > 0.01) {
        let center = vec2<f32>(0.5, 0.5);
        let d = uv - center;
        let angle = atan2(d.y, d.x);
        let dist = length(d);

        let line_pattern = sin(angle * speed_dens + t * 3.0) * 0.5 + 0.5;
        let line_mask = smoothstep(0.3, 0.7, line_pattern);
        let radial_fade = smoothstep(0.12, 0.55, dist);

        // Slight thickness variation for hand-drawn feel
        let wobble = sin(angle * 5.0 + t * 1.5) * 0.08;
        let final_mask = line_mask * (radial_fade + wobble) * speed;

        color = mix(color, ink, clamp(final_mask * 0.65, 0.0, 1.0));
    }

    // ── Ink outlines on top of everything ──
    color = mix(color, ink, ink_mask);

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
}
