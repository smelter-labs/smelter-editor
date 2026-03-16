import { vi } from 'vitest';

/**
 * Creates mock objects for SmelterInstance and all external dependencies.
 * Intended to be called from vi.hoisted() so the objects are available
 * when vi.mock() factories run (which are hoisted above imports).
 *
 * Usage in test files:
 *   const mocks = vi.hoisted(() => createMocks());
 *   vi.mock('../../smelter', () => ({ SmelterInstance: mocks.smelter }));
 *   // ... other vi.mock calls using mocks.*
 */
export function createMocks() {
  const smelter = {
    registerOutput: vi.fn(async () => ({})),
    registerMp4Output: vi.fn(async () => {}),
    unregisterOutput: vi.fn(async () => {}),
    registerInput: vi.fn(async () => ''),
    unregisterInput: vi.fn(async () => {}),
    registerImage: vi.fn(async () => {}),
    unregisterImage: vi.fn(async () => {}),
    registerMotionOutput: vi.fn(async () => {}),
    unregisterMotionOutput: vi.fn(async () => {}),
    getPipelineTimeMs: vi.fn(() => 0),
    terminate: vi.fn(async () => {}),
  };

  const twitchMonitor = {
    startMonitor: vi.fn(async () => ({
      isLive: () => true,
      stop: vi.fn(),
      onUpdate: vi.fn(),
    })),
  };

  const kickMonitor = {
    startMonitor: vi.fn(async () => ({
      isLive: () => true,
      stop: vi.fn(),
      onUpdate: vi.fn(),
    })),
  };

  const whipMonitor = {
    startMonitor: vi.fn(async () => ({
      isLive: () => false,
      touch: vi.fn(() => ({ previousAckTimestamp: Date.now(), currentAckTimestamp: Date.now() })),
      getUsername: vi.fn(() => 'test-user'),
      getLastAckTimestamp: vi.fn(() => Date.now()),
      stop: vi.fn(),
    })),
  };

  const fsExtra = {
    pathExists: vi.fn(async () => false),
    ensureDir: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    remove: vi.fn(async () => {}),
  };

  return {
    smelter,
    twitchMonitor,
    kickMonitor,
    whipMonitor,
    fsExtra,
  };
}
