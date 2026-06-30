import type { AIModelInfo, InputType } from '@smelter-editor/types';

export interface ModelManifest {
  id: string;
  name: string;
  description: string;
  needsVideo: boolean;
  needsAudio: boolean;
  defaultDelayMs: number;
  maxDelayMs: number;
  supportedInputTypes: InputType[];
  pythonScript: string;
  requirementsFile: string;
  venvDir: string;
  envOverrideKey?: string;
  wsPort: number;
  /** Python import check for venv bootstrap. */
  depsCheck: string;
}

const manifests = new Map<string, ModelManifest>();

export class ModelRegistry {
  static register(manifest: ModelManifest): void {
    manifests.set(manifest.id, manifest);
  }

  static get(id: string): ModelManifest | undefined {
    return manifests.get(id);
  }

  static getAll(): ModelManifest[] {
    return [...manifests.values()];
  }

  static toInfo(manifest: ModelManifest): AIModelInfo {
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      defaultDelayMs: manifest.defaultDelayMs,
      maxDelayMs: manifest.maxDelayMs,
      needsVideo: manifest.needsVideo,
      needsAudio: manifest.needsAudio,
      supportedInputTypes: manifest.supportedInputTypes,
    };
  }
}
