/** Static shader parameter definition (min/max/default) for UI and `AvailableShader`. */
export type ShaderParam = {
  name: string;
  type: string;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number | string;
  /** Slider granularity; if omitted, defaults to (max - min) / 100 */
  step?: number;
};

export type ShaderParamConfig = {
  paramName: string;
  /** number for numeric params, string (e.g. hex) for color params */
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
