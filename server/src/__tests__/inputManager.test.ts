import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_DIR } from '../dataDir';
import { PlaceholderManager } from '../room/PlaceholderManager';
import type { MotionController } from '../room/MotionController';

const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    smelter: {
      registerImage: fn().mockResolvedValue(undefined),
    },
    pathExists: fn().mockResolvedValue(true),
    pictureSuggestionMonitor: {
      pictureFiles: ['nested/folder/demo.png'],
    },
  };
});

vi.mock('../smelter', () => ({
  SmelterInstance: mocks.smelter,
}));

vi.mock('fs-extra', () => ({
  pathExists: mocks.pathExists,
}));

vi.mock('../mp4/mp4SuggestionMonitor', () => ({
  default: { mp4Files: [] },
}));

vi.mock('../pictures/pictureSuggestionMonitor', () => ({
  default: mocks.pictureSuggestionMonitor,
}));

vi.mock('../streamlink', () => ({
  hlsUrlForTwitchChannel: vi.fn(),
  hlsUrlForKickChannel: vi.fn(),
}));

vi.mock('../twitch/TwitchChannelMonitor', () => ({
  TwitchChannelMonitor: { startMonitor: vi.fn() },
}));

vi.mock('../kick/KickChannelMonitor', () => ({
  KickChannelMonitor: { startMonitor: vi.fn() },
}));

vi.mock('../whip/WhipInputMonitor', () => ({
  WhipInputMonitor: { startMonitor: vi.fn() },
}));

vi.mock('../server/mp4Duration', () => ({
  getMp4DurationMs: vi.fn(),
  getMp4VideoDimensions: vi.fn(),
}));

vi.mock('../dashboard', () => ({
  logTimelineEvent: vi.fn(),
}));

vi.mock('../snakeGame/snakeGameState', () => ({
  createDefaultSnakeGameInputState: vi.fn(),
}));

vi.mock('../hands/handStore', () => ({
  createHandsStore: vi.fn(),
}));

const { InputManager } = await import('../room/InputManager');

describe('InputManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathExists.mockResolvedValue(true);
    mocks.pictureSuggestionMonitor.pictureFiles = ['nested/folder/demo.png'];
  });

  it('restores an image from a nested folder when config only has imageId', async () => {
    const onStateChange = vi.fn();
    const placeholderManager = new PlaceholderManager('room');
    const motionController = {} as MotionController;
    const manager = new InputManager(
      'room',
      placeholderManager,
      motionController,
      onStateChange,
    );

    const inputId = await manager.addNewInput({
      type: 'image',
      imageId: 'pictures::nested/folder/demo',
    });

    expect(inputId).toBeTruthy();
    expect(manager.getInput(inputId!)).toMatchObject({
      type: 'image',
      imageId: 'pictures::nested/folder/demo',
    });
    expect(manager.getInput(inputId!).imageAssetMissing).not.toBe(true);
    expect(mocks.smelter.registerImage).toHaveBeenCalledWith(
      'pictures::nested/folder/demo',
      {
        serverPath: path.join(DATA_DIR, 'pictures', 'nested/folder/demo.png'),
        assetType: 'png',
      },
    );
  });
});
