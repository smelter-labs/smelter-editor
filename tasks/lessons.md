# Lessons Learned

> Auto-generated from analysis of 69 agent sessions (Feb 20 – Mar 3, 2026).
> Updated by the self-improvement loop per RULES.md §3.

---

## 1. Scope & Context Misunderstanding

### 1.1 Clarify which system/feature before coding
- **Pattern:** Agent assumed RageTis when user meant Snake; assumed game logic changes when user wanted visualization-only.
- **Sessions:** aba3245e, 8051e57d
- **Rule:** Ask "which feature/module?" if ambiguous. Never assume — 30s of clarification saves 30min of wrong work.

### 1.2 Don't assume layout terms
- **Pattern:** "Second column" vs "second row" — agent built the wrong layout.
- **Session:** 1a9adcd5
- **Rule:** Clarify spatial terms (column/row/grid) before implementing UI layout changes.

### 1.3 Global vs context-specific settings
- **Pattern:** Agent tied `enable/disable auto play macro` to macro mode; user wanted it always available.
- **Session:** 1eecb6ea
- **Rule:** Confirm whether a setting is global or context-dependent before implementing.

---

## 2. Multi-Layer Debugging

### 2.1 Check ALL layers, not just the obvious one
- **Pattern:** CORS fixed in `route.ts` but real cause was `next.config.ts` headers. Active Rooms names looked correct in backend but `.filter((r) => r.isPublic)` hid rooms in UI.
- **Sessions:** 29ef4b49, 421d48dd
- **Rule:** When a fix doesn't work, trace the full request/data path from client → API → server → response → rendering. Don't stop at the first plausible fix.

### 2.2 Distinguish transport vs rendering bugs
- **Pattern:** `smoothMove: false` was sent correctly, but renderer still ran interpolation.
- **Session:** 7bcc5bb1
- **Rule:** Verify the fix at the layer where the symptom appears, not just where the data originates.

### 2.3 Debounce vs request queuing
- **Pattern:** 20-30s delay on shader slider changes. Agent focused on debounce; real cause was `refreshState()` firing after every tick, queuing heavy requests.
- **Session:** 259f220d
- **Rule:** When UI feels slow, check for unnecessary state refresh calls, not just debounce timing. Use `refresh: false` for fire-and-forget updates.

---

## 3. React / Hooks Patterns

### 3.1 Stale closures in async event handlers
- **Pattern:** `onAddShader`, `onRemoveShader`, `onSetTextMaxLines` used `inputs` from closure instead of `inputsRef.current`. Macros applied shaders to wrong inputs.
- **Session:** 89e66092, multiple
- **Rule:** For async handlers driven by external events or macros, always use refs (`inputsRef.current`) instead of closure state. Keep this consistent across ALL handlers.

### 3.2 Hook ordering matters
- **Pattern:** `handleRecordAndPlay` used `play`/`stop` before `useTimelinePlayback` was called → "can't access lexical declaration before initialization".
- **Session:** 7861d5c6
- **Rule:** Order `useCallback` definitions so dependencies are declared before use. Keep hook call order stable.

### 3.3 Type re-exports in `'use server'` files break Turbopack
- **Pattern:** `export type { ... } from '@/lib/game-types'` in a `'use server'` file caused build errors.
- **Session:** multiple
- **Rule:** Never re-export types from `'use server'` files. Have consumers import types directly from the source module.

### 3.4 Circular dependencies
- **Pattern:** `game-types.ts` ↔ `actions.ts` circular import.
- **Rule:** Define shared types in a dedicated module that does not depend on other app modules. One-way dependency only.

---

## 4. API Schema & Validation

### 4.1 Schema must include ALL fields clients send
- **Pattern:** `snake1Shaders`/`snake2Shaders` missing from `UpdateInputSchema`; Fastify stripped them with `removeAdditional: true`.
- **Session:** multiple (Mar 1-2)
- **Rule:** When adding new fields to a client payload, ALWAYS add them to the Fastify TypeBox schema. Missing fields get silently stripped → hard-to-debug 400s or missing data.

### 4.2 Use `Type.Optional()` for partial updates
- **Pattern:** `UpdateInputSchema` required `volume`; client sent only `snakeEventShaders` → 400 error.
- **Rule:** Partial update endpoints should mark all fields as `Type.Optional()`. Validate only what the client provides.

### 4.3 Don't clear unrelated fields in partial updates
- **Pattern:** Setting scroll speed cleared text content because patch included `text: undefined`.
- **Session:** d90f2310
- **Rule:** Voice/macro handlers must send ONLY the fields they intend to change. Never include `undefined` values that could overwrite existing data.

### 4.4 Preserve existing state when building new state
- **Pattern:** `buildUpdatedGameState` dropped `activeEffects`.
- **Rule:** When merging incoming data into existing state, explicitly preserve/merge fields not in the payload. Don't rebuild from scratch.

---

## 5. Voice Commands

### 5.1 Handle natural language variants in regex
- **Pattern:** `FLIP_INPUT_PATTERN` didn't handle "flip input **to** horizontal" (with "to").
- **Session:** a43f4a5e
- **Rule:** Design regex to handle conversational phrasing: "X to Y", "set X to Y", "X Y". Test with spoken-language variants.

### 5.2 Don't silently fail on invalid commands
- **Pattern:** Text-specific handlers checked `input.type !== 'text-input'` and returned silently — user had no idea why command failed.
- **Session:** 907638d4
- **Rule:** Always emit error feedback (via `emitActionFeedback` with `error` type) when a command can't execute. Silent returns are never acceptable.

### 5.3 Dispatch timeline sync events for property updates
- **Pattern:** `SET_TEXT_SCROLL_SPEED` updated input but didn't dispatch `smelter:timeline:update-clip-settings-for-input` → `BlockClipPropertiesPanel` showed stale data.
- **Session:** d90f2310
- **Rule:** Text property handlers (scroll speed, font size, color, align, etc.) MUST dispatch `smelter:timeline:update-clip-settings-for-input` to keep timeline/block panel in sync.

### 5.4 All input type branches must participate in shared post-add logic
- **Pattern:** Camera/screenshare branches in `onAddInput` didn't set `addedInputId` → default orientation wasn't applied.
- **Session:** a43f4a5e
- **Rule:** When extending shared logic after a switch/if-else, ensure EVERY branch sets the shared variable. Or centralize post-add logic after the switch.

### 5.5 Add homophone aliases for STT confusion
- **Pattern:** Speech-to-text produced "truck" instead of "track", so `select second truck` did not select a track.
- **Session:** current
- **Rule:** For voice command nouns (`track`, `layout`, etc.), include common homophone aliases in normalization and add regression tests for the spoken phrase.

---

## 6. Macro Execution

### 6.1 Macro steps must await completion
- **Pattern:** `macroExecutor` dispatched events + fixed delay instead of awaiting handler completion. Steps ran before previous async work finished (e.g. `ADD_SHADER` before `ADD_INPUT` completed).
- **Session:** 89e66092
- **Rule:** Use `requestId` + `smelter:voice:macro-step-complete` handshake so macro ordering is deterministic. No fire-and-forget for steps that have async side effects.

### 6.2 Propose non-redundant fixes
- **Pattern:** Agent proposed Fix 2 (refresh before shader steps) AND Fix 3 (await handler completion) — they were redundant.
- **Session:** 89e66092
- **Rule:** When proposing multiple fixes, explain their relationship. Remove redundant fixes that add complexity without benefit.

---

## 7. Snake / Game Specific

### 7.1 Interpolation state management
- **Pattern:** `prevCellsRef` vs `interpolationFromCellsRef` mix-up caused `from == to` → no movement. Segment pairing by "closest cell" instead of chain order → segments moved independently.
- **Session:** d48aa953
- **Rule:** Interpolation must use stable "from" snapshot. Update "from" only when a new tick arrives, not during animation. Pair segments by chain order (head→tail), not proximity.

### 7.2 Sticky room lifecycle
- **Pattern:** `gameId` persists across Play Again; only page refresh creates new room. Don't clear route on timeout.
- **Rule:** Preserve `gameId` and room mapping across game-over/play-again. Clear only on explicit disconnect.

---

## 8. Infrastructure / Production

### 8.1 Docker volume permissions
- **Pattern:** Config save failed with EACCES — Docker bind mounts create root-owned dirs.
- **Session:** ec014fff
- **Rule:** Use entrypoint `chown` or init container for bind-mounted directories in Docker.

### 8.2 Production error handling
- **Pattern:** Server actions in production hid real errors. Fix: return `{ ok, error }` result objects instead of throwing.
- **Session:** 7861d5c6
- **Rule:** Never throw in server actions for expected failures; use result-based API `{ ok: boolean, error?: string }`.

### 8.3 Don't claim GPU is required when CPU fallback exists
- **Pattern:** README said GPU required; Smelter can fall back to CPU.
- **Session:** 644730ec
- **Rule:** Check runtime behavior before documenting requirements. Use "recommended" over "required" when fallback exists.

---

## 9. UI Defaults

### 9.1 No opinionated invisible defaults
- **Pattern:** Text inputs got default `borderWidth: 8` without user control or visibility.
- **Session:** fe007ca9
- **Rule:** Use zero/neutral defaults. All styling must be user-configurable. Never add invisible opinionated defaults.

### 9.2 Show current values next to sliders
- **Pattern:** Scroll speed slider had no numeric readout.
- **Session:** d90f2310
- **Rule:** Always display the current numeric value next to range sliders.

---

## 10. Code Quality

### 10.1 Don't use `as EventListener` for CustomEvent
- **Pattern:** `CustomEvent` handlers passed to `addEventListener` caused TS errors with `as EventListener`.
- **Rule:** Use `as unknown as EventListener` for `CustomEvent` callbacks, or use a typed wrapper.

### 10.2 ASCII for diagrams
- **Pattern:** README architecture diagram misaligned with Unicode box-drawing chars.
- **Rule:** Use plain ASCII (`+`, `-`, `|`) for diagrams — portable across all fonts/terminals.

### 10.3 Tests reflect source of truth
- **Pattern:** Tests expected legacy shader names (`HOLOGRAM`); parser returned runtime IDs (`sw-hologram`).
- **Rule:** Decide whether tests or implementation are source of truth FIRST. Then update the other to match.

---

## Severity Summary

| Category | Critical | High | Medium |
|----------|----------|------|--------|
| Scope misunderstanding | 2 | 1 | — |
| Multi-layer debugging | — | 3 | — |
| React/Hooks | — | 2 | 2 |
| API Schema | 1 | 2 | 1 |
| Voice Commands | — | 3 | 1 |
| Macro Execution | — | 1 | 1 |
| Snake/Game | — | 1 | 1 |
| Infrastructure | 1 | 1 | 1 |
| UI Defaults | — | 1 | 1 |
| Code Quality | — | — | 3 |
