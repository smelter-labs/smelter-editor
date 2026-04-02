# Workflow Orchestration

## 1. Plan Mode Default
- Enter plan mode for **ANY non-trivial task** (3+ steps or architectural decisions)
- If something goes sideways, **STOP and re-plan immediately** — don't keep pushing
- Use plan mode for **verification steps**, not just building
- Write **detailed specs upfront** to reduce ambiguity

## 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

## 3. Self-Improvement Loop
- After **ANY correction from the user**: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

## 4. Verification Before Done
- Never mark a task complete without **proving it works**
- Diff behavior between `main` and your changes when relevant
- Ask yourself: _"Would a staff engineer approve this?"_
- Run tests, check logs, demonstrate correctness

## 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask _"Is there a more elegant way?"_
- If a fix feels hacky: _"Knowing everything I know now, implement the elegant solution"_
- Skip this for simple, obvious fixes — **don’t over-engineer**
- Challenge your own work before presenting it

## 6. Autonomous Bug Fixing
- When given a bug report: **just fix it**. Don’t ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

# Task Management

1. **Plan First**  
   Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**  
   Check in before starting implementation
3. **Track Progress**  
   Mark items complete as you go
4. **Explain Changes**  
   High-level summary at each step
5. **Document Results**  
   Add review section to `tasks/todo.md`
6. **Capture Lessons**  
   Update `tasks/lessons.md` after corrections

---

# Core Principles

- **Simplicity First**  
  Make every change as simple as possible. Minimal code impact.

- **No Laziness**  
  Find root causes. No temporary fixes. Senior developer standards.

- **Minimal Impact**  
  Changes should only touch what’s necessary. Avoid introducing bugs.


---

# Code Rules (learned from past mistakes)

## TypeScript / Type Safety
- **Never cast to `any`** — use union types (`A | B`) or shared interfaces. If two classes share methods, define a common interface.
- **Don't manually re-declare types that already exist** — import them from their source module (e.g. callback parameter types from monitor classes).
- **Remove redundant type casts** — `condition ? 'a' : 'b'` already narrows to `'a' | 'b'`; don't add `as 'a' | 'b'`.
- **Keep API DTO types complete** — when mapping internal state to a public response type, verify ALL fields used by the editor/consumer are included. Missing fields = silent regressions.
- **Use explicit type predicates** — `.filter(Boolean)` doesn't narrow TS types. Use `.filter((x): x is T => x !== null)` when the narrowed type matters downstream.
- **Don't unify different function signatures** — when two functions have subtly different signatures, call each in its own branch. Don't try `as const` tuples or generic variables to DRY them.

## File & Naming Conventions
- **Follow existing naming conventions in each directory** — if other files use `kebab-case.tsx`, new files must too. Never mix `PascalCase.tsx` with `kebab-case.tsx` siblings.
- **Remove unused imports after refactoring** — when moving code to a new file, clean up old imports in the source file.

## Schema & Validation
- **Don't duplicate validation schemas** — define reusable sub-schemas (e.g. `InputSchema`) and reference them in multiple endpoints. Duplicated schemas drift apart silently.
- **Use `http.STATUS_CODES`** for error responses — don't hardcode `'Bad Request'` / `'Internal Server Error'`. Status 404 is "Not Found", not "Bad Request".
- **Schema must include ALL fields clients send** — Fastify with `removeAdditional: true` silently strips undeclared fields. When adding new client fields, ALWAYS add them to the TypeBox schema.
- **Use `Type.Optional()` for partial updates** — don't require fields that aren't always sent. Validate only what the client provides.

## React / Hooks
- **Use refs in async event handlers** — handlers driven by external events or macros must use `inputsRef.current` instead of closure state. Stale closures cause operations on wrong/missing data.
- **After async refresh, never access closure state** — after `await refreshState()`, state variables from the enclosing closure are stale. Use a ref, schedule a follow-up, or rely on the next render cycle.
- **Respect hook ordering** — `useCallback` definitions must be ordered so dependencies are declared before use. Keep hook call order stable.
- **Never re-export types from `'use server'` files** — Turbopack breaks on `export type { ... }` in `'use server'` modules. Consumers should import types directly from the source.
- **Avoid circular imports** — define shared types in a dedicated module with one-way dependencies only.
- **Compose keys from parent+child IDs** — when flattening nested collections into a single sibling list, use `${parent.id}:${child.id}` as key, not just the child ID.
- **Render modals/portals in ALL return paths** — components with multiple return branches (dashboard vs non-dashboard) must include modals and portals in every path.

## Partial Updates & State
- **Send only changed fields** — voice/macro handlers must not include `undefined` values that could overwrite existing data. Partial updates must never affect unrelated fields.
- **Preserve existing state on merge** — when building new state from incoming data, explicitly preserve fields not in the payload. Don't rebuild from scratch.
- **Always dispatch timeline sync events** — text property handlers (scroll speed, font size, color, etc.) must dispatch `smelter:timeline:update-clip-settings-for-input` to keep timeline/block panel in sync.
- **Minimize async gaps between related dispatches** — when a server mutation (adding an input) must be followed by a local action (swapping a clip), dispatch the local action synchronously right after the server returns, before any other async work.

## Voice Commands
- **Handle natural language variants** — regex patterns must cover conversational phrasing: "X to Y", "set X to Y". Test with spoken-language variants.
- **Never fail silently** — always emit error feedback (via `emitActionFeedback`) when a command can't execute. Silent returns are never acceptable.
- **All switch branches must participate in shared post-logic** — when extending shared logic after a switch/if-else (e.g. `addedInputId` for default orientation), ensure EVERY branch sets the shared variable.

## Refactoring Hygiene
- **Don't leave dead variables** — if a variable is only used in one branch of an if/else, either use it consistently or inline the value.
- **When extracting shared logic, preserve type safety** — merging two typed code paths into one generic function must not lose type information (e.g. via `as any`).
- **Check existing conventions before replacing** — before swapping a component/pattern for "consistency", grep ALL instances. If the "old" pattern is dominant, it IS the convention.
- **Trace persistence before flagging serialization bugs** — before flagging a `Set`/`Map`/etc as a serialization bug, verify the field is actually persisted. Runtime-only fields re-derived on load are not bugs.

## Layout Libraries
- **Understand element injection** — libraries like `react-grid-layout`/`react-resizable` inject children via `cloneElement`. Before debugging, read how the library inserts handles/overlays. Don't iterate CSS-only fixes when the problem is structural nesting.
- **Never `overflow: hidden` on grid items** — absolutely-positioned resize handles get clipped.

## Ref-Based Async
- **Always reset gating refs** — when using a ref to gate an async process (timers, queues), reset it to `null` in the final callback. Otherwise the gate locks permanently.
- **Read latest state in queue processors** — use refs or setState callbacks, not closure captures.

## Dual-State Systems
- **Sync server ↔ local state** — when updating server state programmatically (macros, voice), also update corresponding local state (timeline `blockSettings`). Otherwise playback reverts changes.
- **Filter hidden elements before indexing** — in soft-delete/hide systems, always filter for visibility before applying positional indices.

## UI Defaults & Patterns
- **No opinionated invisible defaults** — use zero/neutral defaults for styling (e.g. `borderWidth: 0`). All visual properties must be user-configurable.
- **Show current values next to sliders** — always display the numeric value next to range sliders.
- **"Don't show X" ≠ "remove the element"** — when user says "leave empty", keep the structural component but clear its content (e.g. space character). Don't remove the element.
- **Hover-only buttons must be visible when active** — toggle buttons controlling persistent UI state must always be visible when the feature is active, not just on hover.
- **Add scroll offset for click coordinates** — when converting viewport coordinates to content positions in a scrollable container, always add `scrollLeft`/`scrollTop`.
- **Confirm toggle direction** — when the user describes a toggle behavior, confirm on→off vs off→on before implementing.

## Config / Export-Import
- **Handle virtual/sentinel IDs** — serialization of timeline clips with virtual IDs (e.g. `__output__`) must handle them explicitly in both export and import. Never assume all inputIds map to real inputs.
- **Assign constant IDs to special tracks** — when reconstructing timeline from config, assign well-known IDs to special tracks/clips (output track) so guards like `ensureOutputTrack` recognize them.
- **Trace the full persistence chain** — when adding a persistent property: Zustand store → API response → editor types → config export → config import → API update. Incomplete chains = invisible data loss.
- **Never reverse-engineer identifiers from display strings** — expose the original data (e.g. `mp4FileName`) from server state. Display formatting is lossy.
- **Ensure source fields in all layers** — new input types need their identifying field (URL, filename) in: public DTO, config export, server schema, and every import path.
- **Sanitize ID uniqueness on load** — don't trust persisted IDs to be unique. Deduplicate tracks, clips, and keyframes on load/import.

## Architecture / Routing
- **Verify which route file the server loads** — trace the import chain from `index.ts`. In this codebase `routes.ts` (legacy monolith) is active, not `routes/index.ts`.
- **Route virtual entities correctly** — when a virtual entity shares UI with real ones, the update handler must check entity type and route to the correct API endpoint.
- **Read wrapped functions fully** — before implementing a flow that wraps an existing function, read its full body to understand all side effects (room creation, navigation, etc.).

## Timeline / Race Conditions
- **SYNC_TRACKS: distinguish new vs known inputs** — use `knownInputIds` to track all inputs that have ever been on a clip. Skip auto-track creation for known inputs.
- **Exclude system tracks from content checks** — when checking if timeline has user content, always exclude output/system tracks. Guard auto-apply with a real-clip threshold.
- **Don't wipe state on transient empty snapshots** — if the timeline already has clips and SYNC_TRACKS receives empty inputs, preserve existing state. Transient empties are expected during room init.
- **Preserve knownInputIds on LOAD** — initialize from loaded state, not empty.

## localStorage / Storage
- **Never silently catch QuotaExceededError** — always log the error and implement a fallback (prune old entries, retry). "Works in incognito but not normal" = quota issue.
- **Don't route imports through localStorage** — build imported state directly from the config object. Treat localStorage as best-effort persistence, not primary transport.

---

# Debugging Protocol

- **Trace the full path** — when a fix doesn't work, trace client → API → server → response → rendering. Don't stop at the first plausible layer.
- **Fix at the symptom layer** — verify the fix where the symptom appears, not just where data originates (transport vs rendering).
- **Check for request queuing** — when UI feels slow, look for unnecessary `refreshState()` calls on every interaction, not just debounce timing.
- **Clarify scope before coding** — ask "which feature/module?" if ambiguous. 30s of clarification saves 30min of wrong work.
- **Don't propose redundant fixes** — when presenting multiple options, explain their relationship and remove overlapping ones.
- **Add diagnostics after 1 failed fix** — cap static analysis at 2-3 messages. If the cause isn't obvious, add runtime logs immediately. Don't trace async flows in your head for 20+ turns.
- **Ask which UI flow the user is using** — when multiple entry points exist (intro page vs control panel vs dashboard), confirm which one before debugging. Don't assume the most common path.
- **Start from the entry point** — when a new route/feature returns 404 or seems missing, first check the import chain from `index.ts`. Don't start from caches, compilation, or leaf files.
- **Never repeatedly tell user to restart** — if they say they restarted and the problem persists, verify which code the running process actually loads. Check entry point imports, not user behavior.
- **Try simplest fix first** — when reducer logic looks correct but UI doesn't update, try dispatching an explicit event before deep-diving into React batching internals.

---

# Testing

## Keep Tests Green
- After any meaningful code change, run the relevant test command before finishing.
- If tests fail because of your change, fix either implementation or tests to match intended behavior.
- Do not leave known failing tests behind without explicit user approval.
- Prefer the narrowest test command first, then run broader suite when requested.
- **Decide source of truth first** — when tests and implementation disagree, determine which reflects intended behavior before fixing either.
- **Check test environment after refactoring** — when refactoring from injectable patterns (parameter injection) to global APIs (`window.dispatchEvent`), verify existing tests don't break in Node.js. Add appropriate mocks.

---

# Performance

- **Throttle with microtask + min-interval** — for server-side update throttling, use `queueMicrotask` to batch synchronous cascades and a minimum-interval `setTimeout` for sustained async bursts. Audit all callers to distinguish coalesced vs independent notifications.

---

# External Tools

## FFmpeg
- **Always use explicit -map flags with lavfi inputs** — when combining synthetic video (`-f lavfi -i color=...`) with audio, use `-map 0:v -map 1:a`. Never rely on automatic stream selection.

## Verify component is rendered before modifying
- Before modifying a component, verify it's actually rendered by searching for JSX usage (`<ComponentName`), not just import references. Dead components waste effort.
