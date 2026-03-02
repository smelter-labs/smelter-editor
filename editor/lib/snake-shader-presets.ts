import type { ShaderConfig } from '@/app/actions/actions';

export type SnakeShaderPreset = {
  name: string;
  shaders: ShaderConfig[];
};

export const SNAKE_SHADER_PRESETS: SnakeShaderPreset[] = [
  {
    name: '🌌 Hologram',
    shaders: [
      {
        shaderName: 'SW Hologram',
        shaderId: 'sw-hologram',
        enabled: true,
        params: [
          { paramName: 'tint_r', paramValue: 0.25 },
          { paramName: 'tint_g', paramValue: 0.6 },
          { paramName: 'tint_b', paramValue: 1.0 },
          { paramName: 'opacity', paramValue: 0.92 },
          { paramName: 'scanline_intensity', paramValue: 0.65 },
          { paramName: 'scanline_density', paramValue: 127.6 },
          { paramName: 'scanline_speed', paramValue: 37.0 },
          { paramName: 'flicker_intensity', paramValue: 0.69 },
          { paramName: 'flicker_speed', paramValue: 8 },
          { paramName: 'chromatic_aberration_px', paramValue: 2 },
          { paramName: 'noise_intensity', paramValue: 0.0 },
          { paramName: 'jitter_x_px', paramValue: 2.2 },
          { paramName: 'jitter_y_px', paramValue: 0.5 },
          { paramName: 'jitter_speed', paramValue: 2.2 },
          { paramName: 'glow_intensity', paramValue: 0.09 },
          { paramName: 'edge_glow_width', paramValue: 0.1 },
          { paramName: 'brightness', paramValue: 2.93 },
          { paramName: 'bloom_intensity', paramValue: 0.42 },
          { paramName: 'bloom_radius', paramValue: 32.36 },
        ],
      },
    ],
  },
  {
    name: '🔥 Neon Fire',
    shaders: [
      {
        shaderName: 'Alpha Stroke',
        shaderId: 'alpha-stroke',
        enabled: true,
        params: [
          { paramName: 'stroke_width_px', paramValue: 40 },
          { paramName: 'softness_px', paramValue: 25 },
          { paramName: 'opacity', paramValue: 0.9 },
          { paramName: 'stroke_color', paramValue: '#ff4400' },
        ],
      },
      {
        shaderName: 'Brightness & Contrast',
        shaderId: 'brightness-contrast',
        enabled: true,
        params: [
          { paramName: 'brightness', paramValue: 0.15 },
          { paramName: 'contrast', paramValue: 1.8 },
        ],
      },
    ],
  },
  {
    name: '👾 Pixel Retro',
    shaders: [
      {
        shaderName: 'ASCII Filter',
        shaderId: 'ascii-filter',
        enabled: true,
        params: [
          { paramName: 'glyph_size', paramValue: 6 },
          { paramName: 'gamma_correction', paramValue: 0.4 },
        ],
      },
    ],
  },
  {
    name: '🌈 Star Warp',
    shaders: [
      {
        shaderName: 'Star Streaks',
        shaderId: 'star-streaks',
        enabled: true,
        params: [
          { paramName: 'line_density', paramValue: 80 },
          { paramName: 'thickness_px', paramValue: 1.5 },
          { paramName: 'speed', paramValue: 1.5 },
          { paramName: 'jitter_amp_px', paramValue: 8 },
          { paramName: 'jitter_freq', paramValue: 2 },
          { paramName: 'dash_repeat', paramValue: 15 },
          { paramName: 'dash_duty', paramValue: 0.3 },
          { paramName: 'brightness', paramValue: 0.7 },
        ],
      },
    ],
  },
  {
    name: '🖤 Shadow Ghost',
    shaders: [
      {
        shaderName: 'Soft Shadow',
        shaderId: 'soft-shadow',
        enabled: true,
        params: [
          { paramName: 'shadow_r', paramValue: 0.3 },
          { paramName: 'shadow_g', paramValue: 0.0 },
          { paramName: 'shadow_b', paramValue: 0.6 },
          { paramName: 'opacity', paramValue: 0.7 },
          { paramName: 'offset_x_px', paramValue: 12 },
          { paramName: 'offset_y_px', paramValue: 12 },
          { paramName: 'blur_px', paramValue: 15 },
          { paramName: 'anim_amp_px', paramValue: 6 },
          { paramName: 'anim_speed', paramValue: 3 },
        ],
      },
      {
        shaderName: 'Opacity',
        shaderId: 'opacity',
        enabled: true,
        params: [{ paramName: 'opacity', paramValue: 0.75 }],
      },
    ],
  },
  {
    name: '🪐 Orbiting Sun',
    shaders: [
      {
        shaderName: 'Orbiting',
        shaderId: 'orbiting',
        enabled: true,
        params: [
          { paramName: 'opacity', paramValue: 1 },
          { paramName: 'sprite_scale', paramValue: 0.35 },
          { paramName: 'orbit_radius', paramValue: 0.45 },
          { paramName: 'orbit_speed', paramValue: 0.3 },
          { paramName: 'copies_f32', paramValue: 4 },
          { paramName: 'colorize_amount', paramValue: 0.3 },
          { paramName: 'sun_rays', paramValue: 12 },
          { paramName: 'sun_anim_speed', paramValue: 4 },
          { paramName: 'sun_base_radius', paramValue: 0.3 },
          { paramName: 'sun_ray_amp', paramValue: 0.12 },
          { paramName: 'sun_softness', paramValue: 0.08 },
        ],
      },
    ],
  },
  {
    name: '⚡ Electric Outline',
    shaders: [
      {
        shaderName: 'Alpha Stroke',
        shaderId: 'alpha-stroke',
        enabled: true,
        params: [
          { paramName: 'stroke_width_px', paramValue: 55 },
          { paramName: 'softness_px', paramValue: 40 },
          { paramName: 'opacity', paramValue: 1 },
          { paramName: 'stroke_color', paramValue: '#00ccff' },
        ],
      },
      {
        shaderName: 'Star Streaks',
        shaderId: 'star-streaks',
        enabled: true,
        params: [
          { paramName: 'line_density', paramValue: 30 },
          { paramName: 'thickness_px', paramValue: 1 },
          { paramName: 'speed', paramValue: 2.5 },
          { paramName: 'jitter_amp_px', paramValue: 12 },
          { paramName: 'jitter_freq', paramValue: 5 },
          { paramName: 'dash_repeat', paramValue: 20 },
          { paramName: 'dash_duty', paramValue: 0.2 },
          { paramName: 'brightness', paramValue: 0.4 },
        ],
      },
    ],
  },
  {
    name: '🌑 Noir',
    shaders: [
      {
        shaderName: 'Grayscale',
        shaderId: 'grayscale',
        enabled: true,
        params: [],
      },
      {
        shaderName: 'Brightness & Contrast',
        shaderId: 'brightness-contrast',
        enabled: true,
        params: [
          { paramName: 'brightness', paramValue: -0.1 },
          { paramName: 'contrast', paramValue: 2.5 },
        ],
      },
      {
        shaderName: 'Soft Shadow',
        shaderId: 'soft-shadow',
        enabled: true,
        params: [
          { paramName: 'shadow_r', paramValue: 0.0 },
          { paramName: 'shadow_g', paramValue: 0.0 },
          { paramName: 'shadow_b', paramValue: 0.0 },
          { paramName: 'opacity', paramValue: 0.8 },
          { paramName: 'offset_x_px', paramValue: 5 },
          { paramName: 'offset_y_px', paramValue: 5 },
          { paramName: 'blur_px', paramValue: 10 },
          { paramName: 'anim_amp_px', paramValue: 0 },
          { paramName: 'anim_speed', paramValue: 0 },
        ],
      },
    ],
  },
  {
    name: '🌊 Deep Ocean',
    shaders: [
      {
        shaderName: 'Soft Shadow',
        shaderId: 'soft-shadow',
        enabled: true,
        params: [
          { paramName: 'shadow_r', paramValue: 0.0 },
          { paramName: 'shadow_g', paramValue: 0.25 },
          { paramName: 'shadow_b', paramValue: 0.55 },
          { paramName: 'opacity', paramValue: 0.72 },
          { paramName: 'offset_x_px', paramValue: 8 },
          { paramName: 'offset_y_px', paramValue: 14 },
          { paramName: 'blur_px', paramValue: 18 },
          { paramName: 'anim_amp_px', paramValue: 4 },
          { paramName: 'anim_speed', paramValue: 1.8 },
        ],
      },
      {
        shaderName: 'Brightness & Contrast',
        shaderId: 'brightness-contrast',
        enabled: true,
        params: [
          { paramName: 'brightness', paramValue: -0.05 },
          { paramName: 'contrast', paramValue: 1.45 },
        ],
      },
    ],
  },
  {
    name: '☀️ Solar Flare',
    shaders: [
      {
        shaderName: 'Alpha Stroke',
        shaderId: 'alpha-stroke',
        enabled: true,
        params: [
          { paramName: 'stroke_width_px', paramValue: 46 },
          { paramName: 'softness_px', paramValue: 28 },
          { paramName: 'opacity', paramValue: 0.95 },
          { paramName: 'stroke_color', paramValue: '#ffbf33' },
        ],
      },
      {
        shaderName: 'Star Streaks',
        shaderId: 'star-streaks',
        enabled: true,
        params: [
          { paramName: 'line_density', paramValue: 55 },
          { paramName: 'thickness_px', paramValue: 1.2 },
          { paramName: 'speed', paramValue: 2.2 },
          { paramName: 'jitter_amp_px', paramValue: 9 },
          { paramName: 'jitter_freq', paramValue: 3.5 },
          { paramName: 'dash_repeat', paramValue: 18 },
          { paramName: 'dash_duty', paramValue: 0.24 },
          { paramName: 'brightness', paramValue: 0.52 },
        ],
      },
    ],
  },
  {
    name: '🧊 Frosted Glass',
    shaders: [
      {
        shaderName: 'SW Hologram',
        shaderId: 'sw-hologram',
        enabled: true,
        params: [
          { paramName: 'tint_r', paramValue: 0.75 },
          { paramName: 'tint_g', paramValue: 0.9 },
          { paramName: 'tint_b', paramValue: 1.0 },
          { paramName: 'opacity', paramValue: 0.82 },
          { paramName: 'scanline_intensity', paramValue: 0.28 },
          { paramName: 'scanline_density', paramValue: 92 },
          { paramName: 'scanline_speed', paramValue: 16 },
          { paramName: 'flicker_intensity', paramValue: 0.22 },
          { paramName: 'flicker_speed', paramValue: 4.5 },
          { paramName: 'chromatic_aberration_px', paramValue: 0.8 },
          { paramName: 'noise_intensity', paramValue: 0.02 },
          { paramName: 'jitter_x_px', paramValue: 0.6 },
          { paramName: 'jitter_y_px', paramValue: 0.2 },
          { paramName: 'jitter_speed', paramValue: 1.1 },
          { paramName: 'glow_intensity', paramValue: 0.06 },
          { paramName: 'edge_glow_width', paramValue: 0.12 },
          { paramName: 'brightness', paramValue: 1.6 },
          { paramName: 'bloom_intensity', paramValue: 0.2 },
          { paramName: 'bloom_radius', paramValue: 24 },
        ],
      },
    ],
  },
  {
    name: '🎛️ VHS Glitch',
    shaders: [
      {
        shaderName: 'SW Hologram',
        shaderId: 'sw-hologram',
        enabled: true,
        params: [
          { paramName: 'tint_r', paramValue: 1.0 },
          { paramName: 'tint_g', paramValue: 0.95 },
          { paramName: 'tint_b', paramValue: 0.9 },
          { paramName: 'opacity', paramValue: 0.9 },
          { paramName: 'scanline_intensity', paramValue: 0.85 },
          { paramName: 'scanline_density', paramValue: 150 },
          { paramName: 'scanline_speed', paramValue: 55 },
          { paramName: 'flicker_intensity', paramValue: 0.82 },
          { paramName: 'flicker_speed', paramValue: 11 },
          { paramName: 'chromatic_aberration_px', paramValue: 3.2 },
          { paramName: 'noise_intensity', paramValue: 0.18 },
          { paramName: 'jitter_x_px', paramValue: 3.4 },
          { paramName: 'jitter_y_px', paramValue: 1.4 },
          { paramName: 'jitter_speed', paramValue: 3.8 },
          { paramName: 'glow_intensity', paramValue: 0.08 },
          { paramName: 'edge_glow_width', paramValue: 0.07 },
          { paramName: 'brightness', paramValue: 1.3 },
          { paramName: 'bloom_intensity', paramValue: 0.14 },
          { paramName: 'bloom_radius', paramValue: 20 },
        ],
      },
      {
        shaderName: 'Brightness & Contrast',
        shaderId: 'brightness-contrast',
        enabled: true,
        params: [
          { paramName: 'brightness', paramValue: -0.02 },
          { paramName: 'contrast', paramValue: 1.7 },
        ],
      },
    ],
  },
  {
    name: '🎯 Precision Outline',
    shaders: [
      {
        shaderName: 'Alpha Stroke',
        shaderId: 'alpha-stroke',
        enabled: true,
        params: [
          { paramName: 'stroke_width_px', paramValue: 20 },
          { paramName: 'softness_px', paramValue: 10 },
          { paramName: 'opacity', paramValue: 1.0 },
          { paramName: 'stroke_color', paramValue: '#33ffaa' },
        ],
      },
      {
        shaderName: 'Opacity',
        shaderId: 'opacity',
        enabled: true,
        params: [{ paramName: 'opacity', paramValue: 0.9 }],
      },
    ],
  },
  {
    name: '🛰️ Radar Sweep',
    shaders: [
      {
        shaderName: 'Star Streaks',
        shaderId: 'star-streaks',
        enabled: true,
        params: [
          { paramName: 'line_density', paramValue: 26 },
          { paramName: 'thickness_px', paramValue: 1.1 },
          { paramName: 'speed', paramValue: 1.0 },
          { paramName: 'jitter_amp_px', paramValue: 4.5 },
          { paramName: 'jitter_freq', paramValue: 1.7 },
          { paramName: 'dash_repeat', paramValue: 24 },
          { paramName: 'dash_duty', paramValue: 0.16 },
          { paramName: 'brightness', paramValue: 0.36 },
        ],
      },
      {
        shaderName: 'Soft Shadow',
        shaderId: 'soft-shadow',
        enabled: true,
        params: [
          { paramName: 'shadow_r', paramValue: 0.0 },
          { paramName: 'shadow_g', paramValue: 0.35 },
          { paramName: 'shadow_b', paramValue: 0.2 },
          { paramName: 'opacity', paramValue: 0.55 },
          { paramName: 'offset_x_px', paramValue: 6 },
          { paramName: 'offset_y_px', paramValue: 6 },
          { paramName: 'blur_px', paramValue: 11 },
          { paramName: 'anim_amp_px', paramValue: 3 },
          { paramName: 'anim_speed', paramValue: 2.2 },
        ],
      },
    ],
  },
  {
    name: '🫧 Bubble Pop',
    shaders: [
      {
        shaderName: 'Orbiting',
        shaderId: 'orbiting',
        enabled: true,
        params: [
          { paramName: 'opacity', paramValue: 0.92 },
          { paramName: 'sprite_scale', paramValue: 0.22 },
          { paramName: 'orbit_radius', paramValue: 0.36 },
          { paramName: 'orbit_speed', paramValue: 0.55 },
          { paramName: 'copies_f32', paramValue: 7 },
          { paramName: 'colorize_amount', paramValue: 0.5 },
          { paramName: 'sun_rays', paramValue: 6 },
          { paramName: 'sun_anim_speed', paramValue: 2.4 },
          { paramName: 'sun_base_radius', paramValue: 0.18 },
          { paramName: 'sun_ray_amp', paramValue: 0.07 },
          { paramName: 'sun_softness', paramValue: 0.13 },
        ],
      },
      {
        shaderName: 'Opacity',
        shaderId: 'opacity',
        enabled: true,
        params: [{ paramName: 'opacity', paramValue: 0.84 }],
      },
    ],
  },
  {
    name: '🧬 DNA Pulse',
    shaders: [
      {
        shaderName: 'Orbiting',
        shaderId: 'orbiting',
        enabled: true,
        params: [
          { paramName: 'opacity', paramValue: 1.0 },
          { paramName: 'sprite_scale', paramValue: 0.28 },
          { paramName: 'orbit_radius', paramValue: 0.5 },
          { paramName: 'orbit_speed', paramValue: 0.95 },
          { paramName: 'copies_f32', paramValue: 5 },
          { paramName: 'colorize_amount', paramValue: 0.42 },
          { paramName: 'sun_rays', paramValue: 10 },
          { paramName: 'sun_anim_speed', paramValue: 5.2 },
          { paramName: 'sun_base_radius', paramValue: 0.26 },
          { paramName: 'sun_ray_amp', paramValue: 0.1 },
          { paramName: 'sun_softness', paramValue: 0.09 },
        ],
      },
      {
        shaderName: 'Brightness & Contrast',
        shaderId: 'brightness-contrast',
        enabled: true,
        params: [
          { paramName: 'brightness', paramValue: 0.08 },
          { paramName: 'contrast', paramValue: 1.55 },
        ],
      },
    ],
  },
];

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_HUE_JITTER_DEG = 12;

function clonePreset(preset: SnakeShaderPreset): SnakeShaderPreset {
  return {
    name: preset.name,
    shaders: preset.shaders.map((shader) => ({
      ...shader,
      params: shader.params.map((param) => ({ ...param })),
    })),
  };
}

function normalizeHexColor(color: string): string | null {
  if (!HEX_COLOR_RE.test(color)) return null;
  const raw = color.slice(1).toLowerCase();
  if (raw.length === 6) return `#${raw}`;
  return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
}

function hexToRgb01(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color)!;
  const int = Number.parseInt(normalized.slice(1), 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  return { r, g, b };
}

function rgb01ToHex(r: number, g: number, b: number): string {
  const toByte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)));
  const rr = toByte(r).toString(16).padStart(2, '0');
  const gg = toByte(g).toString(16).padStart(2, '0');
  const bb = toByte(b).toString(16).padStart(2, '0');
  return `#${rr}${gg}${bb}`;
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
      break;
  }
  h /= 6;

  return { h: h * 360, s, l };
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    return { r: l, g: l, b: l };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  return {
    r: hueToRgb(hue + 1 / 3),
    g: hueToRgb(hue),
    b: hueToRgb(hue - 1 / 3),
  };
}

function rotateHexHue(color: string, deltaDeg: number): string {
  const { r, g, b } = hexToRgb01(color);
  const { h, s, l } = rgbToHsl(r, g, b);
  const rotated = hslToRgb(h + deltaDeg, s, l);
  return rgb01ToHex(rotated.r, rotated.g, rotated.b);
}

function getHueFromHex(color: string): number {
  const { r, g, b } = hexToRgb01(color);
  return rgbToHsl(r, g, b).h;
}

function tintPresetTowardPlayerColor(
  preset: SnakeShaderPreset,
  playerColor: string,
): SnakeShaderPreset {
  const normalizedPlayerColor = normalizeHexColor(playerColor);
  if (!normalizedPlayerColor) return clonePreset(preset);

  const cloned = clonePreset(preset);
  const firstHexParam = cloned.shaders
    .flatMap((shader) => shader.params)
    .find(
      (param) =>
        typeof param.paramValue === 'string' &&
        normalizeHexColor(param.paramValue) !== null,
    );
  if (!firstHexParam || typeof firstHexParam.paramValue !== 'string') {
    return cloned;
  }

  const sourceHue = getHueFromHex(firstHexParam.paramValue);
  const targetHue = getHueFromHex(normalizedPlayerColor);
  const deltaToTarget = ((targetHue - sourceHue + 540) % 360) - 180;
  const randomJitter = (Math.random() * 2 - 1) * COLOR_HUE_JITTER_DEG;
  const hueRotation = deltaToTarget + randomJitter;

  for (const shader of cloned.shaders) {
    shader.params = shader.params.map((param) => {
      if (typeof param.paramValue !== 'string') return param;
      const normalized = normalizeHexColor(param.paramValue);
      if (!normalized) return param;
      return { ...param, paramValue: rotateHexHue(normalized, hueRotation) };
    });
  }

  return cloned;
}

export function getRandomSnakeShaderPreset(
  playerColor?: string,
): SnakeShaderPreset {
  const index = Math.floor(Math.random() * SNAKE_SHADER_PRESETS.length);
  const preset = SNAKE_SHADER_PRESETS[index];
  if (!preset) {
    return {
      name: 'Default',
      shaders: [],
    };
  }
  if (!playerColor) {
    return clonePreset(preset);
  }
  return tintPresetTowardPlayerColor(preset, playerColor);
}
