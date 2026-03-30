import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { AvailableShader, Input } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { GripVertical } from 'lucide-react';
import ShaderPanel from './shader-panel';
import SnakeEventShaderPanel from './snake-event-shader-panel';
import { InputEntryTextSection } from './input-entry-text-section';
import { DeleteButton } from './delete-button';
import { AddShaderModal } from './add-shader-modal';
import { getSourceStateColor, getSourceStateLabel } from './utils';
import { handleShaderDrop, handleShaderDragOver } from './shader-drop-handler';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  clearWhipSessionFor,
  loadLastWhipInputId,
  loadWhipSession,
} from '../whip-input/utils/whip-storage';
import { useIsMobile } from '@/hooks/use-mobile';
import { hexToPackedInt } from '@/lib/color-utils';
import { Input as ShadcnInput } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Slider } from '@/components/ui/slider';

const SHADER_SETTINGS_DEBOUNCE_MS = 200;
interface InputEntryProps {
  roomId: string;
  input: Input;
  refreshState: () => Promise<void>;
  availableShaders?: AvailableShader[];
  canRemove?: boolean;
  pcRef?: React.MutableRefObject<RTCPeerConnection | null>;
  streamRef?: React.MutableRefObject<MediaStream | null>;
  onWhipDisconnectedOrRemoved?: (inputId: string) => void;
  isFxOpen?: boolean;
  onToggleFx?: () => void;
  fxModeOnly?: boolean;
  showGrip?: boolean;
  isSelected?: boolean;
  index?: number;
  readOnly?: boolean;
}

export default function InputEntry({
  roomId,
  input,
  refreshState,
  availableShaders = [],
  canRemove = true,
  pcRef,
  streamRef,
  onWhipDisconnectedOrRemoved,
  isFxOpen,
  onToggleFx,
  fxModeOnly,
  showGrip = true,
  isSelected = false,
  index,
  readOnly = false,
}: InputEntryProps) {
  const actions = useActions();
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
    input.textScrollSpeed ?? 80,
  );
  const [textScrollLoop, setTextScrollLoop] = useState<boolean>(
    input.textScrollLoop ?? true,
  );
  const [textFontSize, setTextFontSize] = useState<number>(
    input.textFontSize ?? 80,
  );
  const [isTextSaving, setIsTextSaving] = useState(false);
  const textSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMobile = useIsMobile();

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

  useEffect(() => {
    return () => {
      Object.values(sliderTimers.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer as number);
        }
      });
    };
  }, []);

  const effectiveShowSliders =
    typeof isFxOpen === 'boolean' ? isFxOpen : showSliders;

  const addedShaderIds = useMemo(
    () => new Set((input.shaders || []).map((s) => s.shaderId)),
    [input.shaders],
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
          await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
      await actions.hideInput(roomId, input.inputId);
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

    await actions.removeInput(roomId, input.inputId);
    await refreshState();
  }, [
    roomId,
    input,
    refreshState,
    pcRef,
    streamRef,
    onWhipDisconnectedOrRemoved,
  ]);

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
        await actions.updateInput(roomId, input.inputId, {
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
          const hasParam = shader.params.some((p) => p.paramName === paramName);
          const updatedParams = hasParam
            ? shader.params.map((param) =>
                param.paramName === paramName
                  ? { ...param, paramValue: newValue }
                  : param,
              )
            : [...shader.params, { paramName, paramValue: newValue }];
          return { ...shader, params: updatedParams };
        });
        await actions.updateInput(roomId, input.inputId, {
          shaders: newShadersConfig,
          volume: input.volume,
        });
      } finally {
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
      }, SHADER_SETTINGS_DEBOUNCE_MS);
    },
    [handleParamChange],
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
        await actions.updateInput(roomId, input.inputId, {
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
        await actions.updateInput(roomId, input.inputId, {
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
        className={`group relative p-2 mb-2 last:mb-0 rounded-none bg-background border-2 overflow-hidden ${
          isSelected
            ? 'border-blue-500 ring-2 ring-blue-500/30'
            : 'border-border'
        }`}>
        {!isMobile && showGrip && (
          <div className='absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none'>
            <GripVertical className='w-5 h-5 text-muted-foreground' />
          </div>
        )}
        <div className='flex items-center min-h-7 md:pl-7'>
          <span
            className={`shrink-0 w-3 h-3 rounded-none mr-2 ${getSourceStateColor(input)}`}
            aria-label={getSourceStateLabel(input)}
          />
          <div className='text-[12px] font-bold text-foreground truncate'>
            {input.title}
          </div>
          {isTextSaving && (
            <span className='ml-2 text-xs text-muted-foreground'>
              Saving...
            </span>
          )}
          {typeof index === 'number' && (
            <span className='ml-auto mr-2 text-xs font-medium text-muted-foreground'>
              {index + 1}
            </span>
          )}
          {!readOnly && canRemove && <DeleteButton onClick={handleDelete} />}
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
              <label className='text-xs text-muted-foreground'>Gap</label>
              <NumberInput
                min={0}
                max={20}
                className='w-16 bg-card border border-border text-foreground text-xs px-2 py-0.5'
                value={input.gameCellGap ?? 1}
                onChange={(e) => {
                  void actions.updateInput(roomId, input.inputId, {
                    gameCellGap: Math.max(0, Number(e.target.value) || 0),
                  });
                }}
              />
              <span className='text-xs text-muted-foreground'>px</span>
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-muted-foreground'>Border</label>
              <NumberInput
                min={0}
                max={20}
                className='w-16 bg-card border border-border text-foreground text-xs px-2 py-0.5'
                value={input.gameBoardBorderWidth ?? 4}
                onChange={(e) => {
                  void actions.updateInput(roomId, input.inputId, {
                    gameBoardBorderWidth: Math.max(
                      0,
                      Number(e.target.value) || 0,
                    ),
                  });
                }}
              />
              <span className='text-xs text-muted-foreground'>px</span>
            </div>
            <div className='flex items-center gap-1'>
              <input
                type='color'
                className='w-6 h-6 bg-transparent border-0 cursor-pointer'
                value={input.gameBoardBorderColor ?? '#ffffff'}
                onChange={(e) => {
                  void actions.updateInput(roomId, input.inputId, {
                    gameBoardBorderColor: e.target.value,
                  });
                }}
              />
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-muted-foreground'>Grid</label>
              <input
                type='color'
                className='w-6 h-6 bg-transparent border-0 cursor-pointer'
                value={input.gameGridLineColor ?? '#000000'}
                onChange={(e) => {
                  void actions.updateInput(roomId, input.inputId, {
                    gameGridLineColor: e.target.value,
                  });
                }}
              />
            </div>
            <div className='flex items-center gap-1'>
              <label className='text-xs text-muted-foreground'>α</label>
              <Slider
                min={0}
                max={1}
                step={0.01}
                className='w-16'
                value={[input.gameGridLineAlpha ?? 1.0]}
                onValueChange={(v) => {
                  void actions.updateInput(roomId, input.inputId, {
                    gameGridLineAlpha: v[0],
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
