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
    edge_r: f32,
    edge_g: f32,
    edge_b: f32,
    edge_threshold: f32,
    line_brightness: f32,
    background_opacity: f32,
    glow_spread: f32,
    pulse_speed: f32,
    color_shift_speed: f32,
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

fn hue_to_rgb(h: f32) -> vec3<f32> {
    let r = abs(h * 6.0 - 3.0) - 1.0;
    let g = 2.0 - abs(h * 6.0 - 2.0);
    let b = 2.0 - abs(h * 6.0 - 4.0);
    return clamp(vec3<f32>(r, g, b), vec3<f32>(0.0), vec3<f32>(1.0));
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

    let base = textureSample(textures[0], sampler_, uv);
    let threshold = shader_options.edge_threshold;

    let pulse = 1.0 + 0.3 * sin(t * shader_options.pulse_speed * 6.28318);

    var edge_color = vec3<f32>(shader_options.edge_r, shader_options.edge_g, shader_options.edge_b);
    if (shader_options.color_shift_speed > 0.01) {
        let hue = fract(t * shader_options.color_shift_speed * 0.1);
        edge_color = hue_to_rgb(hue);
    }

    let edge = sobel(uv, pixel);
    let edge_mask = smoothstep(threshold, threshold + 0.08, edge);

    var glow = 0.0;
    let glow_r = shader_options.glow_spread;
    let samples = 10;
    for (var i = 0; i < samples; i = i + 1) {
        let angle = f32(i) * 6.28318 / f32(samples);
        let offset = vec2<f32>(cos(angle), sin(angle)) * glow_r * pixel;
        let s = sobel(uv + offset, pixel);
        glow = glow + smoothstep(threshold * 0.7, threshold + 0.1, s);
    }
    glow = glow / f32(samples);

    var glow_outer = 0.0;
    for (var i = 0; i < samples; i = i + 1) {
        let angle = f32(i) * 6.28318 / f32(samples) + 0.314;
        let offset = vec2<f32>(cos(angle), sin(angle)) * glow_r * 2.0 * pixel;
        let s = sobel(uv + offset, pixel);
        glow_outer = glow_outer + smoothstep(threshold * 0.5, threshold + 0.15, s);
    }
    glow_outer = glow_outer / f32(samples);

    let neon = (edge_mask + glow * 0.5 + glow_outer * 0.2) * shader_options.line_brightness * pulse;

    let bg = base.rgb * shader_options.background_opacity;
    let result = bg + edge_color * neon;

    return vec4<f32>(result, base.a);
}
