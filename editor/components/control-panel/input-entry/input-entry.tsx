import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  AvailableShader,
  connectInput,
  disconnectInput,
  hideInput,
  showInput,
  Input,
  removeInput,
  updateInput,
} from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import {
  Type,
  ChevronUp,
  ChevronDown,
  GripVertical,
  RectangleHorizontal,
  RectangleVertical,
  RotateCw,
  Link,
  Eye,
  EyeOff,
} from 'lucide-react';
import ShaderPanel from './shader-panel';
import SnakeEventShaderPanel from './snake-event-shader-panel';
import { InputEntryTextSection } from './input-entry-text-section';
import { StatusButton } from './status-button';
import { MuteButton } from './mute-button';
import { DeleteButton } from './delete-button';
import { AddShaderModal } from './add-shader-modal';
import { getSourceStateColor, getSourceStateLabel } from './utils';
import { handleShaderDrop, handleShaderDragOver } from './shader-drop-handler';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import { rotateBy90 } from '../whip-input/utils/whip-publisher';
import {
  clearWhipSessionFor,
  loadLastWhipInputId,
  loadWhipSession,
} from '../whip-input/utils/whip-storage';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Converts a hex color string to a packed integer (0xRRGGBB)
 */
function hexToPackedInt(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const fullHex =
    cleanHex.length === 3
      ? cleanHex
          .split('')
          .map((char) => char + char)
          .join('')
      : cleanHex;
  return parseInt(fullHex, 16);
}

/**
 * Converts a packed integer (0xRRGGBB) to a hex color string
 */
function packedIntToHex(packed: number): string {
  const r = ((packed >> 16) & 0xff).toString(16).padStart(2, '0');
  const g = ((packed >> 8) & 0xff).toString(16).padStart(2, '0');
  const b = (packed & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function isInputAttachedElsewhere(
  targetInputId: string,
  currentInputId: string,
  allInputs: Input[],
): boolean {
  return allInputs.some(
    (i) =>
      i.inputId !== currentInputId &&
      (i.attachedInputIds || []).includes(targetInputId),
  );
}

interface InputEntryProps {
  roomId: string;
  input: Input;
  refreshState: () => Promise<void>;
  availableShaders?: AvailableShader[];
  canRemove?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  pcRef?: React.MutableRefObject<RTCPeerConnection | null>;
  streamRef?: React.MutableRefObject<MediaStream | null>;
  onWhipDisconnectedOrRemoved?: (inputId: string) => void;
  isFxOpen?: boolean;
  onToggleFx?: () => void;
  fxModeOnly?: boolean;
  showGrip?: boolean;
  isSelected?: boolean;
  index?: number;
  allInputs?: Input[];
  readOnly?: boolean;
  isLocalWhipInput?: boolean;
}

export default function InputEntry({
  roomId,
  input,
  refreshState,
  availableShaders = [],
  canRemove = true,
  canMoveUp = true,
  canMoveDown = true,
  pcRef,
  streamRef,
  onWhipDisconnectedOrRemoved,
  isFxOpen,
  onToggleFx,
  fxModeOnly,
  showGrip = true,
  isSelected = false,
  index,
  allInputs,
  readOnly = false,
  isLocalWhipInput = false,
}: InputEntryProps) {
  const [connectionStateLoading, setConnectionStateLoading] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const [isAddShaderModalOpen, setIsAddShaderModalOpen] = useState(false);
  const [textValue, setTextValue] = useState(input.text || '');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(
    input.textAlign || 'left',
  );
  const [textColor, setTextColor] = useState<string>(
    input.textColor || '#ffffff',
  );
  const [textMaxLines, setTextMaxLines] = useState<number>(
    input.textMaxLines ?? 10,
  );
  const [textScrollSpeed, setTextScrollSpeed] = useState<number>(
    input.textScrollSpeed ?? 40,
  );
  const [textScrollLoop, setTextScrollLoop] = useState<boolean>(
    input.textScrollLoop ?? true,
  );
  const [textFontSize, setTextFontSize] = useState<number>(
    input.textFontSize ?? 80,
  );
  const [isTextSaving, setIsTextSaving] = useState(false);
  const textSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachBtnRef = useRef<HTMLButtonElement>(null);
  const [attachMenuPos, setAttachMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const isMobile = useIsMobile();
  const muted = input.volume === 0;
  const showTitle = input.showTitle !== false;
  const isVerticalOrientation = input.orientation === 'vertical';

  const isWhipInput = input.type === 'whip';
  const isTextInput = input.type === 'text-input';

  useEffect(() => {
    if (input.textColor !== undefined) {
      setTextColor(input.textColor);
    }
  }, [input.textColor]);

  useEffect(() => {
    setTextValue(input.text || '');
  }, [input.text]);

  useEffect(() => {
    if (input.textMaxLines !== undefined) {
      setTextMaxLines(input.textMaxLines);
    }
  }, [input.textMaxLines]);

  useEffect(() => {
    if (input.textScrollSpeed !== undefined) {
      setTextScrollSpeed(input.textScrollSpeed);
    }
  }, [input.textScrollSpeed]);

  useEffect(() => {
    if (input.textScrollLoop !== undefined) {
      setTextScrollLoop(input.textScrollLoop);
    }
  }, [input.textScrollLoop]);

  useEffect(() => {
    if (input.textFontSize !== undefined) {
      setTextFontSize(input.textFontSize);
    }
  }, [input.textFontSize]);

  const lastParamChangeRef = useRef<{ [key: string]: number }>({});
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const sliderTimers = useRef<{
    [key: string]: NodeJS.Timeout | number | null;
  }>({});

  const effectiveShowSliders =
    typeof isFxOpen === 'boolean' ? isFxOpen : showSliders;

  const addedShaderIds = useMemo(
    () => new Set((input.shaders || []).map((s) => s.shaderId)),
    [input.shaders],
  );

  const handleMuteToggle = useCallback(async () => {
    await updateInput(roomId, input.inputId, {
      volume: muted ? 1 : 0,
      shaders: input.shaders,
    });
    await refreshState();
  }, [roomId, input, muted, refreshState]);

  const handleShowTitleToggle = useCallback(async () => {
    await updateInput(roomId, input.inputId, {
      showTitle: !showTitle,
      shaders: input.shaders,
      volume: input.volume,
    });
    await refreshState();
  }, [roomId, input, showTitle, refreshState]);

  const handleOrientationToggle = useCallback(async () => {
    await updateInput(roomId, input.inputId, {
      orientation: isVerticalOrientation ? 'horizontal' : 'vertical',
      shaders: input.shaders,
      volume: input.volume,
    });
    await refreshState();
  }, [roomId, input, isVerticalOrientation, refreshState]);

  const handleRotate90 = useCallback(async () => {
    if (isLocalWhipInput && pcRef && streamRef) {
      const angle = await rotateBy90(pcRef, streamRef);
      await updateInput(roomId, input.inputId, {
        orientation: angle % 180 !== 0 ? 'vertical' : 'horizontal',
        shaders: input.shaders,
        volume: input.volume,
      });
    } else {
      await updateInput(roomId, input.inputId, {
        orientation: isVerticalOrientation ? 'horizontal' : 'vertical',
        shaders: input.shaders,
        volume: input.volume,
      });
    }
    await refreshState();
  }, [
    roomId,
    input,
    isVerticalOrientation,
    refreshState,
    isLocalWhipInput,
    pcRef,
    streamRef,
  ]);

  const handleAttachToggle = useCallback(
    async (targetInputId: string) => {
      const currentAttached = input.attachedInputIds || [];
      const newAttached = currentAttached.includes(targetInputId)
        ? currentAttached.filter((id) => id !== targetInputId)
        : [...currentAttached, targetInputId];
      await updateInput(roomId, input.inputId, {
        volume: input.volume,
        attachedInputIds: newAttached,
      });
      await refreshState();
    },
    [roomId, input, refreshState],
  );

  const handleTextChange = useCallback(
    (newText: string) => {
      setTextValue(newText);
      if (textSaveTimerRef.current) {
        clearTimeout(textSaveTimerRef.current);
      }
      textSaveTimerRef.current = setTimeout(async () => {
        setIsTextSaving(true);
        try {
          await updateInput(roomId, input.inputId, {
            text: newText,
            shaders: input.shaders,
            volume: input.volume,
          });
          await refreshState();
        } finally {
          setIsTextSaving(false);
        }
      }, 500);
    },
    [roomId, input, refreshState],
  );

  const handleTextAlignChange = useCallback(
    async (newAlign: 'left' | 'center' | 'right') => {
      setTextAlign(newAlign);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textAlign: newAlign,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleTextColorChange = useCallback(
    async (newColor: string) => {
      setTextColor(newColor);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textColor: newColor,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleTextMaxLinesChange = useCallback(
    async (newMaxLines: number) => {
      setTextMaxLines(newMaxLines);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textMaxLines: newMaxLines,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleTextScrollSpeedChange = useCallback(
    async (newSpeed: number) => {
      setTextScrollSpeed(newSpeed);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textScrollSpeed: newSpeed,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleTextScrollLoopChange = useCallback(
    async (newLoop: boolean) => {
      setTextScrollLoop(newLoop);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textScrollLoop: newLoop,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleTextFontSizeChange = useCallback(
    async (newFontSize: number) => {
      setTextFontSize(newFontSize);
      setIsTextSaving(true);
      try {
        await updateInput(roomId, input.inputId, {
          textFontSize: newFontSize,
          shaders: input.shaders,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setIsTextSaving(false);
      }
    },
    [roomId, input, refreshState],
  );

  const handleDelete = useCallback(async () => {
    const confirmed = window.confirm(
      'Delete this input permanently? This will remove it from the room and from the timeline.',
    );
    if (!confirmed) return;

    const session = loadWhipSession();
    const isSavedInSession =
      (session &&
        session.roomId === roomId &&
        session.inputId === input.inputId) ||
      loadLastWhipInputId(roomId) === input.inputId;
    const isWhipCandidate =
      input.inputId.indexOf('whip') > 0 || isSavedInSession;

    // Hide first so it disappears from the program immediately
    try {
      await hideInput(roomId, input.inputId);
    } catch {
      // non-fatal
    }

    if (isWhipCandidate && pcRef && streamRef) {
      stopCameraAndConnection(pcRef, streamRef);
    }

    if (isWhipCandidate) {
      try {
        clearWhipSessionFor(roomId, input.inputId);
      } catch {}
      try {
        onWhipDisconnectedOrRemoved?.(input.inputId);
      } catch {}
    }

    await removeInput(roomId, input.inputId);
    await refreshState();
  }, [
    roomId,
    input,
    refreshState,
    pcRef,
    streamRef,
    onWhipDisconnectedOrRemoved,
  ]);

  const handleConnectionToggle = useCallback(async () => {
    setConnectionStateLoading(true);
    try {
      if (input.status === 'connected') {
        if (isWhipInput && pcRef && streamRef) {
          stopCameraAndConnection(pcRef, streamRef);
        }
        await disconnectInput(roomId, input.inputId);
        if (isWhipInput) {
          try {
            onWhipDisconnectedOrRemoved?.(input.inputId);
          } catch {}
        }
      } else if (input.status === 'disconnected') {
        await connectInput(roomId, input.inputId);
      }
      await refreshState();
    } finally {
      setConnectionStateLoading(false);
    }
  }, [
    roomId,
    input,
    refreshState,
    isWhipInput,
    pcRef,
    streamRef,
    onWhipDisconnectedOrRemoved,
  ]);

  const handleSlidersToggle = useCallback(() => {
    if (onToggleFx) {
      onToggleFx();
    } else {
      setShowSliders((prev) => !prev);
    }
  }, [onToggleFx]);

  const handleVisibilityToggle = useCallback(async () => {
    try {
      if (input.hidden) {
        await showInput(roomId, input.inputId);
      } else {
        await hideInput(roomId, input.inputId);
      }
      await refreshState();
    } finally {
      // no-op
    }
  }, [roomId, input, refreshState]);

  const handleShaderToggle = useCallback(
    async (shaderId: string) => {
      setShaderLoading(shaderId);
      try {
        const existing = (input.shaders || []).find(
          (s) => s.shaderId === shaderId,
        );
        let newShadersConfig: NonNullable<Input['shaders']>;
        if (!existing) {
          const shaderDef = availableShaders.find((s) => s.id === shaderId);
          if (!shaderDef) {
            setShaderLoading(null);
            return;
          }
          newShadersConfig = [
            ...(input.shaders || []),
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params: (shaderDef.params?.map(
                (param): { paramName: string; paramValue: number } => {
                  // Handle color params: convert hex string to packed integer
                  if (
                    param.type === 'color' &&
                    typeof param.defaultValue === 'string'
                  ) {
                    return {
                      paramName: param.name,
                      paramValue: hexToPackedInt(param.defaultValue),
                    };
                  }
                  // Regular number param
                  return {
                    paramName: param.name,
                    paramValue:
                      typeof param.defaultValue === 'number'
                        ? param.defaultValue
                        : 0,
                  };
                },
              ) || []) as { paramName: string; paramValue: number }[],
            },
          ];
        } else {
          newShadersConfig = (input.shaders || []).map((shader) =>
            shader.shaderId === shaderId
              ? { ...shader, enabled: !shader.enabled }
              : shader,
          );
        }
        await updateInput(roomId, input.inputId, {
          shaders: newShadersConfig,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setShaderLoading(null);
      }
    },
    [roomId, input, refreshState],
  );

  const handleSliderChange = useCallback(
    (shaderId: string, paramName: string, newValue: number) => {
      const key = `${shaderId}:${paramName}`;
      setSliderValues((prev) => ({
        ...prev,
        [key]: newValue,
      }));

      if (sliderTimers.current[key]) {
        clearTimeout(sliderTimers.current[key] as number);
      }

      sliderTimers.current[key] = setTimeout(async () => {
        setParamLoading((prev) => ({ ...prev, [shaderId]: paramName }));
        try {
          await handleParamChange(shaderId, paramName, newValue);
        } finally {
          setParamLoading((prev) => ({ ...prev, [shaderId]: null }));
          setSliderValues((prev) => {
            const newVals = { ...prev };
            delete newVals[key];
            return newVals;
          });
        }
      }, 500);
    },
    [roomId, input, refreshState],
  );

  const handleParamChange = useCallback(
    async (shaderId: string, paramName: string, newValue: number) => {
      if (!input.shaders) return;
      const key = `${shaderId}:${paramName}`;
      const now = Date.now();
      const last = lastParamChangeRef.current[key] || 0;
      const elapsed = now - last;
      const wait = elapsed < 5 ? 5 - elapsed : 0;
      try {
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
        lastParamChangeRef.current[key] = Date.now();
        const newShadersConfig = input.shaders.map((shader) => {
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
        await updateInput(roomId, input.inputId, {
          shaders: newShadersConfig,
          volume: input.volume,
        });
        await refreshState();
      } finally {
      }
    },
    [roomId, input, refreshState],
  );

  const getShaderParamConfig = useCallback(
    (shaderId: string, paramName: string) => {
      const shader = input.shaders?.find((s) => s.shaderId === shaderId);
      return shader?.params.find((p) => p.paramName === paramName);
    },
    [input.shaders],
  );

  const shaderPanelBase =
    'transition-all duration-1500 ease-in-out transform origin-top overflow-hidden';
  const shaderPanelShow = '';
  const shaderPanelHide = 'pointer-events-none  duration-1500';

  const ensureFxOpen = useCallback(() => {
    if (typeof isFxOpen === 'boolean') {
      if (!isFxOpen) {
        onToggleFx?.();
      }
    } else {
      setShowSliders(true);
    }
  }, [isFxOpen, onToggleFx]);

  const addShaderConfig = useCallback(
    async (shaderId: string) => {
      const shaderDef = availableShaders.find((s) => s.id === shaderId);
      if (!shaderDef) return;
      const already = input.shaders?.find((s) => s.shaderId === shaderId);
      const newConfig = already
        ? input.shaders?.map((s) =>
            s.shaderId === shaderId ? { ...s, enabled: true } : s,
          )
        : [
            ...(input.shaders || []),
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params:
                shaderDef.params?.map(
                  (param): { paramName: string; paramValue: number } => {
                    // Handle color params: convert hex string to packed integer
                    if (
                      param.type === 'color' &&
                      typeof param.defaultValue === 'string'
                    ) {
                      return {
                        paramName: param.name,
                        paramValue: hexToPackedInt(param.defaultValue),
                      };
                    }
                    // Regular number param
                    return {
                      paramName: param.name,
                      paramValue:
                        typeof param.defaultValue === 'number'
                          ? param.defaultValue
                          : 0,
                    };
                  },
                ) || [],
            },
          ];
      setShaderLoading(shaderId);
      try {
        await updateInput(roomId, input.inputId, {
          shaders: newConfig,
          volume: input.volume,
        });
        await refreshState();
        ensureFxOpen();
      } finally {
        setShaderLoading(null);
      }
    },
    [availableShaders, input, roomId, refreshState, ensureFxOpen],
  );

  const handleShaderRemove = useCallback(
    async (shaderId: string) => {
      const newConfig = (input.shaders || []).filter(
        (s) => s.shaderId !== shaderId,
      );
      setShaderLoading(shaderId);
      try {
        await updateInput(roomId, input.inputId, {
          shaders: newConfig,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setShaderLoading(null);
      }
    },
    [input, roomId, refreshState],
  );

  if (fxModeOnly && effectiveShowSliders) {
    return (
      <>
        <div
          aria-hidden={!effectiveShowSliders}
          onDragOver={handleShaderDragOver}
          onDrop={(e) =>
            handleShaderDrop({
              e,
              input,
              availableShaders,
              onShaderToggle: handleShaderToggle,
              onAddShader: addShaderConfig,
            })
          }>
          <ShaderPanel
            input={input}
            availableShaders={availableShaders}
            sliderValues={sliderValues}
            paramLoading={paramLoading}
            shaderLoading={shaderLoading}
            onShaderToggle={handleShaderToggle}
            onShaderRemove={handleShaderRemove}
            onSliderChange={handleSliderChange}
            getShaderParamConfig={getShaderParamConfig}
            onOpenAddShader={() => setIsAddShaderModalOpen(true)}
          />
        </div>

        <AddShaderModal
          isOpen={isAddShaderModalOpen}
          onClose={() => setIsAddShaderModalOpen(false)}
          availableShaders={availableShaders}
          addedShaderIds={addedShaderIds}
          onAddShader={addShaderConfig}
        />
      </>
    );
  }

  return (
    <>
      <div
        key={input.inputId}
        className={`group relative p-2 mb-2 last:mb-0 rounded-none bg-neutral-900 border-2 overflow-hidden ${
          isSelected
            ? 'border-blue-500 ring-2 ring-blue-500/30'
            : 'border-neutral-800'
        }`}>
        {typeof index === 'number' && (
          <div className='absolute top-2 right-2 pointer-events-none'>
            <span className='text-xs font-medium text-neutral-400'>
              {index + 1}
            </span>
          </div>
        )}
        {!isMobile && showGrip && (
          <div className='absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none'>
            <GripVertical className='w-5 h-5 text-neutral-500' />
          </div>
        )}
        <div className='flex items-center mb-3 md:pl-7'>
          <span
            className={`inline-block w-3 h-3 rounded-none mr-2 ${getSourceStateColor(input)}`}
            aria-label={getSourceStateLabel(input)}
          />
          <div className='text-s font-medium text-white truncate'>
            {input.title}
          </div>
          {isTextSaving && (
            <span className='ml-2 text-xs text-neutral-400'>Saving...</span>
          )}
        </div>
        {isTextInput && !readOnly && (
          <InputEntryTextSection
            textValue={textValue}
            textAlign={textAlign}
            textColor={textColor}
            textMaxLines={textMaxLines}
            textScrollSpeed={textScrollSpeed}
            textScrollLoop={textScrollLoop}
            textFontSize={textFontSize}
            onTextChange={handleTextChange}
            onTextAlignChange={handleTextAlignChange}
            onTextColorChange={handleTextColorChange}
            onTextMaxLinesChange={handleTextMaxLinesChange}
            onTextScrollSpeedChange={handleTextScrollSpeedChange}
            onTextScrollLoopChange={handleTextScrollLoopChange}
            onTextFontSizeChange={handleTextFontSizeChange}
          />
        )}
        {input.type === 'game' && !readOnly && (
          <div className='flex items-center gap-3 px-2 py-1'>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-neutral-400'>Gap</label>
              <input
                type='number'
                min={0}
                max={20}
                className='w-14 bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-0.5 rounded'
                value={input.gameCellGap ?? 1}
                onChange={(e) => {
                  void updateInput(roomId, input.inputId, {
                    gameCellGap: Math.max(0, Number(e.target.value) || 0),
                  });
                }}
              />
              <span className='text-xs text-neutral-500'>px</span>
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-neutral-400'>Border</label>
              <input
                type='number'
                min={0}
                max={20}
                className='w-14 bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-0.5 rounded'
                value={input.gameBoardBorderWidth ?? 4}
                onChange={(e) => {
                  void updateInput(roomId, input.inputId, {
                    gameBoardBorderWidth: Math.max(
                      0,
                      Number(e.target.value) || 0,
                    ),
                  });
                }}
              />
              <span className='text-xs text-neutral-500'>px</span>
            </div>
            <div className='flex items-center gap-1'>
              <input
                type='color'
                className='w-6 h-6 bg-transparent border-0 cursor-pointer'
                value={input.gameBoardBorderColor ?? '#ffffff'}
                onChange={(e) => {
                  void updateInput(roomId, input.inputId, {
                    gameBoardBorderColor: e.target.value,
                  });
                }}
              />
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-neutral-400'>Grid</label>
              <input
                type='color'
                className='w-6 h-6 bg-transparent border-0 cursor-pointer'
                value={input.gameGridLineColor ?? '#232323'}
                onChange={(e) => {
                  void updateInput(roomId, input.inputId, {
                    gameGridLineColor: e.target.value,
                  });
                }}
              />
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-neutral-400'>α</label>
              <input
                type='range'
                min={0}
                max={1}
                step={0.01}
                className='w-16'
                value={input.gameGridLineAlpha ?? 0.15}
                onChange={(e) => {
                  void updateInput(roomId, input.inputId, {
                    gameGridLineAlpha: Number(e.target.value),
                  });
                }}
              />
            </div>
          </div>
        )}
        {input.type === 'game' && !readOnly && (
          <SnakeEventShaderPanel
            roomId={roomId}
            inputId={input.inputId}
            config={input.snakeEventShaders}
            availableShaders={availableShaders}
            onUpdate={refreshState}
          />
        )}
        {!readOnly && (
          <div className='flex flex-row items-center min-w-0'>
            <div className='flex-1 flex md:pl-7 min-w-0'>
              <StatusButton
                input={input}
                loading={connectionStateLoading}
                showSliders={effectiveShowSliders}
                onClick={handleSlidersToggle}
              />
            </div>
            <div className='flex flex-row items-center justify-end flex-1 gap-0.5 pr-1'>
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className={`transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer ${
                  canMoveUp ? 'text-white hover:text-white' : 'text-neutral-500'
                }`}
                disabled={!canMoveUp}
                aria-label='Move up'
                onClick={() => {
                  try {
                    window.dispatchEvent(
                      new CustomEvent('smelter:inputs:move', {
                        detail: {
                          roomId,
                          inputId: input.inputId,
                          direction: 'up',
                        },
                      }),
                    );
                  } catch {}
                }}>
                <ChevronUp className='size-5' strokeWidth={3} />
              </Button>
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className={`transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer ${
                  canMoveDown
                    ? 'text-white hover:text-white'
                    : 'text-neutral-500'
                }`}
                disabled={!canMoveDown}
                aria-label='Move down'
                onClick={() => {
                  try {
                    window.dispatchEvent(
                      new CustomEvent('smelter:inputs:move', {
                        detail: {
                          roomId,
                          inputId: input.inputId,
                          direction: 'down',
                        },
                      }),
                    );
                  } catch {}
                }}>
                <ChevronDown className='size-5' strokeWidth={3} />
              </Button>
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
                onClick={handleOrientationToggle}
                aria-label={
                  isVerticalOrientation
                    ? 'Switch to horizontal'
                    : 'Switch to vertical'
                }
                title={
                  isVerticalOrientation
                    ? 'Vertical (click for horizontal)'
                    : 'Horizontal (click for vertical)'
                }>
                {isVerticalOrientation ? (
                  <RectangleVertical className='text-white size-5' />
                ) : (
                  <RectangleHorizontal className='text-neutral-400 size-5' />
                )}
              </Button>
              {isWhipInput && (
                <Button
                  data-no-dnd
                  size='sm'
                  variant='ghost'
                  className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
                  onClick={handleRotate90}
                  aria-label='Rotate 90°'
                  title='Rotate 90°'>
                  <RotateCw className='text-neutral-400 size-5' />
                </Button>
              )}
              <Button
                ref={attachBtnRef}
                data-no-dnd
                size='sm'
                variant='ghost'
                className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
                onClick={() => {
                  if (!showAttachMenu && attachBtnRef.current) {
                    const rect = attachBtnRef.current.getBoundingClientRect();
                    setAttachMenuPos({
                      top: rect.top,
                      left: rect.right,
                    });
                  }
                  setShowAttachMenu(!showAttachMenu);
                }}
                aria-label='Attach inputs'
                title='Attach inputs (render behind this input)'>
                <Link
                  className={`size-5 ${(input.attachedInputIds?.length ?? 0) > 0 ? 'text-blue-400' : 'text-neutral-400'}`}
                />
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
                      className='fixed bg-neutral-800 border border-neutral-700 rounded-lg shadow-lg p-2 z-[100] min-w-48'
                      style={{
                        top: attachMenuPos.top,
                        left: attachMenuPos.left,
                        transform: 'translate(-100%, -100%)',
                      }}>
                      <div className='text-xs text-neutral-400 mb-1 px-1'>
                        Attach inputs (render behind)
                      </div>
                      {(allInputs || [])
                        .filter((i) => i.inputId !== input.inputId)
                        .filter(
                          (i) =>
                            !isInputAttachedElsewhere(
                              i.inputId,
                              input.inputId,
                              allInputs || [],
                            ),
                        )
                        .map((i) => {
                          const isAttached = (
                            input.attachedInputIds || []
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
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
                onClick={handleVisibilityToggle}
                aria-label={
                  input.hidden ? 'Show in program' : 'Hide from program'
                }
                title={input.hidden ? 'Show in program' : 'Hide from program'}>
                {input.hidden ? (
                  <EyeOff className='text-neutral-400 size-5' />
                ) : (
                  <Eye className='text-white size-5' />
                )}
              </Button>
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
                onClick={handleShowTitleToggle}
                aria-label={showTitle ? 'Hide title' : 'Show title'}>
                <span className='relative inline-flex items-center justify-center'>
                  <Type
                    className={`${showTitle ? 'text-white' : 'text-neutral-400'} size-5`}
                  />
                  {!showTitle && (
                    <span className='absolute inset-0 flex items-center justify-center pointer-events-none'>
                      <svg
                        width='20'
                        height='20'
                        viewBox='0 0 20 20'
                        fill='none'
                        className='text-neutral-400'>
                        <line
                          x1='4'
                          y1='4'
                          x2='16'
                          y2='16'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                        />
                      </svg>
                    </span>
                  )}
                </span>
              </Button>
              <MuteButton
                muted={muted}
                disabled={input.sourceState === 'offline'}
                onClick={handleMuteToggle}
              />
              {canRemove && <DeleteButton onClick={handleDelete} />}
            </div>
          </div>
        )}
        {!readOnly && (
          <div
            className={
              shaderPanelBase +
              ' ' +
              (effectiveShowSliders ? shaderPanelShow : shaderPanelHide)
            }
            aria-hidden={!effectiveShowSliders}
            style={{
              maxHeight: effectiveShowSliders ? '500px' : 0,
              height: effectiveShowSliders ? '100%' : 0,
              transitionProperty: 'opacity, transform, height, max-height',
            }}
            onDragOver={handleShaderDragOver}
            onDrop={(e) =>
              handleShaderDrop({
                e,
                input,
                availableShaders,
                onShaderToggle: handleShaderToggle,
                onAddShader: addShaderConfig,
              })
            }>
            <ShaderPanel
              input={input}
              availableShaders={availableShaders}
              sliderValues={sliderValues}
              paramLoading={paramLoading}
              shaderLoading={shaderLoading}
              onShaderToggle={handleShaderToggle}
              onShaderRemove={handleShaderRemove}
              onSliderChange={handleSliderChange}
              getShaderParamConfig={getShaderParamConfig}
              onOpenAddShader={() => setIsAddShaderModalOpen(true)}
            />
          </div>
        )}
      </div>

      <AddShaderModal
        isOpen={isAddShaderModalOpen}
        onClose={() => setIsAddShaderModalOpen(false)}
        availableShaders={availableShaders}
        addedShaderIds={addedShaderIds}
        onAddShader={addShaderConfig}
      />
    </>
  );
}
