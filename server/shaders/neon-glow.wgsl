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
    glow_color_r: f32,
    glow_color_g: f32,
    glow_color_b: f32,
    edge_threshold: f32,
    glow_intensity: f32,
    bloom_radius: f32,
    background_dim: f32,
    pulse_speed: f32,
    pulse_amount: f32,
}

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 1.0);
    output.tex_coords = input.tex_coords;
    return output;
}

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.299, 0.587, 0.114));
}

fn sample_lum(uv: vec2<f32>) -> f32 {
    let c = textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
    return luminance(c.rgb) * c.a;
}

fn sobel(uv: vec2<f32>, pixel: vec2<f32>) -> f32 {
    let tl = sample_lum(uv + vec2<f32>(-pixel.x, -pixel.y));
    let tc = sample_lum(uv + vec2<f32>(0.0, -pixel.y));
    let tr = sample_lum(uv + vec2<f32>(pixel.x, -pixel.y));
    let ml = sample_lum(uv + vec2<f32>(-pixel.x, 0.0));
    let mr = sample_lum(uv + vec2<f32>(pixel.x, 0.0));
    let bl = sample_lum(uv + vec2<f32>(-pixel.x, pixel.y));
    let bc = sample_lum(uv + vec2<f32>(0.0, pixel.y));
    let br = sample_lum(uv + vec2<f32>(pixel.x, pixel.y));

    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    return sqrt(gx * gx + gy * gy);
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

    let glow_color = vec3<f32>(shader_options.glow_color_r, shader_options.glow_color_g, shader_options.glow_color_b);
    let threshold = shader_options.edge_threshold;

    let pulse = 1.0 + shader_options.pulse_amount * sin(t * shader_options.pulse_speed * 6.28318);
    let intensity = shader_options.glow_intensity * pulse;

    let base = textureSample(textures[0], sampler_, uv);

    let edge = sobel(uv, pixel);
    let edge_mask = smoothstep(threshold, threshold + 0.1, edge);

    var bloom = 0.0;
    let bloom_r = shader_options.bloom_radius;
    let samples = 12;
    for (var i = 0; i < samples; i = i + 1) {
        let angle = f32(i) * 6.28318 / f32(samples);
        let offset = vec2<f32>(cos(angle), sin(angle)) * bloom_r * pixel;
        bloom = bloom + sobel(uv + offset, pixel);
    }
    bloom = bloom / f32(samples);
    let bloom_mask = smoothstep(threshold * 0.5, threshold + 0.15, bloom);

    var bloom_outer = 0.0;
    for (var i = 0; i < samples; i = i + 1) {
        let angle = f32(i) * 6.28318 / f32(samples) + 0.2618;
        let offset = vec2<f32>(cos(angle), sin(angle)) * bloom_r * 2.0 * pixel;
        bloom_outer = bloom_outer + sobel(uv + offset, pixel);
    }
    bloom_outer = bloom_outer / f32(samples);
    let bloom_outer_mask = smoothstep(threshold * 0.3, threshold + 0.2, bloom_outer);

    let total_glow = (edge_mask * 1.0 + bloom_mask * 0.5 + bloom_outer_mask * 0.25) * intensity;

    let dimmed = base.rgb * (1.0 - shader_options.background_dim);
    let result = dimmed + glow_color * total_glow;

    return vec4<f32>(result, base.a);
}
