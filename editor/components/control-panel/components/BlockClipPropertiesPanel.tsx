'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Input,
  AvailableShader,
  ShaderConfig,
  TransitionType,
} from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import ShaderPanel, { InlineShaderParams } from '../input-entry/shader-panel';
import { AddShaderModal } from '../input-entry/add-shader-modal';
import SnakeEventShaderPanel from '../input-entry/snake-event-shader-panel';
import type { BlockSettings, Keyframe } from '../hooks/use-timeline-state';
import { PendingWhipInputs } from './PendingWhipInputs';
import type { PendingWhipInput } from './ConfigurationSection';
import { Link, Video, Monitor, Dices } from 'lucide-react';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { updateTimelineInputId } from '@/lib/room-config';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'react-toastify';
import { getRandomSnakeShaderPreset } from '@/lib/snake-shader-presets';
import { getMp4Duration } from '@/app/actions/actions';
import { AbsolutePositionController } from './AbsolutePositionController';

const SHADER_SETTINGS_DEBOUNCE_MS = 200;

function extractMp4FileName(title: string): string | null {
  const match = title.match(/^\[MP4\]\s+(.+)$/);
  if (!match) return null;
  return match[1].split(/\s+/).join('_') + '.mp4';
}

function SnakeShaderSection({
  label,
  shaders,
  playerColor,
  availableShaders,
  onPatch,
  onOpenShaderInline,
}: {
  label: string;
  shaders: ShaderConfig[];
  playerColor?: string;
  availableShaders: AvailableShader[];
  onPatch: (shaders: ShaderConfig[], options?: { refresh?: boolean }) => void;
  onOpenShaderInline?: (shaderId: string) => void;
}) {
  const handleRandomPreset = useCallback(() => {
    const preset = getRandomSnakeShaderPreset(playerColor);
    onPatch(preset.shaders);
    toast.info(`🎲 ${preset.name}`, { autoClose: 1500 });
  }, [onPatch, playerColor]);
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const sliderTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});

  useEffect(() => {
    return () => {
      Object.values(sliderTimersRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    };
  }, []);

  const handleToggle = useCallback(
    (shaderId: string) => {
      const current = shaders;
      const existing = current.find((s) => s.shaderId === shaderId);
      if (!existing) {
        const shaderDef = availableShaders.find((s) => s.id === shaderId);
        if (!shaderDef) return;
        onPatch([
          ...current,
          {
            shaderName: shaderDef.name,
            shaderId: shaderDef.id,
            enabled: true,
            params:
              shaderDef.params?.map((param) => ({
                paramName: param.name,
                paramValue:
                  typeof param.defaultValue === 'number'
                    ? param.defaultValue
                    : 0,
              })) || [],
          },
        ]);
        return;
      }
      onPatch(
        current.map((shader) =>
          shader.shaderId === shaderId
            ? { ...shader, enabled: !shader.enabled }
            : shader,
        ),
      );
    },
    [shaders, availableShaders, onPatch],
  );

  const handleRemove = useCallback(
    (shaderId: string) => {
      onPatch(shaders.filter((shader) => shader.shaderId !== shaderId));
    },
    [shaders, onPatch],
  );

  const handleSlider = useCallback(
    (shaderId: string, paramName: string, newValue: number) => {
      const key = `${shaderId}:${paramName}`;
      setSliderValues((prev) => ({
        ...prev,
        [key]: newValue,
      }));
      setParamLoading((prev) => ({ ...prev, [shaderId]: paramName }));
      const timer = sliderTimersRef.current[key];
      if (timer) {
        clearTimeout(timer);
      }
      sliderTimersRef.current[key] = setTimeout(() => {
        const updated = shaders.map((shader) => {
          if (shader.shaderId !== shaderId) return shader;
          return {
            ...shader,
            params: shader.params.map((param) =>
              param.paramName === paramName
                ? { ...param, paramValue: newValue }
                : param,
            ),
          };
        });
        onPatch(updated, { refresh: false });
        setParamLoading((prev) => ({ ...prev, [shaderId]: null }));
        setSliderValues((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        sliderTimersRef.current[key] = null;
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    },
    [shaders, onPatch],
  );

  const getParamConfig = useCallback(
    (shaderId: string, paramName: string) =>
      shaders
        ?.find((shader) => shader.shaderId === shaderId)
        ?.params.find((param) => param.paramName === paramName),
    [shaders],
  );

  const fakeInput: Input = {
    id: -1,
    inputId: '',
    title: '',
    description: '',
    volume: 0,
    type: 'local-mp4',
    sourceState: 'unknown',
    status: 'connected',
    shaders,
    orientation: 'horizontal',
  };

  return (
    <div className='mt-2 border-t border-neutral-800 pt-2'>
      <div className='flex items-center justify-between mb-1'>
        <span className='text-xs text-neutral-400'>{label}</span>
        <button
          type='button'
          title='Random shader preset'
          onClick={handleRandomPreset}
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'>
          <Dices className='size-3.5' />
        </button>
      </div>
      <ShaderPanel
        input={fakeInput}
        availableShaders={availableShaders}
        sliderValues={sliderValues}
        paramLoading={paramLoading}
        shaderLoading={null}
        onShaderToggle={handleToggle}
        onShaderRemove={handleRemove}
        onSliderChange={handleSlider}
        getShaderParamConfig={getParamConfig}
        onOpenAddShader={() => setIsAddModalOpen(true)}
        onOpenShaderInline={onOpenShaderInline}
      />
      <AddShaderModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        availableShaders={availableShaders}
        addedShaderIds={new Set(shaders.map((s) => s.shaderId))}
        onAddShader={handleToggle}
      />
    </div>
  );
}

const TRANSITION_TYPES: { value: TransitionType | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-left', label: 'Slide Left' },
  { value: 'slide-right', label: 'Slide Right' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
  { value: 'wipe-left', label: 'Wipe Left' },
  { value: 'wipe-right', label: 'Wipe Right' },
  { value: 'dissolve', label: 'Dissolve' },
];

function TransitionRow({
  label,
  transition,
  maxDurationMs,
  onChange,
}: {
  label: string;
  transition?: import('@/lib/types').TransitionConfig;
  maxDurationMs: number;
  onChange: (t: import('@/lib/types').TransitionConfig | undefined) => void;
}) {
  const type = transition?.type ?? 'none';
  const durationMs = transition?.durationMs ?? 500;
  const clampedMax = Math.max(100, maxDurationMs);

  return (
    <div className='mb-2'>
      <span className='text-[11px] text-neutral-500 block mb-1'>{label}</span>
      <div className='flex items-center gap-2'>
        <select
          className='flex-1 bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1 rounded'
          value={type}
          onChange={(e) => {
            const val = e.target.value as TransitionType | 'none';
            if (val === 'none') {
              onChange(undefined);
            } else {
              onChange({ type: val, durationMs });
            }
          }}>
          {TRANSITION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {type !== 'none' && (
          <div className='flex items-center gap-1.5'>
            <input
              type='range'
              min={100}
              max={Math.min(2000, clampedMax)}
              step={50}
              className='w-20'
              value={Math.min(durationMs, clampedMax)}
              onChange={(e) => {
                const ms = Number(e.target.value);
                onChange({ type: type as TransitionType, durationMs: ms });
              }}
            />
            <span className='text-[10px] text-neutral-500 w-10 text-right tabular-nums'>
              {durationMs}ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export type SelectedTimelineClip = {
  trackId: string;
  clipId: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
  keyframes: Keyframe[];
  selectedKeyframeId?: string | null;
};

function computeCommonBlockSettings(
  clips: SelectedTimelineClip[],
): BlockSettings {
  if (clips.length === 0) {
    return {
      volume: 1,
      showTitle: true,
      shaders: [],
      orientation: 'horizontal',
    };
  }
  if (clips.length === 1) return clips[0].blockSettings;

  const first = clips[0].blockSettings;
  const result: BlockSettings = { ...first };

  for (let i = 1; i < clips.length; i++) {
    const bs = clips[i].blockSettings;
    if (bs.volume !== result.volume) result.volume = -1;
    if (bs.showTitle !== result.showTitle) result.showTitle = first.showTitle;
    if (bs.orientation !== result.orientation)
      result.orientation = first.orientation;
    if (bs.borderColor !== result.borderColor) result.borderColor = undefined;
    if (bs.borderWidth !== result.borderWidth) result.borderWidth = undefined;
    if (bs.absolutePosition !== result.absolutePosition)
      result.absolutePosition = undefined;
  }
  return result;
}

function clampKeyframeToClipRange(
  valueMs: number,
  clipDurationMs: number,
): number {
  return Math.max(0, Math.min(Math.round(valueMs), clipDurationMs));
}

function resolveNewKeyframeTimeMs(
  clip: Pick<SelectedTimelineClip, 'startMs' | 'endMs' | 'keyframes'>,
  desiredTimeMs: number,
): number {
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  const clampedTimeMs = clampKeyframeToClipRange(desiredTimeMs, clipDurationMs);
  const occupiedTimes = new Set(
    clip.keyframes.map((keyframe) => Math.round(keyframe.timeMs)),
  );

  if (!occupiedTimes.has(clampedTimeMs)) {
    return clampedTimeMs;
  }

  const preferredStep = clampedTimeMs >= clipDurationMs ? -100 : 100;
  for (const step of [preferredStep, -preferredStep]) {
    let candidateTimeMs = clampedTimeMs;
    while (true) {
      candidateTimeMs += step;
      if (candidateTimeMs < 0 || candidateTimeMs > clipDurationMs) {
        break;
      }
      if (!occupiedTimes.has(candidateTimeMs)) {
        return candidateTimeMs;
      }
    }
  }

  return clampedTimeMs;
}

export function BlockClipPropertiesPanel({
  roomId,
  selectedTimelineClips,
  onSelectedTimelineClipsChange,
  playheadMs,
  inputs,
  availableShaders,
  handleRefreshState,
  resolution,
  pendingWhipInputs,
  setPendingWhipInputs,
}: {
  roomId: string;
  selectedTimelineClips: SelectedTimelineClip[];
  onSelectedTimelineClipsChange: (clips: SelectedTimelineClip[]) => void;
  playheadMs?: number;
  inputs: Input[];
  availableShaders: AvailableShader[];
  handleRefreshState: () => Promise<void>;
  resolution?: { width: number; height: number };
  pendingWhipInputs?: PendingWhipInput[];
  setPendingWhipInputs?: (inputs: PendingWhipInput[]) => void | Promise<void>;
}) {
  const selectedTimelineClip =
    selectedTimelineClips.length === 1 ? selectedTimelineClips[0] : null;
  const isMultiSelect = selectedTimelineClips.length > 1;
  const commonSettings = useMemo(
    () => computeCommonBlockSettings(selectedTimelineClips),
    [selectedTimelineClips],
  );
  const onSelectedTimelineClipChange = useCallback(
    (clip: SelectedTimelineClip | null) => {
      onSelectedTimelineClipsChange(clip ? [clip] : []);
    },
    [onSelectedTimelineClipsChange],
  );
  const { updateInput: updateInputAction, addCameraInput } = useActions();
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const shaderSliderTimersRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const [isAddShaderModalOpen, setIsAddShaderModalOpen] = useState(false);
  const [inlineShaderView, setInlineShaderView] = useState<{
    shaderId: string;
    source: 'block' | 'snake1' | 'snake2';
  } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [gameBgColor, setGameBgColor] = useState<string | null>(null);
  const gameBgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameGridColor, setGameGridColor] = useState<string | null>(null);
  const gameGridDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [textScrollSpeedDraft, setTextScrollSpeedDraft] = useState<
    number | null
  >(null);
  const textScrollSpeedDebounceRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [mp4DurationLoading, setMp4DurationLoading] = useState(false);
  const mp4DurationFetchedRef = useRef<string | null>(null);
  const applyClipPatchRef = useRef<
    | ((
        patch: Partial<BlockSettings>,
        options?: { refresh?: boolean },
      ) => Promise<void>)
    | null
  >(null);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      Object.values(shaderSliderTimersRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      if (textScrollSpeedDebounceRef.current) {
        clearTimeout(textScrollSpeedDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setTextScrollSpeedDraft(null);
    if (textScrollSpeedDebounceRef.current) {
      clearTimeout(textScrollSpeedDebounceRef.current);
      textScrollSpeedDebounceRef.current = null;
    }
  }, [selectedTimelineClips]);

  const {
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();
  const { refreshState: ctxRefreshState } = useControlPanelContext();

  const primaryClip =
    selectedTimelineClips.length > 0 ? selectedTimelineClips[0] : null;
  const selectedTimelineKeyframe =
    primaryClip?.selectedKeyframeId != null
      ? (primaryClip.keyframes.find(
          (keyframe) => keyframe.id === primaryClip.selectedKeyframeId,
        ) ?? null)
      : null;
  const selectedInput = primaryClip
    ? inputs.find((i) => i.inputId === primaryClip.inputId)
    : null;
  const allSameInput = selectedTimelineClips.every(
    (c) => c.inputId === primaryClip?.inputId,
  );
  const isDisconnected =
    !!primaryClip &&
    !isMultiSelect &&
    !selectedInput &&
    !primaryClip.inputId.startsWith('__pending-whip-');

  useEffect(() => {
    if (!selectedTimelineClip || !selectedInput) return;
    if (selectedInput.type !== 'local-mp4') return;
    if (effectiveClip.blockSettings.mp4DurationMs) return;

    const mp4FileName = extractMp4FileName(selectedInput.title);
    if (!mp4FileName) return;
    const fetchKey = `${selectedTimelineClip.clipId}::${mp4FileName}`;
    if (mp4DurationFetchedRef.current === fetchKey) return;
    mp4DurationFetchedRef.current = fetchKey;

    setMp4DurationLoading(true);
    getMp4Duration(mp4FileName)
      .then((durationMs) => {
        void applyClipPatchRef.current?.({ mp4DurationMs: durationMs });
      })
      .catch(() => {})
      .finally(() => setMp4DurationLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTimelineClip?.clipId, selectedInput?.type, selectedInput?.title]);

  const [connectingType, setConnectingType] = useState<
    'camera' | 'screenshare' | null
  >(null);

  const handleConnectWhip = useCallback(
    async (type: 'camera' | 'screenshare') => {
      if (!selectedTimelineClip) return;
      setConnectingType(type);

      const pcRef = type === 'camera' ? cameraPcRef : screensharePcRef;
      const streamRef =
        type === 'camera' ? cameraStreamRef : screenshareStreamRef;
      const setActiveInputId =
        type === 'camera'
          ? setActiveCameraInputId
          : setActiveScreenshareInputId;
      const setIsActive =
        type === 'camera' ? setIsCameraActive : setIsScreenshareActive;
      const publishFn =
        type === 'camera' ? startPublish : startScreensharePublish;
      const oldInputId = selectedTimelineClip.inputId;

      try {
        const title =
          type === 'camera' ? `Camera-${Date.now()}` : `Screen-${Date.now()}`;
        const response = await addCameraInput(roomId, title);
        setActiveInputId(response.inputId);
        setIsActive(false);

        const onDisconnected = () => {
          stopCameraAndConnection(pcRef, streamRef);
          setIsActive(false);
        };

        const { location } = await publishFn(
          response.inputId,
          response.bearerToken,
          response.whipUrl,
          pcRef,
          streamRef,
          onDisconnected,
        );

        setIsActive(true);

        saveWhipSession({
          roomId,
          inputId: response.inputId,
          bearerToken: response.bearerToken,
          location,
          ts: Date.now(),
        });
        saveLastWhipInputId(roomId, response.inputId);

        const timelineUpdated = updateTimelineInputId(
          roomId,
          oldInputId,
          response.inputId,
        );
        if (timelineUpdated) {
          window.dispatchEvent(
            new CustomEvent('smelter:timeline-input-replaced', {
              detail: {
                oldInputId,
                newInputId: response.inputId,
              },
            }),
          );
        }

        onSelectedTimelineClipChange({
          ...selectedTimelineClip,
          inputId: response.inputId,
        });

        await handleRefreshState();
        toast.success(
          `Connected ${type === 'camera' ? 'camera' : 'screenshare'}`,
        );
      } catch (e: any) {
        console.error(`Failed to connect ${type}:`, e);
        toast.error(`Failed to connect: ${e?.message || e}`);
        stopCameraAndConnection(pcRef, streamRef);
        setActiveInputId(null);
        setIsActive(false);
      } finally {
        setConnectingType(null);
      }
    },
    [
      selectedTimelineClip,
      roomId,
      cameraPcRef,
      cameraStreamRef,
      screensharePcRef,
      screenshareStreamRef,
      setActiveCameraInputId,
      setIsCameraActive,
      setActiveScreenshareInputId,
      setIsScreenshareActive,
      handleRefreshState,
      onSelectedTimelineClipChange,
    ],
  );

  const applyClipPatch = useCallback(
    async (patch: Partial<BlockSettings>, options?: { refresh?: boolean }) => {
      if (selectedTimelineClips.length === 0) return;
      const shouldRefresh = options?.refresh ?? true;
      const singleSelectedClip =
        selectedTimelineClips.length === 1 ? selectedTimelineClips[0] : null;
      const targetKeyframeId = singleSelectedClip?.selectedKeyframeId ?? null;

      // Update local state for all clips
      const nextClips = selectedTimelineClips.map((clip) => ({
        ...clip,
        blockSettings: { ...clip.blockSettings, ...patch },
        keyframes:
          targetKeyframeId && clip.clipId === singleSelectedClip?.clipId
            ? clip.keyframes.map((keyframe) =>
                keyframe.id === targetKeyframeId
                  ? {
                      ...keyframe,
                      blockSettings: { ...keyframe.blockSettings, ...patch },
                    }
                  : keyframe,
              )
            : clip.keyframes.map((keyframe) =>
                keyframe.timeMs === 0
                  ? {
                      ...keyframe,
                      blockSettings: { ...keyframe.blockSettings, ...patch },
                    }
                  : keyframe,
              ),
      }));
      onSelectedTimelineClipsChange(nextClips);

      // Dispatch timeline update for each clip or selected keyframe.
      if (targetKeyframeId && singleSelectedClip) {
        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-keyframe', {
            detail: {
              trackId: singleSelectedClip.trackId,
              clipId: singleSelectedClip.clipId,
              keyframeId: targetKeyframeId,
              patch,
            },
          }),
        );
      } else {
        for (const clip of selectedTimelineClips) {
          window.dispatchEvent(
            new CustomEvent('smelter:timeline:update-clip-settings', {
              detail: { trackId: clip.trackId, clipId: clip.clipId, patch },
            }),
          );
        }
      }

      // Send server update for each unique inputId
      const seenInputIds = new Set<string>();
      try {
        for (const clip of nextClips) {
          if (seenInputIds.has(clip.inputId)) continue;
          seenInputIds.add(clip.inputId);
          await updateInputAction(roomId, clip.inputId, {
            volume: patch.volume ?? clip.blockSettings.volume,
            shaders: patch.shaders ?? clip.blockSettings.shaders,
            showTitle: patch.showTitle ?? clip.blockSettings.showTitle,
            orientation: patch.orientation ?? clip.blockSettings.orientation,
            text: patch.text,
            textAlign: patch.textAlign,
            textColor: patch.textColor,
            textMaxLines: patch.textMaxLines,
            textScrollSpeed: patch.textScrollSpeed,
            textScrollLoop: patch.textScrollLoop,
            textFontSize: patch.textFontSize,
            borderColor: patch.borderColor,
            borderWidth: patch.borderWidth,
            attachedInputIds: patch.attachedInputIds,
            gameBackgroundColor: patch.gameBackgroundColor,
            gameCellGap: patch.gameCellGap,
            gameBoardBorderColor: patch.gameBoardBorderColor,
            gameBoardBorderWidth: patch.gameBoardBorderWidth,
            gameGridLineColor: patch.gameGridLineColor,
            gameGridLineAlpha: patch.gameGridLineAlpha,
            snakeEventShaders: patch.snakeEventShaders,
            snake1Shaders:
              patch.snake1Shaders ?? clip.blockSettings.snake1Shaders,
            snake2Shaders:
              patch.snake2Shaders ?? clip.blockSettings.snake2Shaders,
            absolutePosition: patch.absolutePosition,
            absoluteTop: patch.absoluteTop,
            absoluteLeft: patch.absoluteLeft,
            absoluteWidth: patch.absoluteWidth,
            absoluteHeight: patch.absoluteHeight,
            absoluteTransitionDurationMs: patch.absoluteTransitionDurationMs,
            absoluteTransitionEasing: patch.absoluteTransitionEasing,
          });
        }
        if (shouldRefresh) {
          await handleRefreshState();
        }
      } catch (err) {
        console.warn('Failed to apply clip settings', err);
      }
    },
    [
      selectedTimelineClips,
      onSelectedTimelineClipsChange,
      roomId,
      handleRefreshState,
    ],
  );

  useEffect(() => {
    applyClipPatchRef.current = applyClipPatch;
  }, [applyClipPatch]);

  const handleSelectKeyframe = useCallback(
    (keyframeId: string | null) => {
      if (!selectedTimelineClip) return;
      window.dispatchEvent(
        new CustomEvent('smelter:timeline:select-keyframe', {
          detail: {
            trackId: selectedTimelineClip.trackId,
            clipId: selectedTimelineClip.clipId,
            keyframeId,
          },
        }),
      );
    },
    [selectedTimelineClip],
  );

  const handleAddKeyframe = useCallback(() => {
    if (!selectedTimelineClip) return;
    const clipDurationMs =
      selectedTimelineClip.endMs - selectedTimelineClip.startMs;
    const desiredTimeMs =
      playheadMs == null
        ? (selectedTimelineKeyframe?.timeMs ?? Math.round(clipDurationMs / 2))
        : playheadMs - selectedTimelineClip.startMs;
    const nextTimeMs = resolveNewKeyframeTimeMs(
      selectedTimelineClip,
      desiredTimeMs,
    );
    window.dispatchEvent(
      new CustomEvent('smelter:timeline:add-keyframe', {
        detail: {
          trackId: selectedTimelineClip.trackId,
          clipId: selectedTimelineClip.clipId,
          timeMs: nextTimeMs,
        },
      }),
    );
  }, [playheadMs, selectedTimelineClip, selectedTimelineKeyframe]);

  const handleMoveSelectedKeyframe = useCallback(
    (timeMs: number) => {
      if (!selectedTimelineClip || !selectedTimelineKeyframe) return;
      window.dispatchEvent(
        new CustomEvent('smelter:timeline:move-keyframe', {
          detail: {
            trackId: selectedTimelineClip.trackId,
            clipId: selectedTimelineClip.clipId,
            keyframeId: selectedTimelineKeyframe.id,
            timeMs,
          },
        }),
      );
    },
    [selectedTimelineClip, selectedTimelineKeyframe],
  );

  const handleDeleteSelectedKeyframe = useCallback(() => {
    if (!selectedTimelineClip || !selectedTimelineKeyframe) return;
    window.dispatchEvent(
      new CustomEvent('smelter:timeline:delete-keyframe', {
        detail: {
          trackId: selectedTimelineClip.trackId,
          clipId: selectedTimelineClip.clipId,
          keyframeId: selectedTimelineKeyframe.id,
        },
      }),
    );
    handleSelectKeyframe(null);
  }, [handleSelectKeyframe, selectedTimelineClip, selectedTimelineKeyframe]);

  const handleShaderToggle = useCallback(
    (shaderId: string) => {
      if (selectedTimelineClips.length === 0) return;
      const clip = selectedTimelineClips[0];
      const current = clip.blockSettings.shaders || [];
      const existing = current.find((s) => s.shaderId === shaderId);
      if (!existing) {
        const shaderDef = availableShaders.find((s) => s.id === shaderId);
        if (!shaderDef) return;
        void applyClipPatch({
          shaders: [
            ...current,
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params:
                shaderDef.params?.map((param) => ({
                  paramName: param.name,
                  paramValue:
                    typeof param.defaultValue === 'number'
                      ? param.defaultValue
                      : 0,
                })) || [],
            },
          ],
        });
        return;
      }
      void applyClipPatch({
        shaders: current.map((shader) =>
          shader.shaderId === shaderId
            ? { ...shader, enabled: !shader.enabled }
            : shader,
        ),
      });
    },
    [selectedTimelineClips, availableShaders, applyClipPatch],
  );

  const handleShaderRemove = useCallback(
    (shaderId: string) => {
      if (selectedTimelineClips.length === 0) return;
      const clip = selectedTimelineClips[0];
      void applyClipPatch({
        shaders: (clip.blockSettings.shaders || []).filter(
          (shader) => shader.shaderId !== shaderId,
        ),
      });
    },
    [selectedTimelineClips, applyClipPatch],
  );

  const handleApplyPreset = useCallback(
    (shaders: ShaderConfig[], mode: 'replace' | 'append') => {
      const current = selectedTimelineClips[0]?.blockSettings.shaders || [];
      const newShaders =
        mode === 'replace' ? shaders : [...current, ...shaders];
      void applyClipPatch({ shaders: newShaders });
    },
    [selectedTimelineClips, applyClipPatch],
  );

  const handleSliderChange = useCallback(
    (shaderId: string, paramName: string, newValue: number) => {
      if (selectedTimelineClips.length === 0) return;
      const key = `${shaderId}:${paramName}`;
      setSliderValues((prev) => ({
        ...prev,
        [key]: newValue,
      }));
      setParamLoading((prev) => ({ ...prev, [shaderId]: paramName }));
      const timer = shaderSliderTimersRef.current[key];
      if (timer) {
        clearTimeout(timer);
      }
      shaderSliderTimersRef.current[key] = setTimeout(() => {
        const current = selectedTimelineClips[0].blockSettings.shaders || [];
        const shaders = current.map((shader) => {
          if (shader.shaderId !== shaderId) return shader;
          return {
            ...shader,
            params: shader.params.map((param) =>
              param.paramName === paramName
                ? { ...param, paramValue: newValue }
                : param,
            ),
          };
        });
        void applyClipPatch({ shaders }, { refresh: false }).finally(() => {
          setParamLoading((prev) => ({ ...prev, [shaderId]: null }));
          setSliderValues((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          shaderSliderTimersRef.current[key] = null;
        });
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    },
    [selectedTimelineClips, applyClipPatch],
  );

  const getShaderParamConfig = useCallback(
    (shaderId: string, paramName: string) =>
      primaryClip?.blockSettings.shaders
        ?.find((shader) => shader.shaderId === shaderId)
        ?.params.find((param) => param.paramName === paramName),
    [primaryClip],
  );

  const handleAttachToggle = useCallback(
    (targetInputId: string) => {
      if (selectedTimelineClips.length === 0) return;
      const current =
        selectedTimelineClips[0].blockSettings.attachedInputIds || [];
      const newAttached = current.includes(targetInputId)
        ? current.filter((id) => id !== targetInputId)
        : [...current, targetInputId];
      void applyClipPatch({ attachedInputIds: newAttached });
    },
    [selectedTimelineClips, applyClipPatch],
  );

  const handleTextScrollSpeedChange = useCallback(
    (newValue: number) => {
      const nextValue = Math.min(400, Math.max(1, Math.round(newValue)));
      setTextScrollSpeedDraft(nextValue);
      if (textScrollSpeedDebounceRef.current) {
        clearTimeout(textScrollSpeedDebounceRef.current);
      }
      textScrollSpeedDebounceRef.current = setTimeout(() => {
        void applyClipPatch({ textScrollSpeed: nextValue }).finally(() => {
          setTextScrollSpeedDraft(null);
          textScrollSpeedDebounceRef.current = null;
        });
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    },
    [applyClipPatch],
  );

  const pendingSection =
    pendingWhipInputs &&
    pendingWhipInputs.length > 0 &&
    setPendingWhipInputs ? (
      <PendingWhipInputs
        pendingInputs={pendingWhipInputs}
        setPendingInputs={setPendingWhipInputs}
      />
    ) : null;

  if (selectedTimelineClips.length === 0) {
    return pendingSection;
  }

  // Effective clip used for rendering: primary clip for single, or first clip for multi
  const effectiveClip = selectedTimelineClips[0];

  const shaderInput: Input = selectedInput ?? {
    id: -1,
    inputId: effectiveClip.inputId,
    title: effectiveClip.inputId,
    description: '',
    showTitle: effectiveClip.blockSettings.showTitle,
    volume: effectiveClip.blockSettings.volume,
    type: 'local-mp4',
    sourceState: 'unknown',
    status: 'connected',
    shaders: effectiveClip.blockSettings.shaders,
    orientation: effectiveClip.blockSettings.orientation,
    attachedInputIds: effectiveClip.blockSettings.attachedInputIds,
    borderColor: effectiveClip.blockSettings.borderColor,
    borderWidth: effectiveClip.blockSettings.borderWidth,
  };
  shaderInput.shaders = effectiveClip.blockSettings.shaders;

  const inlineShaders =
    inlineShaderView?.source === 'snake1'
      ? (effectiveClip.blockSettings.snake1Shaders ?? [])
      : inlineShaderView?.source === 'snake2'
        ? (effectiveClip.blockSettings.snake2Shaders ?? [])
        : (effectiveClip.blockSettings.shaders ?? []);

  const inlineShaderToggle = (sid: string) => {
    if (inlineShaderView?.source === 'snake1') {
      const current = effectiveClip.blockSettings.snake1Shaders ?? [];
      const existing = current.find((s) => s.shaderId === sid);
      if (!existing) return;
      void applyClipPatch({
        snake1Shaders: current.map((s) =>
          s.shaderId === sid ? { ...s, enabled: !s.enabled } : s,
        ),
      });
    } else if (inlineShaderView?.source === 'snake2') {
      const current = effectiveClip.blockSettings.snake2Shaders ?? [];
      const existing = current.find((s) => s.shaderId === sid);
      if (!existing) return;
      void applyClipPatch({
        snake2Shaders: current.map((s) =>
          s.shaderId === sid ? { ...s, enabled: !s.enabled } : s,
        ),
      });
    } else {
      handleShaderToggle(sid);
    }
  };

  const inlineShaderRemove = (sid: string) => {
    if (inlineShaderView?.source === 'snake1') {
      void applyClipPatch({
        snake1Shaders: (effectiveClip.blockSettings.snake1Shaders ?? []).filter(
          (s) => s.shaderId !== sid,
        ),
      });
    } else if (inlineShaderView?.source === 'snake2') {
      void applyClipPatch({
        snake2Shaders: (effectiveClip.blockSettings.snake2Shaders ?? []).filter(
          (s) => s.shaderId !== sid,
        ),
      });
    } else {
      handleShaderRemove(sid);
    }
  };

  const inlineShaderSlider = (sid: string, paramName: string, val: number) => {
    const key = `${sid}:${paramName}`;
    if (inlineShaderView?.source === 'snake1') {
      setSliderValues((prev) => ({ ...prev, [key]: val }));
      setParamLoading((prev) => ({ ...prev, [sid]: paramName }));
      const timer = shaderSliderTimersRef.current[key];
      if (timer) {
        clearTimeout(timer);
      }
      shaderSliderTimersRef.current[key] = setTimeout(() => {
        const current = effectiveClip.blockSettings.snake1Shaders ?? [];
        void applyClipPatch(
          {
            snake1Shaders: current.map((s) =>
              s.shaderId !== sid
                ? s
                : {
                    ...s,
                    params: s.params.map((p) =>
                      p.paramName === paramName ? { ...p, paramValue: val } : p,
                    ),
                  },
            ),
          },
          { refresh: false },
        ).finally(() => {
          setParamLoading((prev) => ({ ...prev, [sid]: null }));
          setSliderValues((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          shaderSliderTimersRef.current[key] = null;
        });
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    } else if (inlineShaderView?.source === 'snake2') {
      setSliderValues((prev) => ({ ...prev, [key]: val }));
      setParamLoading((prev) => ({ ...prev, [sid]: paramName }));
      const timer = shaderSliderTimersRef.current[key];
      if (timer) {
        clearTimeout(timer);
      }
      shaderSliderTimersRef.current[key] = setTimeout(() => {
        const current = effectiveClip.blockSettings.snake2Shaders ?? [];
        void applyClipPatch(
          {
            snake2Shaders: current.map((s) =>
              s.shaderId !== sid
                ? s
                : {
                    ...s,
                    params: s.params.map((p) =>
                      p.paramName === paramName ? { ...p, paramValue: val } : p,
                    ),
                  },
            ),
          },
          { refresh: false },
        ).finally(() => {
          setParamLoading((prev) => ({ ...prev, [sid]: null }));
          setSliderValues((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          shaderSliderTimersRef.current[key] = null;
        });
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    } else {
      handleSliderChange(sid, paramName, val);
    }
  };

  const inlineShaderParamConfig = (sid: string, paramName: string) => {
    return inlineShaders
      .find((s) => s.shaderId === sid)
      ?.params.find((p) => p.paramName === paramName);
  };

  if (inlineShaderView) {
    return (
      <div>
        <InlineShaderParams
          shaderId={inlineShaderView.shaderId}
          availableShaders={availableShaders}
          shaders={inlineShaders}
          sliderValues={sliderValues}
          paramLoading={paramLoading}
          onShaderToggle={inlineShaderToggle}
          onShaderRemove={inlineShaderRemove}
          onSliderChange={inlineShaderSlider}
          getShaderParamConfig={inlineShaderParamConfig}
          onBack={() => setInlineShaderView(null)}
        />
      </div>
    );
  }

  return (
    <div>
      {pendingSection}
      <div className='text-xs text-neutral-500 mb-2'>
        Selected block properties
      </div>
      <div className='text-sm text-neutral-300 mb-3 truncate'>
        {isMultiSelect
          ? `${selectedTimelineClips.length} clips selected`
          : (selectedInput?.title ?? effectiveClip.inputId)}
      </div>
      {isDisconnected && (
        <div className='mb-3 p-2.5 rounded border-2 border-dashed border-neutral-700 bg-neutral-800/50'>
          <div className='text-xs text-amber-400/80 mb-2'>
            Disconnected — connect a new input
          </div>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='default'
              className='flex-1 bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
              disabled={!!connectingType}
              onClick={() => handleConnectWhip('camera')}>
              {connectingType === 'camera' ? (
                <LoadingSpinner size='sm' variant='spinner' />
              ) : (
                <>
                  <Video className='w-4 h-4 mr-1' />
                  Camera
                </>
              )}
            </Button>
            <Button
              size='sm'
              variant='default'
              className='flex-1 bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
              disabled={!!connectingType}
              onClick={() => handleConnectWhip('screenshare')}>
              {connectingType === 'screenshare' ? (
                <LoadingSpinner size='sm' variant='spinner' />
              ) : (
                <>
                  <Monitor className='w-4 h-4 mr-1' />
                  Screen
                </>
              )}
            </Button>
          </div>
        </div>
      )}
      {!isMultiSelect && selectedTimelineClip && (
        <div className='border border-neutral-700 rounded p-2 mb-3 mt-1'>
          <div className='flex items-center justify-between mb-2'>
            <div>
              <div className='text-xs text-neutral-400 font-medium'>
                Keyframes
              </div>
              <div className='text-[10px] text-neutral-500'>
                {selectedTimelineKeyframe
                  ? `Editing ${Math.round(selectedTimelineKeyframe.timeMs)}ms snapshot`
                  : 'Editing clip default snapshot'}
              </div>
            </div>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 px-2 bg-neutral-800 border-neutral-700 text-white cursor-pointer hover:bg-neutral-700'
              onClick={handleAddKeyframe}>
              Add
            </Button>
          </div>
          <div className='flex flex-wrap gap-1.5 mb-2'>
            <button
              type='button'
              className={`rounded border px-2 py-1 text-[11px] cursor-pointer transition-colors ${
                selectedTimelineKeyframe == null
                  ? 'border-neutral-500 bg-neutral-700 text-white'
                  : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
              }`}
              onClick={() => handleSelectKeyframe(null)}>
              Clip
            </button>
            {selectedTimelineClip.keyframes.map((keyframe) => (
              <button
                key={keyframe.id}
                type='button'
                className={`rounded border px-2 py-1 text-[11px] cursor-pointer transition-colors ${
                  selectedTimelineKeyframe?.id === keyframe.id
                    ? 'border-red-400/70 bg-red-500/20 text-red-100'
                    : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
                onClick={() => handleSelectKeyframe(keyframe.id)}>
                {Math.round(keyframe.timeMs)}ms
              </button>
            ))}
          </div>
          {selectedTimelineKeyframe && (
            <div className='grid grid-cols-[1fr_auto] gap-2 items-end'>
              <div>
                <label className='text-xs text-neutral-400 block mb-1'>
                  Time (ms)
                </label>
                <input
                  type='number'
                  min={0}
                  max={
                    selectedTimelineClip.endMs - selectedTimelineClip.startMs
                  }
                  step={50}
                  disabled={selectedTimelineKeyframe.timeMs === 0}
                  className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1 disabled:opacity-50'
                  value={Math.round(selectedTimelineKeyframe.timeMs)}
                  onChange={(e) =>
                    handleMoveSelectedKeyframe(
                      Math.max(0, Number(e.target.value) || 0),
                    )
                  }
                />
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={selectedTimelineKeyframe.timeMs === 0}
                className='h-8 px-2 bg-neutral-800 border-neutral-700 text-white cursor-pointer hover:bg-neutral-700 disabled:cursor-not-allowed'
                onClick={handleDeleteSelectedKeyframe}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <label className='text-xs text-neutral-400'>Volume</label>
        <input
          type='range'
          min={0}
          max={1}
          step={0.01}
          value={effectiveClip.blockSettings.volume}
          onChange={(e) => {
            void applyClipPatch({ volume: Number(e.target.value) });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Show title</span>
        <input
          type='checkbox'
          checked={effectiveClip.blockSettings.showTitle}
          onChange={(e) => {
            void applyClipPatch({ showTitle: e.target.checked });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Orientation</span>
        <select
          className='bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
          value={effectiveClip.blockSettings.orientation}
          onChange={(e) =>
            void applyClipPatch({
              orientation: e.target.value as 'horizontal' | 'vertical',
            })
          }>
          <option value='horizontal'>Horizontal</option>
          <option value='vertical'>Vertical</option>
        </select>
      </div>
      <div className='border border-neutral-700 rounded p-2 mb-3 mt-1'>
        <div className='text-xs text-neutral-400 font-medium mb-2'>
          Position
        </div>
        <div className='flex items-center justify-between mb-2'>
          <span className='text-xs text-neutral-400'>Absolute position</span>
          <input
            type='checkbox'
            checked={effectiveClip.blockSettings.absolutePosition ?? false}
            onChange={(e) => {
              const enabled = e.target.checked;
              if (enabled && resolution) {
                const isVert =
                  effectiveClip.blockSettings.orientation === 'vertical';
                const w = Math.round(resolution.width * 0.5);
                const h = isVert
                  ? Math.round(w * (16 / 9))
                  : Math.round(w * (9 / 16));
                void applyClipPatch({
                  absolutePosition: true,
                  absoluteWidth: w,
                  absoluteHeight: h,
                  absoluteTop: Math.round((resolution.height - h) / 2),
                  absoluteLeft: Math.round((resolution.width - w) / 2),
                  absoluteTransitionDurationMs: 300,
                  absoluteTransitionEasing: 'linear',
                });
              } else {
                void applyClipPatch({ absolutePosition: false });
              }
            }}
          />
        </div>
        {effectiveClip.blockSettings.absolutePosition && resolution && (
          <>
            <AbsolutePositionController
              resolution={resolution}
              top={effectiveClip.blockSettings.absoluteTop ?? 0}
              left={effectiveClip.blockSettings.absoluteLeft ?? 0}
              width={
                effectiveClip.blockSettings.absoluteWidth ??
                Math.round(resolution.width * 0.5)
              }
              height={
                effectiveClip.blockSettings.absoluteHeight ??
                Math.round(resolution.height * 0.5)
              }
              onChange={(pos) =>
                void applyClipPatch({
                  absoluteTop: pos.top,
                  absoluteLeft: pos.left,
                  absoluteWidth: pos.width,
                  absoluteHeight: pos.height,
                })
              }
            />
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <label className='text-xs text-neutral-400 block mb-1'>
                  Duration (ms)
                </label>
                <input
                  type='number'
                  min={0}
                  step={50}
                  className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                  value={
                    effectiveClip.blockSettings.absoluteTransitionDurationMs ??
                    300
                  }
                  onChange={(e) =>
                    void applyClipPatch({
                      absoluteTransitionDurationMs: Math.max(
                        0,
                        Number(e.target.value) || 0,
                      ),
                    })
                  }
                />
              </div>
              <div>
                <label className='text-xs text-neutral-400 block mb-1'>
                  Easing
                </label>
                <select
                  className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                  value={
                    effectiveClip.blockSettings.absoluteTransitionEasing ??
                    'linear'
                  }
                  onChange={(e) =>
                    void applyClipPatch({
                      absoluteTransitionEasing: e.target.value,
                    })
                  }>
                  <option value='linear'>Linear</option>
                  <option value='bounce'>Bounce</option>
                  <option value='cubic_bezier_ease_in_out'>Ease in-out</option>
                </select>
              </div>
            </div>
          </>
        )}
      </div>
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border color
          </label>
          <input
            type='color'
            className='w-full h-8 bg-neutral-800 border border-neutral-700'
            value={effectiveClip.blockSettings.borderColor || '#ff0000'}
            onChange={(e) =>
              void applyClipPatch({ borderColor: e.target.value })
            }
          />
        </div>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border width
          </label>
          <input
            type='number'
            min={0}
            max={100}
            className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
            value={effectiveClip.blockSettings.borderWidth ?? 0}
            onChange={(e) =>
              void applyClipPatch({
                borderWidth: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </div>
      </div>
      <div className='border border-neutral-700 rounded p-2 mb-3 mt-1'>
        <div className='text-xs text-neutral-400 font-medium mb-2'>
          Transitions
        </div>
        <TransitionRow
          label='Intro'
          transition={effectiveClip.blockSettings.introTransition}
          maxDurationMs={
            effectiveClip.endMs -
            effectiveClip.startMs -
            (effectiveClip.blockSettings.outroTransition?.durationMs ?? 0)
          }
          onChange={(t) =>
            void applyClipPatch({ introTransition: t }, { refresh: false })
          }
        />
        <TransitionRow
          label='Outro'
          transition={effectiveClip.blockSettings.outroTransition}
          maxDurationMs={
            effectiveClip.endMs -
            effectiveClip.startMs -
            (effectiveClip.blockSettings.introTransition?.durationMs ?? 0)
          }
          onChange={(t) =>
            void applyClipPatch({ outroTransition: t }, { refresh: false })
          }
        />
      </div>
      {selectedInput?.type === 'local-mp4' && (
        <div className='border border-neutral-700 rounded p-2 mb-3 mt-1'>
          <div className='text-xs text-neutral-400 font-medium mb-2'>
            MP4 Playback
          </div>
          <div className='grid grid-cols-2 gap-2 mb-2'>
            <label className='text-xs text-neutral-400 self-center'>
              Play from (s)
            </label>
            <input
              type='number'
              min={0}
              step={0.1}
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
              value={
                Math.round(
                  ((effectiveClip.blockSettings.mp4PlayFromMs ?? 0) / 1000) *
                    10,
                ) / 10
              }
              onChange={(e) => {
                const seconds = Math.max(0, Number(e.target.value) || 0);
                void applyClipPatch(
                  { mp4PlayFromMs: Math.round(seconds * 1000) },
                  { refresh: false },
                );
              }}
            />
          </div>
          <div className='flex items-center justify-between mb-1'>
            <span className='text-xs text-neutral-400'>Loop</span>
            <input
              type='checkbox'
              checked={effectiveClip.blockSettings.mp4Loop !== false}
              onChange={(e) => {
                void applyClipPatch(
                  { mp4Loop: e.target.checked },
                  { refresh: false },
                );
              }}
            />
          </div>
          {effectiveClip.blockSettings.mp4DurationMs != null && (
            <div className='text-[10px] text-neutral-500 mt-1'>
              Duration:{' '}
              {(effectiveClip.blockSettings.mp4DurationMs / 1000).toFixed(1)}s
              {effectiveClip.blockSettings.mp4Loop === false && (
                <span>
                  {' '}
                  · Max block:{' '}
                  {(
                    Math.max(
                      0,
                      effectiveClip.blockSettings.mp4DurationMs -
                        (effectiveClip.blockSettings.mp4PlayFromMs ?? 0),
                    ) / 1000
                  ).toFixed(1)}
                  s
                </span>
              )}
            </div>
          )}
          {mp4DurationLoading && (
            <div className='text-[10px] text-neutral-500 mt-1'>
              Loading duration...
            </div>
          )}
        </div>
      )}
      {selectedInput?.type === 'game' && (
        <div className='grid grid-cols-2 gap-2 mb-2'>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              BG color
            </label>
            <input
              type='color'
              className='w-full h-8 bg-neutral-800 border border-neutral-700'
              value={
                gameBgColor ??
                effectiveClip.blockSettings.gameBackgroundColor ??
                '#0a0f1a'
              }
              onChange={(e) => {
                const value = e.target.value;
                setGameBgColor(value);
                if (gameBgDebounceRef.current) {
                  clearTimeout(gameBgDebounceRef.current);
                }
                gameBgDebounceRef.current = setTimeout(() => {
                  void applyClipPatch({ gameBackgroundColor: value });
                  setGameBgColor(null);
                }, 200);
              }}
            />
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Cell gap
            </label>
            <input
              type='number'
              min={0}
              max={20}
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
              value={effectiveClip.blockSettings.gameCellGap ?? 1}
              onChange={(e) =>
                void applyClipPatch({
                  gameCellGap: Math.max(0, Number(e.target.value) || 0),
                })
              }
            />
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Grid line color
            </label>
            <input
              type='color'
              className='w-full h-8 bg-neutral-800 border border-neutral-700'
              value={
                gameGridColor ??
                effectiveClip.blockSettings.gameGridLineColor ??
                '#000000'
              }
              onChange={(e) => {
                const value = e.target.value;
                setGameGridColor(value);
                if (gameGridDebounceRef.current) {
                  clearTimeout(gameGridDebounceRef.current);
                }
                gameGridDebounceRef.current = setTimeout(() => {
                  void applyClipPatch({ gameGridLineColor: value });
                  setGameGridColor(null);
                }, 200);
              }}
            />
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Grid opacity
            </label>
            <input
              type='range'
              min={0}
              max={1}
              step={0.01}
              className='w-full'
              value={effectiveClip.blockSettings.gameGridLineAlpha ?? 1.0}
              onChange={(e) =>
                void applyClipPatch({
                  gameGridLineAlpha: Number(e.target.value),
                })
              }
            />
          </div>
        </div>
      )}
      {selectedInput?.type === 'game' && (
        <SnakeEventShaderPanel
          roomId={roomId}
          inputId={effectiveClip.inputId}
          config={effectiveClip.blockSettings.snakeEventShaders}
          availableShaders={availableShaders}
          onConfigChange={(updated) => {
            void applyClipPatch(
              { snakeEventShaders: updated },
              { refresh: false },
            );
          }}
          onUpdate={async () => {}}
        />
      )}
      {selectedInput?.type === 'game' && (
        <>
          <SnakeShaderSection
            label='🐍 Snake 1 Shaders'
            shaders={effectiveClip.blockSettings.snake1Shaders ?? []}
            playerColor={selectedInput?.snakePlayerColors?.[0]}
            availableShaders={availableShaders}
            onPatch={(shaders) =>
              void applyClipPatch({ snake1Shaders: shaders })
            }
            onOpenShaderInline={(shaderId) =>
              setInlineShaderView({ shaderId, source: 'snake1' })
            }
          />
          <SnakeShaderSection
            label='🐍 Snake 2 Shaders'
            shaders={effectiveClip.blockSettings.snake2Shaders ?? []}
            playerColor={selectedInput?.snakePlayerColors?.[1]}
            availableShaders={availableShaders}
            onPatch={(shaders) =>
              void applyClipPatch({ snake2Shaders: shaders })
            }
            onOpenShaderInline={(shaderId) =>
              setInlineShaderView({ shaderId, source: 'snake2' })
            }
          />
        </>
      )}
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Attached inputs</span>
        <button
          ref={attachBtnRef}
          className='flex items-center gap-1 text-xs px-2 py-1 rounded border border-neutral-700 bg-neutral-800 hover:bg-neutral-700 cursor-pointer transition-colors'
          onClick={() => {
            if (!showAttachMenu && attachBtnRef.current) {
              const rect = attachBtnRef.current.getBoundingClientRect();
              setAttachMenuPos({ top: rect.bottom + 4, left: rect.left });
            }
            setShowAttachMenu(!showAttachMenu);
          }}>
          <Link
            className={`w-3.5 h-3.5 ${(effectiveClip.blockSettings.attachedInputIds?.length ?? 0) > 0 ? 'text-blue-400' : 'text-neutral-400'}`}
          />
          <span className='text-neutral-300'>
            {(effectiveClip.blockSettings.attachedInputIds?.length ?? 0) > 0
              ? `${effectiveClip.blockSettings.attachedInputIds!.length} attached`
              : 'None'}
          </span>
        </button>
        {showAttachMenu &&
          attachMenuPos &&
          createPortal(
            <>
              <div
                className='fixed inset-0 z-[99]'
                onClick={() => setShowAttachMenu(false)}
              />
              <div
                className='fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg p-2 z-[100] min-w-48'
                style={{
                  top: attachMenuPos.top,
                  left: attachMenuPos.left,
                }}>
                <div className='text-xs text-neutral-400 mb-1 px-1'>
                  Attach inputs (render behind)
                </div>
                {inputs
                  .filter((i) => i.inputId !== effectiveClip.inputId)
                  .filter(
                    (i) =>
                      !inputs.some(
                        (other) =>
                          other.inputId !== effectiveClip.inputId &&
                          (other.attachedInputIds || []).includes(i.inputId),
                      ),
                  )
                  .map((i) => {
                    const isAttached = (
                      effectiveClip.blockSettings.attachedInputIds || []
                    ).includes(i.inputId);
                    return (
                      <label
                        key={i.inputId}
                        className='flex items-center gap-2 px-1 py-1 hover:bg-neutral-700 rounded cursor-pointer'>
                        <input
                          type='checkbox'
                          checked={isAttached}
                          onChange={() => handleAttachToggle(i.inputId)}
                          className='accent-blue-500 cursor-pointer'
                        />
                        <span className='text-sm text-white truncate'>
                          {i.title}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </>,
            document.body,
          )}
      </div>
      {selectedInput?.type === 'text-input' && (
        <div className='mt-2 space-y-2'>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>Text</label>
            <textarea
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs p-2 min-h-[80px]'
              value={effectiveClip.blockSettings.text || ''}
              onChange={(e) => void applyClipPatch({ text: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Align
              </label>
              <select
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={effectiveClip.blockSettings.textAlign || 'left'}
                onChange={(e) =>
                  void applyClipPatch({
                    textAlign: e.target.value as 'left' | 'center' | 'right',
                  })
                }>
                <option value='left'>Left</option>
                <option value='center'>Center</option>
                <option value='right'>Right</option>
              </select>
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Text color
              </label>
              <input
                type='color'
                className='w-full h-8 bg-neutral-800 border border-neutral-700'
                value={effectiveClip.blockSettings.textColor || '#ffffff'}
                onChange={(e) =>
                  void applyClipPatch({ textColor: e.target.value })
                }
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Font size
              </label>
              <input
                type='number'
                min={8}
                max={300}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={effectiveClip.blockSettings.textFontSize ?? 80}
                onChange={(e) =>
                  void applyClipPatch({
                    textFontSize: Number(e.target.value) || 80,
                  })
                }
              />
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Max lines
              </label>
              <input
                type='number'
                min={1}
                max={50}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={effectiveClip.blockSettings.textMaxLines ?? 10}
                onChange={(e) =>
                  void applyClipPatch({
                    textMaxLines: Number(e.target.value) || 10,
                  })
                }
              />
            </div>
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Scroll speed
            </label>
            <div className='flex items-center gap-2'>
              <input
                type='range'
                min={1}
                max={400}
                step={1}
                className='flex-1'
                value={
                  textScrollSpeedDraft ??
                  effectiveClip.blockSettings.textScrollSpeed ??
                  80
                }
                onChange={(e) =>
                  handleTextScrollSpeedChange(Number(e.target.value) || 80)
                }
              />
              <span className='text-xs text-neutral-500 w-8 text-right'>
                {textScrollSpeedDraft ??
                  effectiveClip.blockSettings.textScrollSpeed ??
                  80}
              </span>
            </div>
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-neutral-400'>Scroll loop</span>
            <input
              type='checkbox'
              checked={effectiveClip.blockSettings.textScrollLoop ?? true}
              onChange={(e) =>
                void applyClipPatch({ textScrollLoop: e.target.checked })
              }
            />
          </div>
        </div>
      )}
      <div className='mt-3 border-t border-neutral-800 pt-2'>
        <div className='text-xs text-neutral-400 mb-1'>
          Shaders (block-level)
        </div>
        <div className='text-[11px] text-neutral-500 mb-2'>
          Edit this block&apos;s shaders independently from other blocks.
        </div>
        <ShaderPanel
          input={shaderInput}
          availableShaders={availableShaders}
          sliderValues={sliderValues}
          paramLoading={paramLoading}
          shaderLoading={shaderLoading}
          onShaderToggle={handleShaderToggle}
          onShaderRemove={handleShaderRemove}
          onSliderChange={handleSliderChange}
          getShaderParamConfig={getShaderParamConfig}
          onOpenAddShader={() => setIsAddShaderModalOpen(true)}
          onOpenShaderInline={(shaderId) =>
            setInlineShaderView({ shaderId, source: 'block' })
          }
          onApplyPreset={handleApplyPreset}
        />
      </div>
      <AddShaderModal
        isOpen={isAddShaderModalOpen}
        onClose={() => setIsAddShaderModalOpen(false)}
        availableShaders={availableShaders}
        addedShaderIds={
          new Set(
            (effectiveClip.blockSettings.shaders || []).map((s) => s.shaderId),
          )
        }
        onAddShader={handleShaderToggle}
      />
    </div>
  );
}
