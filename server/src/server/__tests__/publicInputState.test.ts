import { describe, expect, it } from 'vitest';
import { toPublicInputState } from '../publicInputState';
import { DATA_DIR } from '../../dataDir';
import type { RoomInputState } from '../../room/types';

function createLocalMp4Input(mp4FilePath: string): RoomInputState {
  return {
    inputId: `room::local::${mp4FilePath}`,
    type: 'local-mp4',
    status: 'disconnected',
    hidden: false,
    motionEnabled: false,
    metadata: { title: '[MP4] Demo', description: '' },
    showTitle: false,
    shaders: [],
    borderColor: '#ff0000',
    borderWidth: 0,
    volume: 0,
    mp4FilePath,
  };
}

describe('toPublicInputState', () => {
  it('preserves nested relative paths for MP4 files', () => {
    const pub = toPublicInputState(
      createLocalMp4Input(`${DATA_DIR}/mp4s/nested/folder/demo.mp4`),
    );

    expect(pub.mp4FileName).toBe('nested/folder/demo.mp4');
    expect(pub.audioFileName).toBeUndefined();
  });

  it('preserves nested relative paths for audio files', () => {
    const pub = toPublicInputState(
      createLocalMp4Input(`${DATA_DIR}/audios/nested/folder/demo.mp4`),
    );

    expect(pub.audioFileName).toBe('nested/folder/demo.mp4');
    expect(pub.mp4FileName).toBeUndefined();
  });
});
