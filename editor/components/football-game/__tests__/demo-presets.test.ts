import { describe, expect, it, vi } from 'vitest';
import { colorsTooClose } from '@/lib/arcade/color';
import { clipFitsRole } from '../clip-role';
import {
  FB_DEMO_PRESETS,
  applyDemoPreset,
  demoClipsMissing,
} from '../demo-presets';
import { DEFAULT_FB_UI_CONFIG, type FbUiConfig } from '../use-fb-room';

// The hook module pulls in the server actions; only its pure helpers run here.
vi.mock('@/app/actions/actions', () => ({}));

/** `MAX_FOLDER_DEPTH` of the mp4 library: at most 3 path segments. */
const MAX_SEGMENTS = 3;

describe('FB_DEMO_PRESETS', () => {
  it('has three demos with unique ids', () => {
    expect(FB_DEMO_PRESETS).toHaveLength(3);
    expect(new Set(FB_DEMO_PRESETS.map((p) => p.id)).size).toBe(3);
  });

  it('attaches clips that fit their role and rig', () => {
    for (const p of FB_DEMO_PRESETS) {
      const roles = p.clips.map((c) => c.role).sort();
      expect(roles).toEqual(
        p.session === 'pano' ? ['pano'] : ['centre', 'left', 'right'],
      );
      for (const c of p.clips) {
        expect(clipFitsRole(c.role, c.fileName, p.session)).toBe(true);
        expect(c.fileName.endsWith('.mp4')).toBe(true);
        expect(c.fileName.split('/').length).toBeLessThanOrEqual(MAX_SEGMENTS);
      }
    }
  });

  it('keeps team fields within the server clamps and kits apart', () => {
    for (const p of FB_DEMO_PRESETS) {
      for (const t of [p.teams.A, p.teams.B]) {
        expect(t.name.length).toBeLessThanOrEqual(16);
        expect(t.short.length).toBeLessThanOrEqual(4);
        expect(t.short).toBe(t.short.toUpperCase());
        expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(colorsTooClose(p.teams.A.color, p.teams.B.color)).toBe(false);
    }
  });

  it('names the tagged home side A in every demo', () => {
    for (const p of FB_DEMO_PRESETS) expect(p.teams.A.short).toBe('TIL');
  });
});

describe('applyDemoPreset', () => {
  it('sets the teams and the clip-driven fields, keeps the rest', () => {
    const base: FbUiConfig = {
      ...DEFAULT_FB_UI_CONFIG,
      resolution: '720p',
      halfMin: 3,
      attacksLeft: 'B',
      clockFromClip: false,
      perf: { ...DEFAULT_FB_UI_CONFIG.perf, animTickHz: 15 },
      director: { ...DEFAULT_FB_UI_CONFIG.director, zoom: 'wide' },
    };
    const anzhi = FB_DEMO_PRESETS.find((p) => p.id === 'anzhi')!;
    const out = applyDemoPreset(base, anzhi);
    expect(out.teams).toEqual(anzhi.teams);
    expect(out.teams).not.toBe(anzhi.teams);
    expect(out.attacksLeft).toBeNull();
    expect(out.clockFromClip).toBe(true);
    expect(out.halfMin).toBe(45);
    expect(out.resolution).toBe('720p');
    expect(out.perf.animTickHz).toBe(15);
    expect(out.director.zoom).toBe('wide');
  });
});

describe('demoClipsMissing', () => {
  it('lists the preset clips the library does not have', () => {
    const tricam = FB_DEMO_PRESETS.find((p) => p.id === 'stromsgodset')!;
    const library = ['fb-demo/tricam-3min/cam0.mp4', 'other/x.mp4'];
    expect(demoClipsMissing(tricam, library)).toEqual([
      'fb-demo/tricam-3min/cam1.mp4',
      'fb-demo/tricam-3min/cam2.mp4',
    ]);
    expect(
      demoClipsMissing(
        tricam,
        tricam.clips.map((c) => c.fileName),
      ),
    ).toEqual([]);
  });
});
