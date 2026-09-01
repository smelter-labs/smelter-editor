enable wgpu_binding_array;

// Hit feedback for a shot duck in the duck-hunter game. Instead of darkening
// the whole frame on every hit (which drowned out the dog pop-up, the one beat
// that should feel special), the duck itself lights up:
//
//   1. its own colors get brighter and more saturated  ("podświetlone")
//   2. a tint in the shooting player's color says WHO scored
//   3. a white-hot core burns through at the instant of impact
//   4. an expanding halo, dilated out of the sprite's alpha, sells the hit
//
// Driven entirely from TS (hitFlashEnvelope in duckHunter/duckFlight.ts) — the
// engine `time` uniform is wall-clock and shared, so it cannot express a
// per-duck envelope that starts when *that* duck was shot.
//
// With every parameter at 0 this is an exact passthrough, so the tail of the
// death beat (the fall) renders identically to the pre-shader version.

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

// Field order must match the shaderParam array in PacmanBirdsInput.tsx exactly.
struct ShaderOptions {
    scale: f32,        // sprite zoom about the plane centre (1 = untouched)
    flash: f32,        // 0..1 blend toward white (the impact)
    glow: f32,         // 0..1 brightness/saturation lift + tint strength
    rim: f32,          // 0..1 halo opacity
    rim_t: f32,        // 0..1 halo expansion (0 = hugs the sprite)
    rim_px: f32,       // halo reach in px at rim_t = 1
    tint_r: f32,       // shooting player's color
    tint_g: f32,
    tint_b: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

const LUMA_WEIGHTS = vec3<f32>(0.2126, 0.7152, 0.0722);

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Sprite lookup with the impact zoom applied about the plane centre. Doing the
// scale pop here — rather than by resizing the child View — keeps the shader
// plane a constant size for the whole death beat, so the render target is never
// reallocated mid-animation and the box never jitters by a rounded pixel.
//
// textureSampleLevel throughout: the halo loop below sits behind a branch, and
// implicit-LOD sampling is only allowed in uniform control flow. There are no
// mips here, so level 0 is the same picture (same reasoning as marker-erase.wgsl).
fn sprite(uv: vec2<f32>) -> vec4<f32> {
    let s = max(shader_options.scale, 0.01);
    let suv = (uv - vec2<f32>(0.5)) / s + vec2<f32>(0.5);
    let c = textureSampleLevel(
        textures[0], sampler_, clamp(suv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
    // Outside the sprite plane there is nothing to draw; masking by 0 is a
    // correct "nothing here" for premultiplied rgb and alpha alike.
    let inside = step(0.0, suv.x) * step(suv.x, 1.0)
               * step(0.0, suv.y) * step(suv.y, 1.0);
    return c * inside;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );

    let src = sprite(uv);
    let src_a = clamp(src.a, 0.0, 1.0);
    // The sprite arrives premultiplied; recover straight color so the tone work
    // below operates on the real hue, not on edge pixels faded toward black.
    let src_rgb = src.rgb / max(src_a, 1e-4);

    let flash = clamp(shader_options.flash, 0.0, 1.0);
    let glow = clamp(shader_options.glow, 0.0, 1.0);
    let tint = vec3<f32>(
        shader_options.tint_r,
        shader_options.tint_g,
        shader_options.tint_b,
    );

    // ── 1. Lift the duck's own colors: brighter, and further from gray ──
    let luma = dot(src_rgb, LUMA_WEIGHTS);
    // Push each channel away from its luma to deepen saturation, then raise the
    // whole thing. Both scale with `glow`, so at glow = 0 this is a no-op.
    var rgb = src_rgb + (src_rgb - vec3<f32>(luma)) * (0.55 * glow);
    rgb = rgb * (1.0 + 0.85 * glow);

    // ── 2. Tint toward the shooting player's color ──
    // Screen-blend rather than mix: it colors the duck without flattening the
    // sprite's internal shading, so the bird still reads as a bird.
    let screened = 1.0 - (1.0 - clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0))) * (1.0 - tint);
    rgb = mix(rgb, screened, 0.7 * glow);

    // ── 3. White-hot core at the moment of impact ──
    rgb = mix(rgb, vec3<f32>(1.0), flash);

    rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

    // ── 4. Halo: dilate the silhouette outward and draw the ring in the
    // player's color, only where the sprite itself is transparent. Same
    // 8-direction march as alpha-stroke.wgsl, at half the step count — this
    // runs per dead duck at ~60fps and the reach is small.
    //
    // The whole block is skipped once the halo has decayed, which is most of
    // the death beat: the fall costs a single texture sample per pixel.
    let rim_amt = clamp(shader_options.rim, 0.0, 1.0);
    let reach_px = max(shader_options.rim_px, 0.0) * clamp(shader_options.rim_t, 0.0, 1.0);
    let px = vec2<f32>(1.0 / max(res.x, 1.0), 1.0 / max(res.y, 1.0));

    let dirs = array<vec2<f32>, 8>(
        vec2<f32>( 1.0,  0.0), vec2<f32>(-1.0,  0.0),
        vec2<f32>( 0.0,  1.0), vec2<f32>( 0.0, -1.0),
        vec2<f32>( 0.7071,  0.7071), vec2<f32>(-0.7071,  0.7071),
        vec2<f32>( 0.7071, -0.7071), vec2<f32>(-0.7071, -0.7071),
    );

    // Max neighbour alpha within the reach = a dilated silhouette. Weighting by
    // distance makes the ring brightest right at the expanding front.
    var dilated: f32 = 0.0;
    if (rim_amt > 0.0 && reach_px > 0.0) {
        for (var i: i32 = 0; i < 8; i = i + 1) {
            for (var s: i32 = 1; s <= 2; s = s + 1) {
                let r_px = reach_px * f32(s) / 2.0;
                let a_n = sprite(uv + dirs[i] * r_px * px).a;
                dilated = max(dilated, clamp(a_n, 0.0, 1.0) * (1.0 - 0.35 * f32(s - 1)));
            }
        }
    }

    // Fade the halo out toward the plane border, so one that outgrows the
    // padded box dissolves instead of showing a square cut.
    let d_edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    let edge_fade = 1.0 - smoothstep(0.40, 0.50, d_edge);

    // Only outside the sprite, so the duck is never overpainted by its own halo.
    let rim_alpha = clamp(dilated * rim_amt * (1.0 - src_a) * edge_fade, 0.0, 1.0);
    // Halo core runs hot toward white while the impact flash is still up.
    let rim_rgb = clamp(mix(tint, vec3<f32>(1.0), 0.45 * flash), vec3<f32>(0.0), vec3<f32>(1.0));

    // Composite the halo *under* the sprite, then emit premultiplied alpha
    // (the convention every partial-alpha shader in this repo follows —
    // see haunter-ghost.wgsl and retro-panel.wgsl).
    let out_a = clamp(src_a + rim_alpha * (1.0 - src_a), 0.0, 1.0);
    let out_rgb = rgb * src_a + rim_rgb * rim_alpha * (1.0 - src_a);

    return vec4<f32>(out_rgb, out_a);
}
