import React from 'react';
import { Shader, Text, View } from '@swmansion/smelter';
import type { ShaderParamStructField } from '@swmansion/smelter';
import type { ObHudLook } from '../app/store';

type Resolution = { width: number; height: number };

/** Panel amber (ob-kit `OB.amber`) — the HOST marking matches the desk. */
const HOST_GOLD = '#F5B301';
const HOST_INK = '#141414';

/**
 * Gold frame + HOST chip over the confirmed host's picture. Drawn in the
 * camera's content space, so it scales with the tile wherever the stage puts
 * it (featured main, grid cell, solo).
 */
function HostTag({ width, height }: Resolution) {
  const k = height / 1080;
  const border = Math.max(2, Math.round(10 * k));
  const fs = Math.max(12, Math.round(52 * k));
  const chipH = Math.round(fs * 1.5);
  const chipW = Math.round(fs * 3.2);
  const inset = Math.max(4, Math.round(32 * k));
  return (
    <View style={{ top: 0, left: 0, width, height }}>
      {/* width/height exclude the border while top/left measure to its OUTER
          edge (same engine quirk as SmoothedBoxes/KbtHud) — size the box down
          by 2*border or the right/bottom strokes get clipped by the tile. */}
      <View
        style={{
          top: 0,
          left: 0,
          width: Math.max(2, width - 2 * border),
          height: Math.max(2, height - 2 * border),
          borderWidth: border,
          borderColor: HOST_GOLD,
        }}
      />
      <View
        style={{
          top: inset,
          left: inset,
          width: chipW,
          height: chipH,
          backgroundColor: HOST_GOLD,
          borderRadius: Math.round(6 * k) + 2,
        }}
      />
      <View
        style={{
          top: inset + Math.round((chipH - fs * 1.2) / 2),
          left: inset,
          width: chipW,
          height: Math.round(fs * 1.45),
          overflow: 'hidden',
        }}>
        <Text
          style={{
            fontSize: fs,
            color: HOST_INK,
            width: chipW,
            align: 'center',
            fontFamily: 'Big Shoulders Display',
            fontWeight: 'extra_bold',
          }}>
          HOST
        </Text>
      </View>
    </View>
  );
}

/** hsl-adjust params per grade (mix 0 = untouched picture). */
const GRADE_HSL: Record<
  ObHudLook['grade'],
  { hue: number; sat: number; light: number; mix: number }
> = {
  none: { hue: 0, sat: 0, light: 0, mix: 0 },
  warm: { hue: -0.025, sat: 0.12, light: 0.02, mix: 1 },
  cool: { hue: 0.045, sat: -0.08, light: 0, mix: 1 },
  mono: { hue: 0, sat: -1, light: 0, mix: 1 },
  vhs: { hue: 0, sat: -0.15, light: 0, mix: 1 },
  neon: { hue: 0.06, sat: 0.55, light: 0.03, mix: 1 },
};

const f32 = (fieldName: string, value: number): ShaderParamStructField => ({
  type: 'f32',
  fieldName,
  value,
});

function sized(children: React.ReactElement, { width, height }: Resolution) {
  // Shader children need a known size (the raw stream's Rescaler may not have one).
  return <View style={{ width, height }}>{children}</View>;
}

/**
 * OB Van per-camera picture treatment: the program grade (hsl-adjust, plus
 * the vhs-distortion pass for `vhs`) and the spotlight vignette. Driven by the
 * `obVan.stage.tiles[inputId]` store slot — never by `input.shaders` (that
 * would leak into the editor's shader list and the room state). The
 * hsl-adjust and vignette passes stay mounted for every OB camera and only
 * their params change, so a grade or a cut never rebuilds the video node.
 */
export function ObCamLook({
  look,
  resolution,
  children,
}: {
  look: ObHudLook;
  resolution: Resolution;
  children: React.ReactElement;
}) {
  const g = GRADE_HSL[look.grade];
  const scale = look.focus?.scale ?? 1;
  let content = (
    <Shader
      shaderId='hsl-adjust'
      resolution={resolution}
      shaderParam={{
        type: 'struct',
        value: [
          f32('hue_shift', g.hue),
          f32('saturation', g.sat),
          f32('lightness', g.light),
          f32('colorize_enable', 0),
          f32('colorize_hue', 0),
          f32('colorize_saturation', 0),
          f32('mix_amount', g.mix),
        ],
      }}>
      {sized(children, resolution)}
    </Shader>
  );
  if (look.grade === 'vhs') {
    content = (
      <Shader
        shaderId='vhs-distortion'
        resolution={resolution}
        shaderParam={{
          type: 'struct',
          value: [
            f32('jitter_x_px', 4),
            f32('jitter_y_px', 1),
            f32('jitter_speed', 6),
            f32('tape_warp', 0.3),
            f32('color_bleed_px', 2.5),
            f32('ghosting', 0.2),
            f32('scanline_intensity', 0.25),
            f32('scanline_density', 1.6),
            f32('noise_intensity', 0.12),
            f32('dropout_intensity', 0.15),
            f32('chroma_noise', 0.15),
            f32('tape_tint', 0.2),
          ],
        }}>
        {sized(content, resolution)}
      </Shader>
    );
  }
  content = (
    <Shader
      shaderId='vignette'
      resolution={resolution}
      shaderParam={{
        type: 'struct',
        value: [
          f32('intensity', 1),
          f32('radius', 0.22 * scale),
          f32('softness', 0.45 * scale),
          f32('roundness', 0.6),
          f32('color_r', 0),
          f32('color_g', 0),
          f32('color_b', 0),
          f32('center_x', look.focus?.cx ?? 0),
          f32('center_y', look.focus?.cy ?? -0.1),
          f32('opacity', look.spotlight ? 1 : 0),
        ],
      }}>
      {sized(content, resolution)}
    </Shader>
  );
  // The outer View keeps the tree shape stable whether or not the HOST
  // marking shows, so toggling it never rebuilds the video node. The shader
  // stack sits in a positioned full-frame View (a Shader left in flow gets
  // pushed off screen), the marking paints on top.
  return (
    <View style={{ width: resolution.width, height: resolution.height }}>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
        }}>
        {content}
      </View>
      {look.hostTag ? <HostTag {...resolution} /> : null}
    </View>
  );
}
