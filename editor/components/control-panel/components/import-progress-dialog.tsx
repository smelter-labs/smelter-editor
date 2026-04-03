'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export type ImportProgressState = {
  phase: string;
  current: number;
  total: number;
};

type ImportProgressDialogProps = {
  progress: ImportProgressState | null;
};

type ImportMetricConfig = {
  label: string;
  multiplier: number;
  continuous?: boolean;
  accentClassName: string;
  borderClassName: string;
  badgeClassName: string;
  barClassName: string;
};

type ImportMetricPlan = ImportMetricConfig & {
  total: number;
  current: number;
  currentDisplayValue: number;
  totalDisplayValue: number;
  percent: number;
  delayMs: number;
};

const IMPORT_METRICS: ImportMetricConfig[] = [
  {
    label: 'keyframes stitched',
    multiplier: 1,
    accentClassName: 'text-cyan-200',
    borderClassName: 'border-cyan-400/30',
    badgeClassName: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    barClassName: 'from-cyan-400 via-sky-300 to-fuchsia-400',
  },
  {
    label: 'chroma ghosts purged',
    multiplier: 1,
    accentClassName: 'text-fuchsia-200',
    borderClassName: 'border-fuchsia-400/30',
    badgeClassName: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-100',
    barClassName: 'from-fuchsia-400 via-pink-300 to-cyan-300',
  },
  {
    label: 'gpu fan rotations',
    multiplier: 100,
    continuous: true,
    accentClassName: 'text-emerald-200',
    borderClassName: 'border-emerald-400/30',
    badgeClassName: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    barClassName: 'from-emerald-400 via-cyan-300 to-blue-300',
  },
  {
    label: 'scanlines stabilized',
    multiplier: 1,
    accentClassName: 'text-amber-100',
    borderClassName: 'border-amber-300/25',
    badgeClassName: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
    barClassName: 'from-amber-300 via-fuchsia-300 to-cyan-300',
  },
];

const zeroMetricValues = IMPORT_METRICS.map(() => 0);

const CONTINUOUS_METRIC_INDEX = IMPORT_METRICS.findIndex(
  (metric) => metric.continuous,
);
const CONTINUOUS_DECAY_RATE = 3.0;
const CONTINUOUS_MIN_VELOCITY = 12;
const CONTINUOUS_BOOST_FACTOR = 3.5;
const CONTINUOUS_MAX_VELOCITY = 800;
const MIN_IMPORT_DIALOG_VISIBLE_MS = 3000;
const MAX_IMPORT_DIALOG_VISIBLE_MS = 5000;

function createSeededRandom(seed: number) {
  let state = (seed ^ 0xa5a5a5a5) >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function formatMetricValue(value: number) {
  return value.toLocaleString('en-US');
}

// ── GPU Canvas Effect Types & Helpers ───────────────────────────────

type FxSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  bright: number;
};

type FxPt = { x: number; y: number };

type FxBolt = {
  pts: FxPt[];
  branches: FxPt[][];
  life: number;
  maxLife: number;
  w: number;
  hue: number;
};

type FxPulse = {
  path: number;
  t: number;
  speed: number;
  hue: number;
  tail: number;
};

type FxWave = {
  cx: number;
  cy: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
};

type FxState = {
  w: number;
  h: number;
  dpr: number;
  sparks: FxSpark[];
  bolts: FxBolt[];
  circuits: FxPt[][];
  pulses: FxPulse[];
  waves: FxWave[];
  dots: HTMLCanvasElement | null;
  nextBolt: number;
  nextWave: number;
  nextPulse: number;
};

const FX_HUES = [187, 295, 45, 160];

function fxHsl(h: number, s: number, l: number, a: number) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

function displaceMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  d: number,
  depth: number,
): FxPt[] {
  if (depth <= 0)
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * d;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * d;
  const left = displaceMidpoint(x1, y1, mx, my, d * 0.52, depth - 1);
  const right = displaceMidpoint(mx, my, x2, y2, d * 0.52, depth - 1);
  return [...left.slice(0, -1), ...right];
}

function makeBolt(w: number, h: number): FxBolt {
  const edge = Math.random();
  let x1: number, y1: number;
  if (edge < 0.25) {
    x1 = 0;
    y1 = Math.random() * h;
  } else if (edge < 0.5) {
    x1 = w;
    y1 = Math.random() * h;
  } else if (edge < 0.75) {
    x1 = Math.random() * w;
    y1 = 0;
  } else {
    x1 = Math.random() * w;
    y1 = h;
  }
  const x2 = w * 0.2 + Math.random() * w * 0.6;
  const y2 = h * 0.2 + Math.random() * h * 0.6;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const pts = displaceMidpoint(x1, y1, x2, y2, dist * 0.35, 5);

  const branches: FxPt[][] = [];
  for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
    const idx = Math.min(
      Math.floor(pts.length * 0.3 + Math.random() * pts.length * 0.5),
      pts.length - 1,
    );
    const bp = pts[idx];
    const bx = bp.x + (Math.random() - 0.5) * dist * 0.4;
    const by = bp.y + (Math.random() - 0.5) * dist * 0.4;
    branches.push(
      displaceMidpoint(
        bp.x,
        bp.y,
        bx,
        by,
        Math.hypot(bx - bp.x, by - bp.y) * 0.3,
        3,
      ),
    );
  }

  return {
    pts,
    branches,
    life: 0,
    maxLife: 0.15 + Math.random() * 0.2,
    w: 1.2 + Math.random() * 2,
    hue: FX_HUES[Math.floor(Math.random() * FX_HUES.length)],
  };
}

function makeCircuits(w: number, h: number): FxPt[][] {
  const grid = 16;
  const paths: FxPt[][] = [];
  for (let i = 0; i < 28; i++) {
    const path: FxPt[] = [];
    let cx = Math.floor(Math.random() * (w / grid)) * grid;
    let cy = Math.floor(Math.random() * (h / grid)) * grid;
    path.push({ x: cx, y: cy });
    for (let j = 0; j < 3 + Math.floor(Math.random() * 5); j++) {
      if (Math.random() > 0.5) {
        cx +=
          (Math.random() > 0.5 ? 1 : -1) *
          grid *
          (1 + Math.floor(Math.random() * 4));
        cx = Math.max(0, Math.min(w, cx));
      } else {
        cy +=
          (Math.random() > 0.5 ? 1 : -1) *
          grid *
          (1 + Math.floor(Math.random() * 4));
        cy = Math.max(0, Math.min(h, cy));
      }
      path.push({ x: cx, y: cy });
    }
    paths.push(path);
  }
  return paths;
}

function makeDotPattern(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * dpr);
  c.height = Math.ceil(h * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  ctx.scale(dpr, dpr);
  const sp = 9;
  for (let x = sp / 2; x < w; x += sp) {
    for (let y = sp / 2; y < h; y += sp) {
      ctx.fillStyle = `rgba(34,211,238,${0.035 + Math.random() * 0.03})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return c;
}

function makeSpark(w: number, h: number, scatter?: boolean): FxSpark {
  return {
    x: Math.random() * w,
    y: scatter ? Math.random() * h : h + Math.random() * 20,
    vx: (Math.random() - 0.5) * 28,
    vy: -(25 + Math.random() * 55),
    life: scatter ? Math.random() * 3 : 0,
    maxLife: 1.2 + Math.random() * 2.0,
    hue: FX_HUES[Math.floor(Math.random() * FX_HUES.length)],
    size: 0.8 + Math.random() * 1.8,
    bright: 0.5 + Math.random() * 0.5,
  };
}

function updateFx(s: FxState, dt: number, pct: number) {
  const target = Math.floor(60 + 90 * pct);
  while (s.sparks.length < target) s.sparks.push(makeSpark(s.w, s.h));
  for (const p of s.sparks) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx += (Math.random() - 0.5) * 40 * dt;
    p.vy -= 8 * dt;
  }
  s.sparks = s.sparks.filter(
    (p) => p.life < p.maxLife && p.y > -10 && p.x > -10 && p.x < s.w + 10,
  );

  s.nextBolt -= dt;
  if (s.nextBolt <= 0 && pct > 0.02) {
    const burstCount = 1 + Math.floor(Math.random() * 2 + pct * 2);
    for (let i = 0; i < burstCount; i++) s.bolts.push(makeBolt(s.w, s.h));
    const iv = 0.35 - 0.2 * pct;
    s.nextBolt = iv + Math.random() * iv * 0.4;
  }
  for (const b of s.bolts) b.life += dt;
  s.bolts = s.bolts.filter((b) => b.life < b.maxLife);

  s.nextPulse -= dt;
  if (s.nextPulse <= 0 && s.circuits.length > 0) {
    const pulseCount = 1 + Math.floor(Math.random() * 2 + pct);
    for (let i = 0; i < pulseCount; i++) {
      s.pulses.push({
        path: Math.floor(Math.random() * s.circuits.length),
        t: 0,
        speed: 0.4 + Math.random() * 0.5 + pct * 0.4,
        hue: FX_HUES[Math.floor(Math.random() * FX_HUES.length)],
        tail: 0.18 + Math.random() * 0.14,
      });
    }
    const iv = 0.4 - 0.25 * pct;
    s.nextPulse = iv + Math.random() * iv * 0.2;
  }
  for (const p of s.pulses) p.t += p.speed * dt;
  s.pulses = s.pulses.filter((p) => p.t < 1 + p.tail);

  s.nextWave -= dt;
  if (s.nextWave <= 0 && pct > 0.05) {
    const waveCount = 1 + Math.floor(pct * 1.5);
    for (let i = 0; i < waveCount; i++) {
      s.waves.push({
        cx: s.w * (0.15 + Math.random() * 0.7),
        cy: s.h * (0.15 + Math.random() * 0.7),
        r: 0,
        maxR: Math.max(s.w, s.h) * (0.6 + Math.random() * 0.4),
        life: 0,
        maxLife: 1.2 + Math.random() * 0.6,
      });
    }
    s.nextWave = 1.0 - pct * 0.5;
  }
  for (const wv of s.waves) {
    wv.life += dt;
    wv.r += (wv.maxR / wv.maxLife) * dt;
  }
  s.waves = s.waves.filter((wv) => wv.life < wv.maxLife);
}

function drawFx(ctx: CanvasRenderingContext2D, s: FxState, pct: number) {
  const { w, h, dpr } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (s.dots) {
    ctx.globalAlpha = 0.6 + pct * 0.4;
    ctx.drawImage(s.dots, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = 'rgba(34,211,238,1)';
  ctx.fillStyle = 'rgba(34,211,238,1)';
  ctx.lineWidth = 0.7;
  for (const path of s.circuits) {
    if (path.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    for (const n of path) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.lineCap = 'round';
  for (const pulse of s.pulses) {
    const path = s.circuits[pulse.path];
    if (!path || path.length < 2) continue;
    let totalLen = 0;
    const segs: number[] = [];
    for (let i = 1; i < path.length; i++) {
      const len = Math.hypot(
        path[i].x - path[i - 1].x,
        path[i].y - path[i - 1].y,
      );
      segs.push(len);
      totalLen += len;
    }
    const headD = pulse.t * totalLen;
    const tailD = Math.max(0, headD - pulse.tail * totalLen);
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      const sS = acc;
      const sE = acc + segs[i];
      if (sE > tailD && sS < headD) {
        const t0 = (Math.max(sS, tailD) - sS) / segs[i];
        const t1 = (Math.min(sE, headD) - sS) / segs[i];
        const sx = path[i].x + (path[i + 1].x - path[i].x) * t0;
        const sy = path[i].y + (path[i + 1].y - path[i].y) * t0;
        const ex = path[i].x + (path[i + 1].x - path[i].x) * t1;
        const ey = path[i].y + (path[i + 1].y - path[i].y) * t1;
        ctx.shadowColor = fxHsl(pulse.hue, 100, 70, 1);
        ctx.shadowBlur = 14;
        ctx.strokeStyle = fxHsl(pulse.hue, 90, 75, 0.85);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = fxHsl(pulse.hue, 60, 90, 0.5);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      }
      acc = sE;
    }
    ctx.shadowBlur = 0;
    if (headD <= totalLen) {
      let a2 = 0;
      for (let i = 0; i < segs.length; i++) {
        if (a2 + segs[i] >= headD) {
          const t = (headD - a2) / segs[i];
          const hx = path[i].x + (path[i + 1].x - path[i].x) * t;
          const hy = path[i].y + (path[i + 1].y - path[i].y) * t;
          ctx.shadowColor = fxHsl(pulse.hue, 100, 80, 1);
          ctx.shadowBlur = 18;
          ctx.fillStyle = fxHsl(pulse.hue, 80, 92, 0.95);
          ctx.beginPath();
          ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          break;
        }
        a2 += segs[i];
      }
    }
  }

  for (const wv of s.waves) {
    const p = wv.life / wv.maxLife;
    const a = (0.22 + pct * 0.15) * (1 - p) * (1 - p);
    if (a < 0.005) continue;
    const waveHue =
      FX_HUES[Math.floor((wv.cx + wv.cy) * 0.01) % FX_HUES.length];
    ctx.strokeStyle = fxHsl(waveHue, 90, 75, a);
    ctx.lineWidth = 2 * (1 - p * 0.4);
    ctx.shadowColor = fxHsl(waveHue, 100, 70, a * 0.9);
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(wv.cx, wv.cy, wv.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  for (const sp of s.sparks) {
    const lr = sp.life / sp.maxLife;
    const a = Math.min(1, sp.life * 5) * (1 - lr) * sp.bright;
    if (a < 0.01) continue;
    ctx.shadowColor = fxHsl(sp.hue, 100, 70, 1);
    ctx.shadowBlur = 10 * a;
    ctx.fillStyle = fxHsl(sp.hue, 85, 80, a * 0.9);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = fxHsl(sp.hue, 40, 95, a);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  for (const bolt of s.bolts) {
    const lr = bolt.life / bolt.maxLife;
    const flash = lr < 0.15 ? lr / 0.15 : 1 - (lr - 0.15) / 0.85;
    const a = flash * flash;
    if (a < 0.01) continue;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokePath = (pts: FxPt[], lw: number, al: number) => {
      if (pts.length < 2) return;
      ctx.lineWidth = lw;
      ctx.strokeStyle = fxHsl(bolt.hue, 100, 85, al);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };
    ctx.shadowColor = fxHsl(bolt.hue, 100, 70, a);
    ctx.shadowBlur = 30;
    strokePath(bolt.pts, bolt.w * 4, a * 0.35);
    ctx.shadowBlur = 12;
    strokePath(bolt.pts, bolt.w * 2, a * 0.65);
    ctx.shadowBlur = 0;
    strokePath(bolt.pts, bolt.w * 0.5, a);
    if (lr < 0.2) {
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.5})`;
      ctx.lineWidth = bolt.w * 0.2;
      ctx.beginPath();
      ctx.moveTo(bolt.pts[0].x, bolt.pts[0].y);
      for (let i = 1; i < bolt.pts.length; i++)
        ctx.lineTo(bolt.pts[i].x, bolt.pts[i].y);
      ctx.stroke();
    }
    for (const br of bolt.branches) {
      ctx.shadowColor = fxHsl(bolt.hue, 100, 70, a * 0.6);
      ctx.shadowBlur = 14;
      strokePath(br, bolt.w * 2, a * 0.3);
      ctx.shadowBlur = 0;
      strokePath(br, bolt.w * 0.6, a * 0.6);
    }
    ctx.shadowBlur = 0;
  }
}

function GpuCanvas({
  percent,
  isActive,
}: {
  percent: number;
  isActive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const percentRef = useRef(percent);
  percentRef.current = percent;

  useEffect(() => {
    if (!isActive) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    canvas.width = Math.ceil(rect.width * dpr);
    canvas.height = Math.ceil(rect.height * dpr);

    const st: FxState = {
      w: rect.width,
      h: rect.height,
      dpr,
      sparks: [],
      bolts: [],
      circuits: makeCircuits(rect.width, rect.height),
      pulses: [],
      waves: [],
      dots: makeDotPattern(rect.width, rect.height, dpr),
      nextBolt: 0.5,
      nextWave: 1.0,
      nextPulse: 0.3,
    };
    for (let i = 0; i < 55; i++) st.sparks.push(makeSpark(st.w, st.h, true));

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: rw, height: rh } = entry.contentRect;
      canvas.width = Math.ceil(rw * dpr);
      canvas.height = Math.ceil(rh * dpr);
      st.w = rw;
      st.h = rh;
      st.circuits = makeCircuits(rw, rh);
      st.dots = makeDotPattern(rw, rh, dpr);
    });
    observer.observe(parent);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      updateFx(st, dt, percentRef.current / 100);
      drawFx(ctx, st, percentRef.current / 100);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  if (!isActive) return null;
  return (
    <canvas
      ref={canvasRef}
      className='absolute inset-0 pointer-events-none'
      style={{ borderRadius: 'inherit' }}
    />
  );
}

export function ImportProgressDialog({ progress }: ImportProgressDialogProps) {
  const [visibleProgress, setVisibleProgress] =
    useState<ImportProgressState | null>(progress);
  const openedAtRef = useRef<number | null>(progress ? Date.now() : null);
  const sessionMinVisibleMsRef = useRef(MIN_IMPORT_DIALOG_VISIBLE_MS);
  const closeTimeoutRef = useRef<number | null>(null);
  const [, setDisplayTick] = useState(0);
  const total = visibleProgress?.total ?? 0;
  const current = visibleProgress
    ? Math.min(visibleProgress.current, total)
    : 0;
  const elapsedMs =
    openedAtRef.current === null
      ? 0
      : Math.max(Date.now() - openedAtRef.current, 0);
  const sessionProgressRatio =
    sessionMinVisibleMsRef.current > 0
      ? Math.min(elapsedMs / sessionMinVisibleMsRef.current, 1)
      : 1;
  const sessionCurrentCap =
    total > 0 ? Math.floor(total * sessionProgressRatio) : 0;
  const displayedCurrent = visibleProgress
    ? Math.min(current, sessionCurrentCap)
    : 0;
  const percent = total > 0 ? Math.round((displayedCurrent / total) * 100) : 0;
  const [sessionSeed, setSessionSeed] = useState(0);
  const [displayValues, setDisplayValues] =
    useState<number[]>(zeroMetricValues);
  const wasOpenRef = useRef(false);
  const animatedValuesRef = useRef<number[]>(zeroMetricValues);
  const animationFrameRef = useRef<number | null>(null);
  const continuousVelocityRef = useRef(0);
  const continuousValueRef = useRef(0);
  const continuousPrevTargetRef = useRef(0);
  const continuousRafRef = useRef<number | null>(null);
  const continuousLastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (visibleProgress === null) return;

    const intervalId = window.setInterval(() => {
      setDisplayTick((previous) => previous + 1);
    }, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [visibleProgress]);

  useEffect(() => {
    if (progress !== null) {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (openedAtRef.current === null) {
        openedAtRef.current = Date.now();
        const range =
          MAX_IMPORT_DIALOG_VISIBLE_MS - MIN_IMPORT_DIALOG_VISIBLE_MS;
        sessionMinVisibleMsRef.current =
          MIN_IMPORT_DIALOG_VISIBLE_MS +
          Math.floor(Math.random() * (range + 1));
      }
      setVisibleProgress(progress);
      return;
    }

    if (visibleProgress === null) {
      openedAtRef.current = null;
      return;
    }

    const openedAt = openedAtRef.current ?? Date.now();
    const elapsed = Date.now() - openedAt;
    const delayMs = Math.max(sessionMinVisibleMsRef.current - elapsed, 0);

    closeTimeoutRef.current = window.setTimeout(() => {
      setVisibleProgress(null);
      openedAtRef.current = null;
      closeTimeoutRef.current = null;
    }, delayMs);

    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, [progress, visibleProgress]);

  useEffect(() => {
    const isOpen = visibleProgress !== null;

    if (isOpen && !wasOpenRef.current) {
      setSessionSeed((previous) => previous + 1);
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
      continuousVelocityRef.current = 0;
      continuousValueRef.current = 0;
      continuousPrevTargetRef.current = 0;
      continuousLastTimeRef.current = null;
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    }

    if (!isOpen && wasOpenRef.current) {
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
      continuousVelocityRef.current = 0;
      continuousValueRef.current = 0;
      continuousPrevTargetRef.current = 0;
      continuousLastTimeRef.current = null;
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    }

    wasOpenRef.current = isOpen;
  }, [visibleProgress]);

  const metricPlans = useMemo<ImportMetricPlan[]>(() => {
    const random = createSeededRandom(Math.max(sessionSeed, 1));
    const baseTotal = Math.max(total, 1);
    const ratioFromProgress = total > 0 ? displayedCurrent / total : 0;
    const ratio = Math.max(ratioFromProgress, sessionProgressRatio);

    return IMPORT_METRICS.map((metric, index) => {
      const targetScale = 7 + random() * 16 + (index === 2 ? 8 : 0);
      const metricTotal = Math.max(1, Math.round(baseTotal * targetScale));
      const paceBias = 0.8 + random() * 0.45;
      const preciseCurrent =
        Math.min(1, Math.pow(ratio, paceBias)) * metricTotal;
      const metricCurrent = Math.min(metricTotal, Math.floor(preciseCurrent));
      const currentDisplayValue = metricCurrent * metric.multiplier;
      const totalDisplayValue = metricTotal * metric.multiplier;
      const metricPercent =
        totalDisplayValue > 0
          ? Math.round((currentDisplayValue / totalDisplayValue) * 100)
          : 0;

      return {
        ...metric,
        total: metricTotal,
        current: metricCurrent,
        currentDisplayValue,
        totalDisplayValue,
        percent: metricPercent,
        delayMs: 140 + Math.round(random() * 800),
      };
    });
  }, [displayedCurrent, sessionProgressRatio, sessionSeed, total]);

  const targetValuesKey = metricPlans
    .map((metric) => metric.currentDisplayValue)
    .join(':');

  useEffect(() => {
    if (visibleProgress === null) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const targetValues = metricPlans.map(
      (metric) => metric.currentDisplayValue,
    );
    const startValues = animatedValuesRef.current;
    const durationMs = 280;
    let startedAt: number | null = null;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const tick = (timestamp: number) => {
      if (startedAt === null) {
        startedAt = timestamp;
      }

      const progressRatio = Math.min((timestamp - startedAt) / durationMs, 1);
      const easedRatio = 1 - Math.pow(1 - progressRatio, 3);
      const nextValues = startValues.map((value, index) => {
        if (index === CONTINUOUS_METRIC_INDEX) return value;
        const targetValue = targetValues[index] ?? value;
        return Math.round(value + (targetValue - value) * easedRatio);
      });

      animatedValuesRef.current = nextValues;
      setDisplayValues((prev) => {
        if (CONTINUOUS_METRIC_INDEX >= 0) {
          const result = [...nextValues];
          result[CONTINUOUS_METRIC_INDEX] = prev[CONTINUOUS_METRIC_INDEX] ?? 0;
          return result;
        }
        return nextValues;
      });

      if (progressRatio < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [metricPlans, visibleProgress, targetValuesKey]);

  useEffect(() => {
    if (visibleProgress === null || CONTINUOUS_METRIC_INDEX < 0) {
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
      continuousLastTimeRef.current = null;
      return;
    }

    const continuousMetric = metricPlans[CONTINUOUS_METRIC_INDEX];
    if (!continuousMetric) return;

    const newTarget = continuousMetric.currentDisplayValue;
    const prevTarget = continuousPrevTargetRef.current;
    if (newTarget > prevTarget) {
      const delta = newTarget - prevTarget;
      continuousVelocityRef.current = Math.min(
        continuousVelocityRef.current + CONTINUOUS_BOOST_FACTOR * delta,
        CONTINUOUS_MAX_VELOCITY,
      );
    }
    continuousPrevTargetRef.current = newTarget;

    const totalDisplay = continuousMetric.totalDisplayValue;
    const isComplete = current >= total && total > 0;

    if (continuousRafRef.current !== null) {
      cancelAnimationFrame(continuousRafRef.current);
    }
    continuousLastTimeRef.current = null;

    const tick = (timestamp: number) => {
      if (continuousLastTimeRef.current === null) {
        continuousLastTimeRef.current = timestamp;
        continuousRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(
        (timestamp - continuousLastTimeRef.current) / 1000,
        0.1,
      );
      continuousLastTimeRef.current = timestamp;

      let velocity = continuousVelocityRef.current;
      velocity *= Math.exp(-CONTINUOUS_DECAY_RATE * dt);

      const reachedTotal =
        totalDisplay > 0 && continuousValueRef.current >= totalDisplay;
      if (!(reachedTotal && isComplete)) {
        velocity = Math.max(velocity, CONTINUOUS_MIN_VELOCITY);
      }
      continuousVelocityRef.current = velocity;

      let nextValue = continuousValueRef.current + velocity * dt;
      if (totalDisplay > 0) {
        nextValue = Math.min(nextValue, totalDisplay);
      }
      continuousValueRef.current = nextValue;

      const rounded = Math.round(nextValue);
      setDisplayValues((prev) => {
        if (prev[CONTINUOUS_METRIC_INDEX] === rounded) return prev;
        const next = [...prev];
        next[CONTINUOUS_METRIC_INDEX] = rounded;
        return next;
      });

      const finished =
        totalDisplay > 0 && nextValue >= totalDisplay && isComplete;
      if (!finished) {
        continuousRafRef.current = requestAnimationFrame(tick);
      } else {
        continuousRafRef.current = null;
        continuousLastTimeRef.current = null;
      }
    };

    continuousRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    };
  }, [metricPlans, visibleProgress, displayedCurrent, total]);

  return (
    <Dialog open={visibleProgress !== null} onOpenChange={() => {}}>
      <DialogContent
        className='max-w-md overflow-hidden border-cyan-400/20 bg-neutral-950/70 shadow-[0_0_60px_rgba(8,145,178,0.12)] [&>button]:hidden'
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}>
        <GpuCanvas percent={percent} isActive={visibleProgress !== null} />
        <DialogHeader className='relative'>
          <DialogTitle>Importing Configuration</DialogTitle>
          <DialogDescription className='text-neutral-400'>
            Applying the saved room setup. This dialog will close automatically
            when the import finishes.
          </DialogDescription>
        </DialogHeader>

        <div className='relative overflow-hidden rounded-xl border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.10),_transparent_34%),linear-gradient(180deg,_rgba(3,7,18,0.55),_rgba(2,6,23,0.40))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'>
          <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(6,182,212,0.08),transparent)] opacity-70 import-progress-scanline' />
          <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:100%_8px] opacity-20' />
          <div className='pointer-events-none absolute -inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent import-progress-sweep' />

          <div className='relative space-y-4'>
            <div className='flex items-center justify-between gap-3'>
              <div className='space-y-1'>
                <p className='text-[11px] uppercase tracking-[0.32em] text-cyan-300/70'>
                  Render pipeline
                </p>
                <p className='text-sm font-medium text-white'>
                  {visibleProgress?.phase}
                </p>
              </div>
              <p className='text-sm text-cyan-100 tabular-nums drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]'>
                {percent}%
              </p>
            </div>

            <div className='space-y-2'>
              <Progress
                value={percent}
                className='h-2.5 bg-white/5 shadow-[0_0_18px_rgba(34,211,238,0.12)]'
              />
              <div className='flex items-center justify-between text-[10px] uppercase tracking-[0.26em] text-neutral-500'>
                <span>telemetry sync</span>
                <span className='tabular-nums'>
                  {displayedCurrent} / {total}
                </span>
              </div>
            </div>

            <div className='grid gap-2'>
              {metricPlans.map((metric, index) => {
                const animatedValue = displayValues[index] ?? 0;
                const animatedPercent =
                  metric.totalDisplayValue > 0
                    ? Math.round(
                        (animatedValue / metric.totalDisplayValue) * 100,
                      )
                    : 0;

                return (
                  <div
                    key={metric.label}
                    className={cn(
                      'group relative overflow-hidden rounded-lg border bg-black/15 p-3 backdrop-blur-[2px] transition-colors duration-300',
                      metric.borderClassName,
                    )}>
                    <div
                      className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 import-progress-glow'
                      style={{
                        background:
                          'radial-gradient(circle at top left, rgba(255,255,255,0.12), transparent 40%)',
                      }}
                    />
                    <div
                      className='pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent import-progress-metric-sweep'
                      style={{ animationDelay: `${metric.delayMs}ms` }}
                    />

                    <div className='relative flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p
                          className={cn(
                            'text-[10px] uppercase tracking-[0.3em] text-neutral-400',
                            metric.accentClassName,
                          )}>
                          {metric.label}
                        </p>
                        <p className='mt-1 font-mono text-sm text-white tabular-nums drop-shadow-[0_0_8px_rgba(255,255,255,0.12)]'>
                          {formatMetricValue(animatedValue)} /{' '}
                          {formatMetricValue(metric.totalDisplayValue)}
                        </p>
                      </div>

                      <span
                        className={cn(
                          'rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.24em] tabular-nums',
                          metric.badgeClassName,
                        )}>
                        {animatedPercent}%
                      </span>
                    </div>

                    <div className='relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/4'>
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out',
                          metric.barClassName,
                        )}
                        style={{ width: `${animatedPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <style jsx>{`
          .import-progress-scanline {
            animation: importProgressScanline 3.4s linear infinite;
          }

          .import-progress-sweep {
            animation: importProgressSweep 2.8s ease-in-out infinite;
          }

          .import-progress-metric-sweep {
            animation: importProgressMetricSweep 2.4s linear infinite;
          }

          .import-progress-glow {
            animation: importProgressGlow 1.8s ease-in-out infinite;
          }

          @keyframes importProgressScanline {
            0% {
              transform: translateY(-110%);
            }
            100% {
              transform: translateY(110%);
            }
          }

          @keyframes importProgressSweep {
            0%,
            100% {
              transform: translateX(-12%);
              opacity: 0.22;
            }
            50% {
              transform: translateX(12%);
              opacity: 0.78;
            }
          }

          @keyframes importProgressMetricSweep {
            0% {
              transform: translateX(-160%);
              opacity: 0;
            }
            18% {
              opacity: 0.42;
            }
            52% {
              opacity: 0.1;
            }
            100% {
              transform: translateX(440%);
              opacity: 0;
            }
          }

          @keyframes importProgressGlow {
            0%,
            100% {
              opacity: 0.1;
            }
            50% {
              opacity: 0.28;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
