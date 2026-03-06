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
