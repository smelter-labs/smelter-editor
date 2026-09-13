enable wgpu_binding_array;

// Blacktop ("basketball game") hoop-cam look: a light broadcast grade that
// tells the inset cam apart from the full-frame court view without hurting
// readability of the action under the rim — a luma-preserving colour tint, a
// touch of contrast, a soft vignette and barely-there scanlines.
//
// `strength` is the master mix with the untouched picture, so the pass can stay
// mounted across scene cuts and just fade its own effect to 0. Mounting it on
// the PiP itself would rebuild the video node on every cut (see the kettlebell
// rig note in inputs.tsx) and flash.
//
// The tint is normalised to luma 1 before it multiplies the picture, so a
// bright accent colour shifts the hue without dimming or lifting the frame.

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
    strength: f32,    // 0 = untouched passthrough, 1 = full look
    tint_r: f32,      // grade colour, 0..1 linear-ish sRGB components
    tint_g: f32,
    tint_b: f32,
    tint_amount: f32, // how far the picture moves toward the tint
    contrast: f32,    // 1 = unchanged, pivots around 0.5
    vignette: f32,    // edge darkening at the very corners
    scanline: f32,    // alternating-line darkening
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

const LUMA: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if base_params.texture_count != 1u {
        return vec4<f32>(0.0);
    }
    let src = textureSample(textures[0], sampler_, input.tex_coords);
    let a = src.a;
    if a <= 0.0 {
        return vec4<f32>(0.0);
    }
    // The engine hands over premultiplied alpha; grade straight colour and
    // premultiply again on the way out.
    let base = src.rgb / a;

    // Luma-preserving tint: scale the colour so its own luma is 1, then the
    // multiply only redistributes channels instead of changing exposure.
    let tint = vec3<f32>(
        shader_options.tint_r,
        shader_options.tint_g,
        shader_options.tint_b,
    );
    let tint_luma = max(dot(tint, LUMA), 1e-4);
    let tint_norm = tint / tint_luma;
    var rgb = mix(base, base * tint_norm, clamp(shader_options.tint_amount, 0.0, 1.0));

    rgb = (rgb - 0.5) * max(shader_options.contrast, 0.0) + 0.5;

    // Soft round falloff from the middle of the tile; `r` runs 0 at the centre
    // to ~0.707 in the corners.
    let r = length(input.tex_coords - vec2<f32>(0.5));
    let vig = 1.0 - clamp(shader_options.vignette, 0.0, 1.0)
        * smoothstep(0.25, 0.72, r);
    rgb = rgb * vig;

    // Two-pixel period in output space, so the texture stays put when the tile
    // is rescaled rather than crawling with the source resolution.
    let y_px = input.tex_coords.y * f32(base_params.output_resolution.y);
    let line = 0.5 + 0.5 * sin(y_px * 3.14159265);
    rgb = rgb * (1.0 - clamp(shader_options.scanline, 0.0, 1.0) * line);

    let graded = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    let out_rgb = mix(base, graded, clamp(shader_options.strength, 0.0, 1.0));
    return vec4<f32>(out_rgb * a, a);
}
