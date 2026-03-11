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
    strength: f32,
    radius_px: f32,
    threshold: f32,
    edge_detect_mix: f32,
    detail_boost: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
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
    let pixel = shader_options.radius_px / res;

    let center = textureSample(textures[0], sampler_, uv);

    let top    = textureSample(textures[0], sampler_, uv + vec2<f32>(0.0, -pixel.y));
    let bottom = textureSample(textures[0], sampler_, uv + vec2<f32>(0.0, pixel.y));
    let left   = textureSample(textures[0], sampler_, uv + vec2<f32>(-pixel.x, 0.0));
    let right  = textureSample(textures[0], sampler_, uv + vec2<f32>(pixel.x, 0.0));

    let tl = textureSample(textures[0], sampler_, uv + vec2<f32>(-pixel.x, -pixel.y));
    let tr = textureSample(textures[0], sampler_, uv + vec2<f32>(pixel.x, -pixel.y));
    let bl = textureSample(textures[0], sampler_, uv + vec2<f32>(-pixel.x, pixel.y));
    let br = textureSample(textures[0], sampler_, uv + vec2<f32>(pixel.x, pixel.y));

    let blur = (top.rgb + bottom.rgb + left.rgb + right.rgb + tl.rgb + tr.rgb + bl.rgb + br.rgb) / 8.0;

    let detail = center.rgb - blur;

    let detail_lum = abs(luminance(detail));
    let threshold = shader_options.threshold;
    let mask = smoothstep(threshold * 0.5, threshold, detail_lum);

    let boost = shader_options.detail_boost;
    let sharpened = center.rgb + detail * shader_options.strength * mask * boost;

    let edge = abs(detail) * 4.0;
    let edge_mix = clamp(shader_options.edge_detect_mix, 0.0, 1.0);
    let result = mix(sharpened, edge, edge_mix);

    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), center.a);
}
