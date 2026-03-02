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
    // Effect type: 0=none, 1=pulse_glow, 2=flash, 3=shake, 4=color_shift, 5=ripple, 6=vignette_pulse, 7=chromatic_burst, 8=pixelate
    effect_type: f32,
    // Overall intensity (0..1)
    intensity: f32,
    // Effect color (RGB, each 0..1)
    effect_color_r: f32,
    effect_color_g: f32,
    effect_color_b: f32,
    // Progress through the effect (0..1)
    progress: f32,
}

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

const PI: f32 = 3.141592653589793;
const PI2: f32 = 6.28318530718;

fn hash(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 1.0);
    output.tex_coords = input.tex_coords;
    return output;
}

// Effect 1: Pulsing glow that fades with progress
fn apply_pulse_glow(color: vec4<f32>, uv: vec2<f32>, t: f32, intensity: f32, progress: f32, effect_color: vec3<f32>) -> vec4<f32> {
    let fade = 1.0 - progress;
    let pulse = 0.5 + 0.5 * sin(t * PI2 * 3.0);
    let glow_strength = intensity * fade * pulse;
    let glowed = mix(color.rgb, effect_color, glow_strength * 0.4);
    let brightened = glowed * (1.0 + glow_strength * 0.6);
    return vec4<f32>(brightened, color.a);
}

// Effect 2: Quick flash that fades
fn apply_flash(color: vec4<f32>, intensity: f32, progress: f32, effect_color: vec3<f32>) -> vec4<f32> {
    let fade = pow(1.0 - progress, 3.0);
    let flash_strength = intensity * fade;
    let flash_color = mix(effect_color, vec3<f32>(1.0, 1.0, 1.0), 0.5);
    let flashed = mix(color.rgb, flash_color, flash_strength);
    return vec4<f32>(flashed, color.a);
}

// Effect 3: Screen shake via UV distortion
fn apply_shake(uv: vec2<f32>, t: f32, intensity: f32, progress: f32, res: vec2<f32>) -> vec2<f32> {
    let fade = 1.0 - progress;
    let shake_amount = intensity * fade * 0.02;
    let offset_x = shake_amount * sin(t * 47.0 + 3.0) * cos(t * 23.0);
    let offset_y = shake_amount * cos(t * 31.0 + 7.0) * sin(t * 19.0);
    return clamp(uv + vec2<f32>(offset_x, offset_y), vec2<f32>(0.0), vec2<f32>(1.0));
}

// Effect 4: Color shift / tint toward effect_color
fn apply_color_shift(color: vec4<f32>, t: f32, intensity: f32, progress: f32, effect_color: vec3<f32>) -> vec4<f32> {
    let fade = 1.0 - progress;
    let pulse = 0.5 + 0.5 * sin(t * PI2 * 2.0);
    let shift_strength = intensity * fade * pulse;
    let shifted = mix(color.rgb, effect_color * dot(color.rgb, vec3<f32>(0.299, 0.587, 0.114)), shift_strength);
    return vec4<f32>(shifted, color.a);
}

// Effect 5: Circular ripple distortion from center
fn apply_ripple(uv: vec2<f32>, t: f32, intensity: f32, progress: f32, res: vec2<f32>) -> vec2<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let aspect = res.x / res.y;
    let corrected = vec2<f32>((uv.x - center.x) * aspect, uv.y - center.y);
    let dist = length(corrected);
    let fade = 1.0 - progress;
    let wave = sin(dist * 30.0 - t * 8.0) * intensity * fade * 0.015;
    let direction = normalize(corrected + vec2<f32>(0.0001, 0.0001));
    let offset = direction * wave;
    return clamp(uv + vec2<f32>(offset.x / aspect, offset.y), vec2<f32>(0.0), vec2<f32>(1.0));
}

// Effect 6: Pulsing dark vignette around edges
fn apply_vignette_pulse(color: vec4<f32>, uv: vec2<f32>, t: f32, intensity: f32, progress: f32, effect_color: vec3<f32>) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let dist = length(uv - center) * 1.414;
    let pulse = 0.5 + 0.5 * sin(t * PI2 * 2.0);
    let vignette_radius = 0.3 + 0.4 * (1.0 - intensity * (0.5 + 0.5 * pulse));
    let vignette = smoothstep(vignette_radius, vignette_radius + 0.5, dist);
    let fade = 0.3 + 0.7 * (1.0 - progress);
    let darkened = mix(color.rgb, effect_color * 0.1, vignette * intensity * fade);
    return vec4<f32>(darkened, color.a);
}

// Effect 7: Chromatic aberration burst
fn apply_chromatic_burst(uv: vec2<f32>, t: f32, intensity: f32, progress: f32, res: vec2<f32>) -> vec4<f32> {
    let envelope = sin(progress * PI);
    let ca_amount = intensity * envelope * 8.0 / res.x;
    let center = vec2<f32>(0.5, 0.5);
    let direction = uv - center;
    let uv_r = uv + direction * ca_amount;
    let uv_g = uv;
    let uv_b = uv - direction * ca_amount;
    let r = textureSample(textures[0], sampler_, clamp(uv_r, vec2<f32>(0.0), vec2<f32>(1.0))).r;
    let g = textureSample(textures[0], sampler_, clamp(uv_g, vec2<f32>(0.0), vec2<f32>(1.0))).g;
    let b = textureSample(textures[0], sampler_, clamp(uv_b, vec2<f32>(0.0), vec2<f32>(1.0))).b;
    let a = textureSample(textures[0], sampler_, uv).a;
    return vec4<f32>(r, g, b, a);
}

// Effect 8: Pixelation effect
fn apply_pixelate(uv: vec2<f32>, intensity: f32, progress: f32, res: vec2<f32>) -> vec2<f32> {
    let envelope = sin(progress * PI);
    let pixel_count = max(4.0, mix(res.x, 4.0, intensity * envelope));
    let pixel_size = res / pixel_count;
    let pixelated = floor(uv * pixel_size) / pixel_size;
    return pixelated;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4(0.0, 0.0, 0.0, 0.0);
    }

    let res = vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));
    let t = base_params.time;
    let effect_type = shader_options.effect_type;
    let intensity = shader_options.intensity;
    let progress = shader_options.progress;
    let effect_color = vec3<f32>(shader_options.effect_color_r, shader_options.effect_color_g, shader_options.effect_color_b);

    var uv = input.tex_coords;

    // Effect 0: none — pass through
    if (effect_type < 0.5) {
        return textureSample(textures[0], sampler_, uv);
    }

    // UV-distortion effects applied before sampling
    if (effect_type > 2.5 && effect_type < 3.5) {
        // Shake
        uv = apply_shake(uv, t, intensity, progress, res);
    } else if (effect_type > 4.5 && effect_type < 5.5) {
        // Ripple
        uv = apply_ripple(uv, t, intensity, progress, res);
    } else if (effect_type > 7.5 && effect_type < 8.5) {
        // Pixelate
        uv = apply_pixelate(uv, intensity, progress, res);
    }

    // Chromatic burst handles its own sampling
    if (effect_type > 6.5 && effect_type < 7.5) {
        return apply_chromatic_burst(uv, t, intensity, progress, res);
    }

    var color = textureSample(textures[0], sampler_, uv);

    // Color-modification effects applied after sampling
    if (effect_type > 0.5 && effect_type < 1.5) {
        color = apply_pulse_glow(color, uv, t, intensity, progress, effect_color);
    } else if (effect_type > 1.5 && effect_type < 2.5) {
        color = apply_flash(color, intensity, progress, effect_color);
    } else if (effect_type > 3.5 && effect_type < 4.5) {
        color = apply_color_shift(color, t, intensity, progress, effect_color);
    } else if (effect_type > 5.5 && effect_type < 6.5) {
        color = apply_vignette_pulse(color, uv, t, intensity, progress, effect_color);
    }

    return color;
}
