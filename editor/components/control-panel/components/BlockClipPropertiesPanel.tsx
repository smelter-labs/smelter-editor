'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Input, AvailableShader, ShaderConfig } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import ShaderPanel, { InlineShaderParams } from '../input-entry/shader-panel';
import { AddShaderModal } from '../input-entry/add-shader-modal';
import SnakeEventShaderPanel from '../input-entry/snake-event-shader-panel';
import type { BlockSettings } from '../hooks/use-timeline-state';
import { OUTPUT_CLIP_ID } from '../hooks/use-timeline-state';
import { PendingWhipInputs } from './PendingWhipInputs';
import type { PendingWhipInput } from './ConfigurationSection';
import { Link, Video, Monitor, ArrowLeftRight } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
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
import { Input as ShadcnInput } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { getMp4Duration } from '@/app/actions/actions';
import { AbsolutePositionController } from './AbsolutePositionController';
import { defaultAbsoluteRect } from '@/lib/source-fit';
import {
  type SelectedTimelineClip,
  extractMp4FileName,
  computeCommonBlockSettings,
  resolveNewKeyframeTimeMs,
} from './block-clip/block-clip-utils';
import { SnakeShaderSection } from './block-clip/SnakeShaderSection';
import { CollapsibleSection } from './block-clip/CollapsibleSection';
import { TransitionRow } from './block-clip/TransitionRow';
import {
  panelInputStyles,
  panelSectionStyles,
  labelStyles,
} from '../styles/panel-primitives';
import {
  SwapSourceModal,
  type SwapSourceResult,
} from './SwapSourceModal';

const SHADER_SETTINGS_DEBOUNCE_MS = 200;

export type { SelectedTimelineClip } from './block-clip/block-clip-utils';

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
  const [textColorDraft, setTextColorDraft] = useState<string | null>(null);
  const textColorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [textScrollSpeedDraft, setTextScrollSpeedDraft] = useState<
    number | null
  >(null);
  const textScrollSpeedDebounceRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
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
  const [swapModalOpen, setSwapModalOpen] = useState(false);

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
      if (textColorDebounceRef.current) {
        clearTimeout(textColorDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setTitleDraft(null);
    setTextScrollSpeedDraft(null);
    setTextColorDraft(null);
    if (textScrollSpeedDebounceRef.current) {
      clearTimeout(textScrollSpeedDebounceRef.current);
      textScrollSpeedDebounceRef.current = null;
    }
    if (textColorDebounceRef.current) {
      clearTimeout(textColorDebounceRef.current);
      textColorDebounceRef.current = null;
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

    const mp4FileName =
      selectedInput.mp4FileName ??
      selectedInput.audioFileName ??
      extractMp4FileName(selectedInput.title);
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

  const handleSwapSource = useCallback(
    async (result: SwapSourceResult) => {
      if (!selectedTimelineClip) return;

      window.dispatchEvent(
        new CustomEvent('smelter:timeline:swap-clip-input', {
          detail: {
            trackId: selectedTimelineClip.trackId,
            clipId: selectedTimelineClip.clipId,
            newInputId: result.newInputId,
            sourceUpdates: result.sourceUpdates,
          },
        }),
      );

      const updatedSettings = {
        ...selectedTimelineClip.blockSettings,
        ...result.sourceUpdates,
      };

      onSelectedTimelineClipChange({
        ...selectedTimelineClip,
        inputId: result.newInputId,
        blockSettings: updatedSettings,
      });

      await handleRefreshState();

      // For newly created inputs, dimensions may only be available after refresh.
      // Dispatch a follow-up settings update if the refreshed input has dimensions
      // that were not part of the initial sourceUpdates.
      if (
        result.sourceUpdates.sourceWidth == null ||
        result.sourceUpdates.sourceHeight == null
      ) {
        const refreshedInput = inputs.find(
          (i) => i.inputId === result.newInputId,
        );
        if (refreshedInput?.sourceWidth && refreshedInput?.sourceHeight) {
          const dimPatch: Partial<BlockSettings> = {
            sourceWidth: refreshedInput.sourceWidth,
            sourceHeight: refreshedInput.sourceHeight,
          };
          window.dispatchEvent(
            new CustomEvent('smelter:timeline:update-clip-settings', {
              detail: {
                trackId: selectedTimelineClip.trackId,
                clipId: selectedTimelineClip.clipId,
                patch: dimPatch,
              },
            }),
          );
        }
      }
    },
    [
      selectedTimelineClip,
      onSelectedTimelineClipChange,
      handleRefreshState,
      inputs,
    ],
  );

  const applyClipPatch = useCallback(
    async (patch: Partial<BlockSettings>, options?: { refresh?: boolean }) => {
      if (selectedTimelineClips.length === 0) return;
      const shouldRefresh = options?.refresh ?? true;
      const singleSelectedClip =
        selectedTimelineClips.length === 1 ? selectedTimelineClips[0] : null;
      const targetKeyframeId = singleSelectedClip?.selectedKeyframeId ?? null;

      const hasCropInPatch =
        'cropTop' in patch ||
        'cropLeft' in patch ||
        'cropRight' in patch ||
        'cropBottom' in patch;
      const cropOnly = hasCropInPatch
        ? {
            ...(patch.cropTop !== undefined && { cropTop: patch.cropTop }),
            ...(patch.cropLeft !== undefined && { cropLeft: patch.cropLeft }),
            ...(patch.cropRight !== undefined && {
              cropRight: patch.cropRight,
            }),
            ...(patch.cropBottom !== undefined && {
              cropBottom: patch.cropBottom,
            }),
          }
        : null;

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
                  : cropOnly
                    ? {
                        ...keyframe,
                        blockSettings: {
                          ...keyframe.blockSettings,
                          ...cropOnly,
                        },
                      }
                    : keyframe,
              )
            : clip.keyframes.map((keyframe) =>
                keyframe.timeMs === 0
                  ? {
                      ...keyframe,
                      blockSettings: { ...keyframe.blockSettings, ...patch },
                    }
                  : cropOnly
                    ? {
                        ...keyframe,
                        blockSettings: {
                          ...keyframe.blockSettings,
                          ...cropOnly,
                        },
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
            cropTop: patch.cropTop,
            cropLeft: patch.cropLeft,
            cropRight: patch.cropRight,
            cropBottom: patch.cropBottom,
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

  const handleTitleCommit = useCallback(
    async (newTitle: string) => {
      if (!primaryClip || !selectedInput) return;
      const trimmed = newTitle.trim();
      if (!trimmed || trimmed === selectedInput.title) {
        setTitleDraft(null);
        return;
      }
      try {
        await updateInputAction(roomId, primaryClip.inputId, {
          title: trimmed,
        });
        await handleRefreshState();
      } catch (err) {
        console.warn('Failed to rename input', err);
      }
      setTitleDraft(null);
    },
    [primaryClip, selectedInput, roomId, updateInputAction, handleRefreshState],
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
  const isOutputClip = effectiveClip.clipId === OUTPUT_CLIP_ID;

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
      <div className='text-xs text-muted-foreground mb-2'>
        {isOutputClip
          ? 'Main Video output shaders'
          : 'Selected block properties'}
      </div>
      {!isOutputClip && (
        <>
          {isMultiSelect ? (
            <div className='text-sm text-card-foreground mb-3 truncate'>
              {selectedTimelineClips.length} clips selected
            </div>
          ) : (
            <div className='flex items-center gap-1.5 mb-3'>
              <ShadcnInput
                className='text-sm text-card-foreground bg-transparent border-border px-1 py-0.5 h-auto flex-1'
                value={
                  titleDraft ?? selectedInput?.title ?? effectiveClip.inputId
                }
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={(e) => void handleTitleCommit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setTitleDraft(null);
                    e.currentTarget.blur();
                  }
                }}
              />
              <Button
                size='sm'
                variant='outline'
                className='h-7 px-2 shrink-0 cursor-pointer border-border text-muted-foreground hover:text-foreground hover:bg-accent'
                title='Change source'
                onClick={() => setSwapModalOpen(true)}>
                <ArrowLeftRight className='w-3.5 h-3.5' />
              </Button>
            </div>
          )}
        </>
      )}
      {!isOutputClip && isDisconnected && (
        <div className='mb-3 p-2.5 rounded border-2 border-dashed border-border bg-card/50'>
          <div className='text-xs text-amber-400/80 mb-2'>
            Disconnected — connect a new input
          </div>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              className='flex-1 cursor-pointer'
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
              variant='outline'
              className='flex-1 cursor-pointer'
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
        <CollapsibleSection title='Keyframes' className={panelSectionStyles()}>
          <div className='flex items-center justify-between mb-2'>
            <div className='text-[10px] text-muted-foreground'>
              {selectedTimelineKeyframe
                ? selectedTimelineKeyframe.timeMs === 0
                  ? 'Editing base (0ms) keyframe'
                  : `Editing ${Math.round(selectedTimelineKeyframe.timeMs)}ms snapshot`
                : 'Editing base (0ms) keyframe'}
            </div>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 px-2 bg-card border-border text-foreground cursor-pointer hover:bg-accent'
              onClick={handleAddKeyframe}>
              Add Keyframe
            </Button>
          </div>
          <div className='flex flex-wrap gap-1.5 mb-2'>
            {selectedTimelineClip.keyframes.map((keyframe) => (
              <Button
                key={keyframe.id}
                type='button'
                variant='outline'
                size='sm'
                className={`px-2 py-1 text-[11px] cursor-pointer ${
                  selectedTimelineKeyframe?.id === keyframe.id
                    ? 'border-red-400/70 bg-red-500/20 text-red-100'
                    : 'border-border bg-card text-card-foreground hover:bg-accent'
                }`}
                onClick={() => handleSelectKeyframe(keyframe.id)}>
                {keyframe.timeMs === 0
                  ? 'Base (0ms)'
                  : `${Math.round(keyframe.timeMs)}ms`}
              </Button>
            ))}
          </div>
          {selectedTimelineKeyframe && (
            <>
              <div className='grid grid-cols-[1fr_auto] gap-2 items-end mb-2'>
                <div>
                  <label className={labelStyles({ block: true })}>
                    Time (ms)
                  </label>
                  <NumberInput
                    min={0}
                    max={
                      selectedTimelineClip.endMs - selectedTimelineClip.startMs
                    }
                    step={50}
                    disabled={selectedTimelineKeyframe.timeMs === 0}
                    className='w-full bg-card border border-border text-foreground text-xs px-2 py-1 disabled:opacity-50'
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
                  className='h-8 px-2 bg-card border-border text-foreground cursor-pointer hover:bg-accent disabled:cursor-not-allowed'
                  onClick={handleDeleteSelectedKeyframe}>
                  Delete
                </Button>
              </div>
              <div>
                <label className={labelStyles({ block: true })}>
                  Interpolation
                </label>
                <Select
                  value={
                    selectedTimelineKeyframe.blockSettings.forceInterpolation ??
                    'inherit'
                  }
                  onValueChange={(v) =>
                    void applyClipPatch({
                      forceInterpolation:
                        v === 'inherit' ? undefined : (v as 'step' | 'smooth'),
                    })
                  }>
                  <SelectTrigger
                    className={panelInputStyles({
                      fullWidth: true,
                      compact: true,
                    })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='inherit'>Inherit (global)</SelectItem>
                    <SelectItem value='smooth'>Force Smooth</SelectItem>
                    <SelectItem value='step'>Force Step</SelectItem>
                  </SelectContent>
                </Select>
                <div className='text-[10px] text-muted-foreground mt-1'>
                  Override the global interpolation mode for this keyframe
                  segment
                </div>
              </div>
            </>
          )}
        </CollapsibleSection>
      )}
      {!isOutputClip && (
        <>
          <CollapsibleSection title='Display' className='mb-2'>
            <div className='grid grid-cols-2 gap-2 mb-2'>
              <label className='text-xs text-muted-foreground'>Volume</label>
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={[effectiveClip.blockSettings.volume]}
                onValueChange={(v) => {
                  void applyClipPatch({ volume: v[0] });
                }}
              />
            </div>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-xs text-muted-foreground'>Show title</span>
              <input
                type='checkbox'
                checked={effectiveClip.blockSettings.showTitle}
                onChange={(e) => {
                  void applyClipPatch({ showTitle: e.target.checked });
                }}
              />
            </div>
          </CollapsibleSection>
          <CollapsibleSection title='Position' className={panelSectionStyles()}>
            {resolution && (
              <>
                <AbsolutePositionController
                  resolution={resolution}
                  top={effectiveClip.blockSettings.absoluteTop ?? 0}
                  left={effectiveClip.blockSettings.absoluteLeft ?? 0}
                  width={
                    effectiveClip.blockSettings.absoluteWidth ??
                    defaultAbsoluteRect(
                      {
                        sourceWidth:
                          effectiveClip.blockSettings.sourceWidth ??
                          selectedInput?.sourceWidth,
                        sourceHeight:
                          effectiveClip.blockSettings.sourceHeight ??
                          selectedInput?.sourceHeight,
                      },
                      resolution,
                    ).width
                  }
                  height={
                    effectiveClip.blockSettings.absoluteHeight ??
                    defaultAbsoluteRect(
                      {
                        sourceWidth:
                          effectiveClip.blockSettings.sourceWidth ??
                          selectedInput?.sourceWidth,
                        sourceHeight:
                          effectiveClip.blockSettings.sourceHeight ??
                          selectedInput?.sourceHeight,
                      },
                      resolution,
                    ).height
                  }
                  cropTop={effectiveClip.blockSettings.cropTop}
                  cropLeft={effectiveClip.blockSettings.cropLeft}
                  cropRight={effectiveClip.blockSettings.cropRight}
                  cropBottom={effectiveClip.blockSettings.cropBottom}
                  onChange={(pos) =>
                    void applyClipPatch({
                      absoluteTop: pos.top,
                      absoluteLeft: pos.left,
                      absoluteWidth: pos.width,
                      absoluteHeight: pos.height,
                    })
                  }
                  onCropChange={(cropVals) =>
                    void applyClipPatch({
                      cropTop: cropVals.cropTop,
                      cropLeft: cropVals.cropLeft,
                      cropRight: cropVals.cropRight,
                      cropBottom: cropVals.cropBottom,
                    })
                  }
                />
                <div className='grid grid-cols-2 gap-2'>
                  <div>
                    <label className={labelStyles({ block: true })}>
                      Duration (ms)
                    </label>
                    <NumberInput
                      min={0}
                      step={50}
                      className={panelInputStyles({ fullWidth: true })}
                      value={
                        effectiveClip.blockSettings
                          .absoluteTransitionDurationMs ?? 300
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
                    <label className={labelStyles({ block: true })}>
                      Easing
                    </label>
                    <Select
                      value={
                        effectiveClip.blockSettings.absoluteTransitionEasing ??
                        'linear'
                      }
                      onValueChange={(v) =>
                        void applyClipPatch({
                          absoluteTransitionEasing: v,
                        })
                      }>
                      <SelectTrigger
                        className={panelInputStyles({
                          fullWidth: true,
                          compact: true,
                        })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='linear'>Linear</SelectItem>
                        <SelectItem value='bounce'>Bounce</SelectItem>
                        <SelectItem value='cubic_bezier_ease_in_out'>
                          Ease in-out
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </CollapsibleSection>
          <CollapsibleSection title='Border' className='mb-2'>
            <div className='grid grid-cols-2 gap-2'>
              <div>
                <label className={labelStyles({ block: true })}>Color</label>
                <input
                  type='color'
                  className='w-full h-8 bg-card border border-border'
                  value={effectiveClip.blockSettings.borderColor || '#ff0000'}
                  onChange={(e) =>
                    void applyClipPatch({ borderColor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelStyles({ block: true })}>Width</label>
                <NumberInput
                  min={0}
                  max={100}
                  className={panelInputStyles({ fullWidth: true })}
                  value={effectiveClip.blockSettings.borderWidth ?? 0}
                  onChange={(e) =>
                    void applyClipPatch({
                      borderWidth: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>
          </CollapsibleSection>
          <CollapsibleSection
            title='Transitions'
            className={panelSectionStyles()}>
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
          </CollapsibleSection>
          {selectedInput?.type === 'local-mp4' && (
            <CollapsibleSection
              title='MP4 Playback'
              className={panelSectionStyles()}>
              <div className='grid grid-cols-2 gap-2 mb-2'>
                <label className='text-xs text-muted-foreground self-center'>
                  Play from (s)
                </label>
                <NumberInput
                  min={0}
                  step={0.1}
                  className={panelInputStyles({ fullWidth: true })}
                  value={
                    Math.round(
                      ((effectiveClip.blockSettings.mp4PlayFromMs ?? 0) /
                        1000) *
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
                <span className='text-xs text-muted-foreground'>Loop</span>
                <input
                  type='checkbox'
                  checked={effectiveClip.blockSettings.mp4Loop !== false}
                  onChange={(e) => {
                    const loopEnabled = e.target.checked;
                    void applyClipPatch(
                      { mp4Loop: loopEnabled },
                      { refresh: false },
                    );
                    if (
                      !loopEnabled &&
                      effectiveClip.blockSettings.mp4DurationMs != null
                    ) {
                      const maxDuration =
                        effectiveClip.blockSettings.mp4DurationMs -
                        (effectiveClip.blockSettings.mp4PlayFromMs ?? 0);
                      if (
                        maxDuration > 0 &&
                        effectiveClip.endMs - effectiveClip.startMs >
                          maxDuration
                      ) {
                        window.dispatchEvent(
                          new CustomEvent(
                            'smelter:timeline:resize-clip',
                            {
                              detail: {
                                trackId: effectiveClip.trackId,
                                clipId: effectiveClip.clipId,
                                edge: 'right' as const,
                                newMs:
                                  effectiveClip.startMs + maxDuration,
                              },
                            },
                          ),
                        );
                      }
                    }
                  }}
                />
              </div>
              {effectiveClip.blockSettings.mp4DurationMs != null && (
                <div className='text-[10px] text-muted-foreground mt-1'>
                  Duration:{' '}
                  {(effectiveClip.blockSettings.mp4DurationMs / 1000).toFixed(
                    1,
                  )}
                  s
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
                <div className='text-[10px] text-muted-foreground mt-1'>
                  Loading duration...
                </div>
              )}
            </CollapsibleSection>
          )}
          {selectedInput?.type === 'game' && (
            <CollapsibleSection title='Game' className='mb-2'>
              <div className='grid grid-cols-2 gap-2'>
                <div>
                  <label className={labelStyles({ block: true })}>
                    BG color
                  </label>
                  <input
                    type='color'
                    className='w-full h-8 bg-card border border-border'
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
                  <label className={labelStyles({ block: true })}>
                    Cell gap
                  </label>
                  <NumberInput
                    min={0}
                    max={20}
                    className={panelInputStyles({ fullWidth: true })}
                    value={effectiveClip.blockSettings.gameCellGap ?? 1}
                    onChange={(e) =>
                      void applyClipPatch({
                        gameCellGap: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={labelStyles({ block: true })}>
                    Grid line color
                  </label>
                  <input
                    type='color'
                    className='w-full h-8 bg-card border border-border'
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
                  <label className={labelStyles({ block: true })}>
                    Grid opacity
                  </label>
                  <Slider
                    min={0}
                    max={1}
                    step={0.01}
                    className='w-full'
                    value={[
                      effectiveClip.blockSettings.gameGridLineAlpha ?? 1.0,
                    ]}
                    onValueChange={(v) =>
                      void applyClipPatch({
                        gameGridLineAlpha: v[0],
                      })
                    }
                  />
                </div>
              </div>
            </CollapsibleSection>
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
            <CollapsibleSection title='Snake Shaders' className='mb-2'>
              <SnakeShaderSection
                label='Snake 1 Shaders'
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
                label='Snake 2 Shaders'
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
            </CollapsibleSection>
          )}
          <CollapsibleSection title='Attached inputs' className='mb-2'>
            <div className='flex items-center justify-between'>
              <Button
                ref={attachBtnRef}
                variant='outline'
                size='sm'
                className='flex items-center gap-1 text-xs px-2 py-1 border-border bg-card hover:bg-accent cursor-pointer'
                onClick={() => {
                  if (!showAttachMenu && attachBtnRef.current) {
                    const rect = attachBtnRef.current.getBoundingClientRect();
                    setAttachMenuPos({ top: rect.bottom + 4, left: rect.left });
                  }
                  setShowAttachMenu(!showAttachMenu);
                }}>
                <Link
                  className={`w-3.5 h-3.5 ${(effectiveClip.blockSettings.attachedInputIds?.length ?? 0) > 0 ? 'text-blue-400' : 'text-muted-foreground'}`}
                />
                <span className='text-card-foreground'>
                  {(effectiveClip.blockSettings.attachedInputIds?.length ?? 0) >
                  0
                    ? `${effectiveClip.blockSettings.attachedInputIds!.length} attached`
                    : 'None'}
                </span>
              </Button>
              {showAttachMenu &&
                attachMenuPos &&
                createPortal(
                  <>
                    <div
                      className='fixed inset-0 z-[99]'
                      onClick={() => setShowAttachMenu(false)}
                    />
                    <div
                      className='fixed bg-card border border-border rounded-lg shadow-lg p-2 z-[100] min-w-48'
                      style={{
                        top: attachMenuPos.top,
                        left: attachMenuPos.left,
                      }}>
                      <div className='text-xs text-muted-foreground mb-1 px-1'>
                        Attach inputs (render behind)
                      </div>
                      {inputs
                        .filter((i) => i.inputId !== effectiveClip.inputId)
                        .filter(
                          (i) =>
                            !inputs.some(
                              (other) =>
                                other.inputId !== effectiveClip.inputId &&
                                (other.attachedInputIds || []).includes(
                                  i.inputId,
                                ),
                            ),
                        )
                        .map((i) => {
                          const isAttached = (
                            effectiveClip.blockSettings.attachedInputIds || []
                          ).includes(i.inputId);
                          return (
                            <label
                              key={i.inputId}
                              className='flex items-center gap-2 px-1 py-1 hover:bg-accent rounded cursor-pointer'>
                              <input
                                type='checkbox'
                                checked={isAttached}
                                onChange={() => handleAttachToggle(i.inputId)}
                                className='accent-blue-500 cursor-pointer'
                              />
                              <span className='text-sm text-foreground truncate'>
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
          </CollapsibleSection>
          {selectedInput?.type === 'text-input' && (
            <CollapsibleSection title='Text input' className='mt-2'>
              <div className='space-y-2'>
                <div>
                  <label className={labelStyles({ block: true })}>Text</label>
                  <Textarea
                    className='w-full bg-card border border-border text-foreground text-xs p-2 min-h-[80px]'
                    value={effectiveClip.blockSettings.text || ''}
                    onChange={(e) =>
                      void applyClipPatch({ text: e.target.value })
                    }
                  />
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
                    <label className={labelStyles({ block: true })}>
                      Align
                    </label>
                    <Select
                      value={effectiveClip.blockSettings.textAlign || 'left'}
                      onValueChange={(v: 'left' | 'center' | 'right') =>
                        void applyClipPatch({ textAlign: v })
                      }>
                      <SelectTrigger
                        className={panelInputStyles({
                          fullWidth: true,
                          compact: true,
                        })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='left'>Left</SelectItem>
                        <SelectItem value='center'>Center</SelectItem>
                        <SelectItem value='right'>Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className={labelStyles({ block: true })}>
                      Text color
                    </label>
                    <input
                      type='color'
                      className='w-full h-8 bg-card border border-border'
                      value={
                        textColorDraft ??
                        effectiveClip.blockSettings.textColor ??
                        '#ffffff'
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        setTextColorDraft(value);
                        if (textColorDebounceRef.current) {
                          clearTimeout(textColorDebounceRef.current);
                        }
                        textColorDebounceRef.current = setTimeout(() => {
                          void applyClipPatch({ textColor: value });
                          setTextColorDraft(null);
                          textColorDebounceRef.current = null;
                        }, SHADER_SETTINGS_DEBOUNCE_MS);
                      }}
                    />
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-2'>
                  <div>
                    <label className={labelStyles({ block: true })}>
                      Font size
                    </label>
                    <NumberInput
                      min={8}
                      max={300}
                      className={panelInputStyles({ fullWidth: true })}
                      value={effectiveClip.blockSettings.textFontSize ?? 80}
                      onChange={(e) =>
                        void applyClipPatch({
                          textFontSize: Number(e.target.value) || 80,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelStyles({ block: true })}>
                      Max lines
                    </label>
                    <NumberInput
                      min={1}
                      max={50}
                      className={panelInputStyles({ fullWidth: true })}
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
                  <label className={labelStyles({ block: true })}>
                    Scroll speed
                  </label>
                  <div className='flex items-center gap-2'>
                    <Slider
                      min={1}
                      max={400}
                      step={1}
                      className='flex-1'
                      value={[
                        textScrollSpeedDraft ??
                          effectiveClip.blockSettings.textScrollSpeed ??
                          80,
                      ]}
                      onValueChange={(v) =>
                        handleTextScrollSpeedChange(v[0] || 80)
                      }
                    />
                    <span className='text-xs text-muted-foreground w-8 text-right'>
                      {textScrollSpeedDraft ??
                        effectiveClip.blockSettings.textScrollSpeed ??
                        80}
                    </span>
                  </div>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground'>
                    Scroll loop
                  </span>
                  <input
                    type='checkbox'
                    checked={effectiveClip.blockSettings.textScrollLoop ?? true}
                    onChange={(e) =>
                      void applyClipPatch({ textScrollLoop: e.target.checked })
                    }
                  />
                </div>
              </div>
            </CollapsibleSection>
          )}
        </>
      )}
      <CollapsibleSection
        title={isOutputClip ? 'Output Shaders' : 'Shaders (block-level)'}
        className='mt-3 border-t border-border pt-2'>
        <div className='text-[11px] text-muted-foreground mb-2'>
          {isOutputClip
            ? 'Apply shader effects to the entire video output.'
            : "Edit this block's shaders independently from other blocks."}
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
      </CollapsibleSection>
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
      {!isOutputClip && !isMultiSelect && selectedTimelineClip && (
        <SwapSourceModal
          open={swapModalOpen}
          onOpenChange={setSwapModalOpen}
          currentInputId={selectedTimelineClip.inputId}
          inputs={inputs}
          roomId={roomId}
          onSwap={handleSwapSource}
          trackId={selectedTimelineClip.trackId}
          clipId={selectedTimelineClip.clipId}
        />
      )}
    </div>
  );
}
