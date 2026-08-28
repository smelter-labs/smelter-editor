import React from 'react';
import { Shader, Text, View } from '@swmansion/smelter';
import { hexToRgb } from '../utils/shaderUtils';

const HUD_FONT = 'Doto';

/**
 * Retro navy-blueprint palette — keep in sync with the editor retro-kit `R5`
 * (editor/components/duck-hunter/retro-kit.tsx), which this HUD mirrors on
 * the broadcast.
 */
export const RETRO = {
  bgDeep: '#081120',
  panel: '#0b1a33',
  panelDark: '#08132a',
  line: '#2e5c9e',
  lineBright: '#4d86d8',
  cyan: '#4fc3f7',
  orange: '#ff9210',
  orangeBright: '#ffb428',
  yellow: '#ffd23e',
  red: '#ff4030',
  green: '#3fd05a',
  ink: '#dbe6f5',
  inkMuted: '#7c93b8',
} as const;

/**
 * Big centered arcade headline with a hard pixel drop shadow (two stacked
 * Texts — engine Text has no shadows/outlines and rotated/bordered Views are
 * broken on this build).
 */
export function ArcadeBigText({
  text,
  fontSize,
  color,
  top,
  width,
}: {
  text: string;
  fontSize: number;
  color: string;
  top: number;
  width: number;
}) {
  const off = Math.max(2, Math.round(fontSize * 0.05));
  const lineH = Math.round(fontSize * 1.4);
  const line = (dx: number, dy: number, c: string) => (
    <View
      style={{ top: dy, left: dx, width, height: lineH, overflow: 'visible' }}>
      <Text
        style={{
          fontSize,
          color: c,
          width,
          align: 'center',
          fontFamily: HUD_FONT,
          fontWeight: 'black',
        }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View style={{ top, left: 0, width, height: lineH, overflow: 'visible' }}>
      {line(off, off, '#04080f')}
      {line(0, 0, color)}
    </View>
  );
}

/**
 * Chamfered retro panel chrome on the broadcast, drawn by the `retro-panel`
 * shader (bordered/rotated Views render broken on this engine build, so the
 * cut-corner double-stroke shape can't be built from Views). The shader draws
 * chrome only; `children` render in a sibling View stacked on top, so Text
 * never depends on shader texture compositing.
 */
export function RetroPanel({
  x,
  y,
  w,
  h,
  cut = 10,
  line = RETRO.lineBright,
  linePx = 3,
  gapPx = 3,
  fill = RETRO.panel,
  fillA = 0.88,
  glow = 0,
  glowPx = 14,
  grid = 0,
  gridPx = 26,
  scanline = 0,
  scanPx = 3,
  flash = 0,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Chamfer size in px (already scaled by the caller). */
  cut?: number;
  /** Accent line hex; linePx 0 = borderless backdrop mode. */
  line?: string;
  linePx?: number;
  gapPx?: number;
  fill?: string;
  fillA?: number;
  glow?: number;
  glowPx?: number;
  grid?: number;
  gridPx?: number;
  scanline?: number;
  scanPx?: number;
  /** 0..1 urgency boost on the line color (arcade blink). */
  flash?: number;
  children?: React.ReactNode;
}) {
  const w2 = Math.max(2, Math.round(w));
  const h2 = Math.max(2, Math.round(h));
  const lineRgb = hexToRgb(line);
  const fillRgb = hexToRgb(fill);
  return (
    <View
      style={{
        top: Math.round(y),
        left: Math.round(x),
        width: w2,
        height: h2,
        overflow: 'visible',
      }}>
      <Shader
        shaderId='retro-panel'
        resolution={{ width: w2, height: h2 }}
        shaderParam={{
          type: 'struct',
          value: [
            { type: 'f32', fieldName: 'cut_px', value: cut },
            { type: 'f32', fieldName: 'line_px', value: linePx },
            { type: 'f32', fieldName: 'gap_px', value: gapPx },
            { type: 'f32', fieldName: 'glow', value: glow },
            { type: 'f32', fieldName: 'glow_px', value: glowPx },
            { type: 'f32', fieldName: 'line_r', value: lineRgb.r },
            { type: 'f32', fieldName: 'line_g', value: lineRgb.g },
            { type: 'f32', fieldName: 'line_b', value: lineRgb.b },
            { type: 'f32', fieldName: 'fill_r', value: fillRgb.r },
            { type: 'f32', fieldName: 'fill_g', value: fillRgb.g },
            { type: 'f32', fieldName: 'fill_b', value: fillRgb.b },
            { type: 'f32', fieldName: 'fill_a', value: fillA },
            { type: 'f32', fieldName: 'grid', value: grid },
            { type: 'f32', fieldName: 'grid_px', value: gridPx },
            { type: 'f32', fieldName: 'scanline', value: scanline },
            { type: 'f32', fieldName: 'scan_px', value: scanPx },
            { type: 'f32', fieldName: 'flash', value: flash },
          ],
        }}>
        {/* Shader children must have a known size; the texture is unused. */}
        <View style={{ width: w2, height: h2 }} />
      </Shader>
      {children != null ? (
        <View
          style={{ top: 0, left: 0, width: w2, height: h2, overflow: 'visible' }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
