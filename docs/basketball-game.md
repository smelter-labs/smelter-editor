# Basketball game ("Blacktop")

A one-hoop streetball production: two phones on tripods (hoop cam + court cam),
a moderator courtside, and the `basketball-scorer` AI counting made baskets from
the hoop camera and calling the team by jersey colour. FIBA 3x3 rules by
default: first to 21 or 10 minutes, tied at the buzzer → overtime, first team to
+2 wins. Sibling of the kettlebell tournament — same kit, same phone plumbing.

## Pages

| URL | Who | What |
|---|---|---|
| `/basketball-game` | host laptop | title → setup (teams, colours, rules, AI, output) → lobby (3 QR codes) → live → final |
| `/basketball-game/<roomId>` | host | same, rehydrated after a refresh |
| `/basketball-game/panel/<roomId>?server=…` | moderator (phone/tablet/laptop) | pending AI calls (A / B / VOID, 1↔2), clock, manual points, views, jersey colour sampling, optional cam + mic |
| `/mobile/<roomId>/bb-cam?role=hoop\|court` | camera phones | claim a role → rear camera → GO LIVE → (hoop) calibrate the rim → live view with AI feedback |
| `/mobile/<roomId>/bb-commentate` | commentator phone | cam + mic on air (no referee controls) |

The join links are built by the host lobby (`?server=` carries the API base, the
same way the kettlebell pages do) and pushed to the server, which burns the
three QR codes into the broadcast lobby scene.

## Camera placement

**Hoop cam (runs the AI).** Phone in landscape on a tripod or clamp, **front-side
of the hoop at ~45° to the backboard, 5–8 m from the rim, at least 2.5 m up**
(a tall tripod, a fence post, a friend's shoulders). The rim should sit in the
upper-middle third of the frame with the whole backboard and the net visible,
and the shooter's side of the court in view (the AI attributes a make by looking
back to who released the ball). No sun into the lens. **Do not touch the phone
after calibrating** — the rim ellipse is in image coordinates; if the phone is
bumped, tap RECALIBRATE RIM on the phone.

Why this angle: from front-elevated the rim is an ellipse the ball drops
*into*, the net hangs *below* it, and both the release and the make are in one
frame. A top-down camera above the backboard is the most reliable for the
make itself but sees no shooters and has nowhere to mount at a street court; a
pure side view is blind to depth (a ball flying past the rim looks like a
make).

**Court cam.** Wide on the half-court from mid-court, as high as possible.
This is the broadcast picture; the hoop cam is the picture-in-picture and is
featured full-frame on every make.

**Moderator.** Phone in hand courtside. Pending calls (low-confidence
attribution) show up ~3 s *before* the make airs; keyboard A / B / V work on a
laptop.

## Rim calibration + the shot state machine

The hoop phone grabs a still from its preview, the operator drags an ellipse
onto the rim (centre, width handle, height handle) and taps CALIBRATE. The
ellipse `{cx, cy, rx, ry}` is normalized (0..1) and reaches the worker as flat
params (`rimCx`… `rimSet`). Zones around it (`analysis.py`):

```
idle ──(ball in the band ABOVE the rim)──▶ flight
flight ──(centre inside the ellipse, descending)──▶ rim
rim ──(in the NET band under the rim)──▶ net ──(dwell + slowdown)──▶ MAKE ▶ cooldown
```

A ball flying past the rim also projects onto the ellipse from an elevated
camera, so entering it is never enough: a make needs the ball to *slow down*
inside the net band (the net catches it) or to hang there ≥ 250 ms; a pass-by
falls through at free-fall speed → attempt, no make. A ball that vanishes in
the net (mesh, a player under the hoop) still counts (`lost_in_net`
evidence). Rim-outs, air balls and pass-bys count as attempts for FG%.

Attribution: on a make the worker walks a 4 s ring buffer back to the last
frame the ball overlapped a person box (the release), samples that person's
torso band and classifies the colour against the two team colours. The
confidence is the margin between the two; below `autoAssignMinConf` (60 %)
the make lands in the moderator's queue as **REF CALL**.

## Broadcast

All three cams keep the engine's WHIP side channel, i.e. the same 3 s buffer,
so court, hoop PiP, commentary audio and the HUD stay in sync. The worker sees
frames ~3 s before viewers do, so on a make the layout cuts to the hoop cam
**while the ball is still in the air** and the SCORE banner + score bug land
exactly when it drops (`HUD_HOLD_MS`). Layout follows immediately, data is held.

Scenes: lobby (QRs + cam status over the court cam) · live (court + hoop PiP +
score bug) · score (hoop full-frame, SCORE! banner, release still) · hoop /
court / caster / split (moderator overrides) · ended (final card with makes,
attempts, FG%, twos, lead changes).

## Running it

```bash
# API + engine (macOS: the side-channel patched engine, see the side-channel memory)
cd server && BB_SIM=1 SMELTER_PATH=~/.smelter/v0.6.0-scfix/main_process pnpm start
# editor
cd editor && pnpm dev
```

`BB_SIM=1` enables the dev routes `POST /room/:id/basketball-game/simulate-shot`
(`{team|null, confidence, points}`) and `POST …/mp4-cam` (`{role, fileName}`, a
looping clip from `server/data/mp4s` as a camera with a real side channel).

Phones on 5G through a tunnel have no media path without TURN (see the
kettlebell phone-testing memory) — use the same Wi-Fi as the server, or a
recording via "USE A RECORDING" on the camera page.

### Tests

```bash
cd server && pnpm vitest run src/basketball src/__tests__/bbStore.test.ts
python3 src/ai-models/basketball-scorer/test_analysis.py      # stdlib only, 37 trajectories
cd editor && pnpm vitest run components/basketball-game
# end to end (API running with BB_SIM=1 SKIP_PYTHON=1)
node server/scripts/basketball-e2e.mjs
# synthetic clip through the real model (API with the Python sidecars)
node server/scripts/basketball-synth-clip.mjs                 # → data/mp4s/bb-synth.mp4
node server/scripts/basketball-model-check.mjs bb-synth.mp4 --detector hsv --teams '#2ee06a,#1f7bff' --expect-makes 3
node server/scripts/basketball-model-check.mjs my-clip.mp4 --detector auto --rim 0.5,0.35,0.06,0.02 --teams '#ff6a1f,#1f7bff'
```

Visual check of the HUD: start a recording (`POST /room/:id/record/start`),
drive the room, stop, and pull frames with `ffmpeg -ss <t> -i data/recordings/<file> -frames:v 1 out.png`.

### Ops notes (GPU box / Docker)

- Weights: `yolo11n.pt` (CPU default) / `yolo11s.pt` (CUDA default) are
  prefetched by the Dockerfile into `basketball-scorer/`; `BASKETBALL_YOLO_WEIGHTS`
  or the `yoloWeights` setting overrides. The worker shares the
  `people-counter` venv (no new venv volume).
- `SMELTER_SIDE_CHANNEL_MAX_RESOLUTION=640` (compose.dev) makes a far ball tiny;
  the rim-crop second pass compensates, but prefer 1280 (or unset) on a GPU box
  and have the hoop phone publish 1920×1080.
- `AI_SIDECAR_NUM_THREADS` caps the worker's CPU threads next to the encoder.
- Stills for the queue / SCORE inset are written to `data/bb-shot-frames/` and
  served at `/bb-shot-frames/:file`; they are swept when the room is deleted.

### Wire protocol (room WS, `bb_` prefix)

Client → server: `bb_spectate`, `bb_cam_join {role, name?, camKey?}`,
`bb_cam_request {nativeWidth?, nativeHeight?}`, `bb_cam_stop`, `bb_cam_leave`,
`bb_rim_calibrate {rim}`, `bb_team_color {team, color}`,
`bb_commentator_join {name, commentatorKey?}`, `bb_commentator_cam_request`,
`bb_commentator_leave`, `bb_commentator_view {override}`,
`bb_commentator_match {action, role?}`, `bb_commentator_caster_pip {enabled}`,
`bb_shot_resolve {shotId, team?, points?, voided?}`, `bb_shot_add {team, points}`,
`bb_shot_undo {shotId?}`.

Server → client: `bb_state`, `bb_match` (1 Hz clock), `bb_shot {kind, shot,
scores}`, `bb_cam_joined`, `bb_commentator_joined`, `bb_cam_offer`, `bb_ball`
(hoop phone), `bb_lead_change`, `bb_error`.

REST: `POST /room/:id/basketball-game/{config,match,shot}`, `GET …/state`, dev
`simulate-shot` + `mp4-cam` (BB_SIM=1). Types live in
`packages/types/src/basketball-game-events.ts`.

## Not in v1 (next steps)

Arc detection from the court cam (2-pt shots by shooter position), player
self-registration with avatars and per-player attribution, a 12 s shot clock,
instant replay from the recording buffer, Polish UI, and migrating the
kettlebell / duck-hunter pages onto the shared `use-join-link` helper.
