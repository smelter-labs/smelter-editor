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

// Up to 16 bird sprites. Each box is supplied in tile space (0..1), already
// mapped through the same rescale 'fill' (cover) transform the video uses, so
// the shader can compare against tex_coords directly.
//   b{i}_cx, b{i}_cy  - box center
//   b{i}_hw, b{i}_hh  - box half-width / half-height
//   b{i}_color        - bird palette index (0..3)
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

// A few cheerful bird colors keyed by palette index.
fn bird_palette(idx: f32) -> vec3<f32> {
    let i = i32(round(idx)) % 4;
    if i == 0 { return vec3(0.15, 0.18, 0.22); }    // dark slate (classic silhouette)
    if i == 1 { return vec3(0.90, 0.30, 0.20); }    // red
    if i == 2 { return vec3(0.20, 0.55, 0.95); }    // blue
    return vec3(0.98, 0.80, 0.20);                  // yellow
}

// Renders one flapping bird ("M"/seagull silhouette + body) in the box's local
// space. Returns rgb + alpha (1 inside the bird). `t` animates the wing flap.
fn draw_bird(uv: vec2<f32>, b: Box, t: f32) -> vec4<f32> {
    if b.half.x <= 0.0001 || b.half.y <= 0.0001 {
        return vec4(0.0);
    }
    // Local coords: lx,ly in [-1,1]; ly = -1 top, +1 bottom.
    let lx = (uv.x - b.center.x) / b.half.x;
    let ly = (uv.y - b.center.y) / b.half.y;

    if abs(lx) > 1.1 || abs(ly) > 1.1 {
        return vec4(0.0);
    }

    // Wing flap: two humps (M shape) whose amplitude oscillates over time so the
    // wings beat up and down. Phase varies per sprite via the box center.
    let flap = 0.25 + 0.45 * sin(t * 9.0 + b.center.x * 40.0);
    // Centerline of the wings as a function of horizontal position: 0 at the
    // body, dipping to -flap at the wingtips (|lx| ~ 0.5), back up toward tips.
    let centerline = -flap * sin(clamp(abs(lx), 0.0, 1.0) * PI);
    let thickness = 0.16;
    let in_wing = abs(lx) <= 1.0 && abs(ly - centerline) <= thickness;

    // Rounded body blob at the center so the bird has a visible core.
    let body = vec2(lx / 0.28, (ly - 0.02) / 0.42);
    let in_body = dot(body, body) <= 1.0;

    if !in_wing && !in_body {
        return vec4(0.0);
    }

    return vec4(bird_palette(b.color), 1.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let src = textureSample(textures[0], sampler_, uv);

    // Background: desaturate then darken so the birds pop against the scene.
    let lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    let desat = mix(src.rgb, vec3(lum), clamp(shader_options.bg_desat, 0.0, 1.0));
    var color = desat * (1.0 - clamp(shader_options.bg_dim, 0.0, 1.0));

    let t = base_params.time;
    let count = i32(round(shader_options.box_count));
    for (var i = 0; i < 16; i = i + 1) {
        if i >= count {
            break;
        }
        let bird = draw_bird(uv, get_box(i), t);
        if bird.a > 0.5 {
            color = bird.rgb;
        }
    }

    return vec4(color, src.a);
}
