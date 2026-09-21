import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fbRoleRefusal, readFbClipSession, sessionOf } from '../clipSession';

describe('clip session (the rig a library clip was shot with)', () => {
  let root = '';
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'fb-clips-'));
    await mkdir(path.join(root, 'fb/demo'), { recursive: true });
    await writeFile(
      path.join(root, 'fb/demo/pano.alfheim.json'),
      JSON.stringify({ session: 'pano', fps: 25 }),
    );
    await writeFile(path.join(root, 'fb/demo/bad.alfheim.json'), '{nope');
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('reads the sidecar next to the clip', async () => {
    expect(await readFbClipSession(root, 'fb/demo/pano.mp4')).toBe('pano');
  });

  it('is null without a sidecar or with a malformed one', async () => {
    expect(await readFbClipSession(root, 'fb/demo/other.mp4')).toBeNull();
    expect(await readFbClipSession(root, 'fb/demo/bad.mp4')).toBeNull();
    expect(sessionOf({ session: 'drone' })).toBeNull();
    expect(sessionOf(null)).toBeNull();
  });

  it('refuses a clip in the slot of the other rig', () => {
    expect(fbRoleRefusal('pano', 'tricam')).toMatch(/three-camera/);
    expect(fbRoleRefusal('left', 'pano')).toMatch(/panorama/);
    expect(fbRoleRefusal('pano', 'pano')).toBeNull();
    expect(fbRoleRefusal('centre', 'tricam')).toBeNull();
    // Footage without a sidecar goes anywhere.
    expect(fbRoleRefusal('pano', null)).toBeNull();
  });
});
