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
    cells_x: f32,
    cells_y: f32,
    gap: f32,
    line_r: f32,
    line_g: f32,
    line_b: f32,
    line_a: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let res = vec2<f32>(base_params.output_resolution);
    let pixel = input.tex_coords * res;

    let cells_x = shader_options.cells_x;
    let cells_y = shader_options.cells_y;
    let gap = shader_options.gap;

    // Total size: cells * cell_size + (cells - 1) * gap = res
    // cell_size = (res - (cells - 1) * gap) / cells
    let cell_w = (res.x - (cells_x - 1.0) * gap) / cells_x;
    let cell_h = (res.y - (cells_y - 1.0) * gap) / cells_y;
    let stride_x = cell_w + gap;
    let stride_y = cell_h + gap;

    // Position within the repeating cell+gap pattern
    let mod_x = pixel.x % stride_x;
    let mod_y = pixel.y % stride_y;

    // A pixel is on a grid line if it falls in the gap region (after the cell)
    let on_gap_x = mod_x >= cell_w && pixel.x < res.x;
    let on_gap_y = mod_y >= cell_h && pixel.y < res.y;

    if (on_gap_x || on_gap_y) {
        return vec4<f32>(shader_options.line_r, shader_options.line_g, shader_options.line_b, shader_options.line_a);
    }

    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}
