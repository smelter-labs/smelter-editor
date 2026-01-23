type ShaderParam = {
    name: string;
    type: string;
    minValue?: number;
    maxValue?: number;
    defaultValue?: number | string;
};
type AvailableShader = {
    id: string;
    isActive: boolean;
    isVisible: boolean;
    name: string;
    description: string;
    shaderFile: string;
    params?: ShaderParam[];
};
export type PublicShader = AvailableShader & {
    iconSvg: string;
};
export type ShaderParamConfig = {
    paramName: string;
    paramValue: number;
};
export type ShaderConfig = {
    shaderName: string;
    shaderId: string;
    enabled: boolean;
    params: ShaderParamConfig[];
};
declare class ShadersController {
    get shaders(): PublicShader[];
    getShaderById(shaderId: string): AvailableShader | undefined;
}
declare const shadersController: ShadersController;
export default shadersController;
