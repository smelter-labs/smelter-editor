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
- **Respect hook ordering** — `useCallback` definitions must be ordered so dependencies are declared before use. Keep hook call order stable.
- **Never re-export types from `'use server'` files** — Turbopack breaks on `export type { ... }` in `'use server'` modules. Consumers should import types directly from the source.
- **Avoid circular imports** — define shared types in a dedicated module with one-way dependencies only.

## Partial Updates & State
- **Send only changed fields** — voice/macro handlers must not include `undefined` values that could overwrite existing data. Partial updates must never affect unrelated fields.
- **Preserve existing state on merge** — when building new state from incoming data, explicitly preserve fields not in the payload. Don't rebuild from scratch.
- **Always dispatch timeline sync events** — text property handlers (scroll speed, font size, color, etc.) must dispatch `smelter:timeline:update-clip-settings-for-input` to keep timeline/block panel in sync.

## Voice Commands
- **Handle natural language variants** — regex patterns must cover conversational phrasing: "X to Y", "set X to Y". Test with spoken-language variants.
- **Never fail silently** — always emit error feedback (via `emitActionFeedback`) when a command can't execute. Silent returns are never acceptable.
- **All switch branches must participate in shared post-logic** — when extending shared logic after a switch/if-else (e.g. `addedInputId` for default orientation), ensure EVERY branch sets the shared variable.

## Refactoring Hygiene
- **Don't leave dead variables** — if a variable is only used in one branch of an if/else, either use it consistently or inline the value.
- **When extracting shared logic, preserve type safety** — merging two typed code paths into one generic function must not lose type information (e.g. via `as any`).

## UI Defaults
- **No opinionated invisible defaults** — use zero/neutral defaults for styling (e.g. `borderWidth: 0`). All visual properties must be user-configurable.
- **Show current values next to sliders** — always display the numeric value next to range sliders.

---

# Debugging Protocol

- **Trace the full path** — when a fix doesn't work, trace client → API → server → response → rendering. Don't stop at the first plausible layer.
- **Fix at the symptom layer** — verify the fix where the symptom appears, not just where data originates (transport vs rendering).
- **Check for request queuing** — when UI feels slow, look for unnecessary `refreshState()` calls on every interaction, not just debounce timing.
- **Clarify scope before coding** — ask "which feature/module?" if ambiguous. 30s of clarification saves 30min of wrong work.
- **Don't propose redundant fixes** — when presenting multiple options, explain their relationship and remove overlapping ones.

---

# Testing

## Keep Tests Green
- After any meaningful code change, run the relevant test command before finishing.
- If tests fail because of your change, fix either implementation or tests to match intended behavior.
- Do not leave known failing tests behind without explicit user approval.
- Prefer the narrowest test command first, then run broader suite when requested.
- **Decide source of truth first** — when tests and implementation disagree, determine which reflects intended behavior before fixing either.
