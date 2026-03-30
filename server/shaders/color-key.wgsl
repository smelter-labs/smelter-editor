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
    tolerance: f32,
    softness: f32,
    highlight: f32,
    shadow: f32,
    pedestal: f32,
    choke: f32,
    contrast: f32,
    mid_point: f32,
    spill: f32,
    spill_range: f32,
    desaturate: f32,
    saturation: f32,
    hue: f32,
    luminance: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

fn rgb_to_ycbcr(rgb: vec3<f32>) -> vec3<f32> {
    let y  = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    let cb = rgb.b - y;
    let cr = rgb.r - y;
    return vec3<f32>(y, cb, cr);
}

fn ycbcr_to_rgb(ycbcr: vec3<f32>) -> vec3<f32> {
    let y  = ycbcr.x;
    let cb = ycbcr.y;
    let cr = ycbcr.z;
    let r = cr + y;
    let b = cb + y;
    let g = y - 0.50934 * cr - 0.19418 * cb;
    return vec3<f32>(r, g, b);
}

fn rotate_hue(rgb: vec3<f32>, angle: f32) -> vec3<f32> {
    let k = 0.57735026919;
    let axis = vec3<f32>(k, k, k);
    let cos_a = cos(angle);
    let sin_a = sin(angle);
    return rgb * cos_a + cross(axis, rgb) * sin_a + axis * dot(axis, rgb) * (1.0 - cos_a);
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

    let pixel_ycbcr = rgb_to_ycbcr(c.rgb);
    let key_ycbcr   = rgb_to_ycbcr(key_rgb);

    let pixel_y  = pixel_ycbcr.x;
    let pixel_cb = pixel_ycbcr.y;
    let pixel_cr = pixel_ycbcr.z;
    let key_cb   = key_ycbcr.y;
    let key_cr   = key_ycbcr.z;

    // ── Matte Generation ──
    let chroma_dist = length(vec2<f32>(pixel_cb - key_cb, pixel_cr - key_cr));

    let tol  = shader_options.tolerance;
    let soft = shader_options.softness;
    var alpha = smoothstep(tol, tol + soft + 0.001, chroma_dist);

    // Highlight protection: keep bright pixels from being keyed
    let hl = shader_options.highlight;
    if (hl > 0.0) {
        let hl_keep = smoothstep(1.0 - hl, 1.0, pixel_y);
        alpha = max(alpha, hl_keep);
    }

    // Shadow protection: keep dark pixels from being keyed
    let sh = shader_options.shadow;
    if (sh > 0.0) {
        let sh_keep = smoothstep(sh, 0.0, pixel_y);
        alpha = max(alpha, sh_keep);
    }

    // Pedestal: suppress low-level matte noise
    let ped = shader_options.pedestal;
    if (ped > 0.0) {
        alpha = clamp((alpha - ped) / (1.0 - ped + 0.001), 0.0, 1.0);
    }

    // ── Matte Cleanup ──

    // Choke: 0.5 = neutral, >0.5 shrinks matte (more edge removal), <0.5 expands
    let choke_bias = (shader_options.choke - 0.5) * 0.6;
    alpha = clamp(alpha - choke_bias, 0.0, 1.0);

    // Contrast around mid_point
    let mp = shader_options.mid_point;
    let ct = shader_options.contrast;
    alpha = clamp((alpha - mp) * ct + mp, 0.0, 1.0);

    // ── Spill Suppression ──
    var result_rgb = c.rgb;
    let spill_amt = shader_options.spill;
    let sr        = shader_options.spill_range;
    let desat     = shader_options.desaturate;

    if (spill_amt > 0.0 && alpha > 0.0) {
        let spill_proximity = 1.0 - smoothstep(0.0, sr + 0.001, chroma_dist);
        let effective_spill = spill_amt * spill_proximity;

        // Desaturate in spill zone
        let gray = vec3<f32>(pixel_y);
        result_rgb = mix(result_rgb, gray, desat * spill_proximity);

        // Suppress key color chroma: project pixel chroma onto key chroma
        // direction and reduce it
        let key_chroma = vec2<f32>(key_cb, key_cr);
        let key_chroma_len = length(key_chroma);
        if (key_chroma_len > 0.001) {
            let key_dir = key_chroma / key_chroma_len;
            let pixel_chroma = vec2<f32>(pixel_cb, pixel_cr);
            let proj = dot(pixel_chroma, key_dir);

            if (proj > 0.0) {
                let suppress = min(proj, key_chroma_len) * effective_spill;
                let new_chroma = pixel_chroma - key_dir * suppress;
                result_rgb = clamp(
                    ycbcr_to_rgb(vec3<f32>(pixel_y, new_chroma.x, new_chroma.y)),
                    vec3<f32>(0.0),
                    vec3<f32>(1.0)
                );
                // Re-apply desaturation on the spill-corrected result
                let corrected_y = 0.299 * result_rgb.r + 0.587 * result_rgb.g + 0.114 * result_rgb.b;
                result_rgb = mix(result_rgb, vec3<f32>(corrected_y), desat * spill_proximity);
            }
        }
    }

    // ── Color Correction ──

    // Luminance
    result_rgb = result_rgb * shader_options.luminance;

    // Saturation
    let lum = 0.299 * result_rgb.r + 0.587 * result_rgb.g + 0.114 * result_rgb.b;
    result_rgb = mix(vec3<f32>(lum), result_rgb, shader_options.saturation);

    // Hue rotation (0..1 → 0..2π)
    let hue_angle = shader_options.hue * 6.283185;
    if (abs(hue_angle) > 0.001) {
        result_rgb = rotate_hue(result_rgb, hue_angle);
    }

    result_rgb = clamp(result_rgb, vec3<f32>(0.0), vec3<f32>(1.0));

    let final_alpha = alpha * c.a;
    return vec4<f32>(result_rgb * final_alpha, final_alpha);
}
