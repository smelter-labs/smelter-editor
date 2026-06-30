import type {
  AIModelInfo,
  InputType,
  ModelParamSpec,
} from '@smelter-editor/types';

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
  /** Extra env vars passed to the spawned Python worker (e.g. backend selection). */
  extraEnv?: Record<string, string>;
  /** Whether this model emits bounding boxes (enables the drawBoxes toggle). */
  supportsBoxes?: boolean;
  /** Model-specific numeric tunables exposed in the UI and forwarded to the worker. */
  params?: ModelParamSpec[];
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
      ...(manifest.supportsBoxes ? { supportsBoxes: true } : {}),
      ...(manifest.params ? { params: manifest.params } : {}),
    };
  }
}
