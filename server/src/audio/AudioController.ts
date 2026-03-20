import type { StoreApi } from 'zustand';
import { AudioManager } from './AudioManager';
import { createAudioStore, type AudioStoreState } from './audioStore';
import type { SmelterOutput } from '../smelter';

export class AudioController {
  private readonly audioManager: AudioManager;
  private readonly _audioStore: StoreApi<AudioStoreState>;
  private enabled = false;
  private readonly audioLevelListeners = new Set<
    (levels: number[]) => void
  >();

  constructor(
    roomId: string,
    output: SmelterOutput,
    externalStore?: StoreApi<AudioStoreState>,
  ) {
    this._audioStore = externalStore ?? createAudioStore();
    this.audioManager = new AudioManager(roomId, this._audioStore, output);
  }

  get audioStore(): StoreApi<AudioStoreState> {
    return this._audioStore;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async setAudioAnalysisEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    console.log(`[audio] setAudioAnalysisEnabled=${enabled}`);
    if (enabled) {
      await this.audioManager.start();
    } else {
      await this.audioManager.stop();
    }
  }

  async stopAll(): Promise<void> {
    await this.audioManager.stop();
    this.enabled = false;
  }

  addAudioLevelListener(
    listener: (levels: number[]) => void,
  ): () => void {
    this.audioLevelListeners.add(listener);
    return () => {
      this.audioLevelListeners.delete(listener);
    };
  }

  emitAudioLevels(): void {
    if (this.audioLevelListeners.size === 0) return;
    const bands = this._audioStore.getState().bands;
    for (const listener of this.audioLevelListeners) {
      listener(bands);
    }
  }
}
