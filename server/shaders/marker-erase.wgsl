// Erases colour-keyed marker rectangles drawn into the footage, filling each
// stroke with the picture around it.
//
// The marker backend reads those rectangles to place its overlay, so they have
// to survive as far as the compositor — but they must not survive into the
// shot. Rather than covering them (which only works if the overlay lands on the
// stroke to the pixel), this removes them: every pixel that matches the marker
// colour is replaced by its nearest non-marker neighbours, searched outward in
// eight directions. A drawn outline is thin, so a neighbour is always a few
// pixels away and the fill reads as the grass or sky it came from.
//
// Matching mirrors the worker's keying (circular hue distance plus saturation
// and value gates) so the shader erases exactly what the detector detects.

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

struct ShaderOptions {
    marker_color_r: f32,
    marker_color_g: f32,
    marker_color_b: f32,
    // Half-width of the accepted hue band, in turns (0.06 ~ 22°).
    hue_width: f32,
    // Minimum saturation and value for a pixel to be considered coloured at
    // all. Hue is meaningless on near-grey and near-black pixels.
    sat_min: f32,
    val_min: f32,
    // How far to search for clean pixels, as a fraction of frame height.
    // Must exceed the stroke thickness or the fill samples the stroke itself.
    reach: f32,
    // Extra erase around the match, in the same units — covers the soft halo
    // 4:2:0 compression leaves around a saturated line.
    grow: f32,
};

@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

fn rgb_to_hsv(rgb: vec3<f32>) -> vec3<f32> {
    let mx = max(rgb.r, max(rgb.g, rgb.b));
    let mn = min(rgb.r, min(rgb.g, rgb.b));
    let d = mx - mn;

    var h: f32 = 0.0;
    var s: f32 = 0.0;
    let v: f32 = mx;

    if (mx > 0.0) {
        s = d / mx;
    }
    if (d > 0.0001) {
        if (mx == rgb.r) {
            h = (rgb.g - rgb.b) / d;
            if (rgb.g < rgb.b) { h = h + 6.0; }
        } else if (mx == rgb.g) {
            h = (rgb.b - rgb.r) / d + 2.0;
        } else {
            h = (rgb.r - rgb.g) / d + 4.0;
        }
        h = h / 6.0;
    }
    return vec3<f32>(h, s, v);
}

/// 1.0 where the pixel is the marker colour, falling to 0.0 away from it.
/// `gate` scales the saturation/value floors: 1.0 is the strict match used to
/// decide what gets erased, below 1.0 accepts the washed-out tint that
/// compression smears around a stroke.
fn marker_match(rgb: vec3<f32>, key_hue: f32, gate: f32) -> f32 {
    let hsv = rgb_to_hsv(rgb);

    // Circular hue distance — the target may sit at either end of the wheel.
    var dh = abs(hsv.x - key_hue);
    dh = min(dh, 1.0 - dh);

    let width = max(shader_options.hue_width, 0.001);
    let hue_term = 1.0 - smoothstep(width * 0.6, width, dh);

    // Compression pulls saturation down at a stroke's edge, so the gates fade
    // in rather than cut, otherwise the halo is left behind as a coloured rim.
    // The +0.001 keeps smoothstep's edges apart when a floor is set to zero.
    let s_hi = max(shader_options.sat_min * gate, 0.001);
    let v_hi = max(shader_options.val_min * gate, 0.001);
    let sat_term = smoothstep(s_hi * 0.55, s_hi, hsv.y);
    let val_term = smoothstep(v_hi * 0.55, v_hi, hsv.z);

    return hue_term * sat_term * val_term;
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    // textureSampleLevel throughout: the searches below break on a data
    // dependent condition, and implicit-LOD sampling is only allowed in uniform
    // control flow. There are no mips here, so level 0 is the same picture.
    let src = textureSampleLevel(textures[0], sampler_, input.tex_coords, 0.0);
    let key_hue = rgb_to_hsv(vec3<f32>(
        shader_options.marker_color_r,
        shader_options.marker_color_g,
        shader_options.marker_color_b,
    )).x;

    let res = vec2<f32>(base_params.output_resolution);
    let texel = 1.0 / res;
    let aspect = res.x / max(res.y, 1.0);

    var strength = marker_match(src.rgb, key_hue, 1.0);

    // Only where this pixel carries the tint itself — otherwise the erase would
    // eat a stroke's width of clean picture all around every marker. Computing
    // it up front also keeps the probe below off the vast majority of pixels,
    // which have no trace of the marker colour at all.
    let tint = smoothstep(0.10, 0.45, marker_match(src.rgb, key_hue, 0.4));

    // The compression halo around a stroke can fall below the gates while still
    // being tinted. Probing a short way out catches it, so the rim goes too.
    if (strength < 0.999 && tint > 0.004 && shader_options.grow > 0.0) {
        let g = shader_options.grow;
        var near = 0.0;
        for (var i = 0; i < 8; i = i + 1) {
            let a = f32(i) * 0.7853982;
            let dir = vec2<f32>(cos(a) / aspect, sin(a));
            let p = clamp(input.tex_coords + dir * g, vec2<f32>(0.0), vec2<f32>(1.0));
            near = max(near, marker_match(
                textureSampleLevel(textures[0], sampler_, p, 0.0).rgb,
                key_hue, 1.0));
        }
        strength = max(strength, near * tint);
    }

    if (strength <= 0.004) {
        return src;
    }

    // Walk outward in eight directions and take the first clean pixel on each
    // ray, weighted toward the closer ones so the fill follows local detail
    // (a grass blade continues as grass) instead of flattening to an average.
    let reach = max(shader_options.reach, texel.y);
    var acc = vec3<f32>(0.0);
    var wsum = 0.0;

    for (var i = 0; i < 8; i = i + 1) {
        let a = f32(i) * 0.7853982;
        let dir = vec2<f32>(cos(a) / aspect, sin(a));
        for (var s = 1; s <= 24; s = s + 1) {
            let dist = reach * (f32(s) / 24.0);
            let p = clamp(
                input.tex_coords + dir * dist, vec2<f32>(0.0), vec2<f32>(1.0));
            let sample = textureSampleLevel(textures[0], sampler_, p, 0.0).rgb;
            if (marker_match(sample, key_hue, 0.4) < 0.20) {
                let wgt = 1.0 / (dist + texel.y);
                acc = acc + sample * wgt;
                wsum = wsum + wgt;
                break;
            }
        }
    }

    if (wsum <= 0.0) {
        return src;
    }

    let filled = acc / wsum;
    return vec4<f32>(mix(src.rgb, filled, clamp(strength, 0.0, 1.0)), src.a);
}
