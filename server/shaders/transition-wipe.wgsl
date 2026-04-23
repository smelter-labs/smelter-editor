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

// direction: 0=left (wipe reveals left-to-right), 1=right (wipe reveals right-to-left)
struct ShaderOptions {
    progress: f32,
    direction: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) { return vec4(0.0); }

    let p = clamp(shader_options.progress, 0.0, 1.0);
    let dir = shader_options.direction;
    let c = textureSample(textures[0], sampler_, input.tex_coords);

    if (dir < 0.5) {
        // wipe-left: reveal from left to right
        if (input.tex_coords.x > p) {
            return vec4(0.0);
        }
    } else {
        // wipe-right: reveal from right to left
        if (input.tex_coords.x < (1.0 - p)) {
            return vec4(0.0);
        }
    }

    return c;
}
