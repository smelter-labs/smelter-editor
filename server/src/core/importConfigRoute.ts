import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { state } from './serverState';
import type {
  ImportConfigRequest,
  ImportConfigInput,
  ImportConfigProgressEvent,
  ImportConfigDoneEvent,
} from '@smelter-editor/types';
import type { RegisterInputOptions } from '../types';
import type { ServerResponse } from 'node:http';
import { rebuildLayers } from './importConfigLayers';

type RoomIdParams = { Params: { roomId: string } };

const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

const ImportConfigBodySchema = Type.Object({
  config: Type.Any(),
  oldInputIds: Type.Array(Type.String()),
  timelineAtZero: Type.Optional(
    Type.Object({
      hiddenInputIds: Type.Array(Type.Number()),
      blockSettingsEntries: Type.Array(Type.Tuple([Type.Number(), Type.Any()])),
    }),
  ),
});

function writeProgress(
  raw: ServerResponse,
  event: ImportConfigProgressEvent,
): void {
  raw.write(JSON.stringify(event) + '\n');
}

function writeDone(raw: ServerResponse, event: ImportConfigDoneEvent): void {
  raw.write(JSON.stringify(event) + '\n');
}

function toTitleKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function claimUniqueInputTitle(
  preferred: string,
  usedKeys: Set<string>,
): string {
  const trimmed = preferred.trim();
  if (trimmed && !usedKeys.has(toTitleKey(trimmed))) {
    usedKeys.add(toTitleKey(trimmed));
    return trimmed;
  }

  const base = trimmed || 'Input';
  let index = 1;
  let candidate = `${base} #${index}`;
  while (usedKeys.has(toTitleKey(candidate))) {
    index += 1;
    candidate = `${base} #${index}`;
  }
  usedKeys.add(toTitleKey(candidate));
  return candidate;
}

function normalizeImportedInputTitles(
  inputs: ImportConfigInput[],
): ImportConfigInput[] {
  const usedKeys = new Set<string>();
  return inputs.map((input) => ({
    ...input,
    title: claimUniqueInputTitle(input.title ?? '', usedKeys),
  }));
}

function collectInputIdsToRemoveFromRoomSnapshot(
  serverInputIds: string[],
): string[] {
  return [...new Set(serverInputIds)];
}

function collectReferencedInputIndices(
  config: ImportConfigRequest['config'],
): Set<number> {
  const referenced = new Set<number>();
  const queue: number[] = [];

  for (const track of config.timeline?.tracks ?? []) {
    for (const clip of track.clips) {
      if (clip.inputIndex >= 0 && !referenced.has(clip.inputIndex)) {
        referenced.add(clip.inputIndex);
        queue.push(clip.inputIndex);
      }
    }
  }

  for (const layer of config.layers ?? []) {
    for (const input of layer.inputs) {
      if (input.inputIndex >= 0 && !referenced.has(input.inputIndex)) {
        referenced.add(input.inputIndex);
        queue.push(input.inputIndex);
      }
    }
  }

  while (queue.length > 0) {
    const idx = queue.shift();
    if (idx === undefined) continue;
    const input = config.inputs[idx];
    if (!input?.attachedInputIndices) continue;
    for (const attachedIdx of input.attachedInputIndices) {
      if (attachedIdx >= 0 && !referenced.has(attachedIdx)) {
        referenced.add(attachedIdx);
        queue.push(attachedIdx);
      }
    }
  }

  return referenced;
}

function shouldImportInputFromConfig(
  config: ImportConfigRequest['config'],
  referencedIndices: Set<number>,
  index: number,
): boolean {
  const input = config.inputs[index];
  if (!input) return false;
  if (!config.timeline && (!config.layers || config.layers.length === 0)) {
    return true;
  }
  // Keep non-text inputs even if unreferenced, but drop unreferenced text inputs.
  if (input.type !== 'text-input') return true;
  return referencedIndices.has(index);
}

function buildRegisterOptions(
  input: ImportConfigInput,
): RegisterInputOptions | null {
  switch (input.type) {
    case 'twitch-channel':
      return input.channelId
        ? { type: 'twitch-channel', channelId: input.channelId }
        : null;
    case 'kick-channel':
      return input.channelId
        ? { type: 'kick-channel', channelId: input.channelId }
        : null;
    case 'hls':
      return input.url ? { type: 'hls', url: input.url } : null;
    case 'local-mp4':
      if (input.audioFileName) {
        return {
          type: 'local-mp4',
          source: { audioFileName: input.audioFileName },
        };
      }
      if (input.mp4FileName) {
        return {
          type: 'local-mp4',
          source: { fileName: input.mp4FileName },
        };
      }
      return null;
    case 'image':
      if (input.imageFileName) {
        return { type: 'image', fileName: input.imageFileName };
      }
      return input.imageId ? { type: 'image', imageId: input.imageId } : null;
    case 'text-input':
      return input.text
        ? {
            type: 'text-input',
            text: input.text,
            textAlign: input.textAlign,
            textColor: input.textColor,
            textMaxLines: input.textMaxLines,
            textScrollEnabled: input.textScrollEnabled,
            textScrollSpeed: input.textScrollSpeed,
            textScrollLoop: input.textScrollLoop,
            textFontSize: input.textFontSize,
          }
        : null;
    case 'game':
      return { type: 'game', title: input.title };
    case 'whip':
    case 'hands':
      return null;
    default:
      return null;
  }
}

export const __importConfigRouteTestUtils = {
  buildRegisterOptions,
  buildUpdateOptions,
  normalizeImportedInputTitles,
  collectInputIdsToRemoveFromRoomSnapshot,
  collectReferencedInputIndices,
  shouldImportInputFromConfig,
};

function buildUpdateOptions(
  input: ImportConfigInput,
  attachedInputIds?: string[],
): Record<string, unknown> {
  return {
    title: input.title,
    volume: input.volume,
    shaders: input.shaders,
    showTitle: input.showTitle,
    textColor: input.textColor,
    textMaxLines: input.textMaxLines,
    textScrollEnabled: input.textScrollEnabled,
    textScrollSpeed: input.textScrollSpeed,
    textScrollLoop: input.textScrollLoop,
    textFontSize: input.textFontSize,
    borderColor: input.borderColor,
    borderWidth: input.borderWidth,
    gameBackgroundColor: input.gameBackgroundColor,
    gameCellGap: input.gameCellGap,
    gameBoardBorderColor: input.gameBoardBorderColor,
    gameBoardBorderWidth: input.gameBoardBorderWidth,
    gameGridLineColor: input.gameGridLineColor,
    gameGridLineAlpha: input.gameGridLineAlpha,
    snakeEventShaders: input.snakeEventShaders,
    snake1Shaders: input.snake1Shaders,
    snake2Shaders: input.snake2Shaders,
    absolutePosition: input.absolutePosition,
    absoluteTop: input.absoluteTop,
    absoluteLeft: input.absoluteLeft,
    absoluteWidth: input.absoluteWidth,
    absoluteHeight: input.absoluteHeight,
    absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input.absoluteTransitionEasing,
    cropTop: input.cropTop,
    cropLeft: input.cropLeft,
    cropRight: input.cropRight,
    cropBottom: input.cropBottom,
    attachedInputIds:
      attachedInputIds && attachedInputIds.length > 0
        ? attachedInputIds
        : undefined,
  };
}

export function registerImportConfigRoute(routes: FastifyInstance): void {
  routes.post<RoomIdParams & { Body: ImportConfigRequest }>(
    '/room/:roomId/import-config',
    { schema: { params: RoomIdParamsSchema, body: ImportConfigBodySchema } },
    async (req, res) => {
      const { roomId } = req.params;
      const room = state.getRoom(roomId);
      const { config, timelineAtZero } = req.body as ImportConfigRequest;
      const importedInputs = normalizeImportedInputTitles(config.inputs);
      const normalizedConfig: ImportConfigRequest['config'] = {
        ...config,
        inputs: importedInputs,
      };
      const inputIdsToRemove = collectInputIdsToRemoveFromRoomSnapshot(
        room.getInputs().map((input) => input.inputId),
      );
      const referencedIndices = collectReferencedInputIndices(normalizedConfig);

      const raw = res.raw;
      raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const errors: string[] = [];

      const nonWhipInputs = importedInputs
        .map((input, index) => ({ input, index }))
        .filter(
          ({ input, index }) =>
            input.type !== 'whip' &&
            shouldImportInputFromConfig(
              normalizedConfig,
              referencedIndices,
              index,
            ),
        );
      const whipInputs = importedInputs
        .map((input, index) => ({ input, index }))
        .filter(({ input }) => input.type === 'whip');

      const timelineSteps =
        (timelineAtZero?.hiddenInputIds.length ?? 0) +
        (timelineAtZero?.blockSettingsEntries.length ?? 0);
      const totalSteps =
        nonWhipInputs.length +
        nonWhipInputs.length +
        inputIdsToRemove.length +
        timelineSteps +
        3; // pending whip + room update + finalize
      let currentStep = 0;

      const advance = (phase: string) => {
        currentStep++;
        writeProgress(raw, { phase, current: currentStep, total: totalSteps });
      };

      // Phase 1: Add inputs
      const createdInputs: { inputId: string; index: number }[] = [];
      const configInputIndexMap = new Map<ImportConfigInput, number>();
      importedInputs.forEach((input, idx) =>
        configInputIndexMap.set(input, idx),
      );

      for (const { input, index } of nonWhipInputs) {
        const originalIndex = index ?? configInputIndexMap.get(input)!;
        try {
          const opts = buildRegisterOptions(input);
          if (opts) {
            const inputId = await room.addNewInput(opts);
            if (inputId) {
              await room.connectInput(inputId);
              createdInputs.push({ inputId, index: originalIndex });
            }
          }
        } catch (e) {
          const msg = `Failed to add input "${input.title}": ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`[import-config] ${msg}`);
          errors.push(msg);
        }
        advance('Adding inputs');
      }

      // Build position -> inputId mapping
      const indexToInputId: Record<number, string> = {};
      for (const { inputId, index } of createdInputs) {
        indexToInputId[index] = inputId;
      }

      // Phase 2: Update inputs with full settings
      for (const { inputId, index } of createdInputs) {
        const inputConfig = importedInputs[index];
        const attachedIds = inputConfig.attachedInputIndices
          ?.map((idx) => indexToInputId[idx])
          .filter((id): id is string => !!id);
        try {
          await room.updateInput(
            inputId,
            buildUpdateOptions(inputConfig, attachedIds),
          );
        } catch (e) {
          const msg = `Failed to update input "${inputConfig.title}": ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`[import-config] ${msg}`);
          errors.push(msg);
        }
        advance('Configuring inputs');
      }

      // Phase 3: Remove old inputs
      for (const oldInputId of inputIdsToRemove) {
        try {
          await room.removeInput(oldInputId);
        } catch (e) {
          const msg = `Failed to remove input ${oldInputId}: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`[import-config] ${msg}`);
          errors.push(msg);
        }
        advance('Removing old inputs');
      }

      // Phase 4: Set pending WHIP inputs
      const pendingWhipData = whipInputs.map(({ input, index }) => ({
        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: input.title,
        position: index,
        volume: input.volume,
        showTitle: input.showTitle !== false,
        shaders: input.shaders || [],
      }));
      room.pendingWhipInputs = pendingWhipData.map((pw) => ({
        id: pw.id,
        title: pw.title,
        volume: pw.volume,
        showTitle: pw.showTitle,
        shaders: pw.shaders,
        position: pw.position,
      }));
      const pendingWhipPlaceholderByIndex: Record<number, string> = {};
      for (const pending of pendingWhipData) {
        pendingWhipPlaceholderByIndex[pending.position] =
          `__pending-whip-${pending.position}__`;
      }
      advance('Syncing pending WHIP inputs');

      // Phase 5: Apply timeline state at t=0 (if provided)
      if (timelineAtZero) {
        for (const inputIndex of timelineAtZero.hiddenInputIds) {
          const inputId = indexToInputId[inputIndex];
          if (inputId) {
            try {
              await room.hideInput(inputId);
            } catch (e) {
              const msg = `Failed to hide input ${inputId}: ${e instanceof Error ? e.message : String(e)}`;
              console.warn(`[import-config] ${msg}`);
              errors.push(msg);
            }
          }
          advance('Applying timeline state');
        }

        for (const [
          inputIndex,
          blockSettings,
        ] of timelineAtZero.blockSettingsEntries) {
          const inputId = indexToInputId[inputIndex];
          if (inputId) {
            try {
              await room.updateInput(inputId, blockSettings);
            } catch (e) {
              const msg = `Failed to apply block settings for ${inputId}: ${e instanceof Error ? e.message : String(e)}`;
              console.warn(`[import-config] ${msg}`);
              errors.push(msg);
            }
          }
          advance('Applying timeline state');
        }
      }

      // Phase 6: Restore layers from config (if available)
      if (config.layers && config.layers.length > 0) {
        try {
          const restoredLayers = rebuildLayers(
            config.layers,
            indexToInputId,
            pendingWhipPlaceholderByIndex,
          );
          await room.updateLayers(restoredLayers);
        } catch (e) {
          const msg = `Failed to restore layers: ${e instanceof Error ? e.message : String(e)}`;
          console.warn(`[import-config] ${msg}`);
          errors.push(msg);
        }
      }

      // Phase 7: Update room settings (input order, transitions, viewport, output shaders)
      const orderedInputIds = createdInputs
        .slice()
        .sort((a, b) => a.index - b.index)
        .map(({ inputId }) => inputId);

      try {
        if (orderedInputIds.length > 0) {
          await room.reorderInputs(orderedInputIds);
        }
        if (config.transitionSettings) {
          const ts = config.transitionSettings;
          if (ts.swapDurationMs !== undefined)
            room.setSwapDurationMs(ts.swapDurationMs);
          if (ts.swapOutgoingEnabled !== undefined)
            room.setSwapOutgoingEnabled(ts.swapOutgoingEnabled);
          if (ts.swapFadeInDurationMs !== undefined)
            room.setSwapFadeInDurationMs(ts.swapFadeInDurationMs);
          if (ts.swapFadeOutDurationMs !== undefined)
            room.setSwapFadeOutDurationMs(ts.swapFadeOutDurationMs);
        }

        if (config.viewport) {
          room.setViewport(config.viewport as any);
        }

        if (config.outputShaders) {
          room.setOutputShaders(config.outputShaders);
        }
      } catch (e) {
        const msg = `Failed to update room settings: ${e instanceof Error ? e.message : String(e)}`;
        console.warn(`[import-config] ${msg}`);
        errors.push(msg);
      }
      advance('Finalizing');

      // Phase 7: Done
      advance('Done');
      writeDone(raw, {
        done: true,
        indexToInputId,
        pendingWhipData,
        errors,
      });
      raw.end();
    },
  );
}
