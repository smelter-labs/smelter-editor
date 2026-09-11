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

## Design ("Blacktop")

The design package lives in `docs/design/blacktop/` (Claude Design canvases:
open `Blacktop.dc.html` for the index — brandbook, HUD 1920×1080 with the
per-plate position table, host app, moderator, phones). The language:
asphalt `#141416`, chalk text (`#F4EFE6` on air, `#E8E4DA` in the apps),
one electric accent (`#33E1FF` / `#22D3EE`), gold only on WINNER, plates
`rgba(20,20,22,.94)` / `rgba(30,30,34,.94)` with a single cut top-right
corner and no hairline, team colours only ever as 16 px stripes / 4 px rules
/ 12 px chips — never under text. Big Shoulders Display (900 wordmark /
SCORE! / FINAL / final scores, 800 names + scores, 700 banners) and IBM Plex
Mono (600 clocks + tags, 500 status, 400 tracked meta).

- Web: `editor/components/basketball-game/bb-kit.tsx` (+ `bb-kit.css`) is
  the whole kit — tokens `BB`, `Wordmark`, `BbPlate`, `BbButton`, `Segment`,
  `Stepper`, `NameField`, `JerseyGrid`, `ScoreRow`, `LedgerRow`,
  `RefCallCard`, `StatusPill`, `HostFrame`; phones use `phone/bb-phone-shell`
  + `bb-connect-step` / `bb-name-step` / `bb-cam-mic-step`. Host screens draw
  at 2/3 of the 1080p design in the 1280×720 arcade stage. Fonts come from
  `app/basketball-game/fonts.ts` (`--font-bb-display` / `--font-bb-mono`).
  Nothing under `basketball-game/` imports the kettlebell kit; only its
  hooks (rig, recovery, recording, preview, WHIP) are shared.
- Broadcast: `server/scripts/bb-render-assets.mjs` renders the neutral
  plates into `server/imgs/bb/*.png` (committed; re-run after editing);
  `server/src/inputs/BbHud.tsx` composites runtime text at the design's
  positions (`bbHudMetrics.ts` holds the clock face / tag chip / PiP anchor
  maths, unit-tested). Big Shoulders Black 900 is
  `server/fonts/big-shoulders/BigShouldersDisplay-Black.ttf` (instanced from
  the Google Fonts VF at opsz 72 / wght 900).

## Running it

```bash
# API + engine (macOS: the side-channel patched engine, see the side-channel memory)
cd server && BB_SIM=1 SMELTER_PATH=~/.smelter/v0.6.0-scfix/main_process pnpm start
# editor
cd editor && pnpm dev
```

`BB_SIM=1` enables the dev route `POST /room/:id/basketball-game/simulate-shot`
(`{team|null, confidence, points}`).

### File cameras (test clips instead of phones)

Drop clips into `server/data/mp4s` (sub-folders are fine, e.g.
`bb-test/hoop.mp4` + `bb-test/court.mp4`) and pick them in the host lobby
(under each camera's QR) or in the moderator panel (CAMERAS). The clip is
registered as a looping `local-mp4` input with the same video side channel a
phone would get, so the scorer sees real decoded frames; the list rescans the
folder on every screen open (RELOAD LIST forces it). Attaching a clip to a
role a phone holds retires the phone's stream (the phone shows NO SIGNAL); the
phone keeps the slot and can publish again, which drops the clip.

Synchronized clips: arming the scorer re-registers the hoop clip with its
side channel a beat after it is attached, so hoop and court drift apart by
that latency. The second USE FILE restarts both from 0:00 automatically, and
RESTART CLIPS 0:00 does it again on demand (both go through one critical
section, so the offsets come from the same pipeline time). The side channel
also delays the hoop picture by 3 s (the AI sees frames before the viewers;
WHIP cams all carry that delay, a court clip does not), so the sync starts
each clip at `playFromMs` + its own delay: the hoop clip runs 3 s further
into the file and both show the same moment on air, while
`cams.hoop.clip.playFromMs` / shot `mediaMs` report the AI-side media time.

REST: `POST /room/:id/basketball-game/mp4-cam` (`{role: hoop|court, fileName}`,
relative to `data/mp4s`, `.mp4` only, no traversal) and
`POST …/mp4-cam/sync` (`{playFromMs?}` → `{inputIds}`).

`playFromMs` is a real seek only up to the pipeline's age: the engine can
delay an input but not start it mid-file, so "play from X" places the clip's
start at pipeline time now − X. Asking for more than the pipeline has lived
restarts the clip at media ≈ pipeline age instead, and `cams[role].clip.playFromMs`
reports that effective position (the server log says `clamp-offset`). To
work on a later part of a long clip, cut it (`basketball-bench.mjs` does this
itself, into `data/mp4s/bb-bench/`).

Phones on 5G through a tunnel have no media path without TURN (see the
kettlebell phone-testing memory) — use the same Wi-Fi as the server, a file
camera as above, or a recording via "USE A RECORDING" on the camera page.

### Ground-truth replay (annotated throws instead of the model)

With file cameras attached, the moderator panel (CAMERAS → GROUND TRUTH) can
load an `events.json` from `data/mp4s` (the one next to the clip is picked by
default) and fire its throws at their clip media time instead of scoring with
the model: makes land in the ledger as `source: 'replay'` (ledger rows say
`GT: A 2PT`), misses count as attempts, and the model's own shot events are
ignored while a replay is loaded (the scorer stays armed so the hoop clip
keeps its 3 s side-channel delay and the ball overlay). Each throw fires when
the model would have reported it — frame time + side-channel delay − the HUD
hold + 300 ms — so the predictive cut and the held score behave exactly as on
a live make. Throws before START are skipped; RESTART CLIPS / a re-attach
re-anchors the schedule; the file loops with the clip.

REST: `POST /room/:id/basketball-game/replay` (`{action?: 'load'|'off',
fileName, basket?: left|right|both, loop?, pointsMap?, teamMap?}` → `{replay}`),
`DELETE …/replay`, `GET /suggestions/bb-events`. `bb_state.replay` carries
`{fileName, total, fired, skipped, nextEventTMs, nextFireInMs, clockRole}`;
`bb_state.cams[role].clip` is the file cam's playhead `{playFromMs, mediaMs,
durationMs, delayMs}` and every shot gets `mediaMs` when the hoop is a clip.

Events file shape (`scripts/apidis-events.mjs`, `basketball-synth-clip.mjs`):
`{t0Utc, teams: {A: {attacks}, B: {attacks}}, events: [{tMs, kind: 'throw',
made, points: 0|1|2|3, team, shotType, basket: 'left'|'right', …}]}`;
free throws and 2-pt field goals score 1 in the 3x3 ledger, 3-pt goals score
`config.arcPoints`.

### Tests

```bash
cd server && pnpm vitest run src/basketball src/__tests__/bbStore.test.ts
python3 src/ai-models/basketball-scorer/test_analysis.py      # stdlib only, 37 trajectories
cd editor && pnpm vitest run components/basketball-game
# end to end (API running with BB_SIM=1 SKIP_PYTHON=1)
node server/scripts/basketball-e2e.mjs
BB_E2E_MP4=bb-synth.mp4 node server/scripts/basketball-e2e.mjs   # + file cams, sync, model
BB_E2E_MP4=apidis/q2/cam7.mp4 BB_E2E_REPLAY=apidis/q2/events.json node server/scripts/basketball-e2e.mjs   # + ground-truth replay
# synthetic clip through the real model (API with the Python sidecars)
node server/scripts/basketball-synth-clip.mjs                 # → data/mp4s/bb-synth.mp4 + bb-synth.events.json
node server/scripts/basketball-model-check.mjs bb-synth.mp4 --detector hsv --teams '#2ee06a,#1f7bff' --expect-makes 3
node server/scripts/basketball-model-check.mjs my-clip.mp4 --detector auto --rim 0.5,0.35,0.06,0.02 --teams '#ff6a1f,#1f7bff'
# precision / recall of AI makes against an events.json (see "Benchmark" below)
node server/scripts/basketball-bench.mjs bb-synth.mp4 --events bb-synth.events.json --detector hsv --teams '#2ee06a,#1f7bff'
```

### APIDIS dataset (fixed hall cameras)

[APIDIS](http://www.apidis.org/Dataset) (UCLouvain, 2008): one basketball
game from 7 fixed cameras (1600×1200, ~22 fps real) with every throw
annotated (time, team, made / points) — **non-commercial research use only,
credit the APIDIS project**. It is the reference footage for the scorer on
fixed hall cameras; a local copy lives outside the repo (`APIDIS_DIR`).

Layout: cams 7 (side, elevated — the hoop cam), 5 (fisheye above), 1 (wide
side), 2 (behind the board) see the **left** basket; cams 3 (fisheye), 6
(wide), 4 (corner) the right one. In the first half team A attacks the
right basket (Q2 `events.json` says `teams.A.attacks = right`). File names
carry local time (+02) with a misleading `Z`; the real UTC per frame is in
the `.avi.idx` sidecars. The capture dropped frames, so a plain remux plays
1.1–1.45× too fast — `apidis-prep.mjs` re-times from the sidecars.

```bash
A=~/…/pzpn/archive
# ground truth for a quarter (media time = UTC − 16:46:00Z for Q2)
node server/scripts/apidis-events.mjs --archive $A --quarter 2 --out server/data/mp4s/apidis/q2/events.json
# true-time 25 fps clips (+ .apidis.json sidecars with a rim suggestion, stills)
node server/scripts/apidis-prep.mjs --archive $A --cams 7,5,3,1,6 --from 2008-04-09T16:46:00Z --to 2008-04-09T17:04:30Z --out server/data/mp4s/apidis/q2 --stills
```

Then USE FILE hoop = `apidis/q2/cam7.mp4`, court = `cam1.mp4` in the panel
(or the benchmark below). Needs ffmpeg and `mkvmerge` (`brew install mkvtoolnix`).

**Demo clips (first make within 10 s).** A full quarter starts with minutes
of no scoring and a clip cannot be seeked past the pipeline's age, so cut
windows that start just before a make:

```bash
node server/scripts/bb-clip-window.mjs --clips apidis/q2/cam7.mp4,apidis/q2/cam1.mp4 \
     --from-s 411.65 --to-s 471.65 --events apidis/q2/events.json --out demo/left-make-420s
```

writes `data/mp4s/demo/left-make-420s/{cam7,cam1}.mp4` (60 s, make at 9.0 s),
`events.json` shifted onto the window (+ `cam7.events.json` so GROUND TRUTH
picks it), and `cam7.rim.json` — the hoop file cam applies a `<clip>.rim.json`
(or the `.apidis.json` rim) on USE FILE, so no phone calibration is needed.
Ready-made: `demo/left-make-213s`, `left-make-420s`, `left-make-570s` (all
team B on the left basket, cam7 hoop + cam1 court; the make lands 9 s in —
leave ≥ 8 s before it: after a sync the hoop clip runs 3 s ahead for the AI
and its worker needs a couple of seconds to re-subscribe). Verified on
`left-make-420s`: the AI scores the 9.0 s make 1.4 s early, team B at 0.62.

A montage of several windows (`--windows a-b,c-d,…`) cuts every clip at the
same points and concatenates them, so hoop and court stay in sync across the
seams, with `events.json` remapped onto the montage timeline:

```bash
node server/scripts/bb-clip-window.mjs --clips apidis/q2/cam7.mp4,apidis/q2/cam1.mp4 \
     --windows 204.35-232.35,411.65-439.65,561.3-589.3 --events apidis/q2/events.json --out demo/left-3-makes
```

→ `demo/left-3-makes/{cam7,cam1}.mp4`, 84 s, team B makes at 9 / 37 / 65 s.
Through the pipeline (HALL CAM preset, `analysisFps` 25) all three are scored.
Keep `analysisFps` at the clip's frame rate for hall footage: the net
crossing lasts 3–5 frames, and at 20 fps the worker (~40 ms per frame on
MPS) samples it too thinly. The full-frame person pass, needed only for the
release lookup, runs every `BASKETBALL_PERSON_EVERY` frames (default 3) and
the full-frame ball fallback every `BASKETBALL_FALLBACK_EVERY` (default 2);
the rim-crop ball pass runs on every frame. Frames wait in a bounded queue
(`BASKETBALL_FRAME_QUEUE`, default 6) instead of "newest only", so a slow
frame no longer costs the next one; the worker's log line every 200 frames
shows the achieved rate and the mean detect time.

Manual points (panel → MANUAL POINTS) are refused in the lobby and after the
final: START first. The panel shows every server refusal under the plate.

### Ball detector fine-tune (`bb-ball.pt`)

The COCO "sports ball" detector barely sees the ball on hall footage (~30 px,
dark orange, 22 fps): through the worker it found the ball in 0.3 % of the
annotated APIDIS frames, so no shot ever reached the state machine. The
dataset's manual ball labels (6.6 k boxes over one minute × 7 cams, 12.9 k
centres over three minutes) train a single-class YOLO11 ball model that the
worker uses for the ball while persons still come from COCO:

```bash
cd server && V=src/ai-models/people-counter/.venv/bin/python
$V scripts/bb-ball/build_dataset.py --archive $A --cams 7,5,3,6,1 --out data/bb-train/apidis --preview 20
$V scripts/bb-ball/train.py --model yolo11n.pt --name bb-ball-n --smoke              # 1 epoch on 5 %
$V scripts/bb-ball/train.py --model yolo11n.pt --name bb-ball-n --epochs 25 --install # → basketball-scorer/bb-ball.pt
APIDIS_DIR=$A $V scripts/bb-ball/eval.py --weights yolo11n.pt --mode worker            # COCO baseline
APIDIS_DIR=$A $V scripts/bb-ball/eval.py --weights bb-ball.pt --mode crops --conf 0.1,0.2,0.3
APIDIS_DIR=$A $V scripts/bb-ball/eval.py --weights bb-ball.pt --mode worker            # the real detect() path
```

- Frames come from the source AVIs joined with the `.idx` timestamps (the 25
  fps mp4s duplicate frames and would slip labels by up to a frame). Images:
  the worker's rim crop (`analysis.rim_crop_box`, positives + negatives), a
  jittered crop around the ball, and the full frame at 1280. Split by media
  time: train ≤ 198 s, val ≥ 200 s; the benchmark runs on ≥ 240 s, outside
  both.
- `worker.detect_yolo` runs the ball model on the rim crop at 640 first (side
  = 16·rx, ≥ 480 px, letterboxed up), then the full frame; `yoloWeights:
  'bb-ball.pt'` selects it (setup → AI REFEREE → WEIGHTS, or the HALL CAM
  preset). The file is gitignored — copy it to
  `server/src/ai-models/basketball-scorer/` on every box; a missing file falls
  back to `auto` with a warning.
- To adapt to your own hall camera: label a few minutes of the ball (any tool
  that writes YOLO txt), add them to `data/bb-train/<name>` next to the
  APIDIS export and re-run `train.py` from `bb-ball.pt`.
- Rim calibration matters more than the detector: the sidecar's rim is only
  a guess from the annotated `basket` box (kept as `rimSuggested`); on a side
  view the hoop sits at one edge of that box. Calibrate by hand — a zoomed
  still of the basket (ffmpeg `crop`+`scale`+`drawgrid`) plus
  `eval.py --mode trace --from-s <make−2> --to-s <make+1> --rim cx,cy,rx,ry`,
  which prints the detected and annotated ball per frame with its zone and
  the state machine's state — then write the ellipse into `cam{N}.apidis.json`
  (`rim`) so the bench and USE FILE pick it up. Fisheye top views (APIDIS cams
  3 and 5) show the hoop as a circle the ball drops *into*; the above → rim →
  net state machine is a side-view model and does not score them.
- Make evidence on real footage: a clean layup crosses the net in ~0.2 s with
  no measurable deceleration at 22 fps, but the mesh hides the ball for a
  frame or two — `net_occluded` (seen in the net, lost inside it, out under
  the bottom) is what fires on APIDIS; `decel` / `net_dwell` cover balls the
  net actually catches.

### Benchmark (AI makes vs ground truth)

`basketball-bench.mjs` plays a clip as the hoop file cam through the real
pipeline, seeks to the window, starts a match and matches every AI make (by
clip media time, ±4 s) against the made throws of an `events.json`:

```bash
node scripts/basketball-bench.mjs apidis/q2/cam7.mp4 --events apidis/q2/events.json --basket left --from-s 240 --to-s 600 --detector yolo --weights bb-ball.pt --teams '#62611e,#151711'
```

Reports precision / recall / F1, signed timing bias (`medianDeltaMs`), team
accuracy (raw AI guess and after auto-assign), `ballTrackedPolls`, and writes
`data/bb-bench/<clip>-<ts>.json`. Results on APIDIS Q2 (media ≥ 240 s; jerseys
yellow `#62611e` vs dark `#151711`):

| hoop cam | basket | detector | ball recall / precision (worker path, val 200–240 s) | zone recall | makes, 240–600 s window (2 annotated) |
|---|---|---|---|---|---|
| cam7 | left | COCO yolo11n @640 | 0.06 / 1.00 | 0.00 | 0 TP · 0 FP · ball in 0/362 polls |
| cam7 | left | bb-ball.pt | 0.29 / 0.98 | 1.00 | **1 TP** (Δ −1.5 s) · 1 FP (rattled 3-pt miss) · ball in 220/360 polls |
| cam6 | right | bb-ball.pt | 0.25 / 0.98 | 0.78 | 0 TP · 0 FP (offline trace on the source frames scores the 397.8 s layup) |
| cam1 | left, wide | bb-ball.pt | 0.27 / 0.88 | 0.83 | 0 TP · 2 FP (conf ≤ 0.03, pending) — ball 27 px, rim 30 px |
| cam5 / cam3 | fisheye, top view | bb-ball.pt | 0.19 / 0.85 · 0.21 / 0.87 | 0.80 · 1.00 | not scored — the side-view state machine does not apply |

"Ball recall" counts every annotated frame, most of them far from the rim
where only the full-frame pass at imgsz 640 looks (a 12 px ball); "zone
recall" is the fraction of frames inside the above / rim / net zones the
state machine needs — that is the number that matters. Team colours for
APIDIS Q2: B (attacks left) is the yellow kit `#62611e`, A the dark `#151711`;
pass `--teams '#151711,#62611e'` or team accuracy reads as 0.

Known gaps after this pass (next steps): the live pipeline still scores
fewer makes than the offline trace on the same throws (the 25 fps CFR clip
carries ~12 % duplicated frames and the worker samples the newest frame at
`analysisFps`, so the net crossing is seen with fewer distinct samples —
try `analysisFps` 25 and a duplicate-frame guard in the worker); a rattled
miss with a long dwell in the net band still reads as a make; cam1-style
wide views need a larger crop / imgsz; fisheye top views need their own
"ball entered the circle" rule.

Visual check of the HUD: start a recording (`POST /room/:id/record/start`),
drive the room, stop, and pull frames with `ffmpeg -ss <t> -i data/recordings/<file> -frames:v 1 out.png`.

### Ops notes (GPU box / Docker)

- Weights: `yolo11n.pt` (CPU default) / `yolo11s.pt` (CUDA default) are
  prefetched by the Dockerfile into `basketball-scorer/`; `BASKETBALL_YOLO_WEIGHTS`
  or the `yoloWeights` setting overrides. `bb-ball.pt` (hall fine-tune) is not
  in git: `scp` it into `server/src/ai-models/basketball-scorer/` (and
  `dist/ai-models/basketball-scorer/` when running from dist) before selecting
  it. The worker shares the `people-counter` venv (no new venv volume).
- `SMELTER_SIDE_CHANNEL_MAX_RESOLUTION=640` (compose.dev) makes a far ball tiny;
  the rim crop runs at native resolution but a 640-wide frame leaves a hall
  ball at ~12 px — use 1280 (or unset) for this game on a GPU box and have a
  hoop phone publish 1920×1080. A live hall camera should give the rim ≥ 80 px
  (≥ 1280 px wide, elevated side view like APIDIS cam7).
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

REST: `POST /room/:id/basketball-game/{config,match,shot}`, `GET …/state`,
`POST …/mp4-cam` + `…/mp4-cam/sync` (file cameras), `POST/DELETE …/replay` +
`GET /suggestions/bb-events` (ground-truth replay), dev `simulate-shot`
(BB_SIM=1). `bb_state.cams[role].source` is `whip` | `file` (+ `fileName`,
`clip`); `bb_state.replay` is the loaded replay or null.
Types live in `packages/types/src/basketball-game-events.ts`.

## Not in v1 (next steps)

Arc detection from the court cam (2-pt shots by shooter position), player
self-registration with avatars and per-player attribution, a 12 s shot clock,
instant replay from the recording buffer, Polish UI, and migrating the
kettlebell / duck-hunter pages onto the shared `use-join-link` helper.
