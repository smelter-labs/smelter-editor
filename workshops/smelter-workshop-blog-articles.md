# Smelter Workshop — Blog Article Series

Five technical articles, one per episode of the **Smelter Workshop** video series.
The tone follows the videos — loose, story-driven — but each article digs into the
actual implementation, with real code from the repos.

All code shown is verbatim from:

- [`smeltest`](https://github.com/) — the Smelter Editor app (episodes 1, 2, 4, 5)
- [`smelter-surveilance`](https://github.com/) — the hackathon surveillance app (episode 3)

Suggested frontmatter for the smelter.dev blog (`title` / `description` / `category`)
is included at the top of each article.

---

## Contents

1. [A prompt, a clap, and a carousel](#article-1--a-prompt-a-clap-and-a-carousel)
2. [Pong is a pixel shader](#article-2--pong-is-a-pixel-shader)
3. [Anatomy of a hackathon surveillance rig](#article-3--anatomy-of-a-hackathon-surveillance-rig)
4. [One tap on the pipeline: the side channel, three ways](#article-4--one-tap-on-the-pipeline-the-side-channel-three-ways)
5. [Duck Hunt on a live stream](#article-5--duck-hunt-on-a-live-stream)

---
---

# Article 1 — A prompt, a clap, and a carousel

> **title:** A prompt, a clap, and a carousel: AI-generating a live-stream feature
> **description:** How a 15-line prompt turned into a clap-controlled video carousel inside a live composited stream — and why the animation runs on the GPU compositor, not in a render loop.
> **category:** Live Streaming

Smelter is an engine for real-time programmatic video composition: an end-to-end
GPU pipeline controlled through a React interface. The scene you compose isn't
DOM — components like `<View>`, `<Rescaler>` and `<InputStream>` render directly
to video frames.

For the first Smelter Workshop episode we set ourselves a simple goal: build a
**carousel of live video inputs** inside the stream — navigable with arrow keys,
and, because why not, with a **clap**. And we wanted an AI agent to build it,
inside the existing Smelter Editor app, from a single prompt.

## The prompt is the spec

This is the entire prompt (it ships in the repo as `DEMO-PROMPTS.md`):

```
Add carousel to the layer system.
A layer shows one slide at a time with animated transitions
— configurable: duration, easing, visible slide count, gap.
Server: carousel action endpoint (next/prev/setIndex)
with debounce during animation and index wrap-around.
Rendering component with slide animation and overflow hidden.
State bounds sanitization.
Editor: carousel action API,
keyboard hook (←/→/Space),
clap detection hook via mic (2-5kHz).
UI: creation modal with input selection,
inline settings (duration, visible count, gap, easing,
position/size, keyboard/clap toggles with localStorage),
slide selection dialog.
"Carousel" label and settings/edit buttons in layer header.
```

Fifteen lines. Every bullet maps 1:1 onto a file in the resulting single
squashed commit — the endpoint, the render component, both hooks, the settings
UI. The interesting part isn't that an agent can write React; it's *what the
resulting architecture looks like* when the substrate is a video compositor.

## There is no carousel primitive

Smelter has no "carousel" component, and none was added. The whole animation is
built from two properties of the engine:

1. Components with a **stable `id`** are matched between scene updates, and
   Smelter interpolates their style changes on the GPU.
2. A `<View>` can clip its children with `overflow: 'hidden'`.

So a carousel is: one masking `View`, and one absolutely-positioned `<Rescaler>`
per slide whose `left` changes between updates.

```tsx
// server/src/app/App.tsx
<View
  style={{
    top: slot.y, left: slot.x,
    width: slot.width, height: slot.height,
    overflow: 'hidden',
  }}>
  ...
  <Rescaler
    key={`carousel-${layer.id}-${item.inputId}`}
    id={`carousel-${layer.id}-${item.inputId}`}
    transition={transition}
    style={{ top: 0, left: offsetLeft, width: tileWidth, height: slot.height }}>
    {inner}
  </Rescaler>
```

The consequence is worth spelling out: **the server sends one scene update per
navigation action, not one per frame.** There is no animation loop anywhere in
the codebase. The compositor interpolates `left` at output framerate on the GPU.

Slide positions come from a wrap-aware signed distance from the active index:

```tsx
// server/src/app/App.tsx
// signedDist === 0            → active (leftmost visible)
// signedDist in [1, visibleCount-1] → other visible slides
// signedDist === visibleCount → entering from the right
// signedDist === -1           → exiting to the left
// others                      → hidden (snap to hiddenOffset)
const signedDistOf = (i: number, activeIndex: number, preferPositive: boolean): number => {
  if (n === 0) return 0;
  const raw = ((i - activeIndex) % n + n) % n;
  if (raw === 0) return 0;
  if (preferPositive) return raw > visibleCount ? raw - n : raw;
  return raw > n / 2 ? raw - n : raw;
};
```

And the one genuinely subtle decision — **which slides animate and which snap**:

```tsx
// Animate only when this slide moved by at most one cell and both
// positions lie in the participating window [-1, visibleCount].
// This prevents wrap-around slides from flying across the slot.
const participates = (sd: number) => sd >= -1 && sd <= visibleCount;
const shouldAnimate =
  participates(cur) && participates(prev) && Math.abs(cur - prev) <= 1;
// When snapping, leave transition undefined so Smelter applies its
// default (no animation) without remembering a 0ms transition that
// would bleed into subsequent updates.
const transition = shouldAnimate
  ? { durationMs: carousel.durationMs, easingFunction: easing, shouldInterrupt: true }
  : undefined;
```

Two engine details hide in there. `transition: undefined` is deliberately not
`durationMs: 0` — Smelter remembers a component's last transition, and a zero-ms
one would bleed into later updates. And `shouldInterrupt: true` makes rapid
next-next-next pick up from the current visual position instead of queueing.

## Clap detection is three thresholds and a trick

The clap hook is plain Web Audio: `getUserMedia` → `MediaStreamSource` →
`AnalyserNode`, scanned in a `requestAnimationFrame` loop. The parameters are
where the signal-processing actually lives:

- The analyser watches the **2–5 kHz band** — where a clap's transient energy
  sits, above voice fundamentals and below hiss.
- `smoothingTimeConstant = 0`. The default (0.8) low-passes the spectrum across
  frames and would smear a 50 ms clap into invisibility.
- It takes the band's **peak** dB, not the mean — a clap is a spike in a few
  bins, not a lift of the whole band.

```ts
// editor/lib/audio/useClapDetection.ts
analyser.getFloatFrequencyData(buf);
let peakDb = -Infinity;
for (let i = lowBin; i <= highBin; i++) {
  if (buf[i] > peakDb) peakDb = buf[i];
}
// Baseline = average of older frames in the history (skip the most
// recent ones so a clap doesn't dilute its own baseline).
const baselineLen = peakHistory.length - SKIP_RECENT;
let baselineDb = -Infinity;
if (baselineLen > 0) {
  let sum = 0;
  for (let i = 0; i < baselineLen; i++) sum += peakHistory[i];
  baselineDb = sum / baselineLen;
}
const cooled = now - lastClapAt > cooldownMs;          // 600 ms
const aboveFloor = peakDb >= peakThresholdDb;          // -60 dB
const spike = peakDb - baselineDb >= transientRiseDb;  // +10 dB rise
if (cooled && aboveFloor && spike) { lastClapAt = now; onClap(); }
```

The `SKIP_RECENT` detail is the classic transient-detection trick: the baseline
is the average of the *older* history frames, excluding the most recent ~4, so
the clap can't raise the baseline it's about to be compared against. The
detector needs all three conditions at once — the absolute floor rejects
quiet-room noise, the relative rise rejects steady loud sources like music.

## The server is the debounce

Keyboard and clap both just POST a `carouselAction` (`next`/`prev`/`setIndex`).
The real rate-limiter lives server-side: a per-`(room, layer)` timestamp map
that silently no-ops any action arriving before the previous animation
finished. Wrap-around is a modulo:

```ts
// server/src/routing/routes.ts
const startedAt = carouselTransitionStartedAt.get(`${roomId}:${layerId}`) ?? 0;
if (Date.now() - startedAt < targetLayer.carousel.durationMs) {
  res.status(200).send({ status: 'ok', layers: currentLayers }); // silent no-op
  return;
}
if (action === 'next')      newIndex = (oldIndex + 1) % n;
else if (action === 'prev') newIndex = (oldIndex - 1 + n) % n;
```

That split — **position state owned by the server, config state owned by the
client** (debounced sliders for duration/easing/gap) — is what keeps N editor
clients, a keyboard, a microphone and a voice-command system from fighting over
one carousel.

## Takeaway

A carousel over live video inputs — phone cameras, Twitch streams, MP4s — with
animated GPU transitions, driven by claps, built by an agent from a 15-line
prompt in one commit. The prompt could stay that short because Smelter's React
model absorbs the hard parts: identity-based interpolation, clipping, and a
scene that re-renders like any other React tree.

Try it live in the Smelter Editor, or build it from scratch in your own project
with Smelter Skills — links in the video description.

---
---

# Article 2 — Pong is a pixel shader

> **title:** Pong is a pixel shader: a playable game inside a live stream
> **description:** A fully playable Pong rendered per-pixel by a WGSL shader on top of a live video input — with the webcam inside the ball, an AI opponent that literally sees the past, and a 14-float protocol between browser and GPU.
> **category:** Live Streaming

The original 1972 Pong was Allan Alcorn's training project at Atari. Ours is a
training project too, of a different kind: can an AI agent build a playable
game that lives *inside* a live video stream — not as an overlay app, but as a
**WGSL shader** composited by Smelter on every output frame?

Why a shader? In Smelter, user shaders run per-pixel on every output frame and
get the input video as a texture. That means Pong can be painted *over* the
live input, with the input itself rendered inside the ball — entirely on the
GPU, at stream framerate, with zero extra latency stages.

## The architecture in one breath

The editor runs the actual game — a pure TypeScript simulation ticked in
`requestAnimationFrame`. Thirty times a second it pushes the game state over a
dedicated WebSocket to the server, which merges it into the shader's parameters.
Smelter re-renders, and the stream *is* the game.

```
RAF loop (editor)                    ~60 Hz
  controllers → intents → tick(state, dt)   pure sim, UV coords [0..1]
  canvas preview (local, instant)
  every 33 ms → WS: { pong_shader_partial_update, params: {…14 floats} }
server: merge params into shader → uniform struct → pong.wgsl → output stream
```

The entire game→GPU protocol is **14 floats**: ball x/y, velocities, two paddle
y's, score, countdown, last-bounce event, and a `mode` flag. The sim runs in
normalized UV coordinates `[0..1]` precisely so its numbers are the shader's
numbers — no conversion layer exists.

## Auto mode: the whole attract loop is a triangle wave

The shader has two modes. `mode=0` is a self-contained attract mode: drop the
shader on any input and Pong just plays itself forever, with zero state pushed
from anywhere. The ball's position is a triangle wave of stream time:

```wgsl
// server/shaders/pong.wgsl
// Bounces a position between 0 and 1 using a triangle wave driven by time.
fn bounce(start: f32, vel: f32, time: f32) -> f32 {
    let raw = start + vel * time;
    let m = raw - 2.0 * floor(raw * 0.5);
    return 1.0 - abs(m - 1.0);
}
```

Auto-mode paddles track that ball with a sine wobble whose amplitude grows as
`ai_skill` drops. Switching between the two modes is a handful of `select()`
calls:

```wgsl
let is_manual = shader_options.mode > 0.5;
let ball_x     = select(auto_ball_x,     shader_options.manual_ball_x,    is_manual);
let ball_y     = select(auto_ball_y,     shader_options.manual_ball_y,    is_manual);
let paddle_l_y = select(auto_paddle_l_y, shader_options.manual_paddle_l_y, is_manual);
let paddle_r_y = select(auto_paddle_r_y, shader_options.manual_paddle_r_y, is_manual);
```

Pressing **Start** in the editor pushes `mode=1`; pressing **Reset** pushes one
last update with `mode=0`. That last one matters: without it the stream would
freeze on the final frame of the match. The attract mode doubles as the "never
show a dead stream" guarantee.

## The webcam inside the ball

The ball is an aspect-corrected distance field, and inside it the shader
samples the input texture with a "cover" mapping so a 16:9 frame isn't squeezed
into a circle — it samples the central strip instead:

```wgsl
// server/shaders/pong.wgsl
let bdx = (uv.x - ball_x) * aspect;
let bdy = uv.y - ball_y;
let bdist = sqrt(bdx * bdx + bdy * bdy);
if (bdist < ball_radius) {
    let lu = vec2<f32>(
        (bdx / ball_radius) * cover_x * 0.5 + 0.5,
        (bdy / ball_radius) * cover_y * 0.5 + 0.5,
    );
    let c = textureSample(textures[0], sampler_, clamp(lu, vec2<f32>(0.0), vec2<f32>(1.0)));
    let edge = 1.0 - smoothstep(ball_radius * 0.95, ball_radius, bdist);
    color = mix(color, mix(c.rgb, paddle_color, border_m), edge);
}
```

The score is drawn with a 3×5 bitmap font packed one glyph per `u32` — and the
identical bit-packed table is duplicated in the editor's canvas renderer, so
the operator's local preview is pixel-identical to the broadcast.

## 1972 physics, on purpose

The deflection mechanic is the same trick Alcorn put into the original cabinet:
the exit angle depends on where the ball hits relative to the paddle's center,
which turns rallies into a skill game instead of a coin flip.

```ts
// editor/lib/pong/physics.ts
const hitOffset = (ball.y - paddle.y) / halfH;               // -1..1
const angle = clamp(hitOffset, -1, 1) * MAX_DEFLECT_ANGLE_RAD; // ≈63° max

const speed = Math.min(
  Math.hypot(ball.vx, ball.vy) + BALL_SPEED_INCREMENT_PER_HIT,
  BALL_MAX_SPEED,
);
const newVx = Math.cos(angle) * speed * dir;
const newVy = Math.sin(angle) * speed;
```

The sim is deterministic end to end — serve angles key off score parity, and
the AI's randomness comes from a seeded mulberry32 PRNG — so every physics and
AI behavior is unit-testable without a DOM.

## An AI opponent that sees the past

The AI paddle's difficulty comes from three axes of deliberate imperfection:

| difficulty | reaction lag | predicted bounces | aim noise | max speed |
|---|---|---|---|---|
| easy | 300 ms | 0 | 0.15 | 0.6 |
| medium | 150 ms | 1 | 0.05 | 1.0 |
| hard | 50 ms | 8 | 0.01 | 1.5 |

**Reaction lag** is implemented as time travel: the AI keeps a ring buffer of
ball snapshots and aims using the newest one older than its lag — it literally
plays against the past. **Prediction** walks the ball's trajectory analytically
to the paddle's x, reflecting off walls at most `predictBounces` times — easy
mode gets zero bounces and genuinely whiffs on banked shots. And **aim noise**
is re-rolled only on bounce events, so the paddle glides to a
wrong-but-committed spot instead of jittering:

```ts
// editor/lib/pong/controllers/ai.ts
const targetTime = state.now - this.diff.reactionLagSec;
let snapshot: Sample = this.history[0]!;
for (const h of this.history) {
  if (h.t <= targetTime) snapshot = h;
  else break;
}
// Re-sample aim noise on each new bounce so the AI's "aim point" varies
// between rally segments but stays steady within a segment (no jitter).
if (state.lastBounce && state.lastBounce.time !== this.lastSeenBounceTime) {
  this.lastSeenBounceTime = state.lastBounce.time;
  this.cachedNoise = (this.rng() * 2 - 1) * this.diff.aimNoise;
}
const predicted = predictAtX(snapshot.ball, myX, this.diff.predictBounces);
```

That combination is what makes the AI feel *believably laggy* on stream rather
than robotic.

## Why a dedicated WebSocket

The editor already has a path for changing shader parameters — the sliders in
the shader panel. But that path is HTTP with a ~200 ms debounce, tuned for
humans dragging sliders, not for a 30 Hz game. So the panel opens a dedicated
push socket. The server-side handler then does a **sparse merge** instead of a
replace:

```ts
// server/src/routing/routes.ts — merge, don't clobber
const mergedParams = s.params.map((p) => {
  seen.add(p.paramName);
  const incoming = params[p.paramName];
  return typeof incoming === 'number' ? { ...p, paramValue: incoming } : p;
});
for (const [name, value] of Object.entries(params)) {
  if (!seen.has(name) && typeof value === 'number') {
    mergedParams.push({ paramName: name, paramValue: value });
  }
}
```

That merge is why you can drag the ball-radius slider *while a match is
running* and neither writer clobbers the other — both are writing into the same
uniform struct, 30 times a second.

Multiplayer (added later) keeps the same shape: the first player to join is the
host and runs the entire sim; the guest sends paddle intents and locally
predicts only its own paddle, so it never rubber-bands, while ball and score
always come from the host.

## Takeaway

A tournament intermission, a charity stream, a BRB screen — anywhere you'd put
a static placeholder, you can put a playable game instead, with the live feed
inside the ball. No capture cards, no OBS gymnastics: the game state is 14
floats, and the GPU that's already compositing your stream draws the rest.

---
---

# Article 3 — Anatomy of a hackathon surveillance rig

> **title:** Cameras, numpy and Gemini: anatomy of a hackathon surveillance rig
> **description:** A weekend-built surveillance app on Smelter: WHIP cameras in, WHEP out, motion detection in 11 lines of numpy, automatic MP4 clips, and Gemini 2.5 Flash filing severity-rated incident reports.
> **category:** Broadcasting

This episode's project wasn't generated from a prompt — it's an existing app,
built by Patryk at a hackathon organized by Software Mansion and Gemini. It's a
video surveillance tool: multiple cameras stream in, motion gets scored in real
time, incidents get recorded to MP4, and Gemini writes up what happened with a
severity rating. Serious events fire a Web Push notification even with the
browser tab closed. Everything persists in SQLite.

The first test was accidental: fire up the app, light a cigarette at the desk
while it boots, and by the time the dashboard loads Gemini has already filed a
report on you, severity badge attached.

What makes the codebase worth reading is one architectural idea used five
different ways.

## Everything is a Smelter output

The server embeds Smelter (0.3.x here) and drives it with a React 18 component
tree. Cameras arrive over **WHIP** (browsers publishing WebRTC) or as looping
local MP4s; the composited result leaves over **WHEP**. But look at what else
`registerOutput` is used for:

- the main 1080p live view (WHEP output),
- a small per-camera preview for the dashboard (more WHEP outputs),
- **recording** — an incident clip is just an MP4 output that gets registered
  when motion starts and unregistered when it ends,
- and the **motion detector's frame source** — a throwaway 320×240 RTP stream
  to localhost.

There is no separate encoder, muxer, or screenshot code anywhere in the
project. One primitive, five jobs.

```tsx
// server/src/motion.tsx — a mini output that exists only to feed Python
await SmelterInstance.registerOutput(
  outputId,
  <View style={{ backgroundColor: '#000000' }}>
    <InputStream inputId={inputId} />
  </View>,
  {
    type: 'rtp_stream',
    port, ip: '127.0.0.1', transportProtocol: 'udp',
    video: {
      resolution: { width: 320, height: 240 },
      encoder: {
        type: 'ffmpeg_h264', preset: 'ultrafast',
        ffmpegOptions: { tune: 'zerolatency', g: '15', 'forced-idr': '1' },
      },
    },
  }
);
```

The ffmpeg options matter: `g: '15'` and `forced-idr` force frequent keyframes
so the Python side's decoder locks on immediately instead of waiting seconds
for an IDR frame.

## Motion detection: no OpenCV, no ML — 11 lines of numpy

On the Python side, ffmpeg decodes that RTP stream to raw grayscale
(`-pix_fmt gray -s 320x240`), which makes every frame exactly 76,800 bytes —
so the "protocol" between ffmpeg and Python is a `read(FRAME_BYTES)` loop with
no framing at all. The detector itself is frame differencing:

```python
# server/motion_detector.py
DIFF_THRESHOLD = 10
SAMPLE_INTERVAL = 0.3   # seconds between motion score reports

def compute_motion_score(prev: np.ndarray, curr: np.ndarray) -> float:
    diff = np.abs(curr.astype(np.int16) - prev.astype(np.int16))
    changed = np.count_nonzero(diff > DIFF_THRESHOLD)
    return round((changed / diff.size) * 100.0, 1)
```

A score is "percent of pixels that changed since the last frame," reported at
~3 Hz per camera. That's it. For an apartment with three phone cameras, it's
completely sufficient — and it costs nothing next to an ML detector.

## Focus follows motion, with manners

Scores flow back to Node over stdout and drive a tiny arbitration store that
the Smelter scene subscribes to via `useSyncExternalStore` — so a focus change
is just a React re-render, and the camera swap animates because the `Rescaler`
styles change under a 700 ms cubic-bezier transition.

The arbitration has two rules that stop it from thrashing:

```ts
// server/src/focusStore.ts
if (score <= noiseThreshold) return;
if (focusedInputId === null) { focus(inputId); return; }   // first mover wins
if (Date.now() - lastSwitchTime < COOLDOWN_MS) return;      // 3 s cooldown
// Switch only if the incumbent went quiet OR the challenger dominates 2×
if (currentScore <= noiseThreshold || score >= currentScore * DOMINANCE_FACTOR) {
  focus(inputId);
}
```

A camera has to *double* the incumbent's motion score to steal focus mid-event.
Two people walking in different rooms don't ping-pong the stream.

## Recording: linger windows and zero-gap rotation

Recording state is a small per-camera machine. Motion above threshold starts a
clip (register MP4 output). Motion dropping below threshold doesn't stop it —
it schedules a stop **5 seconds out**, and returning motion cancels the timer,
so a clip stretches as long as the event does. A hard 30-second cap rotates
files, and the rotation registers the *new* output before unregistering the old
one, so nothing is lost in the handoff.

One production-grade wrinkle hides here: `unregisterOutput()` returns before
the MP4's moov atom is flushed, so the analyzer polls the file size until it's
stable before uploading. The file existing is not the file being done.

## Gemini as the incident reporter

Finished clips go into a sequential queue, upload via the Gemini File API, and
get analyzed by **Gemini 2.5 Flash** against a prompt with a strict output
contract:

```
Analyze this home security camera footage.
You are turned on most often when the owner isn't at home — beware of suspicious activity.
If the camera cuts to dark it probably means someone covered it to block the view!
Return a JSON object with exactly two fields:
  - "description": a brief description in English of what is happening (1-2 sentences)
  - "severity": exactly one of: "funny" | "unimportant" | "moderate" | "serious"
Return ONLY valid JSON, no markdown, no additional text.
```

`serious` → Web Push to every subscribed browser (the VAPID keys are generated
on first boot and stored in SQLite — zero push configuration). `unimportant` →
the clip is auto-deleted. Everything — clips, analyses, camera names, settings,
push subscriptions — lives in one SQLite file in WAL mode.

And the part demoed in the video: because the analysis is *one prompt string*,
the same pipeline happily re-purposes itself. Swap the local-video inputs for
gangsta-rap music videos, tweak the prompt to call out the most unhinged
moments, and the identical engine, thresholds and recorder produce a completely
different product. (Verdict: most of what happens in those videos is,
disappointingly, technically legal.)

## The workaround that became a feature

Notice what the motion tap really is: the pipeline **re-encodes and re-decodes
every camera a second time** just so Python can see pixels. At hackathon scale,
fine. But it's pure overhead — the compositor already had those frames decoded.

That exact pattern is why Smelter now ships a native **side channel**: since
v0.6.0, any input can hand its already-decoded frames directly to an external
process over a local socket — no second encode, no RTP, no SDP files. The next
article takes that one feature and builds three completely different things
with it.

---
---

# Article 4 — One tap on the pipeline: the side channel, three ways

> **title:** One decode, three demos: Smelter's side channel
> **description:** Smelter v0.6.0 hands already-decoded frames to external processes over a local socket. We point it at Whisper for perfectly-timed captions, at YOLO for hue-painted drone traffic, and at a ghost swarm that haunts people on camera.
> **category:** Live Streaming

Quick refresher: Smelter consumes input streams and composes them into outputs
— that's the pipeline. The **side channel**, added in Smelter v0.6.0, is a
second tap on it: the compositor hands already-decoded frames — video or audio
— straight to an external process over a local socket. No re-decoding, and a
configurable delay means whatever's listening gets each frame *before* it hits
the output.

I'd been doing this the hard way — a janky bolt-on that decoded the stream a
second time so my Python had something to look at (see the previous article).
Swapping that for the side channel on plain motion detection made the
difference obvious the second I hit play: the old way decoded the same video
twice; this decodes once. So the question stops being "how do I get video into
my AI" and becomes "what do I actually do with it."

## The plumbing

Enabling it is one field at input registration:

```ts
await smelter.registerInput(inputId, {
  type: 'whip_server',
  sideChannel: { video: true, audio: true, delayMs: 3000 },
});
```

Frames arrive on a Unix domain socket per input, in a format simple enough
that its whole spec fits in a docstring:

```
Both video and audio messages are framed with a 4-byte big-endian
u32 length prefix.

Video payload (always RGBA):
    u32 width
    u32 height
    u64 pts_nanos
    [u8; width * height * 4] rgba_data

Audio payload:
    u64 start_pts_nanos
    u32 sample_rate
    u8  channel_count
    u32 sample_count
    [f64] samples   (interleaved, values in [-1, 1])
```

The crucial field is `pts_nanos`: it's the **pipeline clock** — the exact time
this frame will be presented on the output. Every trick below is built on it.

The `delayMs` creates a simple contract. The worker sees a frame `delayMs`
before viewers do; when its result comes back after `procMs` of inference, the
server holds the overlay for the remainder, so boxes land on the video instead
of running ahead of it:

```ts
// server/src/room/RoomState.ts
// The side channel hands frames to the worker ~delayMs before the output
// presents them. Hold the on-output overlay until the frame is due, minus
// the time the worker already spent processing it.
const holdMs = Math.max(0, outputDelayMs - procMs);
```

In other words: the side channel converts "AI is always late" into "AI has a
time budget."

## Demo 1: captions that land on the speech

Flip the tap to audio and hang a transcriber off it: **Silero VAD** in front
(so Whisper only runs on actual speech) and **faster-whisper** behind it,
running fully locally. The sidecar resamples side-channel audio to 16 kHz in
512-sample windows — and each window keeps its own PTS, so when VAD detects a
speech segment, the transcript inherits the exact stream-time of its first
word.

Then the delay pays off. With an 8-second audio side channel, the server
receives the transcript *before the words have played on the output*, and
schedules the caption against the pipeline clock:

```ts
// server/src/captions/CaptionBridge.ts
const start = SmelterInstance.getStartTime();
const wait = start === null ? 0 : start + event.ts - Date.now();
if (wait <= 0) { this.opts.onTranscript(event); return; }
setTimeout(() => this.opts.onTranscript(event), wait);
```

The result: captions that appear exactly when the words play — landing *on*
the speech instead of trailing behind it like every bad livestream caption
you've seen. The renderer is just Smelter React again: a bottom-pinned rounded
`View` with wrapped `Text`, sized relative to its tile so it survives any
layout change.

## Demo 2: drone traffic in Skittles colors

Video tap, different problem: bird's-eye drone footage of an intersection,
with a shader rotating the hue inside every detected car.

The war story first. The standard street-level YOLOv8 weights found **exactly
zero cars** in top-down footage — that viewpoint simply isn't in COCO. One swap
to aerial **VisDrone** weights (`yolov8s-visdrone`) and the same frame yielded
35 detections, faster. The worker selects classes *by name* (`car`, `van`,
`truck`, `bus`), so COCO and VisDrone weights interchange without config
changes.

Detection runs on CPU at only ~4–6 results per second. The color stays glued to
the cars anyway, because between detections the renderer dead-reckons:

```ts
// server/src/inputs/motionPredictor.ts
// The track's expected position at `nowMs`: last target led forward along
// the estimated velocity, capped so it can't run ahead of what one-or-so
// missed responses could plausibly explain.
predict(id: number, nowMs: number): number[] | undefined {
  const e = this.entries.get(id);
  if (!e) return undefined;
  const horizon = Math.min(Math.max(0, nowMs - e.at), cap);
  return e.target.map((t, i) => t + e.vel[i] * horizon);
}
```

A 60 fps tick eases each drawn region toward its *predicted* position, so a
handful of detections per second turns into glassy motion. Each stable track id
maps to a hue via a golden-ratio hash — a car keeps its color for as long as
it's tracked.

The recolor itself is a WGSL shader taking up to 16 box slots. Two details make
it look right: the tint is a **feathered ellipse** inscribed in each box (edges
hide tracker jitter far better than a hard rectangle), and rotation alone can't
recolor a silver car — there's no hue to rotate — so the shader boosts
saturation and *paints* bright achromatic pixels instead. Broadcast live over
WebRTC, the whole street lights up like a bag of Skittles.

## Demo 3: the ghosts

Same video tap, YOLO tuned to people, plus a tracker that gives each person a
stable id across detections. Above the video floats a pool of ghost sprites.
Each ghost locks onto the nearest unclaimed person and hovers over their head;
the whole behavior is a pure, unit-tested state machine —
`bored → looking (1 s, holds still) → hunting` — and the chase is an
exponential ease with a hard speed cap:

```ts
// server/src/haunter/haunterModel.ts
const k = Math.min(1, (EASE_PER_S * speed * dtMs) / 1000);
let dx = (tx - g.px) * k;
let dy = (ty - g.py) * k;
const maxStep =
  ((target ? MAX_SPEED_FRAC : IDLE_SPEED_FRAC) * speed * minEdge * dtMs) / 1000;
const len = Math.hypot(dx, dy);
if (len > maxStep && len > 0) {
  dx *= maxStep / len;
  dy *= maxStep / len;
}
```

When a ghost's victim leaves the frame, its track id disappears; the ghost goes
calm, floats back up to its home row, and drifts on a slow Lissajous curve
until someone new shows up. Detection ticks a few times a second, physics run
at sixty fps — so it glides instead of snapping. And it took almost no code,
because "where are the people" just falls out of the side channel.

## The gotcha worth knowing

The whole sidecar pattern has one hard rule: **never let inference block the
socket.** From the worker's own docstring:

```python
# The socket reader and YOLO inference run as SEPARATE coroutines sharing a
# single-slot "latest frame" holder — this split is the whole point. Inference
# takes tens to hundreds of ms; if it ran inline in the read loop the socket
# would go undrained... Draining continuously on its own coroutine keeps the
# buffer empty; inference just consumes the most recent frame and lets the
# rest fall on the floor (we rate-limit output anyway).
```

Drain on one coroutine, infer on another, and always process the *latest*
frame rather than queueing all of them. Real-time AI on video is a sampling
problem, not a throughput problem.

So: same feature, three times. Audio into a transcriber, video into a detector
feeding a shader, video into a ghost sidecar. One tap, one decode — and what
you hang off it is up to you. None of it is pre-rendered; it's all one live
Smelter stream, broadcast over WebRTC while it happens.

---
---

# Article 5 — Duck Hunt on a live stream

> **title:** Duck Hunt on a live stream: YOLO birds, gyro pistols, and one pure function of time
> **description:** Real birds on camera spawn NES-style ducks; phones become gyro-aimed light guns over WebRTC. The whole hit-registration problem dissolves into a single shared function of time.
> **category:** Community

This episode is Duck Hunt. On a live stream. With real birds.

The machinery is the side channel again: decoded frames go to a Python sidecar
running YOLO, this time tuned to spot birds. Every real bird found on the
stream spawns a NES-style duck sprite on top of it. The duck holds still for a
beat, then takes off at forty-five degrees toward the top-right corner —
straight out of 1984. Your phone is the gun: it scans a QR code, joins the
room, shows the live stream, and aims with its gyroscope. Multiplayer from the
first line of code.

Under the arcade nostalgia there are four genuinely interesting engineering
problems.

## Problem 1: birds are 12 pixels

Street-level YOLO weights are trained on birds that fill a decent chunk of the
frame. A bird in the sky is a dozen pixels — squeeze a 1080p frame down to the
model's input size and it simply vanishes. The sidecar deals with it the way
aerial-imagery people do (SAHI-style): **tiled inference**. The frame is split
into an overlapping 2×2 or 3×2 grid, each tile inferred at full detail, and the
results merged with cross-tile non-max suppression.

On top of that runs **motion fusion**: cheap frame-differencing on a downscaled
gray frame catches moving blobs YOLO missed, and emits them as low-confidence
detections — deliberately below the YOLO threshold, so they're distinguishable.
When more than 15% of the frame moves it backs off, because that's a camera
pan, not a flock.

(Small confession from the video: real birds don't cooperate on camera, so an
AI-generated clip of ducks stood in for some of the dynamic cuts.)

## Problem 2: hitting what you see

Here's the trap in any shooter-over-video design: the phone shoots at what it
*sees*, but what it sees is a WebRTC stream some hundreds of milliseconds
behind the server's present. If the server hit-tests a shot against "where the
duck is now," every shot lands behind the duck.

The fix is to make the duck's flight a **pure function of time**, computed
identically by the server and the renderer from the same spawn point:

```ts
// server/src/duckHunter/duckFlight.ts
/**
 * Duck center in normalized content space [0,1] at time `now`. The flight is a
 * pure function of (now - spawnAt), so the server and renderer agree exactly.
 */
export function duckContentPos(d, now, p, v) {
  const elapsed = Math.max(0, now - d.spawnAt);
  if (elapsed <= p.pauseMs) return { x: d.cx0, y: d.cy0 };
  // Output px travelled since the pause ended (45° → equal px on both axes).
  const travel =
    ((p.flySpeed * Math.max(v.width, v.height)) / 1000) * (elapsed - p.pauseMs);
  return {
    x: d.cx0 + travel / dispW,  // fly right
    y: d.cy0 - travel / dispH,  // and up
  };
}
```

No velocity state, no interpolation code, nothing to drift. The renderer calls
this at 60 Hz to draw; the server calls the *same function* when a shot
arrives. A duck's entire life is `(spawnAt, cx0, cy0)`. Two nice consequences
fall out for free:

- **The 45° is really 45°.** Content space is anisotropic (the video is
  cover-fitted into the output), so the travel distance is computed in output
  pixels and divided by the display dimensions per axis — the diagonal stays
  true on screen.
- **Hit-stop costs three lines.** When a duck is shot, the whole flock freezes
  for the classic beat — implemented not with a pause flag but by pushing every
  live duck's `spawnAt` forward each tick. The flight stays a pure function of
  `(now - spawnAt)`, and the freeze propagates to every client automatically.

One more subtlety: the server hit-tests against the **eased crosshair the
player actually sees on the broadcast**, not the raw latest aim sample. The
rendered crosshair is smoothed, so it lags the raw aim while the phone moves —
hit-testing raw aim made shots land ahead of the visible crosshair, in the
direction of motion. Shoot what you see, literally.

## Problem 3: a phone is not a mouse

Aiming uses the gyroscope as a **gyro-mouse**: integrate angular velocity, move
the crosshair by how much the phone rotated. The obvious alternative — the
`deviceorientation` angles — gimbal-locks the moment you hold the phone upright.
Which is, you know, how you hold a gun. The *angles* freeze near beta ≈ 90°;
the angular *rates* stay well-defined at any attitude.

The neat part is the yaw axis. Rotating "left-right" should mean rotation about
*world-up*, regardless of how the phone is tilted — so the horizontal axis
projects the rotation-rate vector onto gravity, estimated from a low-passed
accelerometer:

```ts
// editor/app/mobile/[roomId]/shoot/page.tsx
case 'yaw':
default: {
  // Yaw about true world-up (ω·û), û = -gravity/|g|. Falls back to rotation
  // about the screen's up axis when gravity isn't available.
  if (grav) {
    const m = Math.hypot(grav.x, grav.y, grav.z);
    if (m > 1) return -(wx * grav.x + wy * grav.y + wz * grav.z) / m;
  }
  return wx * up[0] + wy * up[1];
}
```

Each integration step gets a deadzone (hand tremor), a per-frame clamp
(sensor spikes), and a sensitivity gain. And because no two people hold an
imaginary pistol the same way, there's a calibration screen: pick which axis
drives what, flip it, tune sensitivity — persisted per phone in localStorage.

A favorite hack hides in the trigger options. Browsers don't expose hardware
volume keys — but while an `<audio>` element is playing, Android routes the
volume buttons to that element's volume:

```ts
// Keep a looping silent clip playing and treat a volume *increase* as a shot,
// then snap the volume back to mid so there's always headroom in both directions.
const onVol = () => {
  if (audio.volume > prev + 0.001) fire();   // volume up → shoot
  if (audio.volume !== 0.5) audio.volume = 0.5;  // re-arm
};
```

A silent WAV loop turns the volume rocker into a trigger.

## Problem 4: one URL, no app

The phone experience is "scan a QR code, you're holding a gun" — no app, no
pairing. That takes some infrastructure honesty: the gyroscope API requires
HTTPS, and the editor, the API/WebSocket server, and the WebRTC media server
are three services. All three are merged behind a single reverse-proxy origin
and one tunnel, so there's exactly one https:// URL in the QR code and no
mixed-content anywhere.

Multiplayer was free from the start because the room is the unit: every phone
gets its own crosshair color, ammo is operator-configured (magazine size,
reload time — regeneration is one round per interval, server-side), and the
scoreboard lives on the broadcast itself. Flip on your phone's camera and your
face joins the broadcast next to your score — it's just one more WHIP input
into the same compositor, mirrored by a selfie shader.

Even the sprites got an engineering footnote: Smelter samples textures
bilinearly, which would blur 36-pixel NES sprites into mush. So a script
pre-upscales them 16× with nearest-neighbor, and Smelter *downsamples* a crisp
image instead of upsampling a tiny one.

## And the pistol

Grip: the handle of a saw. Barrel: a tube that used to hold glow sticks. A bike
phone mount up top, a Bluetooth button as the trigger, a beer opener because
every serious build has one, and a stick of DDR2 RAM as a heat sink. Does it
cool anything? No. Does it look like it does? Absolutely.

None of what it shoots at is post-production. YOLO finds the birds, Smelter
composites the ducks, the crosshairs, the scoreboard and the players' faces
into every frame live, and pushes it out over WebRTC while it happens. The
phone just needs the stream and a socket — you could join the hunt from the
other end of the internet, out of the box.

Everything from this episode is up at [workshop.smelter.dev](https://workshop.smelter.dev)
— grab a phone, join the room, shoot some ducks. The code is there too: pull it
apart and build your own on top of it.
