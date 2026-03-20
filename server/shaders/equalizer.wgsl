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
    band_0: f32,
    band_1: f32,
    band_2: f32,
    band_3: f32,
    band_4: f32,
    band_5: f32,
    band_6: f32,
    band_7: f32,
    band_8: f32,
    band_9: f32,
    band_10: f32,
    band_11: f32,
    band_12: f32,
    band_13: f32,
    band_14: f32,
    band_15: f32,
    bar_color_r: f32,
    bar_color_g: f32,
    bar_color_b: f32,
    bg_opacity: f32,
    glow: f32,
    gap: f32,
    bar_count: f32,
    smoothing: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

fn get_band(index: i32) -> f32 {
    switch index {
        case 0: { return shader_options.band_0; }
        case 1: { return shader_options.band_1; }
        case 2: { return shader_options.band_2; }
        case 3: { return shader_options.band_3; }
        case 4: { return shader_options.band_4; }
        case 5: { return shader_options.band_5; }
        case 6: { return shader_options.band_6; }
        case 7: { return shader_options.band_7; }
        case 8: { return shader_options.band_8; }
        case 9: { return shader_options.band_9; }
        case 10: { return shader_options.band_10; }
        case 11: { return shader_options.band_11; }
        case 12: { return shader_options.band_12; }
        case 13: { return shader_options.band_13; }
        case 14: { return shader_options.band_14; }
        case 15: { return shader_options.band_15; }
        default: { return 0.0; }
    }
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let bar_count = max(1.0, floor(shader_options.bar_count));
    let gap = clamp(shader_options.gap, 0.0, 0.9);

    let bar_width = 1.0 / bar_count;
    let bar_index = floor(uv.x / bar_width);
    let bar_local_x = (uv.x - bar_index * bar_width) / bar_width;

    // Gap: center the bar content within the cell
    let half_gap = gap * 0.5;
    let in_gap = bar_local_x < half_gap || bar_local_x > (1.0 - half_gap);

    // Map bar_index (0..bar_count-1) to band (0..15)
    let band_float = bar_index * 16.0 / bar_count;
    let band_low = i32(floor(band_float));
    let band_high = min(band_low + 1, 15);
    let t = band_float - floor(band_float);
    let band_value = mix(get_band(band_low), get_band(band_high), t);

    // Y axis: 0 = top, 1 = bottom in UV. Bars grow from bottom.
    let fill_y = 1.0 - uv.y;
    let bar_height = clamp(band_value, 0.0, 1.0);

    let bar_color = vec3<f32>(
        shader_options.bar_color_r,
        shader_options.bar_color_g,
        shader_options.bar_color_b
    );
    let bg_color = vec4<f32>(0.0, 0.0, 0.0, clamp(shader_options.bg_opacity, 0.0, 1.0));

    if in_gap {
        return bg_color;
    }

    if fill_y <= bar_height {
        // Glow: brighten near the top of the bar
        let glow_factor = 1.0 + shader_options.glow * smoothstep(bar_height - 0.15, bar_height, fill_y);
        let final_color = bar_color * glow_factor;
        return vec4<f32>(final_color, 1.0);
    }

    // Subtle glow above the bar
    let dist_above = fill_y - bar_height;
    let glow_range = 0.08 * shader_options.glow;
    if glow_range > 0.001 && dist_above < glow_range {
        let glow_alpha = (1.0 - dist_above / glow_range) * 0.4 * shader_options.glow;
        return vec4<f32>(bar_color * glow_alpha, glow_alpha);
    }

    return bg_color;
}
