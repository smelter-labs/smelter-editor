import type { Input } from '@/lib/types';
import type { UpdateInputOptions } from '@smelter-editor/types';
import type { OutputJsxState } from '@/lib/generate-output-jsx';
import { createBlockSettingsFromInput } from '@/components/control-panel/hooks/use-timeline-state';
import { buildInputUpdateFromBlockSettings } from '@/lib/room-config';

export type RestoreOutputCodeSnapshotActions = {
  updateRoom: (
    roomId: string,
    opts: {
      layers: OutputJsxState['layers'];
      outputShaders?: OutputJsxState['outputShaders'];
      viewportTop?: number;
      viewportLeft?: number;
      viewportWidth?: number;
      viewportHeight?: number;
      viewportTransitionDurationMs?: number;
      viewportTransitionEasing?: string;
    },
  ) => Promise<unknown>;
  updateInput: (
    roomId: string,
    inputId: string,
    opts: Partial<UpdateInputOptions>,
  ) => Promise<unknown>;
  hideInput: (roomId: string, inputId: string) => Promise<unknown>;
  showInput: (roomId: string, inputId: string) => Promise<unknown>;
};

export function buildInputUpdateFromInput(
  input: Input,
): Partial<UpdateInputOptions> {
  return {
    ...buildInputUpdateFromBlockSettings(createBlockSettingsFromInput(input)),
    title: input.title,
    volume: input.volume,
    attachedInputIds: input.attachedInputIds,
  };
}

export async function restoreOutputCodeSnapshot(
  roomId: string,
  sceneState: OutputJsxState,
  currentInputIds: Set<string>,
  actions: RestoreOutputCodeSnapshotActions,
): Promise<void> {
  await actions.updateRoom(roomId, {
    layers: sceneState.layers,
    outputShaders: sceneState.outputShaders,
    viewportTop: sceneState.viewportTop,
    viewportLeft: sceneState.viewportLeft,
    viewportWidth: sceneState.viewportWidth,
    viewportHeight: sceneState.viewportHeight,
    viewportTransitionDurationMs: sceneState.viewportTransitionDurationMs,
    viewportTransitionEasing: sceneState.viewportTransitionEasing,
  });

  for (const snapshotInput of sceneState.inputs) {
    if (!currentInputIds.has(snapshotInput.inputId)) continue;

    await actions.updateInput(
      roomId,
      snapshotInput.inputId,
      buildInputUpdateFromInput(snapshotInput),
    );

    if (snapshotInput.hidden) {
      await actions.hideInput(roomId, snapshotInput.inputId);
    } else {
      await actions.showInput(roomId, snapshotInput.inputId);
    }
  }
}
