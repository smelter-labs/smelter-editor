import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  AvailableShader,
  connectInput,
  disconnectInput,
  Input,
  removeInput,
  updateInput,
} from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import { Type, ChevronUp, ChevronDown, GripVertical, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import ShaderPanel from './shader-panel';
import { StatusButton } from './status-button';
import { MuteButton } from './mute-button';
import { DeleteButton } from './delete-button';
import { AddShaderModal } from './add-shader-modal';
import {
  getSourceStateColor,
  getSourceStateLabel,
  getShaderButtonClass,
} from './utils';
import { handleShaderDrop, handleShaderDragOver } from './shader-drop-handler';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  clearWhipSessionFor,
  loadLastWhipInputId,
  loadWhipSession,
} from '../whip-input/utils/whip-storage';
import { useDriverTourControls } from '@/components/tour/DriverTourContext';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * Converts a hex color string to a packed integer (0xRRGGBB)
 */
function hexToPackedInt(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(char => char + char).join('')
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
}: InputEntryProps) {
  const [connectionStateLoading, setConnectionStateLoading] = useState(false);
  const [showSliders, setShowSliders] = useState(false);
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});
  const [isAddShaderModalOpen, setIsAddShaderModalOpen] = useState(false);
  const [textValue, setTextValue] = useState(input.text || '');
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(input.textAlign || 'left');
  const [textColor, setTextColor] = useState<string>(input.textColor || '#ffffff');
  const [isTextSaving, setIsTextSaving] = useState(false);
  const textSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMobile = useIsMobile();
  const muted = input.volume === 0;
  const showTitle = input.showTitle !== false;

  const isWhipInput = input.type === 'whip';
  const isTextInput = input.type === 'text-input';

  const [isComposingTourActive, setIsComposingTourActive] = useState(false);
  useEffect(() => {
    const onStart = (e: any) => {
      try {
        if (e?.detail?.id === 'composing') setIsComposingTourActive(true);
      } catch {}
    };
    const onStop = (e: any) => {
      try {
        if (e?.detail?.id === 'composing') setIsComposingTourActive(false);
      } catch {}
    };
    window.addEventListener('smelter:tour:start', onStart);
    window.addEventListener('smelter:tour:stop', onStop);
    return () => {
      window.removeEventListener('smelter:tour:start', onStart);
      window.removeEventListener('smelter:tour:stop', onStop);
    };
  }, []);

  useEffect(() => {
    if (input.textColor !== undefined) {
      setTextColor(input.textColor);
    }
  }, [input.textColor]);

  const lastParamChangeRef = useRef<{ [key: string]: number }>({});
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const sliderTimers = useRef<{
    [key: string]: NodeJS.Timeout | number | null;
  }>({});

  const effectiveShowSliders =
    typeof isFxOpen === 'boolean' ? isFxOpen : showSliders;

  const visibleShaders = useMemo(
    () =>
      availableShaders.filter((availableShader) =>
        (input.shaders || []).some((s) => s.shaderId === availableShader.id),
      ),
    [availableShaders, input.shaders],
  );

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

  const handleDelete = useCallback(async () => {
    const session = loadWhipSession();
    const isSavedInSession =
      (session &&
        session.roomId === roomId &&
        session.inputId === input.inputId) ||
      loadLastWhipInputId(roomId) === input.inputId;
    const isWhipCandidate =
      input.inputId.indexOf('whip') > 0 || isSavedInSession;
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

  const { nextIf: shadersTourNextIf } = useDriverTourControls('shaders');

  const handleSlidersToggle = useCallback(() => {
    setTimeout(() => shadersTourNextIf(0), 50);
    if (onToggleFx) {
      onToggleFx();
    } else {
      setShowSliders((prev) => !prev);
    }
  }, [shadersTourNextIf, onToggleFx]);

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
              params: (
                shaderDef.params?.map((param): { paramName: string; paramValue: number } => {
                  // Handle color params: convert hex string to packed integer
                  if (param.type === 'color' && typeof param.defaultValue === 'string') {
                    return {
                      paramName: param.name,
                      paramValue: hexToPackedInt(param.defaultValue),
                    };
                  }
                  // Regular number param
                  return {
                    paramName: param.name,
                    paramValue: (typeof param.defaultValue === 'number' ? param.defaultValue : 0),
                  };
                }) || []
              ) as { paramName: string; paramValue: number }[],
            },
          ];
        } else {
          newShadersConfig = (input.shaders || []).map((shader) =>
            shader.shaderId === shaderId
              ? { ...shader, enabled: !shader.enabled }
              : shader,
          );
        }
        setTimeout(() => shadersTourNextIf(1), 500);
        await updateInput(roomId, input.inputId, {
          shaders: newShadersConfig,
          volume: input.volume,
        });
        await refreshState();
      } finally {
        setShaderLoading(null);
      }
    },
    [roomId, input, refreshState, shadersTourNextIf],
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
                shaderDef.params?.map((param): { paramName: string; paramValue: number } => {
                  // Handle color params: convert hex string to packed integer
                  if (param.type === 'color' && typeof param.defaultValue === 'string') {
                    return {
                      paramName: param.name,
                      paramValue: hexToPackedInt(param.defaultValue),
                    };
                  }
                  // Regular number param
                  return {
                    paramName: param.name,
                    paramValue: (typeof param.defaultValue === 'number' ? param.defaultValue : 0),
                  };
                }) || [],
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
    const shadersForPanel = availableShaders;
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
            availableShaders={shadersForPanel}
            sliderValues={sliderValues}
            paramLoading={paramLoading}
            shaderLoading={shaderLoading}
            onShaderToggle={handleShaderToggle}
            onShaderRemove={handleShaderRemove}
            onSliderChange={handleSliderChange}
            getShaderParamConfig={getShaderParamConfig}
            getShaderButtonClass={getShaderButtonClass}
            consolidated={true}
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
        className='group relative p-2 mb-2 last:mb-0 rounded-none bg-neutral-900 border-2 border-neutral-800 overflow-hidden'>
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
        {isTextInput && (
          <div className='mb-3 md:pl-7'>
            <textarea
              data-no-dnd
              value={textValue}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder='Enter text to display...'
              className='w-full p-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm resize-none min-h-[60px] focus:outline-none focus:border-neutral-500'
            />
            <div className='flex items-center gap-4 mt-2'>
              <div className='flex items-center gap-2'>
                <span className='text-xs text-neutral-400'>Align:</span>
                <div className='flex gap-1'>
                  {([
                    { value: 'left' as const, icon: <AlignLeft className='w-3 h-3' /> },
                    { value: 'center' as const, icon: <AlignCenter className='w-3 h-3' /> },
                    { value: 'right' as const, icon: <AlignRight className='w-3 h-3' /> },
                  ]).map((option) => (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => handleTextAlignChange(option.value)}
                      className={`p-1.5 rounded transition-colors cursor-pointer ${
                        textAlign === option.value
                          ? 'bg-white text-black'
                          : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                      }`}
                    >
                      {option.icon}
                    </button>
                  ))}
                </div>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-xs text-neutral-400'>Color:</span>
                <input
                  type='color'
                  value={textColor}
                  onChange={(e) => handleTextColorChange(e.target.value)}
                  className='w-8 h-8 rounded cursor-pointer bg-neutral-800 border border-neutral-700'
                  style={{ cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>
        )}
        <div className='flex flex-row items-center min-w-0'>
          <div className='flex-1 flex md:pl-7 min-w-0'>
            {(() => {
              const installedCountForHide = (input.shaders || []).length;
              const hideAddEffectsButton =
                isComposingTourActive &&
                !effectiveShowSliders &&
                installedCountForHide === 0;
              if (hideAddEffectsButton) return null;
              return (
                <StatusButton
                  input={input}
                  loading={connectionStateLoading}
                  showSliders={effectiveShowSliders}
                  onClick={handleSlidersToggle}
                />
              );
            })()}
          </div>
          <div className='flex flex-row items-center justify-end flex-1 gap-0.5 pr-1'>
            <Button
              data-no-dnd
              size='sm'
              variant='ghost'
              className={`transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer ${
                canMoveUp
                  ? 'text-white hover:text-white'
                  : 'text-neutral-500'
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
          {(() => {
            const shadersForPanel = effectiveShowSliders
              ? availableShaders
              : visibleShaders;
            return (
              <ShaderPanel
                input={input}
                availableShaders={shadersForPanel}
                sliderValues={sliderValues}
                paramLoading={paramLoading}
                shaderLoading={shaderLoading}
                onShaderToggle={handleShaderToggle}
                onShaderRemove={handleShaderRemove}
                onSliderChange={handleSliderChange}
                getShaderParamConfig={getShaderParamConfig}
                getShaderButtonClass={getShaderButtonClass}
                consolidated={effectiveShowSliders}
              />
            );
          })()}
        </div>
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
