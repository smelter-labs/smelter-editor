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
    radius: f32,
    strength: f32,
    direction_x: f32,
    direction_y: f32,
    preserve_alpha: f32,
    quality: f32,
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

    let radius = clamp(shader_options.radius, 0.0, 50.0);
    let strength = clamp(shader_options.strength, 0.0, 1.0);
    let steps = i32(clamp(shader_options.quality, 1.0, 8.0));

    let dir_x = shader_options.direction_x;
    let dir_y = shader_options.direction_y;
    let is_directional = (dir_x > 0.001 || dir_y > 0.001);

    var color = vec4<f32>(0.0);
    var total_weight = 0.0;

    let sample_count = steps * 2 + 1;

    for (var i = -steps; i <= steps; i = i + 1) {
        let fi = f32(i);
        let weight = exp(-(fi * fi) / max(radius * 0.5, 0.001));

        if (is_directional) {
            let offset = vec2<f32>(dir_x, dir_y) * fi * radius * pixel;
            color = color + textureSample(textures[0], sampler_, uv + offset) * weight;
            total_weight = total_weight + weight;
        } else {
            for (var j = -steps; j <= steps; j = j + 1) {
                let fj = f32(j);
                let w2 = weight * exp(-(fj * fj) / max(radius * 0.5, 0.001));
                let offset = vec2<f32>(fi, fj) * radius * pixel;
                color = color + textureSample(textures[0], sampler_, uv + offset) * w2;
                total_weight = total_weight + w2;
            }
        }
    }

    var blurred = color / max(total_weight, 0.001);
    let original = textureSample(textures[0], sampler_, uv);

    var result = mix(original, blurred, strength);

    if (shader_options.preserve_alpha > 0.5) {
        result = vec4<f32>(result.rgb, original.a);
    }

    return result;
}
