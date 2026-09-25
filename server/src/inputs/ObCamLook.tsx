import React from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { ShaderParamStructField } from '@swmansion/smelter';
import type { ObHudLook } from '../app/store';

type Resolution = { width: number; height: number };

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
  return (
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
}
