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

// Duck Hunter "hatch mark": says WHICH real bird in the video a duck sprite came
// out of. Runs on the video underneath the sprites (PacmanBirdsInput), so the
// ducks always draw on top of it.
//
// Three layers per slot, all in the duck's own palette color so bird and duck
// are matched by hue as well as by position:
//
//   1. lock-on ring   — a segmented, slowly rotating rim around the detection
//                       box with a hot spot sweeping around it, plus a soft
//                       outer bloom and a soft dark backing so the ring stays
//                       legible over bright sky as well as dark trees.
//   2. birth pulse    — a full shockwave ring expanding out of the box at the
//                       instant the duck spawns. This is the loud part, and it
//                       is over in half a second.
//   3. tether         — dashes running bird -> duck for the first moment after
//                       the duck detaches and flies off, then gone.
//
// The interior is never filled: the bird only gets a small saturation/light
// lift, so the ring marks the subject without hiding it. All envelopes are
// computed in TS (spawnAuraEnvelope in duckHunter/duckFlight.ts) — the engine
// `time` uniform is wall-clock and shared, so it cannot express an envelope
// that starts when *this* duck hatched. With every slot's glow/pulse/link at 0
// this is an exact passthrough.
//
// Field order must match spawnAuraShader.ts exactly.
//   a{i}_cx, a{i}_cy       - bird box center, tile uv (already cover-mapped)
//   a{i}_hw, a{i}_hh       - bird box half-extents, tile uv
//   a{i}_tone              - duck palette index 0..2 (picks the aura color)
//   a{i}_phase             - per-duck animation phase in turns, from its id
//   a{i}_glow              - 0..1 steady ring strength
//   a{i}_pulse             - 0..1 birth shockwave opacity
//   a{i}_pulse_t           - 0..1 shockwave expansion (0 = at the box rim)
//   a{i}_link              - 0..1 tether opacity
//   a{i}_dx, a{i}_dy       - the duck's current center, tile uv (tether end)
struct ShaderOptions {
    aura_count: f32,
    a0_cx: f32, a0_cy: f32, a0_hw: f32, a0_hh: f32, a0_tone: f32, a0_phase: f32, a0_glow: f32, a0_pulse: f32, a0_pulse_t: f32, a0_link: f32, a0_dx: f32, a0_dy: f32,
    a1_cx: f32, a1_cy: f32, a1_hw: f32, a1_hh: f32, a1_tone: f32, a1_phase: f32, a1_glow: f32, a1_pulse: f32, a1_pulse_t: f32, a1_link: f32, a1_dx: f32, a1_dy: f32,
    a2_cx: f32, a2_cy: f32, a2_hw: f32, a2_hh: f32, a2_tone: f32, a2_phase: f32, a2_glow: f32, a2_pulse: f32, a2_pulse_t: f32, a2_link: f32, a2_dx: f32, a2_dy: f32,
    a3_cx: f32, a3_cy: f32, a3_hw: f32, a3_hh: f32, a3_tone: f32, a3_phase: f32, a3_glow: f32, a3_pulse: f32, a3_pulse_t: f32, a3_link: f32, a3_dx: f32, a3_dy: f32,
    a4_cx: f32, a4_cy: f32, a4_hw: f32, a4_hh: f32, a4_tone: f32, a4_phase: f32, a4_glow: f32, a4_pulse: f32, a4_pulse_t: f32, a4_link: f32, a4_dx: f32, a4_dy: f32,
    a5_cx: f32, a5_cy: f32, a5_hw: f32, a5_hh: f32, a5_tone: f32, a5_phase: f32, a5_glow: f32, a5_pulse: f32, a5_pulse_t: f32, a5_link: f32, a5_dx: f32, a5_dy: f32,
    a6_cx: f32, a6_cy: f32, a6_hw: f32, a6_hh: f32, a6_tone: f32, a6_phase: f32, a6_glow: f32, a6_pulse: f32, a6_pulse_t: f32, a6_link: f32, a6_dx: f32, a6_dy: f32,
    a7_cx: f32, a7_cy: f32, a7_hw: f32, a7_hh: f32, a7_tone: f32, a7_phase: f32, a7_glow: f32, a7_pulse: f32, a7_pulse_t: f32, a7_link: f32, a7_dx: f32, a7_dy: f32,
};

@group(0) @binding(0) var textures: binding_array<texture_2d<f32>, 16>;
@group(1) @binding(0) var<uniform> shader_options: ShaderOptions;
@group(2) @binding(0) var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// ── Tuning. Deliberately restrained: this sits under a live game, and a mark
// that shouts is a mark that gets in the way of aiming. ──
/** Ring radius vs the detection box (1 = hugging it). */
const AURA_PAD: f32 = 1.35;
/** Floor on the ring's half-extent, as a fraction of min(width, height), so a
 * small/distant bird still gets a ring you can see — mirrors the sprite floor
 * (DUCK_MIN_SIDE_FRAC) that keeps a distant bird readable as a duck. */
const AURA_MIN_FRAC: f32 = 0.030;
/** Ceiling on the same — a safety valve for a runaway box, not a look: a bird
 * filling the shot should still be ringed, just not across the whole frame.
 * Applied as a uniform shrink, so the ring keeps the bird's proportions. */
const AURA_MAX_FRAC: f32 = 0.28;
/** Peak blend toward the aura color at the ring core. */
const RIM_OPACITY: f32 = 0.50;
/** Additive bloom hugging the ring — what makes it read as a glow rather than
 * an outline. Banded tight around the boundary, NOT filling the interior: a
 * wide bloom turns into fog over the video, which is the one thing this must
 * not become. */
const GLOW_ADD: f32 = 0.12;
/** Soft darkening spread under the ring, so it survives a white sky. */
const BACKING_DARK: f32 = 0.14;
/** Shockwave travel, in ring radii, clamped to a sane on-screen range below. */
const PULSE_REACH: f32 = 1.8;
const PULSE_OPACITY: f32 = 0.50;
/** Tether thickness as a fraction of min(width, height), and its opacity.
 * Tuned against real footage: any thinner/fainter and the line drowns in the
 * video before the envelope even starts decaying it. */
const LINK_W_FRAC: f32 = 0.0035;
const LINK_OPACITY: f32 = 0.60;
/** How much the marked bird itself is lifted (saturation, a whisper of tint). */
const LIFT: f32 = 0.14;

const TAU: f32 = 6.2831853;
const LUMA_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

struct Aura {
    center: vec2<f32>,
    half: vec2<f32>,
    tone: f32,
    phase: f32,
    glow: f32,
    pulse: f32,
    pulse_t: f32,
    link: f32,
    duck: vec2<f32>,
};

fn get_aura(i: i32) -> Aura {
    var a: Aura;
    switch i {
        case 0:  { a.center = vec2(shader_options.a0_cx, shader_options.a0_cy); a.half = vec2(shader_options.a0_hw, shader_options.a0_hh); a.tone = shader_options.a0_tone; a.phase = shader_options.a0_phase; a.glow = shader_options.a0_glow; a.pulse = shader_options.a0_pulse; a.pulse_t = shader_options.a0_pulse_t; a.link = shader_options.a0_link; a.duck = vec2(shader_options.a0_dx, shader_options.a0_dy); }
        case 1:  { a.center = vec2(shader_options.a1_cx, shader_options.a1_cy); a.half = vec2(shader_options.a1_hw, shader_options.a1_hh); a.tone = shader_options.a1_tone; a.phase = shader_options.a1_phase; a.glow = shader_options.a1_glow; a.pulse = shader_options.a1_pulse; a.pulse_t = shader_options.a1_pulse_t; a.link = shader_options.a1_link; a.duck = vec2(shader_options.a1_dx, shader_options.a1_dy); }
        case 2:  { a.center = vec2(shader_options.a2_cx, shader_options.a2_cy); a.half = vec2(shader_options.a2_hw, shader_options.a2_hh); a.tone = shader_options.a2_tone; a.phase = shader_options.a2_phase; a.glow = shader_options.a2_glow; a.pulse = shader_options.a2_pulse; a.pulse_t = shader_options.a2_pulse_t; a.link = shader_options.a2_link; a.duck = vec2(shader_options.a2_dx, shader_options.a2_dy); }
        case 3:  { a.center = vec2(shader_options.a3_cx, shader_options.a3_cy); a.half = vec2(shader_options.a3_hw, shader_options.a3_hh); a.tone = shader_options.a3_tone; a.phase = shader_options.a3_phase; a.glow = shader_options.a3_glow; a.pulse = shader_options.a3_pulse; a.pulse_t = shader_options.a3_pulse_t; a.link = shader_options.a3_link; a.duck = vec2(shader_options.a3_dx, shader_options.a3_dy); }
        case 4:  { a.center = vec2(shader_options.a4_cx, shader_options.a4_cy); a.half = vec2(shader_options.a4_hw, shader_options.a4_hh); a.tone = shader_options.a4_tone; a.phase = shader_options.a4_phase; a.glow = shader_options.a4_glow; a.pulse = shader_options.a4_pulse; a.pulse_t = shader_options.a4_pulse_t; a.link = shader_options.a4_link; a.duck = vec2(shader_options.a4_dx, shader_options.a4_dy); }
        case 5:  { a.center = vec2(shader_options.a5_cx, shader_options.a5_cy); a.half = vec2(shader_options.a5_hw, shader_options.a5_hh); a.tone = shader_options.a5_tone; a.phase = shader_options.a5_phase; a.glow = shader_options.a5_glow; a.pulse = shader_options.a5_pulse; a.pulse_t = shader_options.a5_pulse_t; a.link = shader_options.a5_link; a.duck = vec2(shader_options.a5_dx, shader_options.a5_dy); }
        case 6:  { a.center = vec2(shader_options.a6_cx, shader_options.a6_cy); a.half = vec2(shader_options.a6_hw, shader_options.a6_hh); a.tone = shader_options.a6_tone; a.phase = shader_options.a6_phase; a.glow = shader_options.a6_glow; a.pulse = shader_options.a6_pulse; a.pulse_t = shader_options.a6_pulse_t; a.link = shader_options.a6_link; a.duck = vec2(shader_options.a6_dx, shader_options.a6_dy); }
        case 7:  { a.center = vec2(shader_options.a7_cx, shader_options.a7_cy); a.half = vec2(shader_options.a7_hw, shader_options.a7_hh); a.tone = shader_options.a7_tone; a.phase = shader_options.a7_phase; a.glow = shader_options.a7_glow; a.pulse = shader_options.a7_pulse; a.pulse_t = shader_options.a7_pulse_t; a.link = shader_options.a7_link; a.duck = vec2(shader_options.a7_dx, shader_options.a7_dy); }
        default: { a.center = vec2(0.0); a.half = vec2(0.0); a.tone = 0.0; a.phase = 0.0; a.glow = 0.0; a.pulse = 0.0; a.pulse_t = 0.0; a.link = 0.0; a.duck = vec2(0.0); }
    }
    return a;
}

/**
 * Aura color per duck palette index, picked off the sprite art so the ring on
 * the bird and the duck that hatched from it read as the same thing:
 *   0 = black duck, green head   1 = red duck   2 = navy duck, magenta head
 * All three are saturated mid-tones, which is what lets the ring stay visible
 * whether the bird is against bright sky or dark foliage.
 */
fn tone_color(t: f32) -> vec3<f32> {
    let i = i32(round(clamp(t, 0.0, 2.0)));
    if (i == 0) { return vec3<f32>(0.36, 0.96, 0.45); }
    if (i == 1) { return vec3<f32>(1.00, 0.36, 0.28); }
    return vec3<f32>(0.98, 0.38, 0.95);
}

/** Approximate signed distance (px) to an axis-aligned ellipse. */
fn ellipse_sd(p: vec2<f32>, c: vec2<f32>, h: vec2<f32>) -> f32 {
    if (h.x <= 0.0 || h.y <= 0.0) {
        return 1.0e6;
    }
    let d = length((p - c) / h);
    return (d - 1.0) * min(h.x, h.y);
}

/** Projection parameter of `p` onto segment a->b, clamped to the segment. */
fn seg_t(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let ab = b - a;
    let l2 = dot(ab, ab);
    if (l2 <= 1.0e-6) {
        return 0.0;
    }
    return clamp(dot(p - a, ab) / l2, 0.0, 1.0);
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count == 0u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let color = textureSample(textures[0], sampler_, uv);
    var rgb = color.rgb;

    let res = vec2<f32>(
        f32(base_params.output_resolution.x),
        f32(base_params.output_resolution.y),
    );
    let min_edge = min(res.x, res.y);
    let p = uv * res;
    let t = base_params.time;

    let count = i32(clamp(shader_options.aura_count, 0.0, 8.0));

    // The ring/shockwave/tether are blended toward the aura color (guaranteed
    // contrast on any background); the bloom is additive on top. Both are
    // accumulated across slots and applied once, so overlapping auras compose
    // instead of stacking to white.
    var mix_a: f32 = 0.0;
    var mix_col = vec3<f32>(0.0);
    var mix_w: f32 = 0.0;
    var add_acc = vec3<f32>(0.0);
    var dark_acc: f32 = 0.0;
    var lift_acc: f32 = 0.0;
    var lift_col = vec3<f32>(0.0);

    for (var i: i32 = 0; i < count; i = i + 1) {
        let a = get_aura(i);
        if (max(a.glow, max(a.pulse, a.link)) <= 0.002) {
            continue;
        }
        let col = tone_color(a.tone);
        let ph = a.phase * TAU;

        // Ring geometry: the detection box padded out, floored so a distant
        // bird still gets a visible ring and capped so a close-up one doesn't
        // ring half the frame. The cap is a uniform shrink, so the ring keeps
        // the bird's proportions either way.
        let c = a.center * res;
        let floor_px = AURA_MIN_FRAC * min_edge;
        var h = max(a.half * res * AURA_PAD, vec2<f32>(floor_px));
        let over = max(h.x, h.y) / (AURA_MAX_FRAC * min_edge);
        if (over > 1.0) {
            h = h / over;
        }
        let r_ref = min(h.x, h.y);
        // Line weights are held near-constant in pixels rather than scaling
        // with the box: a hairline reads as a mark, a fat band reads as a blob.
        let rim_w = clamp(r_ref * 0.07, 1.5, min_edge * 0.007);

        // Slow breathing, phased per duck so a flock doesn't pulse in unison.
        let breathe = 1.0 + 0.035 * sin(t * 2.1 + ph);
        let d = ellipse_sd(p, c, h * breathe);

        // ── 1. Lock-on ring ──────────────────────────────────────────────
        let ang = atan2(p.y - c.y, p.x - c.x);
        // Three arcs with gaps, rotating slowly: reads as a tracking reticle
        // rather than a sticker, and the gaps keep it from boxing the bird in.
        let seg = fract((ang / TAU) * 3.0 - t * 0.09 + a.phase);
        let arc = smoothstep(0.0, 0.07, seg) * (1.0 - smoothstep(0.70, 0.78, seg));
        // A hot spot running around the rim — the only fast motion here, and
        // it is what makes the mark catch the eye without being bright.
        let sweep = 0.6 + 0.4 * pow(0.5 + 0.5 * cos(ang - t * 2.2 + ph), 4.0);
        let rim = (1.0 - smoothstep(0.0, rim_w, abs(d))) * arc * sweep * a.glow;
        // Bloom is banded on |d|, so it hugs the ring on both sides instead of
        // flooding the interior — the bird stays visible through its own mark.
        let glow_px = clamp(r_ref * 0.22, 5.0, min_edge * 0.022);
        let bloom = exp(-abs(d) / glow_px) * a.glow;
        // Soft, wider dark backing under the ring so it does not vanish into a
        // white sky — the same trick as a drop shadow behind light text.
        let backing = (1.0 - smoothstep(0.0, rim_w * 2.6, abs(d))) * a.glow;

        // ── 2. Birth shockwave ───────────────────────────────────────────
        // Full ring (no arc gaps) racing outward. Reach is clamped so a big
        // near bird doesn't throw a ring across half the frame.
        let reach = clamp(r_ref * PULSE_REACH, min_edge * 0.03, min_edge * 0.16);
        let shock = (1.0 - smoothstep(0.0, max(rim_w * 1.3, 2.0), abs(d - a.pulse_t * reach)))
            * a.pulse;

        // ── 3. Tether ────────────────────────────────────────────────────
        var link: f32 = 0.0;
        if (a.link > 0.002) {
            let q = a.duck * res;
            let s = seg_t(p, c, q);
            let lw = max(min_edge * LINK_W_FRAC, 1.5);
            let core = 1.0 - smoothstep(0.0, lw, distance(p, mix(c, q, s)));
            // Dashes travelling bird -> duck: the direction is the message.
            let span = distance(c, q);
            let dash = 0.45 + 0.55 * sin(s * span / (lw * 7.0) * TAU - t * 8.0 + ph);
            // Fades toward the duck end, so the line points back at the source.
            link = core * max(dash, 0.0) * (1.0 - 0.5 * s) * a.link;
        }

        let solid = clamp(
            rim * RIM_OPACITY + shock * PULSE_OPACITY + link * LINK_OPACITY,
            0.0,
            1.0,
        );
        mix_a = max(mix_a, solid);
        mix_col = mix_col + col * solid;
        mix_w = mix_w + solid;
        // The tether gets a touch of additive light on top of its color mix,
        // so the umbilical still reads while its envelope decays.
        add_acc = add_acc
            + col * (bloom * GLOW_ADD + shock * PULSE_OPACITY * 0.5 + link * 0.15);
        dark_acc = max(dark_acc, backing * BACKING_DARK);

        // Marked bird: a touch more saturation and light inside the ring, so
        // the source stands out even where the rim crosses busy video. The
        // interior is never filled — the game has to stay readable.
        let ins = (1.0 - smoothstep(-r_ref * 0.5, 0.0, d)) * a.glow;
        if (ins > lift_acc) {
            lift_acc = ins;
            lift_col = col;
        }
    }

    if (mix_a <= 0.0 && lift_acc <= 0.0 && dark_acc <= 0.0) {
        return color;
    }

    // Subject lift first, so the ring composes over the already-lifted bird.
    let luma = dot(rgb, LUMA_WEIGHTS);
    let lifted = rgb + (rgb - vec3<f32>(luma)) * 0.3 + lift_col * 0.03;
    rgb = mix(rgb, lifted, clamp(lift_acc, 0.0, 1.0) * LIFT);

    // Dark backing, then the ring color, then the additive bloom.
    rgb = rgb * (1.0 - clamp(dark_acc, 0.0, 1.0));
    rgb = mix(rgb, mix_col / max(mix_w, 1.0e-4), clamp(mix_a, 0.0, 1.0));
    rgb = rgb + add_acc;

    return vec4<f32>(clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0)), color.a);
}
