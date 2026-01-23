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
    
    let hsv_pixel = rgb_to_hsv(vec3<f32>(c.r, c.g, c.b));
    let hsv_target = rgb_to_hsv(target_rgb);
    
    let hue_diff = hue_distance(hsv_pixel.x, hsv_target.x);
    let sat_diff = abs(hsv_pixel.y - hsv_target.y);
    let val_diff = abs(hsv_pixel.z - hsv_target.z);
    
    let min_saturation = 0.2;
    let is_saturated = hsv_pixel.y > min_saturation && hsv_target.y > min_saturation;
    
    let tolerance = shader_options.tolerance;
    let hue_match = hue_diff < tolerance * 0.5;
    let sat_match = sat_diff < tolerance * 1.5;
    let val_match = val_diff < tolerance * 1.5;
    
    if (is_saturated && hue_match && sat_match && val_match) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    return c;
}


