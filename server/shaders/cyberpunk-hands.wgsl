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

// 21 landmarks per hand × 2 coords (x,y) × 2 hands = 84 + validity flags + style params
struct ShaderOptions {
    h1_valid: f32,
    h1_x0: f32, h1_y0: f32,
    h1_x1: f32, h1_y1: f32,
    h1_x2: f32, h1_y2: f32,
    h1_x3: f32, h1_y3: f32,
    h1_x4: f32, h1_y4: f32,
    h1_x5: f32, h1_y5: f32,
    h1_x6: f32, h1_y6: f32,
    h1_x7: f32, h1_y7: f32,
    h1_x8: f32, h1_y8: f32,
    h1_x9: f32, h1_y9: f32,
    h1_x10: f32, h1_y10: f32,
    h1_x11: f32, h1_y11: f32,
    h1_x12: f32, h1_y12: f32,
    h1_x13: f32, h1_y13: f32,
    h1_x14: f32, h1_y14: f32,
    h1_x15: f32, h1_y15: f32,
    h1_x16: f32, h1_y16: f32,
    h1_x17: f32, h1_y17: f32,
    h1_x18: f32, h1_y18: f32,
    h1_x19: f32, h1_y19: f32,
    h1_x20: f32, h1_y20: f32,
    h2_valid: f32,
    h2_x0: f32, h2_y0: f32,
    h2_x1: f32, h2_y1: f32,
    h2_x2: f32, h2_y2: f32,
    h2_x3: f32, h2_y3: f32,
    h2_x4: f32, h2_y4: f32,
    h2_x5: f32, h2_y5: f32,
    h2_x6: f32, h2_y6: f32,
    h2_x7: f32, h2_y7: f32,
    h2_x8: f32, h2_y8: f32,
    h2_x9: f32, h2_y9: f32,
    h2_x10: f32, h2_y10: f32,
    h2_x11: f32, h2_y11: f32,
    h2_x12: f32, h2_y12: f32,
    h2_x13: f32, h2_y13: f32,
    h2_x14: f32, h2_y14: f32,
    h2_x15: f32, h2_y15: f32,
    h2_x16: f32, h2_y16: f32,
    h2_x17: f32, h2_y17: f32,
    h2_x18: f32, h2_y18: f32,
    h2_x19: f32, h2_y19: f32,
    h2_x20: f32, h2_y20: f32,
    glow: f32,
    line_width: f32,
    dim: f32,
    color1_r: f32, color1_g: f32, color1_b: f32,
    color2_r: f32, color2_g: f32, color2_b: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<push_constant> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Hand 1 landmark accessor
fn h1(idx: i32) -> vec2<f32> {
    switch idx {
        case 0: { return vec2(shader_options.h1_x0, shader_options.h1_y0); }
        case 1: { return vec2(shader_options.h1_x1, shader_options.h1_y1); }
        case 2: { return vec2(shader_options.h1_x2, shader_options.h1_y2); }
        case 3: { return vec2(shader_options.h1_x3, shader_options.h1_y3); }
        case 4: { return vec2(shader_options.h1_x4, shader_options.h1_y4); }
        case 5: { return vec2(shader_options.h1_x5, shader_options.h1_y5); }
        case 6: { return vec2(shader_options.h1_x6, shader_options.h1_y6); }
        case 7: { return vec2(shader_options.h1_x7, shader_options.h1_y7); }
        case 8: { return vec2(shader_options.h1_x8, shader_options.h1_y8); }
        case 9: { return vec2(shader_options.h1_x9, shader_options.h1_y9); }
        case 10: { return vec2(shader_options.h1_x10, shader_options.h1_y10); }
        case 11: { return vec2(shader_options.h1_x11, shader_options.h1_y11); }
        case 12: { return vec2(shader_options.h1_x12, shader_options.h1_y12); }
        case 13: { return vec2(shader_options.h1_x13, shader_options.h1_y13); }
        case 14: { return vec2(shader_options.h1_x14, shader_options.h1_y14); }
        case 15: { return vec2(shader_options.h1_x15, shader_options.h1_y15); }
        case 16: { return vec2(shader_options.h1_x16, shader_options.h1_y16); }
        case 17: { return vec2(shader_options.h1_x17, shader_options.h1_y17); }
        case 18: { return vec2(shader_options.h1_x18, shader_options.h1_y18); }
        case 19: { return vec2(shader_options.h1_x19, shader_options.h1_y19); }
        case 20: { return vec2(shader_options.h1_x20, shader_options.h1_y20); }
        default: { return vec2(0.0, 0.0); }
    }
}

// Hand 2 landmark accessor
fn h2(idx: i32) -> vec2<f32> {
    switch idx {
        case 0: { return vec2(shader_options.h2_x0, shader_options.h2_y0); }
        case 1: { return vec2(shader_options.h2_x1, shader_options.h2_y1); }
        case 2: { return vec2(shader_options.h2_x2, shader_options.h2_y2); }
        case 3: { return vec2(shader_options.h2_x3, shader_options.h2_y3); }
        case 4: { return vec2(shader_options.h2_x4, shader_options.h2_y4); }
        case 5: { return vec2(shader_options.h2_x5, shader_options.h2_y5); }
        case 6: { return vec2(shader_options.h2_x6, shader_options.h2_y6); }
        case 7: { return vec2(shader_options.h2_x7, shader_options.h2_y7); }
        case 8: { return vec2(shader_options.h2_x8, shader_options.h2_y8); }
        case 9: { return vec2(shader_options.h2_x9, shader_options.h2_y9); }
        case 10: { return vec2(shader_options.h2_x10, shader_options.h2_y10); }
        case 11: { return vec2(shader_options.h2_x11, shader_options.h2_y11); }
        case 12: { return vec2(shader_options.h2_x12, shader_options.h2_y12); }
        case 13: { return vec2(shader_options.h2_x13, shader_options.h2_y13); }
        case 14: { return vec2(shader_options.h2_x14, shader_options.h2_y14); }
        case 15: { return vec2(shader_options.h2_x15, shader_options.h2_y15); }
        case 16: { return vec2(shader_options.h2_x16, shader_options.h2_y16); }
        case 17: { return vec2(shader_options.h2_x17, shader_options.h2_y17); }
        case 18: { return vec2(shader_options.h2_x18, shader_options.h2_y18); }
        case 19: { return vec2(shader_options.h2_x19, shader_options.h2_y19); }
        case 20: { return vec2(shader_options.h2_x20, shader_options.h2_y20); }
        default: { return vec2(0.0, 0.0); }
    }
}

// Distance from point p to line segment ab
fn dist_to_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let ap = p - a;
    let len_sq = dot(ab, ab);
    if len_sq < 0.000001 {
        return length(ap);
    }
    let t = clamp(dot(ap, ab) / len_sq, 0.0, 1.0);
    let proj = a + ab * t;
    return length(p - proj);
}

// 20 bones of the hand skeleton (MediaPipe topology)
const BONE_A = array<i32, 20>(0,1,2,3, 0,5,6,7, 0,9,10,11, 0,13,14,15, 0,17,18,19);
const BONE_B = array<i32, 20>(1,2,3,4, 5,6,7,8, 9,10,11,12, 13,14,15,16, 17,18,19,20);

fn draw_hand(
    uv: vec2<f32>,
    get_lm: i32,
    line_color: vec3<f32>,
    dot_color: vec3<f32>,
    lw: f32,
    pulse: f32,
) -> vec4<f32> {
    var result = vec4(0.0, 0.0, 0.0, 0.0);
    let effective_lw = lw * (0.8 + 0.4 * pulse);

    // Bones (neon lines)
    for (var i = 0; i < 20; i = i + 1) {
        var a: vec2<f32>;
        var b: vec2<f32>;
        if get_lm == 1 {
            a = h1(BONE_A[i]);
            b = h1(BONE_B[i]);
        } else {
            a = h2(BONE_A[i]);
            b = h2(BONE_B[i]);
        }
        let d = dist_to_segment(uv, a, b);
        let glow_width = effective_lw * 3.0;
        let core = smoothstep(effective_lw, effective_lw * 0.3, d);
        let outer = smoothstep(glow_width, effective_lw, d) * 0.4 * shader_options.glow;
        let intensity = core + outer;
        if intensity > 0.001 {
            result = vec4(
                max(result.r, line_color.r * intensity),
                max(result.g, line_color.g * intensity),
                max(result.b, line_color.b * intensity),
                max(result.a, intensity),
            );
        }
    }

    // Landmark dots
    for (var i = 0; i < 21; i = i + 1) {
        var lm: vec2<f32>;
        if get_lm == 1 {
            lm = h1(i);
        } else {
            lm = h2(i);
        }
        let d = length(uv - lm);
        let dot_radius = effective_lw * 1.5;
        let glow_radius = dot_radius * 3.0;
        let core = smoothstep(dot_radius, dot_radius * 0.2, d);
        let outer = smoothstep(glow_radius, dot_radius, d) * 0.5 * shader_options.glow;
        let intensity = core + outer;
        if intensity > 0.001 {
            result = vec4(
                max(result.r, dot_color.r * intensity),
                max(result.g, dot_color.g * intensity),
                max(result.b, dot_color.b * intensity),
                max(result.a, intensity),
            );
        }
    }

    return result;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let res = vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));

    // Sample source texture (child InputStream)
    var src = textureSample(textures[0], sampler_, uv);

    // Dim source video
    let dim_factor = clamp(1.0 - shader_options.dim, 0.0, 1.0);
    let tint = vec3(0.05, 0.02, 0.1);
    src = vec4(src.rgb * dim_factor + tint * shader_options.dim * 0.3, src.a);

    // Scanlines
    let scanline_y = uv.y * res.y;
    let scanline = 1.0 - 0.08 * step(0.5, fract(scanline_y / 3.0));
    src = vec4(src.rgb * scanline, src.a);

    // Time-based pulse
    let pulse = 0.5 + 0.5 * sin(base_params.time * 3.0);

    let line_color = vec3(shader_options.color1_r, shader_options.color1_g, shader_options.color1_b);
    let dot_color = vec3(shader_options.color2_r, shader_options.color2_g, shader_options.color2_b);
    let lw = shader_options.line_width;

    var overlay = vec4(0.0, 0.0, 0.0, 0.0);

    if shader_options.h1_valid > 0.5 {
        let h = draw_hand(uv, 1, line_color, dot_color, lw, pulse);
        overlay = vec4(
            max(overlay.r, h.r),
            max(overlay.g, h.g),
            max(overlay.b, h.b),
            max(overlay.a, h.a),
        );
    }

    if shader_options.h2_valid > 0.5 {
        let h = draw_hand(uv, 2, line_color, dot_color, lw, pulse);
        overlay = vec4(
            max(overlay.r, h.r),
            max(overlay.g, h.g),
            max(overlay.b, h.b),
            max(overlay.a, h.a),
        );
    }

    let final_color = mix(src.rgb, overlay.rgb, clamp(overlay.a, 0.0, 1.0));
    return vec4(final_color, src.a);
}
