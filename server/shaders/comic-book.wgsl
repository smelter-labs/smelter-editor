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
    edge_strength: f32,
    color_levels: f32,
    edge_threshold: f32,
    saturation_boost: f32,
    halftone_size: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.299, 0.587, 0.114));
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

    let original = textureSample(textures[0], sampler_, uv);

    // Sobel edge detection
    let tl = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(-px.x, -px.y)).rgb);
    let tc = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(0.0, -px.y)).rgb);
    let tr = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(px.x, -px.y)).rgb);
    let ml = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(-px.x, 0.0)).rgb);
    let mr = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(px.x, 0.0)).rgb);
    let bl = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(-px.x, px.y)).rgb);
    let bc = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(0.0, px.y)).rgb);
    let br = luma(textureSample(textures[0], sampler_, uv + vec2<f32>(px.x, px.y)).rgb);

    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    let edge = sqrt(gx * gx + gy * gy);

    let threshold = clamp(shader_options.edge_threshold, 0.0, 1.0);
    let strength = clamp(shader_options.edge_strength, 0.0, 3.0);
    let edge_factor = clamp((edge - threshold) * strength / max(1.0 - threshold, 0.001), 0.0, 1.0);

    // Posterize — quantize each channel to discrete levels
    let levels = clamp(shader_options.color_levels, 2.0, 16.0);
    let quantized = floor(original.rgb * levels + 0.5) / levels;

    // Saturation boost via mix with luminance
    let sat_boost = clamp(shader_options.saturation_boost, 0.0, 2.0);
    let gray = luma(quantized);
    let colored = mix(vec3<f32>(gray, gray, gray), quantized, sat_boost);

    // Optional halftone dots
    var result = colored;
    let dot_size = clamp(shader_options.halftone_size, 0.0, 20.0);
    if (dot_size > 0.5) {
        let grid = uv * res / dot_size;
        let cell_uv = fract(grid) - 0.5;
        let dist = length(cell_uv);
        let l = luma(colored);
        let dot_r = l * 0.5;
        let halftone = smoothstep(dot_r + 0.05, dot_r - 0.05, dist);
        result = mix(colored * 0.25, colored, halftone);
    }

    // Black ink outlines
    result = mix(result, vec3<f32>(0.0, 0.0, 0.0), edge_factor);

    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
}
