enable wgpu_binding_array;

// AI PANEL "aurora studio" backdrop: deep graphite-navy wall with slowly
// drifting aurora ribbons in the panelist's accent colour, a faint bokeh
// drift, a lit horizon line and a dark floor that dimly mirrors the aurora.
// Drawn behind an ObPuppetInput figure instead of the gold quiz wall PNG.
// The child texture is ignored (backdrop only) and animation runs on the
// engine-supplied `base_params.time`, so it costs no React re-renders.
// Rendered small (640x360) and upscaled by a Rescaler — keep everything soft.

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
    accent_r: f32,   // panelist accent (ribbon 1, horizon light)
    accent_g: f32,
    accent_b: f32,
    accent2_r: f32,  // secondary cool tone (ribbon 2, spotlight)
    accent2_g: f32,
    accent2_b: f32,
    phase: f32,      // per-cam time offset so two studios never sync up
    floor_y: f32,    // horizon line as a fraction of height (~0.785)
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

// Layered sine ribbons; `uv` may be a mirrored coordinate (floor reflection).
fn aurora(uv: vec2<f32>, t: f32, accent: vec3<f32>, accent2: vec3<f32>) -> vec3<f32> {
    var c = vec3<f32>(0.0);

    // Ribbon 1 — accent, mid wall. The accent must dominate the wall, so it
    // is the brightest and meanders the widest.
    let y1 = 0.32 + 0.12 * sin(uv.x * 4.4 + t * 0.21)
                  + 0.045 * sin(uv.x * 9.1 - t * 0.13 + 1.7);
    let d1 = (uv.y - y1) / 0.16;
    let i1 = exp(-d1 * d1) * (0.55 + 0.45 * sin(uv.x * 2.6 + t * 0.17 + 0.8));
    c += accent * i1 * 0.36;

    // Ribbon 2 — cool tone, lower and wider (kept dim: it goes grey fast).
    let y2 = 0.48 + 0.10 * sin(uv.x * 3.1 - t * 0.16 + 2.4)
                  + 0.05 * sin(uv.x * 7.3 + t * 0.11);
    let d2 = (uv.y - y2) / 0.20;
    let i2 = exp(-d2 * d2) * (0.55 + 0.45 * sin(uv.x * 2.2 - t * 0.14 + 3.1));
    c += accent2 * i2 * 0.08;

    // Ribbon 3 — faint accent-leaning blend, high up.
    let y3 = 0.16 + 0.06 * sin(uv.x * 5.6 + t * 0.12 + 4.2);
    let d3 = (uv.y - y3) / 0.11;
    let i3 = exp(-d3 * d3) * (0.6 + 0.4 * sin(uv.x * 3.4 + t * 0.19 + 5.0));
    c += mix(accent, accent2, 0.35) * i3 * 0.08;

    return c;
}

// Eight soft drifting bokeh dots, alternating accent tones.
fn bokeh(uv: vec2<f32>, aspect: f32, t: f32, accent: vec3<f32>, accent2: vec3<f32>) -> vec3<f32> {
    var c = vec3<f32>(0.0);
    for (var i = 0; i < 8; i = i + 1) {
        let fi = f32(i);
        let cx = 0.08 + fi * 0.118 + 0.025 * sin(t * 0.11 + fi * 1.7);
        let cy = 0.12 + fract(fi * 0.37) * 0.52 + 0.03 * cos(t * 0.09 + fi * 2.3);
        let r = 0.022 + 0.014 * fract(fi * 0.61);
        let d = vec2<f32>((uv.x - cx) * aspect, uv.y - cy) / r;
        let g = exp(-dot(d, d));
        let col = select(accent2, accent, i % 2 == 0);
        c += col * g * 0.05;
    }
    return c;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = input.tex_coords;
    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );
    let aspect = res.x / max(res.y, 1.0);
    let t = base_params.time + shader_options.phase;

    let accent = vec3<f32>(
        shader_options.accent_r,
        shader_options.accent_g,
        shader_options.accent_b,
    );
    let accent2 = vec3<f32>(
        shader_options.accent2_r,
        shader_options.accent2_g,
        shader_options.accent2_b,
    );
    let fy = clamp(shader_options.floor_y, 0.5, 0.95);

    var rgb: vec3<f32>;
    if uv.y > fy {
        // Floor: darker gradient plus a dim, compressed mirror of the aurora.
        let depth = (uv.y - fy) / max(1.0 - fy, 0.001);
        rgb = mix(
            vec3<f32>(0.035, 0.045, 0.080),
            vec3<f32>(0.014, 0.018, 0.034),
            depth,
        );
        let muv = vec2<f32>(uv.x, fy - (uv.y - fy) * 1.8);
        rgb += aurora(muv, t, accent, accent2) * 0.35 * exp(-depth * 3.0);
    } else {
        // Wall: graphite-navy vertical gradient, aurora, bokeh, soft key light.
        rgb = mix(
            vec3<f32>(0.047, 0.058, 0.102),
            vec3<f32>(0.023, 0.029, 0.051),
            smoothstep(0.0, 1.0, uv.y / fy),
        );
        rgb += aurora(uv, t, accent, accent2);
        rgb += bokeh(uv, aspect, t, accent, accent2);
        // Cool key light behind the figure's head (faint — it greys the wall).
        let sp = vec2<f32>((uv.x - 0.5) * aspect, uv.y - 0.30);
        rgb += accent2 * exp(-dot(sp, sp) / 0.10) * 0.03;
    }

    // Horizon glow in the accent, brightest at centre, fading to the edges.
    // (PuppetInput overlays a crisp 2 px hairline View at the same y.)
    let ldist = abs(uv.y - fy) * res.y;
    let xfade = exp(-pow((uv.x - 0.5) / 0.42, 2.0));
    rgb += accent * (exp(-ldist * ldist / 18.0) * 0.5 + exp(-ldist / 14.0) * 0.18) * xfade;

    // Vignette (gentle — a heavy one muddies the accent into grey).
    let v = vec2<f32>((uv.x - 0.5) * 1.15, uv.y - 0.45);
    rgb *= 0.65 + 0.35 * smoothstep(0.95, 0.35, length(v));

    return vec4<f32>(rgb, 1.0);
}
