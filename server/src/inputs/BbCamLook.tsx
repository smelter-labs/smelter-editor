import React from 'react';
import { Shader, View } from '@swmansion/smelter';
import type { ShaderParamStructField } from '@swmansion/smelter';
import { hexToRgb } from '../utils/shaderUtils';

type BbCamLookProps = {
  /** The content to grade (raw input or an already-wrapped variant). */
  children: React.ReactElement;
  /** Tint colour, `#rrggbb`. */
  color: string;
  /** False fades the look out without unmounting the pass. */
  active: boolean;
  resolution: { width: number; height: number };
};

// The "cold feed" look: enough to read as a different camera, not enough to
// hurt the action under the rim.
const TINT_AMOUNT = 0.1;
const CONTRAST = 1.06;
const VIGNETTE = 0.14;
const SCANLINE = 0.045;

/**
 * Wraps `children` in the `bb-cam-look` WGSL shader so the Blacktop hoop cam
 * grades apart from the full-frame court view.
 *
 * Mounted on the operator's mode alone — the PiP coming and going only drives
 * `strength`. Gating the mount on the stage would rebuild the video node on
 * every scene cut and flash (same reason the kettlebell rig stays mounted, see
 * inputs.tsx).
 */
export function BbCamLook({
  children,
  color,
  active,
  resolution,
}: BbCamLookProps) {
  const { width, height } = resolution;
  const tint = hexToRgb(color);
  const params: ShaderParamStructField[] = [
    { type: 'f32', fieldName: 'strength', value: active ? 1 : 0 },
    { type: 'f32', fieldName: 'tint_r', value: tint.r },
    { type: 'f32', fieldName: 'tint_g', value: tint.g },
    { type: 'f32', fieldName: 'tint_b', value: tint.b },
    { type: 'f32', fieldName: 'tint_amount', value: TINT_AMOUNT },
    { type: 'f32', fieldName: 'contrast', value: CONTRAST },
    { type: 'f32', fieldName: 'vignette', value: VIGNETTE },
    { type: 'f32', fieldName: 'scanline', value: SCANLINE },
  ];
  return (
    <Shader
      shaderId='bb-cam-look'
      resolution={resolution}
      shaderParam={{ type: 'struct', value: params }}>
      {/* Shader children must have a known size — a sized View makes that
          hold for any content (e.g. the raw stream's auto-sized Rescaler). */}
      <View style={{ width, height }}>{children}</View>
    </Shader>
  );
}
