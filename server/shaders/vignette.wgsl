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
    intensity: f32,
    radius: f32,
    softness: f32,
    roundness: f32,
    color_r: f32,
    color_g: f32,
    color_b: f32,
    center_x: f32,
    center_y: f32,
    opacity: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

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
    let original = textureSample(textures[0], sampler_, uv);
    let res = vec2<f32>(base_params.output_resolution);
    let aspect = res.x / res.y;

    let center = vec2<f32>(
        0.5 + shader_options.center_x * 0.5,
        0.5 + shader_options.center_y * 0.5
    );

    var delta = uv - center;

    let roundness = clamp(shader_options.roundness, 0.0, 1.0);
    let scale = mix(vec2<f32>(aspect, 1.0), vec2<f32>(1.0, 1.0), roundness);
    delta = delta * scale;

    let dist = length(delta);

    let radius = clamp(shader_options.radius, 0.0, 1.0);
    let softness = max(shader_options.softness, 0.001);
    let intensity = shader_options.intensity;

    let vignette = 1.0 - smoothstep(radius, radius + softness, dist) * intensity;

    let vig_color = vec3<f32>(shader_options.color_r, shader_options.color_g, shader_options.color_b);
    let op = clamp(shader_options.opacity, 0.0, 1.0);

    let result = mix(original.rgb, original.rgb * vignette + vig_color * (1.0 - vignette), op);

    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
}
