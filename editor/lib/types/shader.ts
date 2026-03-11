export type ShaderParam = {
  name: string;
  type: string;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number | string;
};

export type AvailableShader = {
  id: string;
  name: string;
  description: string;
  shaderFile: string;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  params: ShaderParam[];
};

export type ShaderParamConfig = {
  paramName: string;
  paramValue: number | string;
};

export type ShaderConfig = {
  shaderName: string;
  shaderId: string;
  enabled: boolean;
  params: ShaderParamConfig[];
};

export type ShaderPreset = {
  name: string;
  shaders: ShaderConfig[];
};

/** @deprecated Use `SavedItemInfo` from `@/lib/storage-client` instead */
export type { SavedItemInfo as SavedShaderPresetInfo } from '../storage-client';
