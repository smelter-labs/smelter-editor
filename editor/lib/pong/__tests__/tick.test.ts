import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCH_CONFIG } from '../constants';
import { createInitialState, startMatch, tick } from '../tick';
import type { PaddleIntent } from '../controllers/types';
import type { GameState, MatchConfig } from '../types';

const idleIntent: PaddleIntent = { kind: 'relative', direction: 0, maxSpeed: 1 };
const intents = { left: idleIntent, right: idleIntent };
const config: MatchConfig = { ...DEFAULT_MATCH_CONFIG, firstTo: 3 };

function tickFor(state: GameState, totalSec: number, stepSec = 1 / 60): GameState {
  const steps = Math.ceil(totalSec / stepSec);
  let s = state;
  for (let i = 0; i < steps; i++) {
    s = tick(s, stepSec, intents, config);
  }
  return s;
}

describe('createInitialState', () => {
  it('starts in idle with empty score', () => {
    const s = createInitialState();
    expect(s.phase).toBe('idle');
    expect(s.score).toEqual({ left: 0, right: 0 });
    expect(s.ball.vx).toBe(0);
  });
});

describe('tick phase transitions', () => {
  it('idle → countdown via startMatch', () => {
    const s = startMatch(createInitialState());
    expect(s.phase).toBe('countdown');
    expect(s.phaseTime).toBe(0);
  });

  it('countdown → playing after countdownSec, ball gets velocity', () => {
    const s = tickFor(startMatch(createInitialState()), config.countdownSec + 0.1);
    expect(s.phase).toBe('playing');
    expect(Math.hypot(s.ball.vx, s.ball.vy)).toBeGreaterThan(0);
  });

  it('idle does not start ball even after long tick', () => {
    const s = tickFor(createInitialState(), 5);
    expect(s.phase).toBe('idle');
    expect(s.ball.vx).toBe(0);
  });
});

describe('tick scoring', () => {
  it('awards a point to right when ball exits left edge', () => {
    let s = startMatch(createInitialState());
    s = tickFor(s, config.countdownSec + 0.05); // now playing
    // Force ball to be exiting left.
    s = { ...s, ball: { x: -0.1, y: 0.5, vx: -0.5, vy: 0 } };
    s = tick(s, 1 / 60, intents, config);
    expect(s.score.right).toBe(1);
    expect(s.score.left).toBe(0);
    expect(s.phase).toBe('pointScored');
    expect(s.lastWinner).toBe('right');
  });

  it('transitions pointScored → countdown after pause', () => {
    let s = startMatch(createInitialState());
    s = tickFor(s, config.countdownSec + 0.05);
    s = { ...s, ball: { x: -0.1, y: 0.5, vx: -0.5, vy: 0 } };
    s = tick(s, 1 / 60, intents, config);
    expect(s.phase).toBe('pointScored');
    s = tickFor(s, config.pointScoredPauseSec + 0.1);
    expect(s.phase).toBe('countdown');
  });

  it('match ends when a side reaches firstTo', () => {
    let s = startMatch(createInitialState());
    s = { ...s, score: { left: config.firstTo - 1, right: 0 } };
    s = tickFor(s, config.countdownSec + 0.05);
    s = { ...s, ball: { x: 1.2, y: 0.5, vx: 0.5, vy: 0 } };
    s = tick(s, 1 / 60, intents, config);
    expect(s.phase).toBe('matchOver');
    expect(s.lastWinner).toBe('left');
  });
});
