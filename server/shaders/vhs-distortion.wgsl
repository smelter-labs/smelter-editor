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
    jitter_x_px: f32,
    jitter_y_px: f32,
    jitter_speed: f32,
    tape_warp: f32,
    color_bleed_px: f32,
    ghosting: f32,
    scanline_intensity: f32,
    scanline_density: f32,
    noise_intensity: f32,
    dropout_intensity: f32,
    chroma_noise: f32,
    tape_tint: f32,
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

fn hash1(x: f32) -> f32 {
    return fract(sin(x * 127.1) * 43758.5453);
}

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(base_params.output_resolution);
    let pixel = 1.0 / res;
    let t = base_params.time;

    // Tape tracking wobble: slowly drifting horizontal shift with a subtle vertical phase.
    let tracking_phase = uv.y * 18.0 + t * shader_options.jitter_speed;
    let tracking_gate = 0.55 + 0.45 * sin(t * shader_options.jitter_speed * 0.35);
    let jitter_x = (shader_options.jitter_x_px * pixel.x) * sin(tracking_phase) * tracking_gate;
    let jitter_y = (shader_options.jitter_y_px * pixel.y) *
        sin(t * shader_options.jitter_speed * 1.3 + uv.x * 24.0);

    // High-frequency tape warp lines.
    let warp = shader_options.tape_warp * 0.0025 *
        sin((uv.y + t * 0.23) * 140.0 + sin(t * 0.9) * 7.0);

    let distorted_uv = clamp(
        uv + vec2<f32>(jitter_x + warp, jitter_y),
        vec2<f32>(0.0),
        vec2<f32>(1.0),
    );

    let chroma_jitter = (hash2(vec2<f32>(floor(uv.y * res.y * 0.25), floor(t * 30.0))) - 0.5) *
        shader_options.chroma_noise *
        2.0;
    let bleed = shader_options.color_bleed_px * pixel.x * (1.0 + 0.35 * chroma_jitter);

    let center_sample = textureSample(textures[0], sampler_, distorted_uv);
    let ghost_sample = textureSample(
        textures[0],
        sampler_,
        clamp(distorted_uv - vec2<f32>(bleed * 2.0, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)),
    );

    let sample_r = textureSample(
        textures[0],
        sampler_,
        clamp(distorted_uv + vec2<f32>(bleed, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)),
    ).r;
    let sample_g = center_sample.g;
    let sample_b = textureSample(
        textures[0],
        sampler_,
        clamp(distorted_uv - vec2<f32>(bleed, 0.0), vec2<f32>(0.0), vec2<f32>(1.0)),
    ).b;

    var color = vec3<f32>(sample_r, sample_g, sample_b);
    color = mix(color, ghost_sample.rgb, clamp(shader_options.ghosting, 0.0, 1.0) * 0.6);

    // Per-line dropout events that dim and dirty horizontal strips.
    let dropout_line = floor(uv.y * res.y * 0.08 + t * 13.0);
    let dropout_rand = hash1(dropout_line * 1.73 + floor(t * 8.0));
    let dropout_active = step(1.0 - shader_options.dropout_intensity * 0.38, dropout_rand);
    let dropout_strength = dropout_active * (0.45 + 0.55 * hash1(dropout_line * 7.13));
    color = mix(color, color * vec3<f32>(0.12, 0.12, 0.12), dropout_strength);

    // VHS-style scanlines.
    let scan_density = max(0.1, shader_options.scanline_density);
    let scan = 0.5 + 0.5 * sin((uv.y * res.y * scan_density) + t * 22.0);
    let scan_mask = 1.0 - shader_options.scanline_intensity * (1.0 - scan);
    color = color * scan_mask;

    // Analog grain/static.
    let grain = hash2(floor(distorted_uv * res * 0.7) + vec2<f32>(floor(t * 120.0), floor(t * 80.0))) - 0.5;
    color = color + vec3<f32>(grain * shader_options.noise_intensity);

    // Slight warm-magenta tape tint to push retro palette.
    let tint_target = vec3<f32>(
        color.r * 1.03,
        color.g * 0.99,
        color.b * 0.93 + 0.015,
    );
    color = mix(color, tint_target, clamp(shader_options.tape_tint, 0.0, 1.0));

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), center_sample.a);
}
