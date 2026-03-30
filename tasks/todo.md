# Branch: `@piotrsnow/block-absolute-positions`

8 commits, 75 files changed, +4746 / -909 lines vs `main`.

---

## Absolute Positioning System

- [x] Server: `RoomInputState` + `UpdateInputOptions` with absolute fields (`absolutePosition`, `absoluteTop/Left/Width/Height`, `absoluteTransitionDurationMs`, `absoluteTransitionEasing`)
- [x] Server rendering: `App.tsx` renders absolute inputs as `<Rescaler>` overlays; layouts use `useLayoutInputs()`
- [x] Store: `useLayoutInputs()` / `useAbsoluteInputs()` selectors
- [x] All 6 layout components updated to `useLayoutInputs()`
- [x] Editor: `AbsolutePositionController` (visual drag/resize editor)
- [x] Editor types: `Input` and `UpdateInputOptions` extended
- [x] API schema: `UpdateInputSchema` extended with absolute fields

## Motion Detection Pipeline

### Implementation
- [x] Python motion detector script (`server/motion/motion_detector.py`)
- [x] MotionScene React component (`server/src/motion/MotionScene.tsx`)
- [x] smelter.tsx — `registerMotionOutput` / `unregisterMotionOutput`
- [x] Dockerfile — add opencv + numpy
- [x] MotionManager class (`server/src/motion/MotionManager.ts`)
- [x] RoomState + publicInputState + routes integration
- [x] Editor types + API client + actions
- [x] Editor UI (InputMotionPanel, MotionIndicator, MotionChart, useMotionHistory, useMotionScores)
- [x] SSE endpoint + editor proxy

### Verification
- [x] Server `pnpm build` — passes
- [x] Editor `pnpm build` — passes
- [x] deleteRoom calls `stopAllMotion()` for cleanup

### Known Issues
- [ ] **Port conflict**: fixed RTP port `20000` + fixed output ID `motion::grid` — multi-room motion detection will conflict
- [ ] **No auto-restart**: Python crash → scores go to `-1`, pipeline not restarted
- [ ] **`execSync` blocks event loop**: venv setup blocks Node.js on first use
- [ ] **SSE leak potential**: stale listeners not pruned if client disconnects without `close` event
- [ ] **Dead code**: `MotionPanel.tsx` never imported (only `InputMotionPanel` is used)

## Generic Storage System

- [x] Server: `storageRoutes.ts` — `registerStorageRoutes()` generic CRUD
- [x] 3 backends: `/configs`, `/shader-presets` (with update), `/dashboard-layouts`
- [x] Editor: `storage-client.ts` — `createStorageClient<T>()` factory
- [x] Editor: `storage-modals.tsx` — `GenericSaveModal`, `GenericLoadModal`, `RemoteItemList`

### Known Issues
- [ ] **Path traversal**: `fileName` from URL params joined with `dirPath` without sanitization

## Shader Preset Modals Extraction

- [x] Extracted `SaveShaderPresetModal` / `LoadShaderPresetModal` from `ConfigModals.tsx` into `ShaderPresetModals.tsx`
- [x] `ConfigModals.tsx` simplified to thin wrappers over `GenericSaveModal` / `GenericLoadModal`

## New GPU Shaders (5)

- [x] Blur (Gaussian, directional/isotropic, quality control)
- [x] HSL Adjust (hue/sat/light + colorize mode)
- [x] Vignette (edge darkening, configurable center/softness)
- [x] Chromatic Aberration (RGB split + animation)
- [x] Sharpen (unsharp mask with threshold)
- [x] All registered in `shaders.tsx` with SVG icons

## Notes
- motionEnabled defaults to `false` for all input types
- MotionChart created and integrated in InputMotionPanel
- Skipped MotionEventEmitter (YAGNI)
- Python crash handling: child `exit` → motionScore = undefined
- Dockerfile uses `pip3 install --break-system-packages` (PEP 668 workaround)

---

## Current Fix: Audio Config Import

- [x] Trace config export/import path for audio timeline blocks
- [x] Fix room creation import flow to recreate audio inputs from `audioFileName`
- [x] Fix control-panel config import flow to recreate audio inputs from `audioFileName`
- [x] Verify with targeted editor checks

---

## Current Fix: Timeline Ruler Alignment

- [x] Trace the offset between the ruler header and clip track content
- [x] Remove the extra layout width consumed by the sources resize handle
- [x] Verify the updated timeline panel for lint issues

### Review
- Root cause: the header ruler started after a separate `w-3` resize column, while track clips started immediately after the sources column
- Fix: render the resize handle as an overlaid boundary control so the ruler and clip tracks share the same horizontal origin
