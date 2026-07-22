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

// Per-car hue recolor for top-down (bird's-eye) vehicle detections. Up to 16
// boxes, supplied in tile space (0..1), already mapped through the same rescale
// 'fill' (cover) transform the video uses. Each box carries its own hue shift
// (turns of the hue wheel, 0..1) so cars can be recolored individually.
//
// The mask is a feathered ellipse inscribed in the box — a car seen from above
// fills its box except the corners, and the soft edge hides tracking jitter.
// Hue rotation only moves saturated pixels, so asphalt inside the ellipse stays
// gray on its own; `sat_boost` additionally saturates masked pixels so weakly
// colored (silver-ish) cars still visibly change, and `white_boost` paints
// bright achromatic pixels (white body panels) with the per-car hue outright —
// rotation alone can't recolor a car that has no color to rotate.
//   box_count   - number of valid boxes
//   strength    - 0..1 blend of the recolored result
//   sat_boost   - extra saturation added inside the mask (0..1)
//   white_boost - 0..1 paint strength on bright achromatic pixels
//   b{i}_cx, b{i}_cy  - box center
//   b{i}_hw, b{i}_hh  - box half-width / half-height
//   b{i}_hue          - hue shift in turns (0..1)
struct ShaderOptions {
    box_count: f32,
    strength: f32,
    sat_boost: f32,
    white_boost: f32,
    b0_cx: f32, b0_cy: f32, b0_hw: f32, b0_hh: f32, b0_hue: f32,
    b1_cx: f32, b1_cy: f32, b1_hw: f32, b1_hh: f32, b1_hue: f32,
    b2_cx: f32, b2_cy: f32, b2_hw: f32, b2_hh: f32, b2_hue: f32,
    b3_cx: f32, b3_cy: f32, b3_hw: f32, b3_hh: f32, b3_hue: f32,
    b4_cx: f32, b4_cy: f32, b4_hw: f32, b4_hh: f32, b4_hue: f32,
    b5_cx: f32, b5_cy: f32, b5_hw: f32, b5_hh: f32, b5_hue: f32,
    b6_cx: f32, b6_cy: f32, b6_hw: f32, b6_hh: f32, b6_hue: f32,
    b7_cx: f32, b7_cy: f32, b7_hw: f32, b7_hh: f32, b7_hue: f32,
    b8_cx: f32, b8_cy: f32, b8_hw: f32, b8_hh: f32, b8_hue: f32,
    b9_cx: f32, b9_cy: f32, b9_hw: f32, b9_hh: f32, b9_hue: f32,
    b10_cx: f32, b10_cy: f32, b10_hw: f32, b10_hh: f32, b10_hue: f32,
    b11_cx: f32, b11_cy: f32, b11_hw: f32, b11_hh: f32, b11_hue: f32,
    b12_cx: f32, b12_cy: f32, b12_hw: f32, b12_hh: f32, b12_hue: f32,
    b13_cx: f32, b13_cy: f32, b13_hw: f32, b13_hh: f32, b13_hue: f32,
    b14_cx: f32, b14_cy: f32, b14_hw: f32, b14_hh: f32, b14_hue: f32,
    b15_cx: f32, b15_cy: f32, b15_hw: f32, b15_hh: f32, b15_hue: f32,
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

struct Box {
    center: vec2<f32>,
    half: vec2<f32>,
    hue: f32,
};

fn get_box(i: i32) -> Box {
    var b: Box;
    switch i {
        case 0:  { b.center = vec2(shader_options.b0_cx,  shader_options.b0_cy);  b.half = vec2(shader_options.b0_hw,  shader_options.b0_hh);  b.hue = shader_options.b0_hue; }
        case 1:  { b.center = vec2(shader_options.b1_cx,  shader_options.b1_cy);  b.half = vec2(shader_options.b1_hw,  shader_options.b1_hh);  b.hue = shader_options.b1_hue; }
        case 2:  { b.center = vec2(shader_options.b2_cx,  shader_options.b2_cy);  b.half = vec2(shader_options.b2_hw,  shader_options.b2_hh);  b.hue = shader_options.b2_hue; }
        case 3:  { b.center = vec2(shader_options.b3_cx,  shader_options.b3_cy);  b.half = vec2(shader_options.b3_hw,  shader_options.b3_hh);  b.hue = shader_options.b3_hue; }
        case 4:  { b.center = vec2(shader_options.b4_cx,  shader_options.b4_cy);  b.half = vec2(shader_options.b4_hw,  shader_options.b4_hh);  b.hue = shader_options.b4_hue; }
        case 5:  { b.center = vec2(shader_options.b5_cx,  shader_options.b5_cy);  b.half = vec2(shader_options.b5_hw,  shader_options.b5_hh);  b.hue = shader_options.b5_hue; }
        case 6:  { b.center = vec2(shader_options.b6_cx,  shader_options.b6_cy);  b.half = vec2(shader_options.b6_hw,  shader_options.b6_hh);  b.hue = shader_options.b6_hue; }
        case 7:  { b.center = vec2(shader_options.b7_cx,  shader_options.b7_cy);  b.half = vec2(shader_options.b7_hw,  shader_options.b7_hh);  b.hue = shader_options.b7_hue; }
        case 8:  { b.center = vec2(shader_options.b8_cx,  shader_options.b8_cy);  b.half = vec2(shader_options.b8_hw,  shader_options.b8_hh);  b.hue = shader_options.b8_hue; }
        case 9:  { b.center = vec2(shader_options.b9_cx,  shader_options.b9_cy);  b.half = vec2(shader_options.b9_hw,  shader_options.b9_hh);  b.hue = shader_options.b9_hue; }
        case 10: { b.center = vec2(shader_options.b10_cx, shader_options.b10_cy); b.half = vec2(shader_options.b10_hw, shader_options.b10_hh); b.hue = shader_options.b10_hue; }
        case 11: { b.center = vec2(shader_options.b11_cx, shader_options.b11_cy); b.half = vec2(shader_options.b11_hw, shader_options.b11_hh); b.hue = shader_options.b11_hue; }
        case 12: { b.center = vec2(shader_options.b12_cx, shader_options.b12_cy); b.half = vec2(shader_options.b12_hw, shader_options.b12_hh); b.hue = shader_options.b12_hue; }
        case 13: { b.center = vec2(shader_options.b13_cx, shader_options.b13_cy); b.half = vec2(shader_options.b13_hw, shader_options.b13_hh); b.hue = shader_options.b13_hue; }
        case 14: { b.center = vec2(shader_options.b14_cx, shader_options.b14_cy); b.half = vec2(shader_options.b14_hw, shader_options.b14_hh); b.hue = shader_options.b14_hue; }
        case 15: { b.center = vec2(shader_options.b15_cx, shader_options.b15_cy); b.half = vec2(shader_options.b15_hw, shader_options.b15_hh); b.hue = shader_options.b15_hue; }
        default: { b.center = vec2(0.0, 0.0); b.half = vec2(0.0, 0.0); b.hue = 0.0; }
    }
    return b;
}

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let l = (mx + mn) * 0.5;
    if (mx == mn) {
        return vec3<f32>(0.0, 0.0, l);
    }
    let d = mx - mn;
    var s: f32;
    if (l > 0.5) {
        s = d / (2.0 - mx - mn);
    } else {
        s = d / (mx + mn);
    }
    var h: f32;
    if (mx == c.r) {
        h = (c.g - c.b) / d;
        if (c.g < c.b) { h = h + 6.0; }
    } else if (mx == c.g) {
        h = (c.b - c.r) / d + 2.0;
    } else {
        h = (c.r - c.g) / d + 4.0;
    }
    h = h / 6.0;
    return vec3<f32>(h, s, l);
}

fn hue_to_rgb(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t = t + 1.0; }
    if (t > 1.0) { t = t - 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5)        { return q; }
    if (t < 2.0 / 3.0)  { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
    let h = hsl.x;
    let s = hsl.y;
    let l = hsl.z;
    if (s == 0.0) {
        return vec3<f32>(l, l, l);
    }
    var q: f32;
    if (l < 0.5) {
        q = l * (1.0 + s);
    } else {
        q = l + s - l * s;
    }
    let p = 2.0 * l - q;
    return vec3<f32>(
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    );
}

// Feathered elliptical mask inscribed in the box: 1 at the center, fading out
// across the last ~25% of the radius so the recolor edge never reads as a
// hard rectangle around the car.
fn box_mask(uv: vec2<f32>, b: Box) -> f32 {
    if (b.half.x <= 0.0 || b.half.y <= 0.0) {
        return 0.0;
    }
    let d = length((uv - b.center) / b.half);
    return 1.0 - smoothstep(0.75, 1.05, d);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let color = textureSample(textures[0], sampler_, uv);

    let count = i32(clamp(shader_options.box_count, 0.0, 16.0));
    // Cars seen from above essentially never overlap — take the strongest box.
    var mask: f32 = 0.0;
    var hue_shift: f32 = 0.0;
    for (var i: i32 = 0; i < count; i = i + 1) {
        let b = get_box(i);
        let m = box_mask(uv, b);
        if (m > mask) {
            mask = m;
            hue_shift = b.hue;
        }
    }

    let amount = mask * clamp(shader_options.strength, 0.0, 1.0);
    if (amount <= 0.001) {
        return color;
    }

    var hsl = rgb_to_hsl(color.rgb);
    // Achromatic before the sat boost: white/gray pixels have nothing for the
    // hue rotation to act on and need painting instead. The window is wide
    // enough that white panels with a slight color cast (lighting, video
    // compression) still count as paintable.
    let achroma = 1.0 - smoothstep(0.12, 0.45, hsl.y);
    hsl.x = fract(hsl.x + hue_shift);
    hsl.y = clamp(hsl.y + shader_options.sat_boost * mask, 0.0, 1.0);
    var recolored = hsl_to_rgb(hsl);

    // Paint white cars: bright achromatic pixels blend toward the per-car hue
    // at their own shading, with lightness pulled well off pure white so the
    // paint reads as an actual car color rather than a pastel wash. The
    // brightness gate keeps gray asphalt and shadows inside the ellipse
    // (darker than body panels) mostly untouched.
    let bright = smoothstep(0.4, 0.6, hsl.z);
    let paint_w =
        achroma * bright * clamp(shader_options.white_boost, 0.0, 1.0) * mask;
    if (paint_w > 0.001) {
        let paint = hsl_to_rgb(vec3<f32>(
            fract(hue_shift),
            0.9,
            clamp(hsl.z * 0.6, 0.25, 0.55),
        ));
        recolored = mix(recolored, paint, paint_w);
    }

    return vec4<f32>(mix(color.rgb, recolored, amount), color.a);
}
