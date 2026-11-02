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

// An effect inside the director's "finger frame": the quad whose corners
// are both hands' thumb + index fingertips (p0..p3, cycle order), supplied
// in tile space (0..1), already mapped through the same rescale 'fill'
// (cover) transform the video uses. The fill is even-odd, so twisted
// fingers (a self-intersecting cycle) draw as an hourglass — by design. A
// chalk viewfinder outline traces the quad's edges; pixels outside pass
// through untouched, and the feathered inner edge hides detection jitter
// at the fingertips.
//   p0x..p3y - the four corners (tile space, cycle order)
//   strength - 0..1 blend of the effect (fade in/out)
//   mode     - the look inside (0 grayscale, 1 sepia, 2 negative,
//              3 pixelate), cycled by the pinch sign
struct ShaderOptions {
    p0x: f32,
    p0y: f32,
    p1x: f32,
    p1y: f32,
    p2x: f32,
    p2y: f32,
    p3x: f32,
    p3y: f32,
    strength: f32,
    mode: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

// The drawn viewfinder outline on the quad's edges (sizes in output
// pixels): a thin chalk line all around with heavier brackets at the
// fingertip corners, over a soft dark halo so the line reads on bright
// pictures too. The effect feathers in from the outline.
const FRAME_AA: f32 = 1.0;
const FRAME_THIN_W: f32 = 0.9;
const FRAME_BRACKET_W: f32 = 2.4;
const FRAME_BRACKET_LEN: f32 = 26.0;
const FRAME_HALO_W: f32 = 4.0;
const FRAME_FEATHER_PX: f32 = 10.0;
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

fn seg_dist(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - (a + ab * t));
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let color = textureSample(textures[0], sampler_, uv);

    let strength = clamp(shader_options.strength, 0.0, 1.0);
    if (strength <= 0.001) {
        return color;
    }

    // Mosaic resample for the pixelate mode (uniform control flow: sampled
    // whatever the mode, selected in effect_color).
    let res = vec2<f32>(base_params.output_resolution);
    let block = vec2<f32>(PIXEL_BLOCK_PX) / res;
    let puv = (floor(uv / block) + 0.5) * block;
    let pix = textureSample(textures[0], sampler_, puv).rgb;

    // The quad in output pixels.
    let p = uv * res;
    var q = array<vec2<f32>, 4>(
        vec2<f32>(shader_options.p0x, shader_options.p0y) * res,
        vec2<f32>(shader_options.p1x, shader_options.p1y) * res,
        vec2<f32>(shader_options.p2x, shader_options.p2y) * res,
        vec2<f32>(shader_options.p3x, shader_options.p3y) * res,
    );

    // Even-odd fill (crossing number) — a self-intersecting cycle reads as
    // the hourglass's two lobes — plus the distance to the outline and to
    // the nearest fingertip corner.
    var inside = false;
    var edge = 1e9;
    var corner_d = 1e9;
    for (var i = 0u; i < 4u; i = i + 1u) {
        let a = q[i];
        let b = q[(i + 1u) % 4u];
        if ((a.y > p.y) != (b.y > p.y)) {
            let t = (p.y - a.y) / (b.y - a.y);
            if (p.x < a.x + t * (b.x - a.x)) {
                inside = !inside;
            }
        }
        edge = min(edge, seg_dist(p, a, b));
        corner_d = min(corner_d, length(p - a));
    }

    // Feather the effect in from the outline (inside only).
    var mask = 0.0;
    if (inside) {
        mask = smoothstep(0.0, FRAME_FEATHER_PX, edge);
    }
    let amount = mask * strength;
    let mode = i32(round(shader_options.mode));
    var rgb = mix(color.rgb, effect_color(mode, color.rgb, pix), amount);

    // Heavier strokes near the fingertip corners (a director's viewfinder).
    let bracket = 1.0 - smoothstep(FRAME_BRACKET_LEN - 4.0, FRAME_BRACKET_LEN, corner_d);
    let line_w = mix(FRAME_THIN_W, FRAME_BRACKET_W, bracket);
    let line_alpha = mix(0.55, 0.95, bracket);

    let halo = (1.0 - smoothstep(FRAME_HALO_W, FRAME_HALO_W + 2.0, edge)) * 0.35 * strength;
    rgb = mix(rgb, vec3<f32>(0.03, 0.03, 0.04), halo);
    let line = (1.0 - smoothstep(line_w, line_w + FRAME_AA, edge)) * line_alpha * strength;
    rgb = mix(rgb, vec3<f32>(0.97, 0.96, 0.92), line);

    return vec4<f32>(rgb, color.a);
}
