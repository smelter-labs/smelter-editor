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
    // Stroke width in pixels (0..inf)
    stroke_width_px: f32,
    // Softness of the stroke falloff in pixels (standard deviation of Gaussian weight)
    softness_px: f32,
    // Overall stroke opacity multiplier (0..1)
    opacity: f32,
    // Stroke color components (expanded from a single 'color' UI param)
    stroke_color_r: f32,
    stroke_color_g: f32,
    stroke_color_b: f32,
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

fn sample_alpha(uv: vec2<f32>) -> f32 {
    let c = textureSample(textures[0], sampler_, uv);
    return clamp(c.a, 0.0, 1.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Single-texture filter only.
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y)
    );

    let src = textureSample(textures[0], sampler_, uv);
    let src_a = clamp(src.a, 0.0, 1.0);

    let stroke_width_px = max(shader_options.stroke_width_px, 0.0);
    let softness_px = max(shader_options.softness_px, 0.001);
    let stroke_opacity = clamp(shader_options.opacity, 0.0, 1.0);

    // If stroke is effectively disabled, just passthrough.
    if (stroke_width_px <= 0.0 || stroke_opacity <= 0.0) {
        return src;
    }

    // Pixel size in UV space.
    let px = vec2<f32>(1.0 / res.x, 1.0 / res.y);

    // Directions around the current pixel where we look for alpha changes.
    let dirs = array<vec2<f32>, 8>(
        vec2<f32>( 1.0,  0.0), vec2<f32>(-1.0,  0.0),
        vec2<f32>( 0.0,  1.0), vec2<f32>( 0.0, -1.0),
        vec2<f32>( 0.7071,  0.7071), vec2<f32>(-0.7071,  0.7071),
        vec2<f32>( 0.7071, -0.7071), vec2<f32>(-0.7071, -0.7071)
    );

    // We march outwards along each direction up to stroke_width_px.
    let steps: i32 = 4;

    var edge_acc: f32 = 0.0;
    var weight_acc: f32 = 0.0;

    for (var i: i32 = 0; i < 8; i = i + 1) {
        let dir = normalize(dirs[i]);

        for (var s: i32 = 1; s <= steps; s = s + 1) {
            let t = f32(s) / f32(steps);
            let r_px = t * stroke_width_px;

            // Convert the step in pixels to UV using anisotropic pixel size.
            let off_uv = vec2<f32>(
                dir.x * r_px * px.x,
                dir.y * r_px * px.y
            );

            let sample_uv = clamp(uv + off_uv, vec2<f32>(0.0), vec2<f32>(1.0));
            let a_n = sample_alpha(sample_uv);

            // We care about difference between current alpha and neighbours:
            // large difference means we are near a transparency boundary.
            let diff = abs(a_n - src_a);

            // Gaussian weight based on distance, controlled by softness_px.
            let sigma = softness_px;
            let w = exp(- (r_px * r_px) / (2.0 * sigma * sigma));

            edge_acc = edge_acc + diff * w;
            weight_acc = weight_acc + w;
        }
    }

    var edge_factor: f32 = 0.0;
    if (weight_acc > 0.0) {
        edge_factor = clamp(edge_acc / weight_acc, 0.0, 1.0);
    }

    // Stroke should appear primarily on the transparent side of the edge:
    // multiply by (1 - src_a) so fully opaque pixels do not get overdrawn.
    var stroke_alpha = edge_factor * stroke_opacity * (1.0 - src_a);
    stroke_alpha = clamp(stroke_alpha, 0.0, 1.0);

    if (stroke_alpha <= 0.0) {
        return src;
    }

    let stroke_rgb = vec3<f32>(
        shader_options.stroke_color_r,
        shader_options.stroke_color_g,
        shader_options.stroke_color_b
    );

    let out_rgb = stroke_rgb * stroke_alpha + src.rgb * (1.0 - stroke_alpha);
    let out_a = max(src_a, stroke_alpha);

    return vec4<f32>(out_rgb, out_a);
}

