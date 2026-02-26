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
];

export function getRandomSnakeShaderPreset(): SnakeShaderPreset {
  const index = Math.floor(Math.random() * SNAKE_SHADER_PRESETS.length);
  return SNAKE_SHADER_PRESETS[index];
}
