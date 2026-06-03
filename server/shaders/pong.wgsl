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
    ball_radius: f32,
    ball_speed: f32,
    vel_x: f32,
    vel_y: f32,
    start_x: f32,
    start_y: f32,
    paddle_width: f32,
    paddle_height: f32,
    paddle_margin: f32,
    ai_skill: f32,
    score_left: f32,
    score_right: f32,
    bg_alpha: f32,
    input_in_paddles: f32,
    show_score: f32,
    trail_length: f32,
    trail_intensity: f32,
    particles: f32,
    particle_intensity: f32,
    court_color_r: f32,
    court_color_g: f32,
    court_color_b: f32,
    paddle_color_r: f32,
    paddle_color_g: f32,
    paddle_color_b: f32,
    mode: f32,
    manual_ball_x: f32,
    manual_ball_y: f32,
    manual_vel_x: f32,
    manual_vel_y: f32,
    manual_paddle_l_y: f32,
    manual_paddle_r_y: f32,
    manual_last_bounce_time: f32,
    manual_last_bounce_x: f32,
    manual_last_bounce_y: f32,
    manual_last_bounce_kind: f32,
    manual_countdown_remaining: f32,
    ball_border_thickness: f32,
};


@group(0) @binding(0)
var textures: binding_array<texture_2d<f32>, 16>;

@group(1) @binding(0)
var<uniform> shader_options: ShaderOptions;

@group(2) @binding(0)
var sampler_: sampler;

var<immediate> base_params: BaseShaderParameters;

const PI : f32 = 3.1415926535;

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4<f32>(input.position, 1.0);
    out.tex_coords = input.tex_coords;
    return out;
}

// Bounces a position between 0 and 1 using a triangle wave driven by time.
fn bounce(start: f32, vel: f32, time: f32) -> f32 {
    let raw = start + vel * time;
    let m = raw - 2.0 * floor(raw * 0.5);
    return 1.0 - abs(m - 1.0);
}

// 3x5 bitmap font: bit 14 = top-left, bit 0 = bottom-right.
fn digit_bits(d: u32) -> u32 {
    switch (d) {
        case 0u: { return 0x7B6Fu; }
        case 1u: { return 0x2C97u; }
        case 2u: { return 0x73E7u; }
        case 3u: { return 0x73CFu; }
        case 4u: { return 0x5BC9u; }
        case 5u: { return 0x79CFu; }
        case 6u: { return 0x79EFu; }
        case 7u: { return 0x72A4u; }
        case 8u: { return 0x7BEFu; }
        case 9u: { return 0x7BCFu; }
        default: { return 0u; }
    }
}

fn digit_pixel(d: u32, x: u32, y: u32) -> bool {
    if (x >= 3u || y >= 5u) {
        return false;
    }
    let bits = digit_bits(d);
    let idx = 14u - (y * 3u + x);
    return ((bits >> idx) & 1u) == 1u;
}

// Mask (0/1) for a two-digit score, top-left of the bounding box at (left_x, top_y).
fn score_mask(uv: vec2<f32>, score: u32, left_x: f32, top_y: f32, digit_w: f32, digit_h: f32, gap: f32) -> f32 {
    let tens = (score / 10u) % 10u;
    let ones = score % 10u;

    let cell_w = digit_w / 3.0;
    let cell_h = digit_h / 5.0;

    let ly = uv.y - top_y;
    if (ly < 0.0 || ly >= digit_h) {
        return 0.0;
    }
    let cy = u32(floor(ly / cell_h));

    let lx_t = uv.x - left_x;
    if (lx_t >= 0.0 && lx_t < digit_w) {
        let cx = u32(floor(lx_t / cell_w));
        if (digit_pixel(tens, cx, cy)) { return 1.0; }
    }

    let ones_left = left_x + digit_w + gap;
    let lx_o = uv.x - ones_left;
    if (lx_o >= 0.0 && lx_o < digit_w) {
        let cx = u32(floor(lx_o / cell_w));
        if (digit_pixel(ones, cx, cy)) { return 1.0; }
    }

    return 0.0;
}

// Big single-digit mask centered at `center`. `cell` is the Y size of one
// bitmap cell in UV; X is aspect-corrected so the digit stays visually square.
fn big_digit_mask(uv: vec2<f32>, digit: u32, center: vec2<f32>, cell: f32, aspect: f32) -> f32 {
    let local_x = (uv.x - center.x) * aspect / cell + 1.5;
    let local_y = (uv.y - center.y) / cell + 2.5;
    if (local_x < 0.0 || local_x >= 3.0 || local_y < 0.0 || local_y >= 5.0) {
        return 0.0;
    }
    let cx = u32(floor(local_x));
    let cy = u32(floor(local_y));
    if (digit_pixel(digit, cx, cy)) { return 1.0; }
    return 0.0;
}

fn hash21(p: vec2<f32>) -> f32 {
    let h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

// Burst of ~10 particles flying outward from `origin`, aged `age` seconds since the bounce.
fn particle_burst(uv: vec2<f32>, origin: vec2<f32>, age: f32, seed: f32, aspect: f32, intensity: f32, color: vec3<f32>) -> vec3<f32> {
    let lifetime = 0.55;
    if (age < 0.0 || age > lifetime) {
        return vec3<f32>(0.0);
    }
    let life01 = age / lifetime;
    let fade = pow(1.0 - life01, 1.5);

    var col = vec3<f32>(0.0);
    var i: u32 = 0u;
    loop {
        if (i >= 10u) { break; }
        let fi = f32(i);
        let h1 = hash21(vec2<f32>(fi * 1.7, seed * 3.3));
        let h2 = hash21(vec2<f32>(fi * 2.3 + 5.1, seed * 7.7 + 11.0));
        let base_angle = fi / 10.0 * 2.0 * PI;
        let angle = base_angle + (h1 - 0.5) * 0.9;
        let speed = 0.18 + h2 * 0.18;
        let pos = origin + vec2<f32>(cos(angle) / aspect, sin(angle)) * speed * age;

        let dx = (uv.x - pos.x) * aspect;
        let dy = uv.y - pos.y;
        let d = sqrt(dx * dx + dy * dy);
        let size = 0.010 * (1.0 - life01 * 0.6);
        let m = 1.0 - smoothstep(size * 0.5, size, d);
        col = col + color * m * fade;
        i = i + 1u;
    }
    return col * intensity;
}

// Dashed center line mask.
fn center_line_mask(uv: vec2<f32>) -> f32 {
    let dist_x = abs(uv.x - 0.5);
    if (dist_x > 0.0035) {
        return 0.0;
    }
    let dash = step(0.5, fract(uv.y * 14.0));
    return dash;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (base_params.texture_count != 1u) {
        return vec4<f32>(0.0);
    }

    let uv = input.tex_coords;
    let time = base_params.time;
    let res = vec2<f32>(f32(base_params.output_resolution.x), f32(base_params.output_resolution.y));
    let aspect = res.x / max(res.y, 1.0);

    let ball_radius = max(shader_options.ball_radius, 0.001);
    let speed = shader_options.ball_speed;
    let vx = shader_options.vel_x * speed;
    let vy = shader_options.vel_y * speed;
    let start_x = shader_options.start_x;
    let start_y = shader_options.start_y;

    let pw = shader_options.paddle_width;
    let ph = shader_options.paddle_height;
    let pmargin = shader_options.paddle_margin;
    let ai_skill = clamp(shader_options.ai_skill, 0.0, 1.0);

    // Ball position bounces within the playable region (between the two paddles).
    let play_min_x = pmargin + pw * 0.5 + ball_radius / aspect;
    let play_max_x = 1.0 - pmargin - pw * 0.5 - ball_radius / aspect;
    let play_min_y = ball_radius;
    let play_max_y = 1.0 - ball_radius;

    let bx_norm = bounce(start_x, vx, time);
    let by_norm = bounce(start_y, vy, time);
    let auto_ball_x = mix(play_min_x, play_max_x, bx_norm);
    let auto_ball_y = mix(play_min_y, play_max_y, by_norm);

    // Auto-mode paddles track the ball with imperfection — sin-wobble grows as ai_skill drops.
    let wobble_l = sin(time * 0.83) * (1.0 - ai_skill) * 0.35;
    let wobble_r = sin(time * 1.07 + 1.7) * (1.0 - ai_skill) * 0.35;
    let auto_paddle_l_y = clamp(auto_ball_y + wobble_l, ph * 0.5, 1.0 - ph * 0.5);
    let auto_paddle_r_y = clamp(auto_ball_y + wobble_r, ph * 0.5, 1.0 - ph * 0.5);
    let paddle_l_x = pmargin + pw * 0.5;
    let paddle_r_x = 1.0 - pmargin - pw * 0.5;

    // Manual-mode values pushed by host. mvx/mvy are UV-units per second (positive = right/down).
    let is_manual = shader_options.mode > 0.5;
    let mball_x = shader_options.manual_ball_x;
    let mball_y = shader_options.manual_ball_y;
    let mvx = shader_options.manual_vel_x;
    let mvy = shader_options.manual_vel_y;

    let ball_x = select(auto_ball_x, mball_x, is_manual);
    let ball_y = select(auto_ball_y, mball_y, is_manual);
    let paddle_l_y = select(auto_paddle_l_y, shader_options.manual_paddle_l_y, is_manual);
    let paddle_r_y = select(auto_paddle_r_y, shader_options.manual_paddle_r_y, is_manual);

    // Aspect-preserving "cover" scale for sampling the input texture into a
    // (square) circular area. For a 16:9 input, cover_x ≈ 0.56 (sample only the
    // central horizontal strip) so the contents aren't squeezed.
    let cover_x = 1.0 / max(1.0, aspect);
    let cover_y = 1.0 / max(1.0, 1.0 / aspect);

    let court_color = vec3<f32>(
        shader_options.court_color_r,
        shader_options.court_color_g,
        shader_options.court_color_b,
    );
    let paddle_color = vec3<f32>(
        shader_options.paddle_color_r,
        shader_options.paddle_color_g,
        shader_options.paddle_color_b,
    );

    // Background: court color or faded input.
    let bg_a = clamp(shader_options.bg_alpha, 0.0, 1.0);
    let input_full = textureSample(textures[0], sampler_, uv);
    var color = mix(court_color, input_full.rgb, bg_a);

    // Center line.
    let line_m = center_line_mask(uv);
    color = mix(color, paddle_color, line_m * 0.8);

    // Score.
    if (shader_options.show_score > 0.5) {
        let digit_h = 0.08;
        let digit_w = 0.04;
        let gap = 0.012;
        let score_top = 0.06;
        let total_w = digit_w * 2.0 + gap;

        let sl = u32(clamp(shader_options.score_left, 0.0, 99.0));
        let sr = u32(clamp(shader_options.score_right, 0.0, 99.0));
        let left_box_x = 0.5 - 0.08 - total_w;
        let right_box_x = 0.5 + 0.08;
        let ml = score_mask(uv, sl, left_box_x, score_top, digit_w, digit_h, gap);
        let mr = score_mask(uv, sr, right_box_x, score_top, digit_w, digit_h, gap);
        color = mix(color, paddle_color, max(ml, mr) * 0.9);
    }

    // Trail — ghost balls at past positions, fading.
    let trail_len = u32(clamp(shader_options.trail_length, 0.0, 15.0));
    let trail_int = clamp(shader_options.trail_intensity, 0.0, 1.0);
    if (trail_len > 0u && trail_int > 0.0) {
        var ti: u32 = 1u;
        loop {
            if (ti > trail_len) { break; }
            let fi = f32(ti);
            let denom = f32(trail_len + 1u);
            let dt = fi * 0.035;
            let bxn = bounce(start_x, vx, time - dt);
            let byn = bounce(start_y, vy, time - dt);
            let auto_tx = mix(play_min_x, play_max_x, bxn);
            let auto_ty = mix(play_min_y, play_max_y, byn);
            // Manual-mode trail walks back along instantaneous velocity (straight line).
            let manual_tx = mball_x - mvx * dt;
            let manual_ty = mball_y - mvy * dt;
            let tx = select(auto_tx, manual_tx, is_manual);
            let ty = select(auto_ty, manual_ty, is_manual);
            // In manual mode clip ghosts older than the last bounce event so the trail
            // ends cleanly at the bounce origin instead of running through it.
            let age_since_bounce = time - shader_options.manual_last_bounce_time;
            let skip_ghost = is_manual && dt > age_since_bounce && age_since_bounce >= 0.0;
            if (!skip_ghost) {
                let dx = (uv.x - tx) * aspect;
                let dy = uv.y - ty;
                let d = sqrt(dx * dx + dy * dy);
                let r = ball_radius * (1.0 - fi / denom * 0.55);
                if (d < r) {
                    let alpha = pow(1.0 - fi / denom, 1.5) * trail_int;
                    let lu = vec2<f32>(
                        (dx / r) * cover_x * 0.5 + 0.5,
                        (dy / r) * cover_y * 0.5 + 0.5,
                    );
                    let c = textureSample(textures[0], sampler_, clamp(lu, vec2<f32>(0.0), vec2<f32>(1.0)));
                    let edge = 1.0 - smoothstep(r * 0.85, r, d);
                    color = mix(color, c.rgb, edge * alpha);
                }
            }
            ti = ti + 1u;
        }
    }

    // Paddles.
    let use_input_paddles = shader_options.input_in_paddles > 0.5;
    let dxl = uv.x - paddle_l_x;
    let dyl = uv.y - paddle_l_y;
    if (abs(dxl) < pw * 0.5 && abs(dyl) < ph * 0.5) {
        if (use_input_paddles) {
            let lu = vec2<f32>(dxl / pw + 0.5, dyl / ph + 0.5);
            let c = textureSample(textures[0], sampler_, lu);
            color = c.rgb;
        } else {
            color = paddle_color;
        }
    }

    let dxr = uv.x - paddle_r_x;
    let dyr = uv.y - paddle_r_y;
    if (abs(dxr) < pw * 0.5 && abs(dyr) < ph * 0.5) {
        if (use_input_paddles) {
            let lu = vec2<f32>(dxr / pw + 0.5, dyr / ph + 0.5);
            let c = textureSample(textures[0], sampler_, lu);
            color = c.rgb;
        } else {
            color = paddle_color;
        }
    }

    // Particle bursts.
    if (shader_options.particles > 0.5) {
        let p_int = clamp(shader_options.particle_intensity, 0.0, 2.0);
        let auto_color = vec3<f32>(1.0, 0.85, 0.55);

        if (is_manual) {
            // One burst per bounce event pushed by host. kind=0 (wall) → white,
            // kind=1 (paddle) → warm orange. Seed is stable between bounces.
            let kind = clamp(shader_options.manual_last_bounce_kind, 0.0, 1.0);
            let mcolor = mix(vec3<f32>(1.0, 1.0, 1.0), vec3<f32>(1.0, 0.55, 0.25), kind);
            let age = time - shader_options.manual_last_bounce_time;
            let seed = shader_options.manual_last_bounce_time * 47.3
                     + shader_options.manual_last_bounce_x * 13.7
                     + shader_options.manual_last_bounce_y * 29.1;
            color = color + particle_burst(
                uv,
                vec2<f32>(shader_options.manual_last_bounce_x, shader_options.manual_last_bounce_y),
                age, seed, aspect, p_int, mcolor
            );
        } else {
            // Auto-mode: two derived bursts (one per axis-bounce), derived deterministically from time.
            if (abs(vx) > 0.05) {
                let raw_x = start_x + vx * time;
                let last_bx_raw = select(ceil(raw_x), floor(raw_x), vx > 0.0);
                let dt_x = abs(raw_x - last_bx_raw) / abs(vx);
                let bx_norm = round(bounce(start_x, vx, time - dt_x));
                let by_norm = bounce(start_y, vy, time - dt_x);
                let bwx = mix(play_min_x, play_max_x, bx_norm);
                let bwy = mix(play_min_y, play_max_y, by_norm);
                color = color + particle_burst(uv, vec2<f32>(bwx, bwy), dt_x, last_bx_raw, aspect, p_int, auto_color);
            }

            if (abs(vy) > 0.05) {
                let raw_y = start_y + vy * time;
                let last_by_raw = select(ceil(raw_y), floor(raw_y), vy > 0.0);
                let dt_y = abs(raw_y - last_by_raw) / abs(vy);
                let by_norm = round(bounce(start_y, vy, time - dt_y));
                let bx_norm = bounce(start_x, vx, time - dt_y);
                let bwx = mix(play_min_x, play_max_x, bx_norm);
                let bwy = mix(play_min_y, play_max_y, by_norm);
                color = color + particle_burst(uv, vec2<f32>(bwx, bwy), dt_y, last_by_raw + 1000.0, aspect, p_int, auto_color);
            }
        }
    }

    // Ball — aspect-corrected so it stays round.
    let bdx = (uv.x - ball_x) * aspect;
    let bdy = uv.y - ball_y;
    let bdist = sqrt(bdx * bdx + bdy * bdy);
    if (bdist < ball_radius) {
        let lu = vec2<f32>(
            (bdx / ball_radius) * cover_x * 0.5 + 0.5,
            (bdy / ball_radius) * cover_y * 0.5 + 0.5,
        );
        let c = textureSample(textures[0], sampler_, clamp(lu, vec2<f32>(0.0), vec2<f32>(1.0)));
        // Soft anti-aliased edge.
        let edge = 1.0 - smoothstep(ball_radius * 0.95, ball_radius, bdist);
        let border_t = clamp(shader_options.ball_border_thickness, 0.0, ball_radius);
        let inner_r = ball_radius - border_t;
        let aa = ball_radius * 0.02;
        let border_m = smoothstep(inner_r - aa, inner_r + aa, bdist);
        let fill = mix(c.rgb, paddle_color, border_m);
        color = mix(color, fill, edge);
    }

    // Countdown overlay: big centered digit during pre-serve.
    let countdown = shader_options.manual_countdown_remaining;
    if (countdown > 0.0) {
        let digit = u32(ceil(countdown));
        if (digit > 0u && digit < 10u) {
            let cd_mask = big_digit_mask(uv, digit, vec2<f32>(0.5, 0.5), 0.06, aspect);
            if (cd_mask > 0.0) {
                // Slight pulse within each whole second so it feels alive.
                let pulse = 0.6 + 0.4 * fract(countdown);
                color = mix(color, paddle_color, cd_mask * pulse);
            }
        }
    }

    return vec4<f32>(color, 1.0);
}
