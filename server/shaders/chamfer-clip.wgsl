enable wgpu_binding_array;

// Alpha-clips a single child texture to a chamfered (cut-corner) rectangle —
// the inner counterpart of retro-panel's chrome. HunterTile insets its video
// inside a chamfered panel, but RetroPanel draws children in a sibling View ON
// TOP of the shader chrome, so a square video box covered the panel's 45°
// corner cuts. This pass carves the same corners out of the video instead.
// Chrome-free by design: the panel underneath still owns the line, gap, fill
// and glow.
//
// `cut_px` is the chamfer of THIS box, not of the panel around it. For a panel
// of chamfer C whose content is inset by i on all sides, the inset box's own
// chamfer is C - i*(2 - sqrt(2)): a 45° edge pushed i px inward travels
// i*sqrt(2) along each axis while the box itself only loses i per side.
// Callers get the number from chamferClipCut() in retroHudLayout.ts.

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
    cut_px: f32,     // chamfer of THIS box (px of the shader resolution)
    feather_px: f32, // antialias width on the clip edge (0 = hard)
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Signed distance to the chamfered rectangle filling the whole plane: the
// axis-aligned rect intersected with four 45° corner cuts.
// Verbatim copy of panel_sd() in retro-panel.wgsl — WGSL has no includes and
// the two shapes have to nest pixel-exactly, so THE COPIES MUST STAY IN SYNC.
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
    if base_params.texture_count != 1u {
        return vec4<f32>(0.0);
    }
    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );
    let p = input.tex_coords * res;
    let sd = panel_sd(p, res, max(shader_options.cut_px, 0.0));
    let feather = max(shader_options.feather_px, 0.0001);
    // 1 inside, 0 outside, smoothed over the last `feather` px of the edge.
    let mask = 1.0 - smoothstep(-feather, 0.0, sd);
    // Sampled unconditionally, ahead of any branch on `mask`: textureSample
    // needs implicit derivatives, which are only well-defined in uniform
    // control flow. The corners cost one wasted fetch and nothing else.
    let color = textureSample(textures[0], sampler_, input.tex_coords);
    // retro-panel's convention: premultiplied alpha, so the whole RGBA scales.
    return color * mask;
}
