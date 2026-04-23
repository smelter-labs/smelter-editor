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
    slice_intensity: f32,
    slice_count: f32,
    rgb_split: f32,
    noise_intensity: f32,
    block_glitch: f32,
    speed: f32,
    scanline_alpha: f32,
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

fn hash(p: f32) -> f32 {
    return fract(sin(p * 127.1) * 43758.5453);
}

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn hash3(p: vec3<f32>) -> f32 {
    return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    var uv = input.tex_coords;
    let res = vec2<f32>(base_params.output_resolution);
    let pixel = 1.0 / res;
    let t = base_params.time * shader_options.speed;

    let time_block = floor(t * 6.0);
    let time_sub = floor(t * 17.0);

    // --- Horizontal slice displacement ---
    let slice_count = max(1.0, shader_options.slice_count);
    let slice_y = floor(uv.y * slice_count);
    let slice_hash = hash(slice_y + time_block * 13.37);
    let slice_active = hash(slice_y * 3.71 + time_sub * 0.97);

    if (slice_hash > 0.5 && slice_active > 0.55) {
        let displacement = (slice_hash - 0.5) * 2.0 * shader_options.slice_intensity;
        let dir = select(-1.0, 1.0, hash(slice_y + time_block * 7.13) > 0.5);
        uv.x = uv.x + displacement * dir;
    }

    // --- Vertical slice displacement (perpendicular variety) ---
    let vslice_count = max(1.0, slice_count * 0.6);
    let vslice_x = floor(uv.x * vslice_count);
    let vslice_hash = hash(vslice_x * 5.13 + time_block * 9.71);
    let vslice_active = hash(vslice_x * 2.31 + time_sub * 1.13);

    if (vslice_hash > 0.7 && vslice_active > 0.6) {
        let displacement = (vslice_hash - 0.7) * 1.5 * shader_options.slice_intensity;
        let dir = select(-1.0, 1.0, hash(vslice_x + time_block * 11.3) > 0.5);
        uv.y = uv.y + displacement * dir;
    }

    // --- Block glitch with varied sizes and directions ---
    let block_intensity = shader_options.block_glitch;
    let block_time_a = floor(t * 5.0);
    let block_time_b = floor(t * 11.0);

    // Large blocks (8x8 grid)
    let lblk = floor(uv * 8.0);
    let lblk_h = hash2(lblk + vec2<f32>(block_time_a * 1.17, block_time_a * 0.73));
    let lblk_thresh = 1.0 - block_intensity * 0.5;
    if (lblk_h > lblk_thresh) {
        let direction_sel = hash(lblk_h * 31.0 + block_time_a);
        if (direction_sel < 0.33) {
            uv.x = uv.x + (hash(lblk_h * 17.0) - 0.5) * 0.18;
        } else if (direction_sel < 0.66) {
            uv.y = uv.y + (hash(lblk_h * 23.0) - 0.5) * 0.12;
        } else {
            let diag = (hash(lblk_h * 17.0) - 0.5) * 0.12;
            uv = uv + vec2<f32>(diag, diag * 0.7);
        }
    }

    // Small blocks (20x20 grid) — rapid flicker
    let sblk = floor(uv * 20.0);
    let sblk_h = hash2(sblk + vec2<f32>(block_time_b * 2.31, block_time_b * 1.47));
    let sblk_thresh = 1.0 - block_intensity * 0.35;
    if (sblk_h > sblk_thresh) {
        let direction_sel = hash(sblk_h * 41.0 + block_time_b);
        if (direction_sel < 0.25) {
            uv.x = uv.x + (hash(sblk_h * 19.0) - 0.5) * 0.08;
        } else if (direction_sel < 0.5) {
            uv.y = uv.y + (hash(sblk_h * 29.0) - 0.5) * 0.06;
        } else if (direction_sel < 0.75) {
            let d = (hash(sblk_h * 37.0) - 0.5) * 0.06;
            uv = uv + vec2<f32>(d, -d);
        } else {
            let d = (hash(sblk_h * 43.0) - 0.5) * 0.06;
            uv = uv + vec2<f32>(d, d);
        }
    }

    // --- RGB split with directional variation ---
    let split = shader_options.rgb_split * pixel.x;
    let split_angle = hash(time_block * 5.31) * 6.2832;
    let split_dir = vec2<f32>(cos(split_angle), sin(split_angle)) * split;
    let split_dir2 = vec2<f32>(cos(split_angle + 2.094), sin(split_angle + 2.094)) * split;

    let r = textureSample(textures[0], sampler_, clamp(uv + split_dir, vec2<f32>(0.0), vec2<f32>(1.0))).r;
    let g = textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).g;
    let b = textureSample(textures[0], sampler_, clamp(uv + split_dir2, vec2<f32>(0.0), vec2<f32>(1.0))).b;
    let a = textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).a;

    var color = vec3<f32>(r, g, b);

    // --- Color inversion on some glitched blocks ---
    let inv_blk = floor(input.tex_coords * 12.0);
    let inv_h = hash2(inv_blk + vec2<f32>(block_time_a * 3.17, block_time_a * 2.41));
    if (inv_h > (1.0 - block_intensity * 0.15)) {
        color = vec3<f32>(1.0) - color;
    }

    // --- Subtle color tint shift on random rows ---
    let tint_row = floor(input.tex_coords.y * slice_count * 2.0);
    let tint_h = hash(tint_row + time_block * 4.73);
    if (tint_h > 0.88) {
        let tint_type = hash(tint_row + time_block * 1.37);
        if (tint_type < 0.33) {
            color = color * vec3<f32>(1.2, 0.9, 1.1);
        } else if (tint_type < 0.66) {
            color = color * vec3<f32>(0.9, 1.15, 1.2);
        } else {
            color = color * vec3<f32>(1.1, 1.15, 0.85);
        }
    }

    // --- Noise grain ---
    let grain = (noise(uv * res * 0.5 + vec2<f32>(t * 100.0, t * 73.0)) - 0.5) * shader_options.noise_intensity;
    color = color + vec3<f32>(grain);

    // --- Scanlines ---
    let scanline = sin(uv.y * res.y * 3.14159) * 0.5 + 0.5;
    let scanline_mask = 1.0 - shader_options.scanline_alpha * (1.0 - scanline);
    color = color * scanline_mask;

    // --- Flicker ---
    let flicker = 1.0 - 0.05 * hash(time_block * 3.7) - 0.02 * hash(time_sub * 2.1);
    color = color * flicker;

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), a);
}
