import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import {
  buildFullProjectManifest,
  downloadFullProjectZip,
  importFullProjectZip,
} from '../full-project-zip';
import type { RoomConfig } from '../room-config';

function createConfig(): RoomConfig {
  return {
    version: 1,
    layout: 'grid',
    inputs: [
      {
        type: 'local-mp4',
        title: 'Video',
        description: '',
        volume: 1,
        shaders: [],
        mp4FileName: 'clips/intro.mp4',
      },
      {
        type: 'local-mp4',
        title: 'Audio',
        description: '',
        volume: 1,
        shaders: [],
        audioFileName: 'music/theme.mp4',
      },
      {
        type: 'image',
        title: 'Logo',
        description: '',
        volume: 1,
        shaders: [],
        imageId: 'pictures::logo',
        imageFileName: 'overlays/logo.png',
      },
    ],
    exportedAt: new Date().toISOString(),
  };
}

describe('full-project-zip', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds manifest with mp4/audio/image paths', () => {
    const config = createConfig();
    const manifest = buildFullProjectManifest(config);

    expect(manifest.version).toBe(1);
    expect(manifest.assets).toEqual([
      { kind: 'mp4', path: 'mp4s/clips/intro.mp4', inputIndex: 0 },
      { kind: 'audio', path: 'audios/music/theme.mp4', inputIndex: 1 },
      { kind: 'image', path: 'pictures/overlays/logo.png', inputIndex: 2 },
    ]);
  });

  it('rejects full-project export when an image has no file reference', async () => {
    const config = createConfig();
    config.inputs[2].imageFileName = undefined;

    await expect(downloadFullProjectZip(config)).rejects.toThrow(
      'Missing asset references',
    );
  });

  it('imports zip, uploads assets, and maps manifest paths back to config', async () => {
    const config = createConfig();
    config.inputs[2].imageFileName = undefined;

    const manifest = {
      version: 1 as const,
      assets: [
        { kind: 'mp4' as const, path: 'mp4s/clips/intro.mp4', inputIndex: 0 },
        {
          kind: 'audio' as const,
          path: 'audios/music/theme.mp4',
          inputIndex: 1,
        },
        {
          kind: 'image' as const,
          path: 'pictures/overlays/logo.png',
          inputIndex: 2,
        },
      ],
    };

    const zip = new JSZip();
    zip.file('room-config.json', JSON.stringify(config, null, 2));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('mp4s/clips/intro.mp4', 'video');
    zip.file('audios/music/theme.mp4', 'audio');
    zip.file('pictures/overlays/logo.png', 'image');
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'project.zip', { type: 'application/zip' });

    const fetchMock = vi
      .fn<(...args: any[]) => Promise<Response>>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const importedConfig = await importFullProjectZip(file);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/upload/mp4');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/upload/audio');
    expect(fetchMock.mock.calls[2][0]).toBe('/api/upload/picture');
    expect(importedConfig.inputs[0].mp4FileName).toBe('clips/intro.mp4');
    expect(importedConfig.inputs[1].audioFileName).toBe('music/theme.mp4');
    expect(importedConfig.inputs[2].imageFileName).toBe('overlays/logo.png');
  });
});
