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

// direction: 0=left, 1=right, 2=up, 3=down
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
    var uv = input.tex_coords;

    // Offset UV based on direction and progress
    if (dir < 0.5) {
        // slide-left: content slides in from the right
        uv.x = uv.x + (1.0 - p);
    } else if (dir < 1.5) {
        // slide-right: content slides in from the left
        uv.x = uv.x - (1.0 - p);
    } else if (dir < 2.5) {
        // slide-up: content slides in from the bottom
        uv.y = uv.y + (1.0 - p);
    } else {
        // slide-down: content slides in from the top
        uv.y = uv.y - (1.0 - p);
    }

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec4(0.0);
    }

    return textureSample(textures[0], sampler_, uv);
}
