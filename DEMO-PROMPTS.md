# Demo Prompts

A collection of example AI prompts used to generate features in this project.

## Carousel

Example prompt for generating carousel functionality in the layer system:

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

## Pong

```
Add a "Pong" dashboard panel to the editor and a matching WGSL shader on the
streaming server, connected via a low-latency WebSocket. Goal: user plays Pong
in the panel; the game lands live in the stream through a shader applied to a
video input.
GAME ENGINE (editor/lib/pong/, pure TS, no React):
- All coords in UV [0..1] to match shader space.
- Physics: wall bounces; Atari-style paddle bounce (exit angle scales with hit
  offset from paddle center); ball speed grows per hit; emit BounceEvents.
- predictAtX(ball, targetX, maxBounces): pure deterministic trajectory
  predictor for AI.
- Match state machine: idle → countdown → playing → (pointScored → countdown)*
  → matchOver. Pure tick(state, dt, intents, config). Configurable firstTo.
- PaddleController interface → PaddleIntent (absolute targetY or relative
  direction). Implementations: keyboard (W/S + ↑/↓), mouse, AI.
- AI: deterministic mulberry32 PRNG, per-side seed. Difficulty params:
  reaction lag, predicted bounces, aim noise (re-sampled ONLY on new
  BounceEvent — no mid-rally jitter), max speed. Presets easy/medium/hard.
- 2D canvas preview renderer including score in a 3×5 bitmap font IDENTICAL to
  the shader's (same bit-packed digits).
- buildPongParamUpdates(state, mode, config) → sparse shader param map.
- Unit tests for physics, tick, AI.
REACT PANEL (editor/components/dashboard/pong-panel.tsx):
- Register panel id 'pong', add to layout preset.
- 2-column layout: left = 16:9 canvas (ResizeObserver + DPR) + score +
  Start/Reset. Right = stream input picker (only inputs with 'pong' shader),
  per-side controller, AI difficulty, firstTo.
- RAF loop, dt capped at 1/30s. Game state in useRef. React state updates ONLY
  on score/phase change.
- Keyboard/mouse hooks store state in refs (zero re-renders).
- Distinct AI seeds per side.
LOW-LATENCY PUSH:
- useShaderPushSocket(roomId): dedicated WS, exp-backoff reconnect, best-effort
  send. In RAF, push sparse update ~30Hz, only when phase !== 'idle'. On Reset
  push one update with mode=0 so the shader returns to auto (otherwise stream
  freezes on last frame). Reason for side channel: normal slider path has
  ~200ms debounce, too slow.
SERVER (server/src/routing/routes.ts):
- WS handler accepts { type: 'pong_shader_partial_update', inputId, shaderId,
  params }. MERGE params into the shader (override existing, keep absent,
  append new) — CRITICAL: must not clobber concurrent slider edits.
SHADER (server/shaders/pong.wgsl + register in shaders.tsx):
- Params: ball/paddle geometry, colors, trail, particles, score_*, mode (0=auto
  / 1=manual), manual_ball_*, manual_vel_*, manual_paddle_l/r_y,
  manual_last_bounce_{time,x,y,kind}, manual_countdown_remaining.
- mode=0: fully self-contained — deterministic triangle-wave ball, AI paddles
  tracking it. Drop the shader on any input and it just runs.
- mode=1: render from manual_* pushed by editor.
- Render: court, paddles, ball with optional input texture inside, trail,
  particle burst on bounces (wall vs paddle different color), score in 3×5
  bitmap font (SAME bits as editor canvas), countdown.
GENERAL:
- Game logic deterministic and pure — testable without a DOM.
- Per-frame work must NOT trigger React re-renders. Use refs.
- Panel runs concurrently with shader-param slider edits — never clobber.
- Branch: @piotrsnow/[short-feature-slug].
```
