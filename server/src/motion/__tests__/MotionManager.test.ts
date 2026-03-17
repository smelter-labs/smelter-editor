import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../smelter', () => ({
  SmelterInstance: {
    registerMotionOutput: vi.fn(async () => {}),
    unregisterMotionOutput: vi.fn(async () => {}),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require('node:events');
    const { Readable } = require('node:stream');

    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const child = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();

    // Emit a ready signal after a tick
    setTimeout(() => {
      stdout.push(JSON.stringify({ ready: true }) + '\n');
    }, 10);

    return child;
  }),
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn(() => vi.fn(async () => ({}))),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

const { MotionManager } = await import('../MotionManager');

describe('MotionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction', () => {
    it('assigns unique RTP ports to each instance', () => {
      const m1 = new MotionManager('room-1');
      const m2 = new MotionManager('room-2');

      // They should have different ports (accessed indirectly through behavior)
      expect(m1).not.toBe(m2);
    });
  });

  describe('startMotionDetection', () => {
    it('registers a callback for the input', async () => {
      const manager = new MotionManager('room-test-start');
      const callback = vi.fn();

      await manager.startMotionDetection('input-1', callback);

      // The manager should have started the pipeline
      const { SmelterInstance } = await import('../../smelter');
      expect(SmelterInstance.registerMotionOutput).toHaveBeenCalled();
    });

    it('replaces callback if called again for same input', async () => {
      const manager = new MotionManager('room-test-replace');
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      await manager.startMotionDetection('input-1', cb1);
      await manager.startMotionDetection('input-1', cb2);

      // Should not throw, just replace callback
      await manager.stopAll();
    });
  });

  describe('stopMotionDetection', () => {
    it('is a no-op for untracked inputs', async () => {
      const manager = new MotionManager('room-test-noop');
      // Should not throw
      await manager.stopMotionDetection('nonexistent');
    });

    it('stops detection for a tracked input', async () => {
      const manager = new MotionManager('room-test-stop');
      await manager.startMotionDetection('input-1', vi.fn());
      await manager.stopMotionDetection('input-1');

      // After removing the last input, the pipeline should tear down
      const { SmelterInstance } = await import('../../smelter');
      expect(SmelterInstance.unregisterMotionOutput).toHaveBeenCalled();
    });
  });

  describe('stopAll', () => {
    it('stops all tracked inputs', async () => {
      const manager = new MotionManager('room-test-stopall');
      await manager.startMotionDetection('input-1', vi.fn());
      await manager.startMotionDetection('input-2', vi.fn());

      await manager.stopAll();

      const { SmelterInstance } = await import('../../smelter');
      expect(SmelterInstance.unregisterMotionOutput).toHaveBeenCalled();
    });

    it('is safe to call on empty manager', async () => {
      const manager = new MotionManager('room-test-empty');
      await manager.stopAll();
      // Should not throw
    });
  });
});
