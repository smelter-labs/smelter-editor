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
    target_color_r: f32,
    target_color_g: f32,
    target_color_b: f32,
    tolerance: f32,
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

fn rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let r = rgb.r;
    let g = rgb.g;
    let b = rgb.b;
    
    let max_c = max(r, max(g, b));
    let min_c = min(r, min(g, b));
    let delta = max_c - min_c;
    
    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let v: f32 = max_c;
    
    if (delta > 0.0001) {
        s = delta / max_c;
        
        if (max_c == r) {
            h = (g - b) / delta;
            if (g < b) {
                h = h + 6.0;
            }
        } else if (max_c == g) {
            h = 2.0 + (b - r) / delta;
        } else {
            h = 4.0 + (r - g) / delta;
        }
        h = h / 6.0;
    }
    
    return vec3<f32>(h, s, v);
}

fn hue_distance(h1: f32, h2: f32) -> f32 {
    let diff = abs(h1 - h2);
    return min(diff, 1.0 - diff);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let c = textureSample(textures[0], sampler_, input.tex_coords);
    let target_rgb = vec3<f32>(shader_options.target_color_r, 
                               shader_options.target_color_g, 
                               shader_options.target_color_b);

    // Compare in YCbCr-like chroma space — ignores brightness entirely.
    // Cb = B - Y, Cr = R - Y  (simplified, unnormalized)
    let pixel_y  = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    let pixel_cb = c.b - pixel_y;
    let pixel_cr = c.r - pixel_y;

    let target_y  = 0.299 * target_rgb.r + 0.587 * target_rgb.g + 0.114 * target_rgb.b;
    let target_cb = target_rgb.b - target_y;
    let target_cr = target_rgb.r - target_y;

    let dist = length(vec2<f32>(pixel_cb - target_cb, pixel_cr - target_cr));

    let tolerance = shader_options.tolerance;
    if (dist < tolerance) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    return c;
}


