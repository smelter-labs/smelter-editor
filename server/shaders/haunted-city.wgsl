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

// Ghost City: up to 16 detected building regions, each an axis-aligned box in
// tile space (0..1), already mapped through the same rescale 'fill' (cover)
// transform the video uses so we can compare against tex_coords directly.
//   b{i}_x, b{i}_y  - box top-left
//   b{i}_w, b{i}_h  - box width / height
// Globals drive the haunt intensities (all 0..1 except flicker_speed).
struct ShaderOptions {
    box_count: f32,
    fog: f32,
    desat: f32,
    glow: f32,
    flicker_speed: f32,
    b0_x: f32, b0_y: f32, b0_w: f32, b0_h: f32,
    b1_x: f32, b1_y: f32, b1_w: f32, b1_h: f32,
    b2_x: f32, b2_y: f32, b2_w: f32, b2_h: f32,
    b3_x: f32, b3_y: f32, b3_w: f32, b3_h: f32,
    b4_x: f32, b4_y: f32, b4_w: f32, b4_h: f32,
    b5_x: f32, b5_y: f32, b5_w: f32, b5_h: f32,
    b6_x: f32, b6_y: f32, b6_w: f32, b6_h: f32,
    b7_x: f32, b7_y: f32, b7_w: f32, b7_h: f32,
    b8_x: f32, b8_y: f32, b8_w: f32, b8_h: f32,
    b9_x: f32, b9_y: f32, b9_w: f32, b9_h: f32,
    b10_x: f32, b10_y: f32, b10_w: f32, b10_h: f32,
    b11_x: f32, b11_y: f32, b11_w: f32, b11_h: f32,
    b12_x: f32, b12_y: f32, b12_w: f32, b12_h: f32,
    b13_x: f32, b13_y: f32, b13_w: f32, b13_h: f32,
    b14_x: f32, b14_y: f32, b14_w: f32, b14_h: f32,
    b15_x: f32, b15_y: f32, b15_w: f32, b15_h: f32,
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
    min: vec2<f32>,
    size: vec2<f32>,
};

fn get_box(i: i32) -> Box {
    var b: Box;
    switch i {
        case 0:  { b.min = vec2(shader_options.b0_x,  shader_options.b0_y);  b.size = vec2(shader_options.b0_w,  shader_options.b0_h); }
        case 1:  { b.min = vec2(shader_options.b1_x,  shader_options.b1_y);  b.size = vec2(shader_options.b1_w,  shader_options.b1_h); }
        case 2:  { b.min = vec2(shader_options.b2_x,  shader_options.b2_y);  b.size = vec2(shader_options.b2_w,  shader_options.b2_h); }
        case 3:  { b.min = vec2(shader_options.b3_x,  shader_options.b3_y);  b.size = vec2(shader_options.b3_w,  shader_options.b3_h); }
        case 4:  { b.min = vec2(shader_options.b4_x,  shader_options.b4_y);  b.size = vec2(shader_options.b4_w,  shader_options.b4_h); }
        case 5:  { b.min = vec2(shader_options.b5_x,  shader_options.b5_y);  b.size = vec2(shader_options.b5_w,  shader_options.b5_h); }
        case 6:  { b.min = vec2(shader_options.b6_x,  shader_options.b6_y);  b.size = vec2(shader_options.b6_w,  shader_options.b6_h); }
        case 7:  { b.min = vec2(shader_options.b7_x,  shader_options.b7_y);  b.size = vec2(shader_options.b7_w,  shader_options.b7_h); }
        case 8:  { b.min = vec2(shader_options.b8_x,  shader_options.b8_y);  b.size = vec2(shader_options.b8_w,  shader_options.b8_h); }
        case 9:  { b.min = vec2(shader_options.b9_x,  shader_options.b9_y);  b.size = vec2(shader_options.b9_w,  shader_options.b9_h); }
        case 10: { b.min = vec2(shader_options.b10_x, shader_options.b10_y); b.size = vec2(shader_options.b10_w, shader_options.b10_h); }
        case 11: { b.min = vec2(shader_options.b11_x, shader_options.b11_y); b.size = vec2(shader_options.b11_w, shader_options.b11_h); }
        case 12: { b.min = vec2(shader_options.b12_x, shader_options.b12_y); b.size = vec2(shader_options.b12_w, shader_options.b12_h); }
        case 13: { b.min = vec2(shader_options.b13_x, shader_options.b13_y); b.size = vec2(shader_options.b13_w, shader_options.b13_h); }
        case 14: { b.min = vec2(shader_options.b14_x, shader_options.b14_y); b.size = vec2(shader_options.b14_w, shader_options.b14_h); }
        case 15: { b.min = vec2(shader_options.b15_x, shader_options.b15_y); b.size = vec2(shader_options.b15_w, shader_options.b15_h); }
        default: { b.min = vec2(0.0, 0.0); b.size = vec2(0.0, 0.0); }
    }
    return b;
}

fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2(123.34, 345.45));
    q = q + dot(q, q + 34.345);
    return fract(q.x * q.y);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let src = textureSample(textures[0], sampler_, uv);
    let t = base_params.time;

    // Per-pixel building membership + local geometry, taken from the box that
    // contains this pixel (buildings rarely overlap; last match wins).
    var inside = 0.0;   // 1 when the pixel is over a building
    var edge = 0.0;     // 0..1 proximity to the nearest building edge (for glow)
    var local_y = 0.0;  // 0 top .. 1 bottom within the building (fog gradient)

    let count = i32(round(shader_options.box_count));
    for (var i = 0; i < 16; i = i + 1) {
        if i >= count {
            break;
        }
        let b = get_box(i);
        if b.size.x <= 0.0001 || b.size.y <= 0.0001 {
            continue;
        }
        if uv.x >= b.min.x && uv.x <= b.min.x + b.size.x
            && uv.y >= b.min.y && uv.y <= b.min.y + b.size.y {
            let lx = (uv.x - b.min.x) / b.size.x;
            let ly = (uv.y - b.min.y) / b.size.y;
            inside = 1.0;
            local_y = ly;
            let d = min(min(lx, 1.0 - lx), min(ly, 1.0 - ly));
            edge = max(edge, 1.0 - smoothstep(0.0, 0.09, d));
        }
    }

    if inside < 0.5 {
        return src;
    }

    let fog = clamp(shader_options.fog, 0.0, 1.0);
    let desat = clamp(shader_options.desat, 0.0, 1.0);
    let glow = clamp(shader_options.glow, 0.0, 2.0);
    let flick_speed = shader_options.flicker_speed;

    // 1) Desaturate to a cold sepia-gray, then dim — the abandoned look.
    let lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    let sepia = vec3(lum) * vec3(1.0, 0.96, 0.88);
    var col = mix(src.rgb, sepia, desat) * 0.72;

    // Cold violet grade for the haunted-house cast.
    col = col * vec3(0.82, 0.74, 1.08);

    // Rolling mist, thicker toward the base of the building.
    let fog_col = vec3(0.62, 0.68, 0.72);
    let mist = fog * local_y * local_y
        * (0.7 + 0.3 * sin(uv.x * 26.0 + t * 0.6));
    col = mix(col, fog_col, clamp(mist, 0.0, 0.75));

    // 2) Spectral green-teal glow along the edges, slowly flickering.
    let flick = 0.65 + 0.35 * sin(t * flick_speed + hash21(uv) * 6.283);
    let teal = vec3(0.15, 0.95, 0.72);
    col = col + teal * edge * glow * flick;

    // 3) Procedural glowing windows: a pixel grid where some cells randomly
    // light up over time, drawn as a warm pane inside each cell.
    let px = uv * vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));
    let cell = 24.0;
    let gid = floor(px / cell);
    let f = fract(px / cell);
    let rnd = hash21(gid);
    let rnd2 = hash21(gid + 7.1);
    let is_window = step(0.55, rnd2);                     // ~45% of cells are windows
    let pane = step(0.22, f.x) * step(f.x, 0.78)
        * step(0.16, f.y) * step(f.y, 0.84);
    let pulse = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(t * (0.5 + rnd * 1.6) + rnd * 6.283));
    let window_col = vec3(0.95, 0.85, 0.45);
    col = col + window_col * is_window * pane * pulse * 0.9;

    return vec4(col, src.a);
}
