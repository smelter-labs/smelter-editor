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
    hex_size: f32,
    border_color_r: f32,
    border_color_g: f32,
    border_color_b: f32,
    border_width: f32,
    border_glow: f32,
    background_dim: f32,
    pulse_speed: f32,
    pulse_amount: f32,
}

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 1.0);
    output.tex_coords = input.tex_coords;
    return output;
}

fn hex_center(hex_coord: vec2<f32>, size: vec2<f32>) -> vec2<f32> {
    return (hex_coord + 0.5) * size;
}

fn hex_dist(p: vec2<f32>) -> f32 {
    let q = abs(p);
    return max(q.x, (q.x * 0.5 + q.y * 0.866025));
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(base_params.output_resolution);
    let t = base_params.time;

    let hex_px = max(5.0, shader_options.hex_size);
    let hex_w = hex_px / res.x;
    let hex_h = hex_px / res.y * 0.866025;

    let col_f = uv.x / (hex_w * 0.75);
    let col = floor(col_f);
    let row_offset = select(0.0, 0.5, i32(col) % 2 != 0);
    let row_f = (uv.y / hex_h) - row_offset;
    let row = floor(row_f);

    var min_dist = 999.0;
    var best_center = vec2<f32>(0.0);

    for (var dc = -1; dc <= 1; dc = dc + 1) {
        for (var dr = -1; dr <= 1; dr = dr + 1) {
            let c = col + f32(dc);
            let r = row + f32(dr);
            let r_off = select(0.0, 0.5, i32(c) % 2 != 0);

            let cx = c * hex_w * 0.75 + hex_w * 0.5;
            let cy = (r + r_off + 0.5) * hex_h;
            let center = vec2<f32>(cx, cy);

            let delta = (uv - center) / vec2<f32>(hex_w * 0.5, hex_h * 0.5);
            let d = hex_dist(delta);

            if (d < min_dist) {
                min_dist = d;
                best_center = center;
            }
        }
    }

    let cell_color = textureSample(textures[0], sampler_, clamp(best_center, vec2<f32>(0.0), vec2<f32>(1.0)));

    let border_color = vec3<f32>(shader_options.border_color_r, shader_options.border_color_g, shader_options.border_color_b);
    let bw = shader_options.border_width;

    let pulse = 1.0 + shader_options.pulse_amount * sin(t * shader_options.pulse_speed * 6.28318);
    let glow_intensity = shader_options.border_glow * pulse;

    let border_edge = 1.0 - bw;
    let border_mask = smoothstep(border_edge - 0.05, border_edge, min_dist);
    let glow_mask = smoothstep(border_edge - 0.15, border_edge, min_dist) * (1.0 - border_mask) * 0.5;

    let dimmed = cell_color.rgb * (1.0 - shader_options.background_dim);
    let border_lit = border_color * glow_intensity;

    let result = dimmed * (1.0 - border_mask) + border_lit * border_mask + border_color * glow_mask * glow_intensity * 0.5;

    return vec4<f32>(result, cell_color.a);
}
