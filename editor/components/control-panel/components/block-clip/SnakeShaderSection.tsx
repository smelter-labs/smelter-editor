'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Input, AvailableShader, ShaderConfig } from '@/lib/types';
import ShaderPanel from '../../input-entry/shader-panel';
import { AddShaderModal } from '../../input-entry/add-shader-modal';
import { getRandomSnakeShaderPreset } from '@/lib/snake-shader-presets';
import { Button } from '@/components/ui/button';
import { Dices } from 'lucide-react';
import { toast } from 'sonner';

const SHADER_SETTINGS_DEBOUNCE_MS = 200;

export function SnakeShaderSection({
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
    toast.info(`🎲 ${preset.name}`, { duration: 1500 });
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
    showTitle: true,
    type: 'local-mp4',
    sourceState: 'unknown',
    status: 'connected',
    shaders,
  };

  return (
    <div className='mt-2 border-t border-border pt-2'>
      <div className='flex items-center justify-between mb-1'>
        <span className='text-xs text-muted-foreground'>{label}</span>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          title='Random shader preset'
          onClick={handleRandomPreset}
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'>
          <Dices className='size-3.5' />
        </Button>
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
