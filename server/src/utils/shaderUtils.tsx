import type { ShaderParamStructField } from '@swmansion/smelter';
import { Shader } from '@swmansion/smelter';
import React from 'react';
import type { ShaderConfig } from '../types';
import shadersController from '../shaders/shaders';

type Resolution = { width: number; height: number };

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleanHex = hex.replace('#', '');
  const fullHex =
    cleanHex.length === 3
      ? cleanHex
          .split('')
          .map((char) => char + char)
          .join('')
      : cleanHex;
  const r = parseInt(fullHex.substring(0, 2), 16) / 255;
  const g = parseInt(fullHex.substring(2, 4), 16) / 255;
  const b = parseInt(fullHex.substring(4, 6), 16) / 255;
  return { r, g, b };
}

export function colorToRgb(colorValue: number | string): {
  r: number;
  g: number;
  b: number;
} {
  if (typeof colorValue === 'string') {
    return hexToRgb(colorValue);
  }
  const r = ((colorValue >> 16) & 0xff) / 255;
  const g = ((colorValue >> 8) & 0xff) / 255;
  const b = (colorValue & 0xff) / 255;
  return { r, g, b };
}

export function darkenHexColor(color: string, factor = 0.75): string {
  const cleanHex = color.replace('#', '');
  const fullHex =
    cleanHex.length === 3
      ? cleanHex
          .split('')
          .map((char) => char + char)
          .join('')
      : cleanHex;
  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return color;
  }
  const clamp = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, '0');
  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

export function wrapWithShaders(
  component: React.ReactElement,
  shaders: ShaderConfig[] | undefined,
  resolution: Resolution,
  index?: number,
): React.ReactElement {
  if (!shaders || shaders.length === 0) {
    return component;
  }
  const currentIndex = index ?? shaders.length - 1;
  if (currentIndex < 0) {
    return component;
  }
  const shader = shaders[currentIndex];
  const shaderDef = shadersController.getShaderById(shader.shaderId);

  const shaderParams: ShaderParamStructField[] = [];

  if (shaderDef?.params && Array.isArray(shader.params)) {
    for (const paramDef of shaderDef.params) {
      const param = shader.params.find((p) => p.paramName === paramDef.name);
      if (!param) continue;

      if (paramDef.type === 'color') {
        const baseName = param.paramName;
        const colorValue = param.paramValue;
        const rgb = colorToRgb(colorValue);

        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_r`,
          value: rgb.r,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_g`,
          value: rgb.g,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_b`,
          value: rgb.b,
        } as ShaderParamStructField);
      } else {
        const numValue =
          typeof param.paramValue === 'string'
            ? Number(param.paramValue)
            : param.paramValue;
        shaderParams.push({
          type: 'f32',
          fieldName: param.paramName,
          value: numValue,
        } as ShaderParamStructField);
      }
    }
  }

  return (
    <Shader
      shaderId={shader.shaderId}
      resolution={resolution}
      shaderParam={
        shaderParams.length > 0
          ? {
              type: 'struct',
              value: shaderParams,
            }
          : undefined
      }>
      {wrapWithShaders(component, shaders, resolution, currentIndex - 1)}
    </Shader>
  );
}
