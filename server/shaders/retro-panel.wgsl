enable wgpu_binding_array;

// Retro arcade panel chrome for the duck-hunter broadcast HUD: the editor
// retro-kit's chamfered (cut-corner) double-stroke panel — bright accent line,
// dark gap, navy fill with optional blueprint grid + CRT scanlines and an
// outer glow — drawn as an SDF. Bordered/rotated Views render broken on this
// engine build, which is why the panel shape lives in a shader at all.
// The child texture is ignored (chrome only); text/content is composited by
// sibling Views on top of the panel.

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
    cut_px: f32,      // chamfer size (px of the shader resolution)
    line_px: f32,     // bright accent border width (0 = borderless backdrop)
    gap_px: f32,      // near-black gap between the line and the fill
    glow: f32,        // 0..1 outer glow strength (in the line color)
    glow_px: f32,     // glow reach in px
    line_r: f32,
    line_g: f32,
    line_b: f32,
    fill_r: f32,
    fill_g: f32,
    fill_b: f32,
    fill_a: f32,      // panel fill opacity (fill shows the video through it)
    grid: f32,        // 0..1 blueprint-grid intensity inside the fill
    grid_px: f32,     // grid spacing in px
    scanline: f32,    // 0..1 CRT scanline darkening inside the fill
    scan_px: f32,     // scanline period in px
    flash: f32,       // 0..1 urgency boost on the line color (blink)
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

// The retro-kit's darkest edge tone (#04080f), used for the stroke gap.
const EDGE_RGB = vec3<f32>(0.0157, 0.0314, 0.0588);
// Blueprint grid line tone (editor BlueprintBackdrop's rgba(64,110,180,…)).
const GRID_RGB = vec3<f32>(0.251, 0.431, 0.706);

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Signed distance to the chamfered rectangle filling the whole plane:
// the axis-aligned rect intersected with four 45° corner cuts.
// Copied verbatim into chamfer-clip.wgsl, which carves the same shape out of
// the video this panel frames — WGSL has no includes and the two shapes have
// to nest pixel-exactly, so THE COPIES MUST STAY IN SYNC.
fn panel_sd(p: vec2<f32>, res: vec2<f32>, cut: f32) -> f32 {
    let h = res * 0.5;
    let q = abs(p - h);
    let d = q - h;
    let sd_rect = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
    let sd_cut = (q.x + q.y - (h.x + h.y - cut)) * 0.7071;
    return max(sd_rect, sd_cut);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );
    let p = input.tex_coords * res;
    let sd = panel_sd(p, res, shader_options.cut_px);

    let line_rgb = vec3<f32>(
        shader_options.line_r,
        shader_options.line_g,
        shader_options.line_b,
    ) * (1.0 + shader_options.flash * 0.8);

    // Outside the panel: only the (optional) glow halo. Premultiplied alpha.
    if sd > 0.0 {
        if shader_options.glow <= 0.0 || shader_options.glow_px <= 0.0 {
            return vec4<f32>(0.0);
        }
        let a = shader_options.glow * 0.55 * exp(-sd / shader_options.glow_px);
        return vec4<f32>(line_rgb * a, a);
    }

    // Bright accent line band.
    if shader_options.line_px > 0.0 && sd > -shader_options.line_px {
        return vec4<f32>(line_rgb, 1.0);
    }

    // Near-black gap band between the line and the fill.
    let stroke = shader_options.line_px + shader_options.gap_px;
    if shader_options.gap_px > 0.0 && sd > -stroke {
        return vec4<f32>(EDGE_RGB, 1.0);
    }

    // Interior fill (+ blueprint grid + scanlines), translucent over the video.
    var rgb = vec3<f32>(
        shader_options.fill_r,
        shader_options.fill_g,
        shader_options.fill_b,
    );
    if shader_options.grid > 0.0 && shader_options.grid_px > 1.0 {
        let cell = fract(p / shader_options.grid_px) * shader_options.grid_px;
        let on_line = f32(cell.x < 1.0 || cell.y < 1.0);
        rgb = mix(rgb, GRID_RGB, on_line * 0.18 * shader_options.grid);
    }
    if shader_options.scanline > 0.0 && shader_options.scan_px > 1.0 {
        let row = fract(p.y / shader_options.scan_px) * shader_options.scan_px;
        let dark = f32(row < 1.0) * 0.22 * shader_options.scanline;
        rgb = rgb * (1.0 - dark);
    }
    let a = clamp(shader_options.fill_a, 0.0, 1.0);
    return vec4<f32>(rgb * a, a);
}
