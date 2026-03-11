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
    hue_shift: f32,
    saturation: f32,
    lightness: f32,
    colorize_enable: f32,
    colorize_hue: f32,
    colorize_saturation: f32,
    mix_amount: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

fn rgb_to_hsl(c: vec3<f32>) -> vec3<f32> {
    let mx = max(c.r, max(c.g, c.b));
    let mn = min(c.r, min(c.g, c.b));
    let l = (mx + mn) * 0.5;
    if (mx == mn) {
        return vec3<f32>(0.0, 0.0, l);
    }
    let d = mx - mn;
    var s: f32;
    if (l > 0.5) {
        s = d / (2.0 - mx - mn);
    } else {
        s = d / (mx + mn);
    }
    var h: f32;
    if (mx == c.r) {
        h = (c.g - c.b) / d;
        if (c.g < c.b) { h = h + 6.0; }
    } else if (mx == c.g) {
        h = (c.b - c.r) / d + 2.0;
    } else {
        h = (c.r - c.g) / d + 4.0;
    }
    h = h / 6.0;
    return vec3<f32>(h, s, l);
}

fn hue_to_rgb(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t = t + 1.0; }
    if (t > 1.0) { t = t - 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5)        { return q; }
    if (t < 2.0 / 3.0)  { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
    let h = hsl.x;
    let s = hsl.y;
    let l = hsl.z;
    if (s == 0.0) {
        return vec3<f32>(l, l, l);
    }
    var q: f32;
    if (l < 0.5) {
        q = l * (1.0 + s);
    } else {
        q = l + s - l * s;
    }
    let p = 2.0 * l - q;
    return vec3<f32>(
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    );
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let original = textureSample(textures[0], sampler_, input.tex_coords);
    var hsl = rgb_to_hsl(original.rgb);

    if (shader_options.colorize_enable > 0.5) {
        hsl.x = shader_options.colorize_hue;
        hsl.y = clamp(shader_options.colorize_saturation, 0.0, 1.0);
    } else {
        hsl.x = fract(hsl.x + shader_options.hue_shift);
        hsl.y = clamp(hsl.y + shader_options.saturation, 0.0, 1.0);
    }

    hsl.z = clamp(hsl.z + shader_options.lightness, 0.0, 1.0);

    let adjusted = hsl_to_rgb(hsl);
    let mix_amt = clamp(shader_options.mix_amount, 0.0, 1.0);
    let result = mix(original.rgb, adjusted, mix_amt);

    return vec4<f32>(clamp(result, vec3<f32>(0.0), vec3<f32>(1.0)), original.a);
}
