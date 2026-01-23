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
    // Perspective strength (0 = no perspective, 1 = strong perspective)
    perspective: f32,
    // Scale factor for the content (1.0 = original size)
    scale: f32,
    // Rotation angle in radians (tilt effect)
    rotation: f32,
    // Opacity of the content
    opacity: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

const PI: f32 = 3.1415926535;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Rotate a 2D point around origin
fn rotate2D(p: vec2<f32>, angle: f32) -> vec2<f32> {
    let cos_a = cos(angle);
    let sin_a = sin(angle);
    return vec2<f32>(
        cos_a * p.x - sin_a * p.y,
        sin_a * p.x + cos_a * p.y
    );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    
    // Get shader parameters
    let perspective_strength = clamp(shader_options.perspective, 0.0, 1.0);
    let scale = shader_options.scale;
    let rotation = shader_options.rotation;
    let opacity = clamp(shader_options.opacity, 0.0, 1.0);
    
    // Convert UV to centered coordinates (-0.5 to 0.5)
    let centered_uv = uv - vec2<f32>(0.5, 0.5);
    
    // Apply perspective transformation
    // The vanishing point is at the bottom center
    // Things at the top (uv.y = 0) appear smaller (further away)
    // Things at the bottom (uv.y = 1) appear larger (closer)
    // Perspective scale: smaller at top, larger at bottom
    // uv.y: 0.0 = top, 1.0 = bottom
    let perspective_scale = 1.0 - perspective_strength * (1.0 - uv.y);
    // Clamp to avoid division by zero
    let safe_perspective = max(perspective_scale, 0.1);
    
    // Auto-scale compensation: at the top (uv.y=0) perspective_scale = 1 - perspective_strength
    // To make the top fill the full height, we need to scale up by 1/(1-perspective_strength)
    let top_scale = 1.0 - perspective_strength;
    let auto_scale_factor = 1.0 / max(top_scale, 0.1);
    
    // Apply scale, perspective, and auto-compensation
    // Smaller perspective_scale means content appears further away (smaller)
    // We divide UV by the scale to achieve this effect
    let scaled_uv = centered_uv / (scale * safe_perspective * auto_scale_factor);
    
    // Apply rotation (tilt effect) around center
    let rotated_uv = rotate2D(scaled_uv, rotation);
    
    // Sample from the original texture position (no movement)
    let sample_uv = rotated_uv + vec2<f32>(0.5, 0.5);
    
    // Check if we're within texture bounds
    if (sample_uv.x < 0.0 || sample_uv.x > 1.0 || sample_uv.y < 0.0 || sample_uv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    
    // Sample the texture
    let color = textureSample(textures[0], sampler_, sample_uv);
    
    // Apply opacity
    return vec4<f32>(color.rgb, color.a * opacity);
}
