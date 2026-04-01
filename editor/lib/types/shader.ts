import type {
  ShaderParam,
  ShaderParamConfig,
  ShaderConfig,
  ShaderPreset,
} from '@smelter-editor/types';

export type { ShaderParam, ShaderParamConfig, ShaderConfig,  };

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

/** @deprecated Use `SavedItemInfo` from `@/lib/storage-client` instead */
;
