# Motion Detection Pipeline

## Implementation Plan

- [x] 1. Python motion detector script (`server/motion/motion_detector.py`)
- [x] 2. MotionScene React component (`server/src/motion/MotionScene.tsx`)
- [x] 3. smelter.tsx — `registerMotionOutput` / `unregisterMotionOutput`
- [x] 4. Dockerfile — add opencv + numpy
- [x] 5. MotionManager class (`server/src/motion/MotionManager.ts`)
- [x] 6. RoomState + publicInputState + routes integration
- [x] 7. Editor types + API client + actions
- [x] 8. Editor UI (MotionIndicator, MotionChart, useMotionHistory)

## Verification
- [x] Server `pnpm build` — passes
- [x] Editor `pnpm build` — passes
- [x] deleteRoom calls `stopAllMotion()` for cleanup

## Notes
- Skipped MotionEventEmitter (YAGNI — no consumers yet)
- Added: Python crash handling (child `exit` → motionScore = undefined)
- Added: cleanup on deleteRoom
- motionEnabled default true only for video types (twitch, kick, mp4, whip)
- MotionChart created but not integrated in UI (available for later use)
