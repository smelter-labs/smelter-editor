import {
  BALL_RADIUS,
  PADDLE_HEIGHT,
  PADDLE_WIDTH,
  paddleX,
} from './constants';
import type { GameState } from './types';

const COURT_BG = '#000000';
const COURT_FG = '#ffffff';
const BOUNCE_PADDLE = '#ff8c3a';
const BOUNCE_WALL = '#ffffff';

// 3x5 bitmap font matching the WGSL shader. Bit 14 = top-left.
const DIGIT_BITS: Record<number, number> = {
  0: 0x7b6f,
  1: 0x2c97,
  2: 0x73e7,
  3: 0x73cf,
  4: 0x5bc9,
  5: 0x7ce7,
  6: 0x7cef,
  7: 0x72a4,
  8: 0x7bef,
  9: 0x7bcf,
};

function drawDigit(
  ctx: CanvasRenderingContext2D,
  digit: number,
  px: number,
  py: number,
  cellPx: number,
) {
  const bits = DIGIT_BITS[digit] ?? 0;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const idx = 14 - (y * 3 + x);
      if ((bits >> idx) & 1) {
        ctx.fillRect(px + x * cellPx, py + y * cellPx, cellPx, cellPx);
      }
    }
  }
}

function drawScore(
  ctx: CanvasRenderingContext2D,
  scoreLeft: number,
  scoreRight: number,
  width: number,
  height: number,
) {
  const cellPx = Math.max(2, Math.floor(height * 0.012));
  const digitW = cellPx * 3;
  const digitH = cellPx * 5;
  const gap = cellPx;
  const topY = height * 0.06;
  const totalW = digitW * 2 + gap;
  const offset = width * 0.08;

  const sl = Math.max(0, Math.min(99, scoreLeft));
  const sr = Math.max(0, Math.min(99, scoreRight));

  ctx.fillStyle = COURT_FG;
  const leftBoxX = width * 0.5 - offset - totalW;
  drawDigit(ctx, Math.floor(sl / 10), leftBoxX, topY, cellPx);
  drawDigit(ctx, sl % 10, leftBoxX + digitW + gap, topY, cellPx);

  const rightBoxX = width * 0.5 + offset;
  drawDigit(ctx, Math.floor(sr / 10), rightBoxX, topY, cellPx);
  drawDigit(ctx, sr % 10, rightBoxX + digitW + gap, topY, cellPx);

  return digitH;
}

function drawCenterLine(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.fillStyle = COURT_FG;
  const lineW = Math.max(2, Math.floor(width * 0.004));
  const dashH = height / 28;
  const x = width * 0.5 - lineW * 0.5;
  for (let i = 0; i < 14; i++) {
    ctx.fillRect(x, i * dashH * 2, lineW, dashH);
  }
}

function drawPaddle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  width: number,
  height: number,
) {
  ctx.fillStyle = COURT_FG;
  ctx.fillRect(cx - width * 0.5, cy - height * 0.5, width, height);
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
) {
  ctx.fillStyle = COURT_FG;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawBounceFx(
  ctx: CanvasRenderingContext2D,
  now: number,
  width: number,
  height: number,
  bounce: GameState['lastBounce'],
) {
  if (!bounce) return;
  const lifetime = 0.55;
  const age = now - bounce.time;
  if (age < 0 || age > lifetime) return;
  const life01 = age / lifetime;
  const fade = Math.pow(1 - life01, 1.5);
  const color = bounce.kind === 'paddle' ? BOUNCE_PADDLE : BOUNCE_WALL;
  const ox = bounce.x * width;
  const oy = bounce.y * height;

  ctx.fillStyle = color;
  ctx.globalAlpha = fade;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const dist = (0.04 + (i % 3) * 0.01) * width * (age / lifetime);
    const size = Math.max(1, 4 * (1 - life01 * 0.6));
    const px = ox + Math.cos(angle) * dist;
    const py = oy + Math.sin(angle) * dist;
    ctx.beginPath();
    ctx.arc(px, py, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPhaseOverlay(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
) {
  if (state.phase === 'idle') {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COURT_FG;
    ctx.font = `${Math.floor(height * 0.06)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PRESS START', width * 0.5, height * 0.5);
  } else if (state.phase === 'countdown') {
    const remaining = Math.max(0, 1.5 - state.phaseTime);
    const n = Math.ceil(remaining);
    ctx.fillStyle = COURT_FG;
    ctx.font = `bold ${Math.floor(height * 0.15)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n || 'GO'), width * 0.5, height * 0.5);
  } else if (state.phase === 'matchOver') {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COURT_FG;
    ctx.font = `bold ${Math.floor(height * 0.08)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const winner = state.lastWinner === 'left' ? 'LEFT' : 'RIGHT';
    ctx.fillText(`${winner} WINS`, width * 0.5, height * 0.45);
    ctx.font = `${Math.floor(height * 0.04)}px monospace`;
    ctx.fillText('press reset to play again', width * 0.5, height * 0.6);
  }
}

export function drawGameState(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
) {
  ctx.fillStyle = COURT_BG;
  ctx.fillRect(0, 0, width, height);

  drawCenterLine(ctx, width, height);
  drawScore(ctx, state.score.left, state.score.right, width, height);

  drawPaddle(
    ctx,
    paddleX('left') * width,
    state.paddles.left.y * height,
    PADDLE_WIDTH * width,
    PADDLE_HEIGHT * height,
  );
  drawPaddle(
    ctx,
    paddleX('right') * width,
    state.paddles.right.y * height,
    PADDLE_WIDTH * width,
    PADDLE_HEIGHT * height,
  );

  drawBounceFx(ctx, state.now, width, height, state.lastBounce);

  if (state.phase !== 'matchOver') {
    drawBall(ctx, state.ball.x * width, state.ball.y * height, BALL_RADIUS * height);
  }

  drawPhaseOverlay(ctx, state, width, height);
}
