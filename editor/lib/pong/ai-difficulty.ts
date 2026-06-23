import type { Difficulty } from './types';

export type DifficultyParams = {
  reactionLagSec: number;
  predictBounces: number;
  aimNoise: number;
  maxSpeed: number;
};

export const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: {
    reactionLagSec: 0.3,
    predictBounces: 0,
    aimNoise: 0.15,
    maxSpeed: 0.6,
  },
  medium: {
    reactionLagSec: 0.15,
    predictBounces: 1,
    aimNoise: 0.05,
    maxSpeed: 1.0,
  },
  hard: {
    reactionLagSec: 0.05,
    predictBounces: 8,
    aimNoise: 0.01,
    maxSpeed: 1.5,
  },
};
