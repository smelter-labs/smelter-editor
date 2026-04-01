import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerMp4Output: vi.fn().mockResolvedValue(undefined),
  unregisterOutput: vi.fn().mockResolvedValue(undefined),
  pathExists: vi.fn().mockResolvedValue(false),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../smelter', () => ({
  SmelterInstance: {
    registerMp4Output: mocks.registerMp4Output,
    unregisterOutput: mocks.unregisterOutput,
  },
}));

vi.mock('fs-extra', () => ({
  pathExists: mocks.pathExists,
  ensureDir: mocks.ensureDir,
  readdir: mocks.readdir,
  remove: mocks.remove,
}));

const { RecordingController } = await import('../RecordingController');

const mockOutput = {
  id: 'room-1',
  url: 'http://test-whep/room-1',
  store: {} as any,
  resolution: { width: 1920, height: 1080 },
};

let controller: InstanceType<typeof RecordingController>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerMp4Output.mockResolvedValue(undefined);
  mocks.unregisterOutput.mockResolvedValue(undefined);
  mocks.pathExists.mockResolvedValue(false);
  mocks.ensureDir.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
  mocks.remove.mockResolvedValue(undefined);
  controller = new RecordingController('room-1', mockOutput as any);
});

describe('RecordingController', () => {
  describe('hasActiveRecording', () => {
    it('returns false initially', () => {
      expect(controller.hasActiveRecording()).toBe(false);
    });

    it('returns true after startRecording', async () => {
      await controller.startRecording();
      expect(controller.hasActiveRecording()).toBe(true);
    });

    it('returns false after stopRecording', async () => {
      await controller.startRecording();
      await controller.stopRecording();
      expect(controller.hasActiveRecording()).toBe(false);
    });
  });

  describe('startRecording', () => {
    it('creates recordings directory via ensureDir', async () => {
      await controller.startRecording();
      expect(mocks.ensureDir).toHaveBeenCalledWith(
        expect.stringContaining('recordings'),
      );
    });

    it('registers MP4 output with Smelter', async () => {
      await controller.startRecording();
      expect(mocks.registerMp4Output).toHaveBeenCalledWith(
        expect.stringContaining('room-1::recording::'),
        mockOutput,
        expect.stringMatching(/recording-room-1-\d+\.mp4$/),
      );
    });

    it('returns fileName matching expected pattern', async () => {
      const result = await controller.startRecording();
      expect(result.fileName).toMatch(/^recording-room-1-\d+\.mp4$/);
    });

    it('sanitizes room ID in filename', async () => {
      const ctrl = new RecordingController(
        'room/with..special\\chars',
        mockOutput as any,
      );
      const result = await ctrl.startRecording();
      expect(result.fileName).toMatch(
        /^recording-room_with__special_chars-\d+\.mp4$/,
      );
      // Filename should not contain path separators
      expect(result.fileName).not.toContain('/');
      expect(result.fileName).not.toContain('\\');
    });

    it('throws when recording is already in progress', async () => {
      await controller.startRecording();
      await expect(controller.startRecording()).rejects.toThrow(
        'Recording is already in progress',
      );
    });
  });

  describe('stopRecording', () => {
    it('unregisters the Smelter output', async () => {
      await controller.startRecording();
      await controller.stopRecording();
      expect(mocks.unregisterOutput).toHaveBeenCalledWith(
        expect.stringContaining('room-1::recording::'),
      );
    });

    it('returns the recording fileName', async () => {
      const startResult = await controller.startRecording();
      const stopResult = await controller.stopRecording();
      expect(stopResult.fileName).toBe(startResult.fileName);
    });

    it('throws when no active recording exists', async () => {
      await expect(controller.stopRecording()).rejects.toThrow(
        'No active recording to stop',
      );
    });

    it('throws when recording already stopped', async () => {
      await controller.startRecording();
      await controller.stopRecording();
      await expect(controller.stopRecording()).rejects.toThrow(
        'No active recording to stop',
      );
    });

    it('marks recording as stopped even if unregisterOutput throws', async () => {
      await controller.startRecording();
      mocks.unregisterOutput.mockRejectedValueOnce(new Error('Smelter error'));

      await expect(controller.stopRecording()).rejects.toThrow('Smelter error');
      expect(controller.hasActiveRecording()).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('unregisters active recording output', async () => {
      await controller.startRecording();
      await controller.cleanup();
      expect(mocks.unregisterOutput).toHaveBeenCalled();
    });

    it('does nothing when no recording exists', async () => {
      await controller.cleanup();
      expect(mocks.unregisterOutput).not.toHaveBeenCalled();
    });

    it('does nothing when recording already stopped', async () => {
      await controller.startRecording();
      await controller.stopRecording();
      mocks.unregisterOutput.mockClear();

      await controller.cleanup();
      expect(mocks.unregisterOutput).not.toHaveBeenCalled();
    });

    it('catches and logs errors from unregisterOutput', async () => {
      await controller.startRecording();
      mocks.unregisterOutput.mockRejectedValueOnce(new Error('cleanup fail'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await controller.cleanup();

      consoleSpy.mockRestore();
    });
  });
});

describe('pruneOldRecordings (via stopRecording)', () => {
  let controller: InstanceType<typeof RecordingController>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerMp4Output.mockResolvedValue(undefined);
    mocks.unregisterOutput.mockResolvedValue(undefined);
    mocks.pathExists.mockResolvedValue(true);
    mocks.ensureDir.mockResolvedValue(undefined);
    controller = new RecordingController('room-1', mockOutput as any);
  });

  it('does nothing when recordings directory does not exist', async () => {
    mocks.pathExists.mockResolvedValue(false);
    mocks.readdir.mockResolvedValue([]);
    await controller.startRecording();
    await controller.stopRecording();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('does nothing when mp4 count <= maxCount', async () => {
    mocks.readdir.mockResolvedValue([
      'recording-room-1-100.mp4',
      'recording-room-1-200.mp4',
    ]);
    await controller.startRecording();
    await controller.stopRecording();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('deletes oldest recordings when count exceeds 10', async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      `recording-room-1-${1000 + i * 100}.mp4`,
    );
    mocks.readdir.mockResolvedValue(files);

    await controller.startRecording();
    await controller.stopRecording();

    // Should delete the 2 oldest (12 - 10 = 2)
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.stringContaining('recording-room-1-1000.mp4'),
    );
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.stringContaining('recording-room-1-1100.mp4'),
    );
  });

  it('assigns timestamp 0 to unparseable filenames (deleted first)', async () => {
    const files = Array.from({ length: 11 }, (_, i) =>
      `recording-room-1-${1000 + i * 100}.mp4`,
    );
    files.push('weird-filename.mp4');
    mocks.readdir.mockResolvedValue(files);

    await controller.startRecording();
    await controller.stopRecording();

    // weird-filename gets timestamp 0, so it's deleted first
    // Then the oldest regular file (1000) is deleted
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.remove).toHaveBeenCalledWith(
      expect.stringContaining('weird-filename.mp4'),
    );
  });
});
