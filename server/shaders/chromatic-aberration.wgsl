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
    offset_px: f32,
    angle: f32,
    falloff: f32,
    center_x: f32,
    center_y: f32,
    r_multiplier: f32,
    g_multiplier: f32,
    b_multiplier: f32,
    animated: f32,
    anim_speed: f32,
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
    let res = vec2<f32>(base_params.output_resolution);
    let pixel = 1.0 / res;

    let center = vec2<f32>(
        0.5 + shader_options.center_x * 0.5,
        0.5 + shader_options.center_y * 0.5
    );

    var angle = shader_options.angle;
    if (shader_options.animated > 0.5) {
        angle = angle + base_params.time * shader_options.anim_speed;
    }

    let dir = vec2<f32>(cos(angle), sin(angle));
    let offset = shader_options.offset_px;

    let dist_from_center = length(uv - center) * 2.0;
    let falloff = mix(1.0, dist_from_center, clamp(shader_options.falloff, 0.0, 1.0));

    let shift = dir * offset * pixel * falloff;

    let r = textureSample(textures[0], sampler_, uv + shift * shader_options.r_multiplier).r;
    let g = textureSample(textures[0], sampler_, uv).g * shader_options.g_multiplier / max(shader_options.g_multiplier, 0.001);
    let original_g = textureSample(textures[0], sampler_, uv).g;
    let b = textureSample(textures[0], sampler_, uv - shift * shader_options.b_multiplier).b;
    let a = textureSample(textures[0], sampler_, uv).a;

    return vec4<f32>(
        r * shader_options.r_multiplier,
        original_g * shader_options.g_multiplier,
        b * shader_options.b_multiplier,
        a
    );
}
