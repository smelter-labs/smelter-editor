# `editor` + `mobile_app` integration - extended collaboration options

## Context

Currently both applications operate on the same server-side room state (`layers`, `inputs`, timeline playback), but they have different product roles:

- `editor` is the "planning" tool and timeline management tool,
- `mobile_app` is the "execution" tool for quick live changes.

This is a good foundation, but without explicit collaboration rules it's easy to run into "who won the last write" conflicts. Below are three realistic architectural options, from the simplest to the most advanced.

---

## Option 1: Control modes (roles + permission policy)

### Idea

We introduce an explicit room work mode and map client permissions onto it:

- `timeline_mode` (`editor` has priority),
- `live_mode` (`mobile_app` has priority),
- optionally `hybrid_mode` (a restricted subset of actions on both sides).

Key point: this is not just a UI lock. The policy must also be enforced on the server, with unambiguous rejection of disallowed mutations.

### How it works in practice

1. The room has a `controlMode` field (e.g. `timeline`/`live`/`hybrid`).
2. Every mutating request (`POST /room/:id`, `POST /input/:id`, timeline endpoints) passes through an operational authorization layer.
3. The server checks:
   - what the client's current role is (`editor`, `mobile`, possibly `observer`),
   - what the room mode is,
   - whether the given action is allowed.
4. When an action is not allowed, the server returns a predictable domain error (e.g. `409 CONTROL_MODE_CONFLICT`) and emits an event with the reason.
5. The client shows a clear message ("Timeline active - this change is temporarily blocked").

### Example permission matrix

- In `timeline_mode`:
  - `editor`: full timeline API + layout modifications.
  - `mobile`: only quick actions without geometry allowed (e.g. mute/unmute, hide/show), no `updateLayers`.
- In `live_mode`:
  - `mobile`: full manipulation of inputs/layout.
  - `editor`: read-only + possibly "offline" timeline changes (no apply/play on the room).
- In `hybrid_mode`:
  - both sides can change selected aspects, but e.g. layout geometry only one side at a time.

### Pros

- Lowest implementation cost.
- Very good operational predictability for the production team.
- Easy to communicate ("mobile is in control now", "timeline holds the lock now").

### Cons

- Less flexibility when multiple operators work simultaneously.
- Somewhat "administrative" UX (modes have to be switched).
- Doesn't solve ambitious collaboration scenarios, it only organizes them.

### Risks and how to mitigate them

- **Risk:** Lock only on the UI side, backend still accepts mutations.
  - **Mitigation:** Rule enforcement on the server as the source of truth.
- **Risk:** Operators don't know who has control.
  - **Mitigation:** persistent indicators in both apps + a `control_mode_changed` event.

### When to choose this option

When the goal is to quickly stabilize collaboration and limit conflicts without a large protocol refactor.

---

## Option 2: Server-side arbitration (intent-based, deterministic merge)

### Idea

Instead of sending "overwrite the state", clients send change intents (commands/intents) with metadata. The server becomes the arbiter and decides to:

- accept,
- reject,
- or rebase (recompute) the change.

This is a more "systemic" model, similar to collaborative apps.

### How it works in practice

1. The client sends an `intent` (e.g. `MOVE_INPUT`, `SET_LAYER_ORDER`, `APPLY_TIMELINE_STATE`) along with:
   - `sourceId`,
   - `clientTimestamp`,
   - `baseRevision` (the state version the client was based on),
   - `priority` or `scope`.
2. The server keeps a monotonic `roomRevision`.
3. When an intent arrives:
   - if `baseRevision` is current -> apply immediately,
   - if not -> the server tries to rebase or rejects with a conflict code.
4. An event with the decision and the new state/revision is sent to clients (`intent_applied`, `intent_rejected`, `room_updated`).
5. The UI can show "Your change didn't go through because the timeline changed the same area".

### What needs to be added

- A shared `Intent` model in `@smelter-editor/types`.
- A room state revision number.
- Conflict logic per domain:
  - geometry/layout,
  - input properties,
  - timeline playback/state.
- Readable domain error codes and telemetry.

### Pros

- Best conflict control with multiple operators.
- Full auditability ("who tried to change what, and when").
- Scales to future clients (e.g. a producer panel, voice bot, automations).

### Cons

- Highest implementation and testing cost.
- Greater mental complexity for the team.
- Risk of a longer time "to first business value".

### Risks and how to mitigate them

- **Risk:** Too many conflict rules at once, a large number of edge cases.
  - **Mitigation:** start with 2-3 critical intents (layout move, hide/show, timeline play/stop).
- **Risk:** Latency regressions.
  - **Mitigation:** latency metrics on the intent -> arbitration -> broadcast path.

### When to choose this option

When you're planning a multi-operator control room long-term and want a deterministic system, not just procedural "working rules".

---

## Option 3: Live overlay on top of the timeline (base state + runtime overrides)

### Idea

We separate two levels of state:

- **Base state**: the timeline prepared in `editor` (the plan),
- **Overlay state**: temporary live corrections from `mobile_app` (the execution).

The final render is: `effectiveState = baseState + overlay`.

Instead of fighting over who overwrites the shared state, we give mobile a dedicated "live" layer that can be reset or "committed" to the timeline.

### How it works in practice

1. Timeline playback establishes base positions and parameters.
2. Mobile only sends overlay commands (e.g. "offset x/y", "temporarily increase blur", "manual hide for 3s").
3. The server merges this at render time and broadcasts the effective state plus overlay diagnostics.
4. The operator has actions:
   - `clear overlay`,
   - `freeze overlay`,
   - `commit overlay to timeline` (writing selected changes back to clips/keyframes).

### Example semantics

- The timeline moves input A to the top-left corner.
- Mobile makes a live correction of +30px X and +10px Y.
- At the next keyframe the base changes, but the overlay still acts as an offset, so the movement stays "at hand" for the live operator.

### What needs to be designed

- Overlay scope:
  - geometry only?
  - geometry + selected shader params?
  - visibility/audio as well?
- Overlay TTL (e.g. automatic expiry after N seconds of inactivity).
- Priority rules (does overlay always win over base? only for selected fields?).
- An API for committing the overlay to the timeline.

### Pros

- Very natural division: the editor plans, mobile "performs live".
- Minimizes destructive overwriting of the timeline.
- Gives the producer creative control without breaking the script.

### Cons

- Requires a mature data model and good UX so the operator understands what is "base" and what is "overlay".
- Harder debugging without good inspection tools (a layer inspector).
- Careful rules for committing the overlay to the timeline are needed.

### Risks and how to mitigate them

- **Risk:** "Invisible state" - the operator doesn't know where the result comes from.
  - **Mitigation:** a diagnostic panel: base vs overlay vs effective.
- **Risk:** Stacking multiple overlays from different clients.
  - **Mitigation:** single-writer overlay or splitting the overlay into a namespace per source.

### When to choose this option

When the product goal is real live performance and quick operator corrections, and the timeline is meant to remain "the plan", not "the only place of mutation".

---

## Option comparison (decision shortcut)

- **Option 1 (Control modes):**
  - simplest,
  - fastest to implement,
  - best for "right now", to stop the conflicts.
- **Option 2 (Arbitration):**
  - most systemic,
  - best for multiple operators and future scale,
  - but most expensive to start.
- **Option 3 (Overlay):**
  - best product-wise for live production,
  - strong "wow" effect and operator ergonomics,
  - medium/high cost and more domain decisions.

---

## Recommended rollout path (iterative)

### Phase 1: Stabilization (2-4 sprints)

- Implement **Option 1** (modes + hard enforcement on the server).
- Unify `sourceId` and events across all clients.
- Add clear conflict messages and telemetry.

### Phase 2: Live UX expansion (subsequent sprints)

- Add a "mini-overlay" for 1-2 cases (e.g. geometry offset + hide/show).
- Check how operators actually use it.

### Phase 3: Target architecture

- If advanced concurrency is needed: move toward **Option 2**.
- If live production is the priority: develop the full **Option 3**.

---

## What this delivers for the business

- Fewer conflicts and fewer "surprises" in production.
- Clear division of responsibility between operators.
- Better scalability of the production process (timeline + live performance without chaos).
