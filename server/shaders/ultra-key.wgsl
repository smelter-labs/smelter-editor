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

struct ShaderOptions {
    key_color_r: f32,
    key_color_g: f32,
    key_color_b: f32,
    hue_width: f32,
    hue_softness: f32,
    sat_threshold: f32,
    sat_softness: f32,
    luma_low: f32,
    luma_high: f32,
    luma_softness: f32,
    erode: f32,
    clip_low: f32,
    clip_high: f32,
    matte_gamma: f32,
    despill: f32,
    despill_balance: f32,
    fg_brightness: f32,
    fg_saturation: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

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

fn hue_distance(h1: f32, h2: f32) -> f32 {
    let d = abs(h1 - h2);
    return min(d, 1.0 - d);
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

    let c = textureSample(textures[0], sampler_, input.tex_coords);
    let key_rgb = vec3<f32>(
        shader_options.key_color_r,
        shader_options.key_color_g,
        shader_options.key_color_b
    );

    let pixel_hsv = rgb_to_hsv(c.rgb);
    let key_hsv = rgb_to_hsv(key_rgb);

    // ── Matte Generation (3 independent HSV axes) ──

    // Hue axis: circular distance, keyed when hue is close to target.
    // Fade hue influence to zero for near-gray pixels where hue is undefined.
    let h_dist = hue_distance(pixel_hsv.x, key_hsv.x);
    let hw = max(shader_options.hue_width, 0.0);
    let hs = max(shader_options.hue_softness, 0.001);
    let raw_hue_key = 1.0 - smoothstep(hw, hw + hs, h_dist);
    let hue_reliability = smoothstep(0.0, 0.05, pixel_hsv.y);
    let hue_key = raw_hue_key * hue_reliability;

    // Saturation axis: only key sufficiently saturated pixels.
    // Low-saturation pixels (shadows, grays) are naturally preserved.
    let st = shader_options.sat_threshold;
    let ss = max(shader_options.sat_softness, 0.001);
    let sat_key = smoothstep(st, st + ss, pixel_hsv.y);

    // Luminance axis: protect very dark shadows and very bright highlights.
    let luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    let ll = shader_options.luma_low;
    let lh = shader_options.luma_high;
    let ls = max(shader_options.luma_softness, 0.001);
    let luma_low_gate = smoothstep(ll, ll + ls, luma);
    let luma_high_gate = 1.0 - smoothstep(lh - ls, lh, luma);
    let luma_key = luma_low_gate * luma_high_gate;

    // All three axes must agree for a pixel to be keyed
    var key_strength = hue_key * sat_key * luma_key;

    // ── Matte Cleanup ──

    // Erode/expand: positive = shrink foreground (more keying), negative = expand
    key_strength = clamp(key_strength + shader_options.erode, 0.0, 1.0);

    // Clip low/high: remap [clip_low, clip_high] → [0, 1], clamp outside
    let cl = shader_options.clip_low;
    let ch = max(shader_options.clip_high, cl + 0.001);
    key_strength = clamp((key_strength - cl) / (ch - cl), 0.0, 1.0);

    // Matte gamma: < 1 pushes toward transparent, > 1 pushes toward opaque
    key_strength = pow(key_strength, max(shader_options.matte_gamma, 0.01));

    let alpha = (1.0 - key_strength) * c.a;

    // ── Spill Suppression (YCbCr chroma projection) ──

    var result_rgb = c.rgb;
    let despill_str = shader_options.despill;

    if (despill_str > 0.0 && alpha > 0.005) {
        let pixel_y  = 0.299 * result_rgb.r + 0.587 * result_rgb.g + 0.114 * result_rgb.b;
        let pixel_cb = result_rgb.b - pixel_y;
        let pixel_cr = result_rgb.r - pixel_y;

        let key_y  = 0.299 * key_rgb.r + 0.587 * key_rgb.g + 0.114 * key_rgb.b;
        let key_cb = key_rgb.b - key_y;
        let key_cr = key_rgb.r - key_y;

        let key_chroma = vec2<f32>(key_cb, key_cr);
        let kc_len = length(key_chroma);

        if (kc_len > 0.001) {
            let key_dir = key_chroma / kc_len;
            let pixel_chroma = vec2<f32>(pixel_cb, pixel_cr);
            let spill_proj = max(dot(pixel_chroma, key_dir), 0.0);

            if (spill_proj > 0.0) {
                let suppress = min(spill_proj, kc_len) * despill_str;
                let new_cb = pixel_cb - key_dir.x * suppress;
                let new_cr = pixel_cr - key_dir.y * suppress;

                let r_new = new_cr + pixel_y;
                let b_new = new_cb + pixel_y;
                let g_new = pixel_y - 0.50934 * new_cr - 0.19418 * new_cb;
                let chroma_corrected = vec3<f32>(r_new, g_new, b_new);

                let bal = shader_options.despill_balance;
                let gray = vec3<f32>(pixel_y);
                let spill_proximity = clamp(spill_proj / (kc_len + 0.001), 0.0, 1.0);
                result_rgb = mix(chroma_corrected, gray, bal * spill_proximity * despill_str);
            }
        }
    }

    // ── Foreground Correction ──

    result_rgb = result_rgb + vec3<f32>(shader_options.fg_brightness);

    let fg_lum = 0.299 * result_rgb.r + 0.587 * result_rgb.g + 0.114 * result_rgb.b;
    result_rgb = mix(vec3<f32>(fg_lum), result_rgb, shader_options.fg_saturation);

    result_rgb = clamp(result_rgb, vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(result_rgb * alpha, alpha);
}
