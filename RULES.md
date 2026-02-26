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

## Refactoring Hygiene
- **Don't leave dead variables** — if a variable is only used in one branch of an if/else, either use it consistently or inline the value.
- **When extracting shared logic, preserve type safety** — merging two typed code paths into one generic function must not lose type information (e.g. via `as any`).
