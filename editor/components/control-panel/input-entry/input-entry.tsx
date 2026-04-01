import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { AvailableShader, Input } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { GripVertical } from 'lucide-react';
import ShaderPanel from './shader-panel';
import SnakeEventShaderPanel from './snake-event-shader-panel';
import { DeleteButton } from './delete-button';
import { MissingAssetMp4Row } from './missing-asset-mp4-row';
import { AddShaderModal } from './add-shader-modal';

import { handleShaderDrop, handleShaderDragOver } from './shader-drop-handler';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  clearWhipSessionFor,
  loadLastWhipInputId,
  loadWhipSession,
} from '../whip-input/utils/whip-storage';
import { useIsMobile } from '@/hooks/use-mobile';
import { hexToPackedInt } from '@/lib/color-utils';
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

  readOnly?: boolean;
  activeBlockColor?: string;
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
  readOnly = false,
  activeBlockColor,
}: InputEntryProps) {
  const actions = useActions();
  const [showSliders, setShowSliders] = useState(false);
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const [isAddShaderModalOpen, setIsAddShaderModalOpen] = useState(false);
  const [gameGridAlphaDraft, setGameGridAlphaDraft] = useState<number | null>(
    null,
  );
  const gameGridAlphaTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameBorderColorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const gameGridColorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMobile = useIsMobile();

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
      if (gameGridAlphaTimerRef.current)
        clearTimeout(gameGridAlphaTimerRef.current);
      if (gameBorderColorTimerRef.current)
        clearTimeout(gameBorderColorTimerRef.current);
      if (gameGridColorTimerRef.current)
        clearTimeout(gameGridColorTimerRef.current);
    };
  }, []);

  const effectiveShowSliders =
    typeof isFxOpen === 'boolean' ? isFxOpen : showSliders;

  const addedShaderIds = useMemo(
    () => new Set((input.shaders || []).map((s) => s.shaderId)),
    [input.shaders],
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
        <div className='flex items-center min-h-7 gap-2'>
          {!isMobile && showGrip && (
            <div className='shrink-0 pointer-events-none'>
              <GripVertical className='w-5 h-5 text-muted-foreground' />
            </div>
          )}
          <span
            className='shrink-0 w-3 h-3 rounded-none mr-2'
            style={
              activeBlockColor
                ? { backgroundColor: activeBlockColor }
                : { border: '1px solid #6b7280' }
            }
          />
          <div className='min-w-0 flex-1 text-[12px] font-bold text-foreground truncate'>
            {input.title}
          </div>
          {!readOnly && canRemove && <DeleteButton onClick={handleDelete} />}
        </div>
        {((input.type === 'local-mp4' && input.mp4AssetMissing) ||
          (input.type === 'image' && input.imageAssetMissing)) &&
          !readOnly && (
            <MissingAssetMp4Row
              roomId={roomId}
              input={input}
              refreshState={refreshState}
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
                  const value = e.target.value;
                  if (gameBorderColorTimerRef.current) {
                    clearTimeout(gameBorderColorTimerRef.current);
                  }
                  gameBorderColorTimerRef.current = setTimeout(() => {
                    void actions.updateInput(roomId, input.inputId, {
                      gameBoardBorderColor: value,
                    });
                    gameBorderColorTimerRef.current = null;
                  }, SHADER_SETTINGS_DEBOUNCE_MS);
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
                  const value = e.target.value;
                  if (gameGridColorTimerRef.current) {
                    clearTimeout(gameGridColorTimerRef.current);
                  }
                  gameGridColorTimerRef.current = setTimeout(() => {
                    void actions.updateInput(roomId, input.inputId, {
                      gameGridLineColor: value,
                    });
                    gameGridColorTimerRef.current = null;
                  }, SHADER_SETTINGS_DEBOUNCE_MS);
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
                value={[gameGridAlphaDraft ?? input.gameGridLineAlpha ?? 1.0]}
                onValueChange={(v) => {
                  const value = v[0];
                  setGameGridAlphaDraft(value);
                  if (gameGridAlphaTimerRef.current) {
                    clearTimeout(gameGridAlphaTimerRef.current);
                  }
                  gameGridAlphaTimerRef.current = setTimeout(() => {
                    void actions
                      .updateInput(roomId, input.inputId, {
                        gameGridLineAlpha: value,
                      })
                      .finally(() => setGameGridAlphaDraft(null));
                    gameGridAlphaTimerRef.current = null;
                  }, SHADER_SETTINGS_DEBOUNCE_MS);
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
