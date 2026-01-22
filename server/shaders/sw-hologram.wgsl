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
    // Hologram tint color (RGB, each 0..1)
    tint_r: f32,
    tint_g: f32,
    tint_b: f32,
    // Overall hologram opacity (0..1)
    opacity: f32,
    // Scanline intensity (0..1)
    scanline_intensity: f32,
    // Scanline density (lines per output height)
    scanline_density: f32,
    // Scanline speed (scroll speed multiplier)
    scanline_speed: f32,
    // Flicker intensity (random brightness variation, 0..1)
    flicker_intensity: f32,
    // Flicker speed (Hz)
    flicker_speed: f32,
    // Chromatic aberration amount in pixels
    chromatic_aberration_px: f32,
    // Noise/static intensity (0..1)
    noise_intensity: f32,
    // Horizontal jitter amplitude in pixels
    jitter_x_px: f32,
    // Vertical jitter amplitude in pixels  
    jitter_y_px: f32,
    // Jitter speed (Hz)
    jitter_speed: f32,
    // Glow intensity (0..1)
    glow_intensity: f32,
    // Edge glow width (0..1, fraction of output)
    edge_glow_width: f32,
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

// Pseudo-random hash function
fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

// Noise function for flicker and static
fn noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hash(i + vec2<f32>(0.0, 0.0)), hash(i + vec2<f32>(1.0, 0.0)), u.x),
        mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
        u.y
    );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));
    let t = base_params.time;
    let pi2 = 6.28318530718;

    // Jitter offset
    let jitter_x = (shader_options.jitter_x_px / res.x) * sin(pi2 * shader_options.jitter_speed * t + uv.y * 20.0);
    let jitter_y = (shader_options.jitter_y_px / res.y) * cos(pi2 * shader_options.jitter_speed * t * 1.3 + uv.x * 15.0);
    let jittered_uv = uv + vec2<f32>(jitter_x, jitter_y);

    // Chromatic aberration - sample R, G, B channels with slight offset
    let ca_offset = shader_options.chromatic_aberration_px / res.x;
    let color_r = textureSample(textures[0], sampler_, jittered_uv + vec2<f32>(ca_offset, 0.0)).r;
    let color_g = textureSample(textures[0], sampler_, jittered_uv).g;
    let color_b = textureSample(textures[0], sampler_, jittered_uv - vec2<f32>(ca_offset, 0.0)).b;
    let color_a = textureSample(textures[0], sampler_, jittered_uv).a;
    
    // Convert to grayscale-ish luminance for hologram base
    let luminance = 0.299 * color_r + 0.587 * color_g + 0.114 * color_b;
    
    // Apply hologram tint color
    let tint = vec3<f32>(shader_options.tint_r, shader_options.tint_g, shader_options.tint_b);
    var holo_color = luminance * tint;

    // Scanlines - horizontal lines moving downward
    let scanline_phase = (uv.y * shader_options.scanline_density) - (t * shader_options.scanline_speed);
    let scanline = 1.0 - shader_options.scanline_intensity * 0.5 * (1.0 + sin(pi2 * scanline_phase));
    holo_color = holo_color * scanline;

    // Flicker effect - random brightness pulsing
    let flicker_noise = noise(vec2<f32>(t * shader_options.flicker_speed, 0.0));
    let flicker = 1.0 - shader_options.flicker_intensity * (flicker_noise - 0.5);
    holo_color = holo_color * flicker;

    // Static noise overlay
    let static_noise = noise(uv * res * 0.5 + vec2<f32>(t * 100.0, t * 73.0));
    holo_color = holo_color + shader_options.noise_intensity * (static_noise - 0.5) * tint;

    // Edge glow - brighter at the edges of visible content
    let edge_x = smoothstep(0.0, shader_options.edge_glow_width, uv.x) * 
                 smoothstep(0.0, shader_options.edge_glow_width, 1.0 - uv.x);
    let edge_y = smoothstep(0.0, shader_options.edge_glow_width, uv.y) * 
                 smoothstep(0.0, shader_options.edge_glow_width, 1.0 - uv.y);
    let edge_factor = 1.0 - edge_x * edge_y;
    holo_color = holo_color + shader_options.glow_intensity * edge_factor * tint * luminance;

    // Overall glow boost based on luminance
    holo_color = holo_color + shader_options.glow_intensity * 0.3 * luminance * tint;

    // Final alpha with opacity
    let final_alpha = color_a * shader_options.opacity;

    return vec4<f32>(holo_color, final_alpha);
}
