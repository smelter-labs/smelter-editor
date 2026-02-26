import type {
  SnakeEventApplicationMode,
  SnakeEventType,
} from '@/app/actions/actions';

export type SnakeEventEffectPreset = {
  name: string;
  effectDurationMs: number;
  application: SnakeEventApplicationMode;
  paramOverrides: Record<string, number | string>;
};

export const SNAKE_EVENT_EFFECT_PRESETS: Record<
  SnakeEventType,
  SnakeEventEffectPreset[]
> = {
  speed_up: [
    {
      name: 'Nitro Kick',
      effectDurationMs: 320,
      application: { mode: 'snake_cells' },
      paramOverrides: { intensity: 0.58, effect_color: '#33d6ff', progress: 0 },
    },
    {
      name: 'Turbo Trail',
      effectDurationMs: 420,
      application: { mode: 'sequential', durationMs: 180, delayMs: 24 },
      paramOverrides: { intensity: 0.72, effect_color: '#5fe6ff', progress: 0 },
    },
    {
      name: 'Overclock',
      effectDurationMs: 520,
      application: { mode: 'first_n', n: 6 },
      paramOverrides: { intensity: 0.82, effect_color: '#9efbff', progress: 0 },
    },
  ],
  cut_opponent: [
    {
      name: 'Crimson Burst',
      effectDurationMs: 500,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.82, effect_color: '#ff4d2e', progress: 0 },
    },
    {
      name: 'Execution Slash',
      effectDurationMs: 420,
      application: { mode: 'first_n', n: 4 },
      paramOverrides: { intensity: 0.9, effect_color: '#ff2f6a', progress: 0 },
    },
    {
      name: 'Victory Sweep',
      effectDurationMs: 620,
      application: { mode: 'sequential', durationMs: 240, delayMs: 28 },
      paramOverrides: { intensity: 0.76, effect_color: '#ff7a33', progress: 0 },
    },
  ],
  got_cut: [
    {
      name: 'Impact Flash',
      effectDurationMs: 540,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.9, effect_color: '#ff2b2b', progress: 0 },
    },
    {
      name: 'Shock Fade',
      effectDurationMs: 680,
      application: { mode: 'snake_cells' },
      paramOverrides: { intensity: 0.68, effect_color: '#ff5b66', progress: 0 },
    },
    {
      name: 'Damage Wave',
      effectDurationMs: 760,
      application: { mode: 'sequential', durationMs: 220, delayMs: 36 },
      paramOverrides: { intensity: 0.74, effect_color: '#ff907a', progress: 0 },
    },
  ],
  cut_self: [
    {
      name: 'Self Burn',
      effectDurationMs: 760,
      application: { mode: 'snake_cells' },
      paramOverrides: { intensity: 0.78, effect_color: '#b347ff', progress: 0 },
    },
    {
      name: 'Purple Gloom',
      effectDurationMs: 860,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.7, effect_color: '#8a3dff', progress: 0 },
    },
    {
      name: 'Regret Chain',
      effectDurationMs: 720,
      application: { mode: 'first_n', n: 5 },
      paramOverrides: { intensity: 0.66, effect_color: '#c06cff', progress: 0 },
    },
  ],
  eat_block: [
    {
      name: 'Snack Glow',
      effectDurationMs: 300,
      application: { mode: 'first_n', n: 3 },
      paramOverrides: { intensity: 0.52, effect_color: '#52ff7d', progress: 0 },
    },
    {
      name: 'Lucky Bite',
      effectDurationMs: 380,
      application: { mode: 'snake_cells' },
      paramOverrides: { intensity: 0.6, effect_color: '#88ff66', progress: 0 },
    },
    {
      name: 'Combo Spark',
      effectDurationMs: 440,
      application: { mode: 'sequential', durationMs: 150, delayMs: 18 },
      paramOverrides: { intensity: 0.7, effect_color: '#a5ff8a', progress: 0 },
    },
  ],
  bounce_block: [
    {
      name: 'Ricochet Ring',
      effectDurationMs: 420,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.56, effect_color: '#ffd84d', progress: 0 },
    },
    {
      name: 'Elastic Knock',
      effectDurationMs: 360,
      application: { mode: 'first_n', n: 2 },
      paramOverrides: { intensity: 0.62, effect_color: '#ffef7a', progress: 0 },
    },
    {
      name: 'Ping Sweep',
      effectDurationMs: 520,
      application: { mode: 'sequential', durationMs: 170, delayMs: 22 },
      paramOverrides: { intensity: 0.68, effect_color: '#ffcd66', progress: 0 },
    },
  ],
  no_moves: [
    {
      name: 'Frozen Grid',
      effectDurationMs: 900,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.66, effect_color: '#8f96a3', progress: 0 },
    },
    {
      name: 'Slow Fade',
      effectDurationMs: 1100,
      application: { mode: 'snake_cells' },
      paramOverrides: { intensity: 0.58, effect_color: '#6f7788', progress: 0 },
    },
    {
      name: 'Terminal Static',
      effectDurationMs: 820,
      application: { mode: 'sequential', durationMs: 260, delayMs: 35 },
      paramOverrides: { intensity: 0.72, effect_color: '#99a0ad', progress: 0 },
    },
  ],
  game_over: [
    {
      name: 'Final Vignette',
      effectDurationMs: 1600,
      application: { mode: 'all' },
      paramOverrides: { intensity: 0.92, effect_color: '#c2183a', progress: 0 },
    },
    {
      name: 'Defeat Collapse',
      effectDurationMs: 1900,
      application: { mode: 'sequential', durationMs: 450, delayMs: 55 },
      paramOverrides: { intensity: 1.0, effect_color: '#7f1028', progress: 0 },
    },
    {
      name: 'Last Signal',
      effectDurationMs: 1450,
      application: { mode: 'first_n', n: 8 },
      paramOverrides: { intensity: 0.86, effect_color: '#d43f5e', progress: 0 },
    },
  ],
};

export function getRandomSnakeEventEffectPreset(
  eventType: SnakeEventType,
): SnakeEventEffectPreset {
  const presets = SNAKE_EVENT_EFFECT_PRESETS[eventType];
  if (!presets || presets.length === 0) {
    return {
      name: 'Default',
      effectDurationMs: 600,
      application: { mode: 'all' },
      paramOverrides: { progress: 0 },
    };
  }
  const index = Math.floor(Math.random() * presets.length);
  return presets[index] ?? presets[0];
}
