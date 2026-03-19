# Refactor Log

## 2026-03-18 — SSE notification fixes, API contract alignment, editor lifecycle cleanup

### SSE room-level state notifications (`server/src/room/RoomState.ts`)

Room-level properties (`isPublic`, `pendingWhipInputs`, `pendingDelete`) were mutated directly without notifying SSE listeners, causing the editor to display stale state until the next unrelated update.

- Converted the three public fields to getter/setter pairs that call `notifyStateChange()` on write.
- Extracted `notifyStateChange()` from `updateStoreWithState()` so room-level mutations that don't touch the rendering store can still push SSE events.
- Added `notifyStateChange()` calls to `startTimelinePlayback`, `pauseTimeline`, `resumeTimeline`, and `stopTimelinePlayback` so the `isFrozen` flag propagates immediately.

### API contract alignment (`server/src/server/routes/schemas.ts`, `server/src/server/publicInputState.ts`)

- Added `textColor`, `textMaxLines`, `textScrollSpeed`, `textScrollLoop`, `textFontSize` to the `InputSchema` `text-input` variant, matching the shared `RegisterInputOptions` type.
- Added `activeTransition` to the base fields in `toPublicInputState()`.
- Added `textScrollNudge` to the `text-input` branch of `toPublicInputState()`.

### Editor state lifecycle (`editor/components/room-page/room-page.tsx`, `editor/app/api/room/[roomId]/state/sse/route.ts`)

- Reset `defaultInputsSavedRef` when `roomId` changes so default inputs are correctly persisted for each room.
- Added `AbortController` to the SSE proxy route, wired to `request.signal`, so upstream connections are torn down when the client disconnects.

### Tests

- Added `state change notifications` test suite covering `isPublic`, `pendingWhipInputs`, `pendingDelete` setters and timeline lifecycle notifications.
- Added `publicInputState serialization` tests verifying `activeTransition` and `textScrollNudge` presence.
- All server tests (82) and editor tests (128) pass.
