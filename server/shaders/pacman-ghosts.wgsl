enable wgpu_binding_array;

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

// Up to 16 detected people. Each box is supplied in tile space (0..1), already
// mapped through the same rescale 'fill' (cover) transform the video uses, so
// the shader can compare against tex_coords directly.
//   b{i}_cx, b{i}_cy  - box center
//   b{i}_hw, b{i}_hh  - box half-width / half-height
//   b{i}_color        - ghost palette index (0..3)
struct ShaderOptions {
    box_count: f32,
    bg_dim: f32,
    bg_desat: f32,
    b0_cx: f32, b0_cy: f32, b0_hw: f32, b0_hh: f32, b0_color: f32,
    b1_cx: f32, b1_cy: f32, b1_hw: f32, b1_hh: f32, b1_color: f32,
    b2_cx: f32, b2_cy: f32, b2_hw: f32, b2_hh: f32, b2_color: f32,
    b3_cx: f32, b3_cy: f32, b3_hw: f32, b3_hh: f32, b3_color: f32,
    b4_cx: f32, b4_cy: f32, b4_hw: f32, b4_hh: f32, b4_color: f32,
    b5_cx: f32, b5_cy: f32, b5_hw: f32, b5_hh: f32, b5_color: f32,
    b6_cx: f32, b6_cy: f32, b6_hw: f32, b6_hh: f32, b6_color: f32,
    b7_cx: f32, b7_cy: f32, b7_hw: f32, b7_hh: f32, b7_color: f32,
    b8_cx: f32, b8_cy: f32, b8_hw: f32, b8_hh: f32, b8_color: f32,
    b9_cx: f32, b9_cy: f32, b9_hw: f32, b9_hh: f32, b9_color: f32,
    b10_cx: f32, b10_cy: f32, b10_hw: f32, b10_hh: f32, b10_color: f32,
    b11_cx: f32, b11_cy: f32, b11_hw: f32, b11_hh: f32, b11_color: f32,
    b12_cx: f32, b12_cy: f32, b12_hw: f32, b12_hh: f32, b12_color: f32,
    b13_cx: f32, b13_cy: f32, b13_hw: f32, b13_hh: f32, b13_color: f32,
    b14_cx: f32, b14_cy: f32, b14_hw: f32, b14_hh: f32, b14_color: f32,
    b15_cx: f32, b15_cy: f32, b15_hw: f32, b15_hh: f32, b15_color: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

const PI: f32 = 3.14159265;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

struct Box {
    center: vec2<f32>,
    half: vec2<f32>,
    color: f32,
};

fn get_box(i: i32) -> Box {
    var b: Box;
    switch i {
        case 0:  { b.center = vec2(shader_options.b0_cx,  shader_options.b0_cy);  b.half = vec2(shader_options.b0_hw,  shader_options.b0_hh);  b.color = shader_options.b0_color; }
        case 1:  { b.center = vec2(shader_options.b1_cx,  shader_options.b1_cy);  b.half = vec2(shader_options.b1_hw,  shader_options.b1_hh);  b.color = shader_options.b1_color; }
        case 2:  { b.center = vec2(shader_options.b2_cx,  shader_options.b2_cy);  b.half = vec2(shader_options.b2_hw,  shader_options.b2_hh);  b.color = shader_options.b2_color; }
        case 3:  { b.center = vec2(shader_options.b3_cx,  shader_options.b3_cy);  b.half = vec2(shader_options.b3_hw,  shader_options.b3_hh);  b.color = shader_options.b3_color; }
        case 4:  { b.center = vec2(shader_options.b4_cx,  shader_options.b4_cy);  b.half = vec2(shader_options.b4_hw,  shader_options.b4_hh);  b.color = shader_options.b4_color; }
        case 5:  { b.center = vec2(shader_options.b5_cx,  shader_options.b5_cy);  b.half = vec2(shader_options.b5_hw,  shader_options.b5_hh);  b.color = shader_options.b5_color; }
        case 6:  { b.center = vec2(shader_options.b6_cx,  shader_options.b6_cy);  b.half = vec2(shader_options.b6_hw,  shader_options.b6_hh);  b.color = shader_options.b6_color; }
        case 7:  { b.center = vec2(shader_options.b7_cx,  shader_options.b7_cy);  b.half = vec2(shader_options.b7_hw,  shader_options.b7_hh);  b.color = shader_options.b7_color; }
        case 8:  { b.center = vec2(shader_options.b8_cx,  shader_options.b8_cy);  b.half = vec2(shader_options.b8_hw,  shader_options.b8_hh);  b.color = shader_options.b8_color; }
        case 9:  { b.center = vec2(shader_options.b9_cx,  shader_options.b9_cy);  b.half = vec2(shader_options.b9_hw,  shader_options.b9_hh);  b.color = shader_options.b9_color; }
        case 10: { b.center = vec2(shader_options.b10_cx, shader_options.b10_cy); b.half = vec2(shader_options.b10_hw, shader_options.b10_hh); b.color = shader_options.b10_color; }
        case 11: { b.center = vec2(shader_options.b11_cx, shader_options.b11_cy); b.half = vec2(shader_options.b11_hw, shader_options.b11_hh); b.color = shader_options.b11_color; }
        case 12: { b.center = vec2(shader_options.b12_cx, shader_options.b12_cy); b.half = vec2(shader_options.b12_hw, shader_options.b12_hh); b.color = shader_options.b12_color; }
        case 13: { b.center = vec2(shader_options.b13_cx, shader_options.b13_cy); b.half = vec2(shader_options.b13_hw, shader_options.b13_hh); b.color = shader_options.b13_color; }
        case 14: { b.center = vec2(shader_options.b14_cx, shader_options.b14_cy); b.half = vec2(shader_options.b14_hw, shader_options.b14_hh); b.color = shader_options.b14_color; }
        case 15: { b.center = vec2(shader_options.b15_cx, shader_options.b15_cy); b.half = vec2(shader_options.b15_hw, shader_options.b15_hh); b.color = shader_options.b15_color; }
        default: { b.center = vec2(0.0, 0.0); b.half = vec2(0.0, 0.0); b.color = 0.0; }
    }
    return b;
}

// Classic Pac-Man ghost palette: Blinky / Pinky / Inky / Clyde.
fn ghost_palette(idx: f32) -> vec3<f32> {
    let i = i32(round(idx)) % 4;
    if i == 0 { return vec3(1.0, 0.0, 0.0); }       // Blinky - red
    if i == 1 { return vec3(1.0, 0.72, 1.0); }      // Pinky - pink
    if i == 2 { return vec3(0.0, 1.0, 1.0); }       // Inky - cyan
    return vec3(1.0, 0.72, 0.32);                   // Clyde - orange
}

// Renders one ghost in the box's local space. Returns rgb + alpha (1 inside).
fn draw_ghost(uv: vec2<f32>, b: Box, t: f32) -> vec4<f32> {
    if b.half.x <= 0.0001 || b.half.y <= 0.0001 {
        return vec4(0.0);
    }
    // Local coords: lx,ly in [-1,1]; ly = -1 top, +1 bottom.
    let lx = (uv.x - b.center.x) / b.half.x;
    let ly = (uv.y - b.center.y) / b.half.y;

    if abs(lx) > 1.05 || abs(ly) > 1.1 {
        return vec4(0.0);
    }

    var inside = false;
    if ly < 0.0 {
        // Domed head: ellipse in normalized box space.
        inside = (lx * lx + ly * ly) <= 1.0;
    } else {
        // Straight sides with an animated scalloped skirt at the bottom.
        let scallop = abs(sin((lx * 0.5 + 0.5) * 4.0 * PI + t * 3.0));
        let bottom = 1.0 - 0.22 * scallop;
        inside = (abs(lx) <= 1.0) && (ly <= bottom);
    }
    if !inside {
        return vec4(0.0);
    }

    var col = ghost_palette(b.color);

    // Eyes: two white ellipses in the upper part of the body.
    let eye_y = -0.28;
    let eye_dx = 0.42;
    let eye_rx = 0.27;
    let eye_ry = 0.36;
    let le = vec2((lx + eye_dx) / eye_rx, (ly - eye_y) / eye_ry);
    let re = vec2((lx - eye_dx) / eye_rx, (ly - eye_y) / eye_ry);
    let in_left = dot(le, le) <= 1.0;
    let in_right = dot(re, re) <= 1.0;
    if in_left || in_right {
        col = vec3(1.0, 1.0, 1.0);
        // Pupils drift slightly over time for a "looking around" feel.
        let look = vec2(0.45 * sin(t * 1.5), 0.30 * sin(t * 1.1));
        let pr = 0.5;
        let pl_v = vec2((le.x - look.x) / pr, (le.y - look.y) / pr);
        let pr_v = vec2((re.x - look.x) / pr, (re.y - look.y) / pr);
        let pupil = (in_left && dot(pl_v, pl_v) <= 1.0) || (in_right && dot(pr_v, pr_v) <= 1.0);
        if pupil {
            col = vec3(0.13, 0.13, 0.86);
        }
    }

    return vec4(col, 1.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let src = textureSample(textures[0], sampler_, uv);

    // Background: desaturate then darken so the ghosts pop (arcade vibe).
    let lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    let desat = mix(src.rgb, vec3(lum), clamp(shader_options.bg_desat, 0.0, 1.0));
    var color = desat * (1.0 - clamp(shader_options.bg_dim, 0.0, 1.0));

    let t = base_params.time;
    let count = i32(round(shader_options.box_count));
    for (var i = 0; i < 16; i = i + 1) {
        if i >= count {
            break;
        }
        let g = draw_ghost(uv, get_box(i), t);
        if g.a > 0.5 {
            color = g.rgb;
        }
    }

    return vec4(color, src.a);
}
