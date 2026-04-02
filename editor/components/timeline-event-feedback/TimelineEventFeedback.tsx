'use client';

import { useState, useEffect, useRef } from 'react';
import { Play, Square, Diamond, Move, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTimelineEventsEnabledSetting,
  useTimelineEventsPositionSetting,
  useTimelineEventsSizeSetting,
  useTimelineEventsDurationSetting,
} from '@/lib/timeline-event-settings';
import {
  TIMELINE_EVENT_NOTIFICATION,
  type TimelineEventNotification,
  type TimelineEventType,
} from '@/lib/timeline-event-notifications';
import type { FeedbackPosition, FeedbackSize } from '@/lib/voice/macroSettings';

const POSITION_CLASSES: Record<FeedbackPosition, string> = {
  'top-left': 'top-8 left-8',
  'top-center': 'top-8 left-1/2 -translate-x-1/2',
  'top-right': 'top-8 right-8',
  'center-left': 'top-1/2 left-8 -translate-y-1/2',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'center-right': 'top-1/2 right-8 -translate-y-1/2',
  'bottom-left': 'bottom-8 left-8',
  'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-8 right-8',
};

const SIZE_CLASSES: Record<FeedbackSize, string> = {
  s: 'min-w-[260px] max-w-[360px]',
  m: 'min-w-[320px] max-w-[440px]',
  l: 'min-w-[380px] max-w-[520px]',
};

const EVENT_ICONS: Record<TimelineEventType, LucideIcon> = {
  'block-enter': Play,
  'block-exit': Square,
  keyframe: Diamond,
  'position-change': Move,
};

const EVENT_LABELS: Record<TimelineEventType, string> = {
  'block-enter': 'Block Started',
  'block-exit': 'Block Ended',
  keyframe: 'Keyframe',
  'position-change': 'Position Changed',
};

// ── GPU Mini-Canvas Types & Helpers ──────────────────────────────────

type FxPt = { x: number; y: number };

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

type FxBolt = {
  pts: FxPt[];
  branches: FxPt[][];
  life: number;
  maxLife: number;
  w: number;
  hue: number;
};

type MiniFxState = {
  w: number;
  h: number;
  dpr: number;
  sparks: FxSpark[];
  bolts: FxBolt[];
  nextBolt: number;
};

function fxHsl(h: number, s: number, l: number, a: number) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

function extractHue(color: string): number {
  const hslMatch = color.match(/hsl[a]?\(\s*(\d+)/);
  if (hslMatch) return parseInt(hslMatch[1], 10);

  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 200;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return Math.round(h * 60 + 360) % 360;
  }
  return 200;
}

function displaceMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  d: number,
  depth: number,
): FxPt[] {
  if (depth <= 0) return [{ x: x1, y: y1 }, { x: x2, y: y2 }];
  const mx = (x1 + x2) / 2 + (Math.random() - 0.5) * d;
  const my = (y1 + y2) / 2 + (Math.random() - 0.5) * d;
  const left = displaceMidpoint(x1, y1, mx, my, d * 0.52, depth - 1);
  const right = displaceMidpoint(mx, my, x2, y2, d * 0.52, depth - 1);
  return [...left.slice(0, -1), ...right];
}

function makeMiniSpark(w: number, h: number, hue: number): FxSpark {
  return {
    x: Math.random() * 6,
    y: Math.random() * h,
    vx: 8 + Math.random() * 18,
    vy: (Math.random() - 0.5) * 20,
    life: Math.random() * 0.6,
    maxLife: 0.8 + Math.random() * 0.7,
    hue: hue + (Math.random() - 0.5) * 30,
    size: 0.6 + Math.random() * 0.6,
    bright: 0.5 + Math.random() * 0.5,
  };
}

function makeMiniBolt(w: number, h: number, hue: number): FxBolt {
  const x1 = Math.random() < 0.5 ? 0 : w;
  const y1 = Math.random() * h;
  const x2 = w * 0.2 + Math.random() * w * 0.6;
  const y2 = h * 0.2 + Math.random() * h * 0.6;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const pts = displaceMidpoint(x1, y1, x2, y2, dist * 0.25, 4);

  const branches: FxPt[][] = [];
  for (let i = 0; i < 1 + Math.floor(Math.random() * 2); i++) {
    const idx = Math.min(
      Math.floor(pts.length * 0.3 + Math.random() * pts.length * 0.4),
      pts.length - 1,
    );
    const bp = pts[idx];
    const bx = bp.x + (Math.random() - 0.5) * dist * 0.3;
    const by = bp.y + (Math.random() - 0.5) * dist * 0.3;
    branches.push(
      displaceMidpoint(
        bp.x,
        bp.y,
        bx,
        by,
        Math.hypot(bx - bp.x, by - bp.y) * 0.25,
        2,
      ),
    );
  }

  return {
    pts,
    branches,
    life: 0,
    maxLife: 0.12 + Math.random() * 0.15,
    w: 0.6 + Math.random() * 1.0,
    hue: hue + (Math.random() - 0.5) * 20,
  };
}

function updateMiniFx(s: MiniFxState, dt: number, hue: number) {
  while (s.sparks.length < 8) s.sparks.push(makeMiniSpark(s.w, s.h, hue));
  for (const p of s.sparks) {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx += (Math.random() - 0.5) * 12 * dt;
    p.vy += (Math.random() - 0.5) * 8 * dt;
  }
  s.sparks = s.sparks.filter(
    (p) =>
      p.life < p.maxLife && p.y > -4 && p.y < s.h + 4 && p.x > -4 && p.x < s.w + 4,
  );

  s.nextBolt -= dt;
  if (s.nextBolt <= 0) {
    s.bolts.push(makeMiniBolt(s.w, s.h, hue));
    s.nextBolt = 0.6 + Math.random() * 0.5;
  }
  for (const b of s.bolts) b.life += dt;
  s.bolts = s.bolts.filter((b) => b.life < b.maxLife);
}

function drawMiniFx(ctx: CanvasRenderingContext2D, s: MiniFxState) {
  const { w, h, dpr } = s;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  for (const sp of s.sparks) {
    const lr = sp.life / sp.maxLife;
    const a = Math.min(1, sp.life * 6) * (1 - lr) * sp.bright;
    if (a < 0.01) continue;
    ctx.shadowColor = fxHsl(sp.hue, 100, 70, 1);
    ctx.shadowBlur = 8 * a;
    ctx.fillStyle = fxHsl(sp.hue, 85, 80, a * 0.85);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = fxHsl(sp.hue, 40, 95, a);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size * 0.35, 0, Math.PI * 2);
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
    ctx.shadowBlur = 18;
    strokePath(bolt.pts, bolt.w * 3, a * 0.3);
    ctx.shadowBlur = 8;
    strokePath(bolt.pts, bolt.w * 1.5, a * 0.6);
    ctx.shadowBlur = 0;
    strokePath(bolt.pts, bolt.w * 0.4, a);

    if (lr < 0.2) {
      ctx.strokeStyle = `rgba(255,255,255,${a * 0.45})`;
      ctx.lineWidth = bolt.w * 0.15;
      ctx.beginPath();
      ctx.moveTo(bolt.pts[0].x, bolt.pts[0].y);
      for (let i = 1; i < bolt.pts.length; i++)
        ctx.lineTo(bolt.pts[i].x, bolt.pts[i].y);
      ctx.stroke();
    }

    for (const br of bolt.branches) {
      ctx.shadowColor = fxHsl(bolt.hue, 100, 70, a * 0.5);
      ctx.shadowBlur = 10;
      strokePath(br, bolt.w * 1.2, a * 0.25);
      ctx.shadowBlur = 0;
      strokePath(br, bolt.w * 0.4, a * 0.5);
    }
    ctx.shadowBlur = 0;
  }
}

function MiniGpuCanvas({ color, isActive }: { color: string; isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const hue = extractHue(color);

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

    const st: MiniFxState = {
      w: rect.width,
      h: rect.height,
      dpr,
      sparks: [],
      bolts: [],
      nextBolt: 0.3 + Math.random() * 0.4,
    };
    for (let i = 0; i < 6; i++) st.sparks.push(makeMiniSpark(st.w, st.h, hue));

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      updateMiniFx(st, dt, hue);
      drawMiniFx(ctx, st);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, hue]);

  if (!isActive) return null;
  return (
    <canvas
      ref={canvasRef}
      className='absolute inset-0 pointer-events-none'
      style={{ borderRadius: 'inherit' }}
    />
  );
}

// ── Toast Card ───────────────────────────────────────────────────────

type QueuedEvent = TimelineEventNotification & {
  id: number;
  phase: 'enter' | 'visible' | 'exit';
};

function TimelineEventCard({
  item,
  size,
  position,
}: {
  item: QueuedEvent;
  size: FeedbackSize;
  position: FeedbackPosition;
}) {
  const { type, inputLabel, color, detail, phase } = item;
  const IconComponent = EVENT_ICONS[type];
  const isTop = position.startsWith('top');

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl backdrop-blur-sm shadow-2xl transition-all duration-[400ms] ease-out',
        SIZE_CLASSES[size],
        phase === 'enter' && 'opacity-0 scale-95',
        phase === 'enter' && (isTop ? '-translate-y-2' : 'translate-y-2'),
        phase === 'visible' && 'opacity-100 scale-100 translate-y-0',
        phase === 'exit' && 'opacity-0 scale-95 translate-y-1',
      )}
      style={{
        border: `1px solid ${color}33`,
        background: `linear-gradient(135deg, ${color}12 0%, rgba(10,10,10,0.95) 100%)`,
      }}>
      <MiniGpuCanvas color={color} isActive={phase === 'enter' || phase === 'visible'} />

      <div
        className='pointer-events-none absolute inset-0 opacity-40 tl-event-scanline'
        style={{
          background: `linear-gradient(180deg, transparent, ${color}15, transparent)`,
        }}
      />

      <div
        className='pointer-events-none absolute -inset-x-8 top-0 h-px tl-event-sweep'
        style={{
          background: `linear-gradient(to right, transparent, ${color}aa, transparent)`,
        }}
      />

      <div className='relative flex items-center gap-3 px-4 py-3'>
        <div
          className='absolute left-0 top-2 bottom-2 w-1 rounded-r-full'
          style={{ background: color }}
        />

        <div
          className='flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
          style={{ background: `${color}22` }}>
          <IconComponent className='w-4 h-4' style={{ color }} />
        </div>

        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium text-white truncate'>{inputLabel}</p>
          <p className='text-xs text-neutral-400'>{detail || EVENT_LABELS[type]}</p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

let idCounter = 0;

export function TimelineEventFeedback() {
  const [items, setItems] = useState<QueuedEvent[]>([]);
  const [enabled] = useTimelineEventsEnabledSetting();
  const [position] = useTimelineEventsPositionSetting();
  const [size] = useTimelineEventsSizeSetting();
  const [durationSec] = useTimelineEventsDurationSetting();
  const durationRef = useRef(durationSec * 1000);

  useEffect(() => {
    durationRef.current = durationSec * 1000;
  }, [durationSec]);

  useEffect(() => {
    const handler = (e: CustomEvent<TimelineEventNotification>) => {
      const item: QueuedEvent = { ...e.detail, id: ++idCounter, phase: 'enter' };
      setItems((prev) => {
        const next = [...prev, item];
        return next.slice(-5);
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, phase: 'visible' } : i)),
          );
        });
      });

      setTimeout(() => {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, phase: 'exit' } : i)),
        );
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        }, 400);
      }, durationRef.current);
    };

    window.addEventListener(
      TIMELINE_EVENT_NOTIFICATION,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        TIMELINE_EVENT_NOTIFICATION,
        handler as EventListener,
      );
  }, []);

  if (!enabled || items.length === 0) return null;

  const isBottom = position.startsWith('bottom');

  return (
    <div
      className={cn(
        'fixed z-[9998] pointer-events-none',
        POSITION_CLASSES[position],
      )}>
      <div
        className={cn(
          'flex gap-2 pointer-events-auto',
          isBottom ? 'flex-col-reverse' : 'flex-col',
        )}>
        {items.map((item) => (
          <TimelineEventCard
            key={item.id}
            item={item}
            size={size}
            position={position}
          />
        ))}
      </div>

      <style jsx>{`
        .tl-event-scanline {
          animation: tlEventScanline 3s linear infinite;
        }
        .tl-event-sweep {
          animation: tlEventSweep 2.4s ease-in-out infinite;
        }
        @keyframes tlEventScanline {
          0% {
            transform: translateY(-110%);
          }
          100% {
            transform: translateY(110%);
          }
        }
        @keyframes tlEventSweep {
          0%,
          100% {
            transform: translateX(-14%);
            opacity: 0.2;
          }
          50% {
            transform: translateX(14%);
            opacity: 0.8;
          }
        }
      `}</style>
    </div>
  );
}
