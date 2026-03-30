import path from 'node:path';
import { pathExists } from 'fs-extra';
import { SmelterInstance } from '../smelter';
import type { ShaderConfig } from '../types';
import type { RoomInputState } from './types';
import { InputOrientation } from '@smelter-editor/types';

export const PLACEHOLDER_LOGO_FILE = 'logo_Smelter.png';

const DEFAULT_LOGO_SHADERS: ShaderConfig[] = [
  {
    shaderName: 'Remove Color',
    shaderId: 'remove-color',
    enabled: true,
    params: [
      { paramName: 'target_color', paramValue: '#1c1c35' },
      { paramName: 'tolerance', paramValue: 0.2 },
    ],
  },
];

export function cloneDefaultLogoShaders(): ShaderConfig[] {
  return DEFAULT_LOGO_SHADERS.map((shader) => ({
    ...shader,
    params: shader.params.map((param) => ({ ...param })),
  }));
}

export class PlaceholderManager {
  constructor(private readonly idPrefix: string) {}

  getPlaceholderId(): string {
    return `${this.idPrefix}::placeholder::smelter-logo`;
  }

  isPlaceholder(inputId: string): boolean {
    return inputId === this.getPlaceholderId();
  }

  /**
   * Adds a placeholder input if there are no non-placeholder inputs.
   * Mutates the `inputs` array in place. Returns `true` if a placeholder was added.
   */
  async ensurePlaceholder(inputs: RoomInputState[]): Promise<boolean> {
    const nonPlaceholder = inputs.filter(
      (inp) => !this.isPlaceholder(inp.inputId),
    );
    if (nonPlaceholder.length > 0) return false;
    if (inputs.find((inp) => this.isPlaceholder(inp.inputId))) return false;

    const inputId = this.getPlaceholderId();
    const imagePath = path.join(
      process.cwd(),
      'pictures',
      PLACEHOLDER_LOGO_FILE,
    );

    if (!(await pathExists(imagePath))) return false;

    const imageId = 'placeholder::smelter-logo';
    try {
      await SmelterInstance.registerImage(imageId, {
        serverPath: imagePath,
        assetType: 'png' as any,
      });
    } catch {
      // ignore if already registered
    }

    inputs.push({
      inputId,
      type: 'image',
      status: 'connected',
      showTitle: false,
      shaders: cloneDefaultLogoShaders(),
      orientation: 'horizontal' as InputOrientation,
      nativeWidth: 1920,
      nativeHeight: 1080,
      borderColor: '#ff0000',
      borderWidth: 0,
      hidden: false,
      motionEnabled: false,
      metadata: { title: 'Smelter', description: '' },
      volume: 0,
      imageId,
    });
    return true;
  }

  /**
   * Removes the placeholder from the array if present.
   * Mutates the `inputs` array in place. Returns `true` if removed.
   */
  removePlaceholder(inputs: RoomInputState[]): boolean {
    const idx = inputs.findIndex((inp) => this.isPlaceholder(inp.inputId));
    if (idx !== -1) {
      inputs.splice(idx, 1);
      return true;
    }
    return false;
  }
}
