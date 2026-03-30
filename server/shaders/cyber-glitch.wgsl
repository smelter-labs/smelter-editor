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
    slice_intensity: f32,
    slice_count: f32,
    rgb_split: f32,
    noise_intensity: f32,
    block_glitch: f32,
    speed: f32,
    scanline_alpha: f32,
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

fn hash(p: f32) -> f32 {
    return fract(sin(p * 127.1) * 43758.5453);
}

fn hash2(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    var uv = input.tex_coords;
    let res = vec2<f32>(base_params.output_resolution);
    let pixel = 1.0 / res;
    let t = base_params.time * shader_options.speed;

    let time_block = floor(t * 4.0);

    let slice_count = max(1.0, shader_options.slice_count);
    let slice_y = floor(uv.y * slice_count);
    let slice_hash = hash(slice_y + time_block * 13.37);

    if (slice_hash > 0.6) {
        let displacement = (slice_hash - 0.6) * 2.5 * shader_options.slice_intensity;
        let dir = select(-1.0, 1.0, hash(slice_y + time_block * 7.13) > 0.5);
        uv.x = uv.x + displacement * dir;
    }

    let block_x = floor(uv.x * 16.0);
    let block_y = floor(uv.y * 16.0);
    let block_hash = hash2(vec2<f32>(block_x, block_y) + vec2<f32>(time_block));
    if (block_hash > (1.0 - shader_options.block_glitch * 0.3)) {
        let offset_x = (hash(block_hash * 17.0 + time_block) - 0.5) * 0.15;
        let offset_y = (hash(block_hash * 23.0 + time_block) - 0.5) * 0.08;
        uv = uv + vec2<f32>(offset_x, offset_y);
    }

    let split = shader_options.rgb_split * pixel.x;
    let r = textureSample(textures[0], sampler_, clamp(uv + vec2<f32>(split, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r;
    let g = textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).g;
    let b = textureSample(textures[0], sampler_, clamp(uv - vec2<f32>(split, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).b;
    let a = textureSample(textures[0], sampler_, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).a;

    var color = vec3<f32>(r, g, b);

    let grain = (noise(uv * res * 0.5 + vec2<f32>(t * 100.0, t * 73.0)) - 0.5) * shader_options.noise_intensity;
    color = color + vec3<f32>(grain);

    let scanline = sin(uv.y * res.y * 3.14159) * 0.5 + 0.5;
    let scanline_mask = 1.0 - shader_options.scanline_alpha * (1.0 - scanline);
    color = color * scanline_mask;

    let flicker = 1.0 - 0.04 * hash(time_block * 3.7);
    color = color * flicker;

    return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), a);
}
