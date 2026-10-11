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

// An effect inside the director's "finger frame": the rect framed by both
// hands' thumbs + index fingertips, supplied in tile space (0..1), already
// mapped through the same rescale 'fill' (cover) transform the video uses.
// A chalk viewfinder frame is drawn on the rect boundary; pixels outside it
// pass through untouched, and the feathered inner edge hides detection
// jitter at the fingertips.
//   rect_cx, rect_cy - rect center
//   rect_hw, rect_hh - rect half-width / half-height
//   feather          - soft-edge width as a fraction of the half-extent
//   strength         - 0..1 blend of the effect (fade in/out)
//   mode             - the look inside (0 grayscale, 1 sepia, 2 negative,
//                      3 pixelate), cycled by the pinch sign
struct ShaderOptions {
    rect_cx: f32,
    rect_cy: f32,
    rect_hw: f32,
    rect_hh: f32,
    feather: f32,
    strength: f32,
    mode: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

// The drawn viewfinder frame on the rect boundary (sizes in output pixels):
// a thin chalk line all around with heavier corner brackets, over a soft
// dark halo so the line reads on bright pictures too.
const FRAME_AA: f32 = 1.0;
const FRAME_THIN_W: f32 = 0.9;
const FRAME_BRACKET_W: f32 = 2.4;
const FRAME_BRACKET_LEN: f32 = 26.0;
const FRAME_HALO_W: f32 = 4.0;
// Pixelate mode: mosaic block edge in output pixels.
const PIXEL_BLOCK_PX: f32 = 14.0;

// The look inside the frame. `pix` is the mosaic-resampled picture (sampled
// unconditionally in fs_main — texture reads must stay in uniform control
// flow).
fn effect_color(mode: i32, color: vec3<f32>, pix: vec3<f32>) -> vec3<f32> {
    if (mode == 1) { // sepia
        return vec3<f32>(
            min(1.0, dot(color, vec3<f32>(0.393, 0.769, 0.189))),
            min(1.0, dot(color, vec3<f32>(0.349, 0.686, 0.168))),
            min(1.0, dot(color, vec3<f32>(0.272, 0.534, 0.131))),
        );
    }
    if (mode == 2) { // negative
        return vec3<f32>(1.0) - color;
    }
    if (mode == 3) { // pixelate
        return pix;
    }
    let gray = dot(color, vec3<f32>(0.3, 0.59, 0.11));
    return vec3<f32>(gray);
}

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Feathered rectangular mask: 1 well inside the rect, fading to 0 across the
// last `feather` fraction of each half-extent (independently per axis, so the
// frame keeps its rectangular reading).
fn rect_mask(uv: vec2<f32>) -> f32 {
    let hw = shader_options.rect_hw;
    let hh = shader_options.rect_hh;
    if (hw <= 0.0 || hh <= 0.0) {
        return 0.0;
    }
    let f = clamp(shader_options.feather, 0.001, 1.0);
    let dx = abs(uv.x - shader_options.rect_cx) / hw;
    let dy = abs(uv.y - shader_options.rect_cy) / hh;
    let mx = 1.0 - smoothstep(1.0 - f, 1.0, dx);
    let my = 1.0 - smoothstep(1.0 - f, 1.0, dy);
    return mx * my;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let color = textureSample(textures[0], sampler_, uv);

    let hw = shader_options.rect_hw;
    let hh = shader_options.rect_hh;
    let strength = clamp(shader_options.strength, 0.0, 1.0);
    if (hw <= 0.0 || hh <= 0.0 || strength <= 0.001) {
        return color;
    }

    // Mosaic resample for the pixelate mode (uniform control flow: sampled
    // whatever the mode, selected in effect_color).
    let res = vec2<f32>(base_params.output_resolution);
    let block = vec2<f32>(PIXEL_BLOCK_PX) / res;
    let puv = (floor(uv / block) + 0.5) * block;
    let pix = textureSample(textures[0], sampler_, puv).rgb;

    let amount = rect_mask(uv) * strength;
    let mode = i32(round(shader_options.mode));
    var rgb = mix(color.rgb, effect_color(mode, color.rgb, pix), amount);

    // Signed distance (in output pixels) to the rect boundary.
    let p = (uv - vec2<f32>(shader_options.rect_cx, shader_options.rect_cy)) * res;
    let he = vec2<f32>(hw, hh) * res;
    let d = abs(p) - he;
    let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
    let edge = abs(dist);

    // Run distance along the boundary to the nearest corner — small there, so
    // the stroke widens into the viewfinder's corner brackets.
    let corner_run = max(he.x - abs(p.x), he.y - abs(p.y));
    let bracket = 1.0 - smoothstep(FRAME_BRACKET_LEN - 4.0, FRAME_BRACKET_LEN, corner_run);
    let line_w = mix(FRAME_THIN_W, FRAME_BRACKET_W, bracket);
    let line_alpha = mix(0.55, 0.95, bracket);

    let halo = (1.0 - smoothstep(FRAME_HALO_W, FRAME_HALO_W + 2.0, edge)) * 0.35 * strength;
    rgb = mix(rgb, vec3<f32>(0.03, 0.03, 0.04), halo);
    let line = (1.0 - smoothstep(line_w, line_w + FRAME_AA, edge)) * line_alpha * strength;
    rgb = mix(rgb, vec3<f32>(0.97, 0.96, 0.92), line);

    return vec4<f32>(rgb, color.a);
}
