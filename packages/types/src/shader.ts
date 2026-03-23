export type ShaderParamConfig = {
  paramName: string;
  /** number for numeric params, string (e.g. hex) for color params */
  paramValue: number | string;
};

/** @deprecated Use {@link ShaderParamConfig} */
export type ShaderParam = ShaderParamConfig;

/** Describes a configurable parameter that a shader accepts (its schema/definition). */
export type ShaderParamDefinition =
  | {
      name: string;
      type: 'number';
      minValue?: number;
      maxValue?: number;
      defaultValue: number;
    }
  | {
      name: string;
      type: 'color';
      defaultValue: string;
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
