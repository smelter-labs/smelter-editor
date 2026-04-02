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
    zoom: f32,
    center_x: f32,
    center_y: f32,
    move_amount: f32,
    move_speed: f32,
    rotation_amount: f32,
    rotation_speed: f32,
    breathe_amount: f32,
    breathe_speed: f32,
    vignette: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

const PI: f32 = 3.1415926535;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Multi-octave organic noise built from phase-shifted sine waves.
// Produces smooth, non-repeating-looking motion without a noise texture.
fn organic_noise(t: f32, seed: f32) -> f32 {
    return sin(t * 1.0 + seed) * 0.5
         + sin(t * 2.3 + seed * 1.7) * 0.25
         + sin(t * 4.7 + seed * 3.1) * 0.125
         + sin(t * 7.1 + seed * 5.3) * 0.0625;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let t = base_params.time;
    let uv = input.tex_coords;

    let zoom = max(shader_options.zoom, 0.1);
    let center = vec2<f32>(
        clamp(shader_options.center_x, -1.0, 1.0) * 0.5,
        clamp(shader_options.center_y, -1.0, 1.0) * 0.5
    );
    let move_amount = clamp(shader_options.move_amount, 0.0, 1.0);
    let move_speed = shader_options.move_speed;
    let rotation_amount = shader_options.rotation_amount;
    let rotation_speed = shader_options.rotation_speed;
    let breathe_amount = clamp(shader_options.breathe_amount, 0.0, 1.0);
    let breathe_speed = shader_options.breathe_speed;
    let vignette_strength = clamp(shader_options.vignette, 0.0, 1.0);

    // Organic camera drift — two independent multi-octave sine curves
    let drift_x = organic_noise(t * move_speed, 0.0) * move_amount * 0.15;
    let drift_y = organic_noise(t * move_speed, 42.0) * move_amount * 0.15;

    // Breathing — slow zoom pulse that makes the frame feel alive
    let breathe = 1.0 + sin(t * breathe_speed * PI * 2.0) * breathe_amount * 0.1;
    let effective_zoom = zoom * breathe;

    // Organic rotation wobble
    let rot_angle = organic_noise(t * rotation_speed, 17.0) * rotation_amount * 0.02;

    // Center UV around origin
    var centered_uv = uv - vec2<f32>(0.5, 0.5);

    // Rotation
    let cos_r = cos(rot_angle);
    let sin_r = sin(rot_angle);
    centered_uv = vec2<f32>(
        cos_r * centered_uv.x - sin_r * centered_uv.y,
        sin_r * centered_uv.x + cos_r * centered_uv.y
    );

    // Zoom
    centered_uv = centered_uv / effective_zoom;

    // Apply center offset + organic drift, then return to UV space
    let final_uv = centered_uv + vec2<f32>(0.5, 0.5) + center + vec2<f32>(drift_x, drift_y);

    if (final_uv.x < 0.0 || final_uv.x > 1.0 || final_uv.y < 0.0 || final_uv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }

    var color = textureSample(textures[0], sampler_, final_uv);

    // Cinematic edge vignette
    if (vignette_strength > 0.001) {
        let vig_uv = uv - vec2<f32>(0.5, 0.5);
        let vig_dist = length(vig_uv) * 2.0;
        let vig = 1.0 - smoothstep(0.5, 1.4, vig_dist) * vignette_strength;
        color = vec4<f32>(color.rgb * vig, color.a);
    }

    return color;
}
