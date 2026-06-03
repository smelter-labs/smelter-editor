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

// Corner-pin / perspective warp. The four corners of the input are displaced by
// the (x, y) offsets below (in UV units: 1.0 == full width/height). The shader
// fits a homography mapping the original unit square onto the resulting quad and
// samples the texture through its inverse, so the content's perspective matches
// the dragged corners.
struct ShaderOptions {
    // Top-left corner offset.
    tl_x: f32,
    tl_y: f32,
    // Top-right corner offset.
    tr_x: f32,
    tr_y: f32,
    // Bottom-right corner offset.
    br_x: f32,
    br_y: f32,
    // Bottom-left corner offset.
    bl_x: f32,
    bl_y: f32,
    // Edge anti-aliasing width in UV units.
    feather: f32,
    // Output opacity.
    opacity: f32,
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

// Homography that maps the unit square corners
//   (0,0) -> p0, (1,0) -> p1, (1,1) -> p2, (0,1) -> p3
// onto an arbitrary quad. Returns the 3x3 matrix in WGSL column-major form so
// that `M * vec3(u, v, 1)` yields homogeneous destination coordinates.
// Reference: Heckbert, "Projective Mappings for Image Warping".
fn square_to_quad(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, p3: vec2<f32>) -> mat3x3<f32> {
    let dx1 = p1.x - p2.x;
    let dx2 = p3.x - p2.x;
    let dx3 = p0.x - p1.x + p2.x - p3.x;
    let dy1 = p1.y - p2.y;
    let dy2 = p3.y - p2.y;
    let dy3 = p0.y - p1.y + p2.y - p3.y;

    let denom = dx1 * dy2 - dx2 * dy1;
    var g: f32 = 0.0;
    var h: f32 = 0.0;
    if (abs(denom) > 1e-8) {
        g = (dx3 * dy2 - dx2 * dy3) / denom;
        h = (dx1 * dy3 - dx3 * dy1) / denom;
    }

    let a = p1.x - p0.x + g * p1.x;
    let b = p3.x - p0.x + h * p3.x;
    let c = p0.x;
    let d = p1.y - p0.y + g * p1.y;
    let e = p3.y - p0.y + h * p3.y;
    let f = p0.y;

    // Columns: (a,d,g), (b,e,h), (c,f,1).
    return mat3x3<f32>(
        vec3<f32>(a, d, g),
        vec3<f32>(b, e, h),
        vec3<f32>(c, f, 1.0),
    );
}

fn inverse3(m: mat3x3<f32>) -> mat3x3<f32> {
    let a = m[0][0]; let d = m[0][1]; let g = m[0][2];
    let b = m[1][0]; let e = m[1][1]; let h = m[1][2];
    let c = m[2][0]; let f = m[2][1]; let i = m[2][2];

    let A =  (e * i - f * h);
    let B = -(d * i - f * g);
    let C =  (d * h - e * g);
    let det = a * A + b * B + c * C;
    let inv_det = select(0.0, 1.0 / det, abs(det) > 1e-12);

    let D = -(b * i - c * h);
    let E =  (a * i - c * g);
    let F = -(a * h - b * g);
    let G =  (b * f - c * e);
    let H = -(a * f - c * d);
    let I =  (a * e - b * d);

    // Adjugate (transpose of cofactor matrix), stored column-major.
    return mat3x3<f32>(
        vec3<f32>(A, B, C) * inv_det,
        vec3<f32>(D, E, F) * inv_det,
        vec3<f32>(G, H, I) * inv_det,
    );
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;

    // Destination quad: base corners + per-corner offsets.
    let p0 = vec2<f32>(0.0, 0.0) + vec2<f32>(shader_options.tl_x, shader_options.tl_y);
    let p1 = vec2<f32>(1.0, 0.0) + vec2<f32>(shader_options.tr_x, shader_options.tr_y);
    let p2 = vec2<f32>(1.0, 1.0) + vec2<f32>(shader_options.br_x, shader_options.br_y);
    let p3 = vec2<f32>(0.0, 1.0) + vec2<f32>(shader_options.bl_x, shader_options.bl_y);

    // Map the output pixel back into source UV space through the inverse homography.
    let warp = inverse3(square_to_quad(p0, p1, p2, p3));
    let src_h = warp * vec3<f32>(uv, 1.0);

    // Behind-the-camera guard: w <= 0 means the point is outside the projected quad.
    if (src_h.z <= 0.0) {
        return vec4<f32>(0.0);
    }
    let src = src_h.xy / src_h.z;

    // Feathered rectangular mask in source space so warped edges stay anti-aliased.
    let fw = max(shader_options.feather, 1e-4);
    let mask_x = smoothstep(0.0, fw, src.x) * smoothstep(0.0, fw, 1.0 - src.x);
    let mask_y = smoothstep(0.0, fw, src.y) * smoothstep(0.0, fw, 1.0 - src.y);
    let mask = mask_x * mask_y;
    if (mask <= 0.0) {
        return vec4<f32>(0.0);
    }

    let color = textureSample(textures[0], sampler_, clamp(src, vec2<f32>(0.0), vec2<f32>(1.0)));
    let alpha = color.a * mask * clamp(shader_options.opacity, 0.0, 1.0);
    return vec4<f32>(color.rgb, alpha);
}
