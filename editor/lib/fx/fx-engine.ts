import type { FxPt, FxSpark, FxBolt, FxState, FxConfig } from './types';

export function fxHsl(h: number, s: number, l: number, a: number): string {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

export function extractHue(color: string): number {
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

export function displaceMidpoint(
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

export function makeSpark(
  w: number,
  h: number,
  hues: number[],
  origin: 'bottom' | 'left',
  scatter?: boolean,
): FxSpark {
  if (origin === 'left') {
    const hue = hues[0] ?? 200;
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
  return {
    x: Math.random() * w,
    y: scatter ? Math.random() * h : h + Math.random() * 20,
    vx: (Math.random() - 0.5) * 28,
    vy: -(25 + Math.random() * 55),
    life: scatter ? Math.random() * 3 : 0,
    maxLife: 1.2 + Math.random() * 2.0,
    hue: hues[Math.floor(Math.random() * hues.length)],
    size: 0.8 + Math.random() * 1.8,
    bright: 0.5 + Math.random() * 0.5,
  };
}

export function makeBolt(
  w: number,
  h: number,
  hues: number[],
  complexity: 'full' | 'mini',
): FxBolt {
  let x1: number, y1: number;

  if (complexity === 'mini') {
    x1 = Math.random() < 0.5 ? 0 : w;
    y1 = Math.random() * h;
  } else {
    const edge = Math.random();
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
  }

  const x2 = w * 0.2 + Math.random() * w * 0.6;
  const y2 = h * 0.2 + Math.random() * h * 0.6;
  const dist = Math.hypot(x2 - x1, y2 - y1);

  const displFactor = complexity === 'mini' ? 0.25 : 0.35;
  const depth = complexity === 'mini' ? 4 : 5;
  const pts = displaceMidpoint(x1, y1, x2, y2, dist * displFactor, depth);

  const branchMin = complexity === 'mini' ? 1 : 2;
  const branchExtra = complexity === 'mini' ? 2 : 3;
  const branchDepth = complexity === 'mini' ? 2 : 3;
  const branchSpread = complexity === 'mini' ? 0.3 : 0.4;
  const branchRange = complexity === 'mini' ? 0.4 : 0.5;
  const branchDispl = complexity === 'mini' ? 0.25 : 0.3;

  const branches: FxPt[][] = [];
  for (
    let i = 0;
    i < branchMin + Math.floor(Math.random() * branchExtra);
    i++
  ) {
    const idx = Math.min(
      Math.floor(pts.length * 0.3 + Math.random() * pts.length * branchRange),
      pts.length - 1,
    );
    const bp = pts[idx];
    const bx = bp.x + (Math.random() - 0.5) * dist * branchSpread;
    const by = bp.y + (Math.random() - 0.5) * dist * branchSpread;
    branches.push(
      displaceMidpoint(
        bp.x,
        bp.y,
        bx,
        by,
        Math.hypot(bx - bp.x, by - bp.y) * branchDispl,
        branchDepth,
      ),
    );
  }

  const hue =
    complexity === 'mini'
      ? (hues[0] ?? 200) + (Math.random() - 0.5) * 20
      : hues[Math.floor(Math.random() * hues.length)];

  return {
    pts,
    branches,
    life: 0,
    maxLife:
      complexity === 'mini'
        ? 0.12 + Math.random() * 0.15
        : 0.15 + Math.random() * 0.2,
    w:
      complexity === 'mini'
        ? 0.6 + Math.random() * 1.0
        : 1.2 + Math.random() * 2,
    hue,
  };
}

export function makeCircuits(
  w: number,
  h: number,
  count: number = 28,
): FxPt[][] {
  const grid = 16;
  const paths: FxPt[][] = [];
  for (let i = 0; i < count; i++) {
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

export function makeDotPattern(
  w: number,
  h: number,
  dpr: number,
): HTMLCanvasElement {
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

export function createFxState(
  w: number,
  h: number,
  dpr: number,
  cfg: FxConfig,
): FxState {
  const st: FxState = {
    w,
    h,
    dpr,
    sparks: [],
    bolts: [],
    circuits: cfg.layers.circuits
      ? makeCircuits(w, h, cfg.circuitCount)
      : [],
    pulses: [],
    waves: [],
    dots: cfg.layers.dots ? makeDotPattern(w, h, dpr) : null,
    nextBolt: cfg.boltInterval * 0.5 + Math.random() * cfg.boltInterval * 0.5,
    nextWave: 1.0,
    nextPulse: 0.3,
  };
  if (cfg.layers.sparks && cfg.initialSparkCount > 0) {
    for (let i = 0; i < cfg.initialSparkCount; i++) {
      st.sparks.push(makeSpark(w, h, cfg.hues, cfg.sparkOrigin, true));
    }
  }
  return st;
}

export function updateFx(s: FxState, dt: number, cfg: FxConfig): void {
  const pct = cfg.intensity;
  const hues = cfg.hues;

  if (cfg.layers.sparks) {
    const target = Math.floor(cfg.sparkCount + cfg.sparkIntensityScale * pct);
    while (s.sparks.length < target)
      s.sparks.push(makeSpark(s.w, s.h, hues, cfg.sparkOrigin));

    for (const p of s.sparks) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (cfg.sparkOrigin === 'left') {
        p.vx += (Math.random() - 0.5) * 12 * dt;
        p.vy += (Math.random() - 0.5) * 8 * dt;
      } else {
        p.vx += (Math.random() - 0.5) * 40 * dt;
        p.vy -= 8 * dt;
      }
    }

    const bound = cfg.sparkOrigin === 'left' ? 4 : 10;
    s.sparks = s.sparks.filter((p) => {
      if (p.life >= p.maxLife) return false;
      if (p.x < -bound || p.x > s.w + bound) return false;
      if (p.y < -bound) return false;
      if (cfg.sparkOrigin === 'left' && p.y > s.h + bound) return false;
      return true;
    });
  }

  if (cfg.layers.bolts) {
    s.nextBolt -= dt;
    if (s.nextBolt <= 0 && pct >= cfg.boltIntensityThreshold) {
      const burstCount =
        cfg.boltComplexity === 'mini'
          ? 1
          : Math.min(
              1 + Math.floor(Math.random() * 2 + pct * 2),
              cfg.boltBurstMax,
            );
      for (let i = 0; i < burstCount; i++) {
        s.bolts.push(makeBolt(s.w, s.h, hues, cfg.boltComplexity));
      }
      if (cfg.boltComplexity === 'mini') {
        s.nextBolt =
          cfg.boltInterval + Math.random() * cfg.boltInterval * 0.8;
      } else {
        const iv = cfg.boltInterval - cfg.boltInterval * 0.57 * pct;
        s.nextBolt = iv + Math.random() * iv * 0.4;
      }
    }
    for (const b of s.bolts) b.life += dt;
    s.bolts = s.bolts.filter((b) => b.life < b.maxLife);
  }

  if (cfg.layers.pulses && s.circuits.length > 0) {
    s.nextPulse -= dt;
    if (s.nextPulse <= 0) {
      const pulseCount = 1 + Math.floor(Math.random() * 2 + pct);
      for (let i = 0; i < pulseCount; i++) {
        s.pulses.push({
          path: Math.floor(Math.random() * s.circuits.length),
          t: 0,
          speed: 0.4 + Math.random() * 0.5 + pct * 0.4,
          hue: hues[Math.floor(Math.random() * hues.length)],
          tail: 0.18 + Math.random() * 0.14,
        });
      }
      const iv = cfg.pulseInterval - cfg.pulseInterval * 0.625 * pct;
      s.nextPulse = iv + Math.random() * iv * 0.2;
    }
    for (const p of s.pulses) p.t += p.speed * dt;
    s.pulses = s.pulses.filter((p) => p.t < 1 + p.tail);
  }

  if (cfg.layers.waves) {
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
      s.nextWave = cfg.waveInterval - pct * cfg.waveInterval * 0.5;
    }
    for (const wv of s.waves) {
      wv.life += dt;
      wv.r += (wv.maxR / wv.maxLife) * dt;
    }
    s.waves = s.waves.filter((wv) => wv.life < wv.maxLife);
  }
}

export function drawFx(
  ctx: CanvasRenderingContext2D,
  s: FxState,
  cfg: FxConfig,
): void {
  const { w, h, dpr } = s;
  const pct = cfg.intensity;
  const hues = cfg.hues;
  const gs = cfg.glowScale;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (cfg.layers.dots && s.dots) {
    ctx.globalAlpha = 0.6 + pct * 0.4;
    ctx.drawImage(s.dots, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  if (cfg.layers.circuits && s.circuits.length > 0) {
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
  }

  if (cfg.layers.pulses) {
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
          ctx.shadowBlur = 14 * gs;
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
            ctx.shadowBlur = 18 * gs;
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
  }

  if (cfg.layers.waves) {
    for (const wv of s.waves) {
      const p = wv.life / wv.maxLife;
      const a = (0.22 + pct * 0.15) * (1 - p) * (1 - p);
      if (a < 0.005) continue;
      const waveHue =
        hues[Math.floor((wv.cx + wv.cy) * 0.01) % hues.length];
      ctx.strokeStyle = fxHsl(waveHue, 90, 75, a);
      ctx.lineWidth = 2 * (1 - p * 0.4);
      ctx.shadowColor = fxHsl(waveHue, 100, 70, a * 0.9);
      ctx.shadowBlur = 20 * gs;
      ctx.beginPath();
      ctx.arc(wv.cx, wv.cy, wv.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  if (cfg.layers.sparks) {
    for (const sp of s.sparks) {
      const lr = sp.life / sp.maxLife;
      const a = Math.min(1, sp.life * 5) * (1 - lr) * sp.bright;
      if (a < 0.01) continue;
      ctx.shadowColor = fxHsl(sp.hue, 100, 70, 1);
      ctx.shadowBlur = 10 * gs * a;
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
  }

  if (cfg.layers.bolts) {
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
        for (let i = 1; i < pts.length; i++)
          ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      };
      ctx.shadowColor = fxHsl(bolt.hue, 100, 70, a);
      ctx.shadowBlur = 30 * gs;
      strokePath(bolt.pts, bolt.w * 4, a * 0.35);
      ctx.shadowBlur = 12 * gs;
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
        ctx.shadowBlur = 14 * gs;
        strokePath(br, bolt.w * 2, a * 0.3);
        ctx.shadowBlur = 0;
        strokePath(br, bolt.w * 0.6, a * 0.6);
      }
      ctx.shadowBlur = 0;
    }
  }
}
