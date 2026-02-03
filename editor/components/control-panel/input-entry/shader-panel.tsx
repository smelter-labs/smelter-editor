import { AvailableShader, Input } from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import {
  X as XIcon,
  ToggleLeft,
  ToggleRight,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

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

interface ShaderPanelProps {
  input: Input;
  availableShaders: AvailableShader[];
  sliderValues: { [key: string]: number };
  paramLoading: { [shaderId: string]: string | null };
  shaderLoading: string | null;
  onShaderToggle: (shaderId: string) => void;
  onShaderRemove: (shaderId: string) => void;
  onSliderChange: (
    shaderId: string,
    paramName: string,
    newValue: number,
  ) => void;
  getShaderParamConfig: (
    shaderId: string,
    paramName: string,
  ) => { paramName: string; paramValue: number | string } | undefined;
  getShaderButtonClass: (enabled: boolean) => string;
  consolidated?: boolean;
}

export default function ShaderPanel({
  input,
  availableShaders,
  sliderValues,
  paramLoading,
  shaderLoading,
  onShaderToggle,
  onShaderRemove,
  onSliderChange,
  getShaderParamConfig,
  getShaderButtonClass,
  consolidated,
}: ShaderPanelProps) {
  const [openShaderId, setOpenShaderId] = useState<string | null>(null);

  if (consolidated) {
    return (
      <div
        className='mt-2 cursor-default'
        data-no-dnd
        data-tour='shader-params-container'>
        {availableShaders.map((shader) => {
          const enabled =
            input.shaders?.find((s) => s.shaderId === shader.id)?.enabled ??
            false;
          return (
            <div
              key={shader.id}
              className='mb-3 p-4 rounded-none border-2 transition-all duration-300 bg-neutral-900 border-neutral-800'>
              <div className='flex items-center justify-between'>
                <div className='text-base font-semibold text-white truncate'>
                  {shader.name}
                </div>
                <div className='flex items-center gap-2'>
                  {enabled ? (
                    <Button
                      data-no-dnd
                      size='sm'
                      variant='ghost'
                      className='h-8 w-8 p-2 rounded-none border-2 border-neutral-800 bg-neutral-900 hover:bg-neutral-800 cursor-pointer'
                      aria-label='Remove shader'
                      onClick={() => onShaderRemove(shader.id)}>
                      <Trash2 className='text-white size-5' />
                    </Button>
                  ) : (
                    <Button
                      data-no-dnd
                      size='sm'
                      variant='ghost'
                      className='h-8 px-3 rounded-none text-white border-2 border-neutral-800 bg-neutral-900 hover:bg-neutral-800 cursor-pointer'
                      aria-label='Enable shader'
                      onClick={() => onShaderToggle(shader.id)}>
                      Enable
                    </Button>
                  )}
                </div>
              </div>
              <div className='mt-2 text-xs text-white opacity-80'>
                {shader.description}
              </div>
              {enabled && shader.params && shader.params.length > 0 && (
                <div className='mt-3 space-y-5' data-no-dnd>
                  <div className='border-t border-neutral-800 -mx-4 px-4 pt-3' />
                  {shader.params.map((param) => {
                    const paramConfig = getShaderParamConfig(
                      shader.id,
                      param.name,
                    );
                    const key = `${shader.id}:${param.name}`;

                    // Handle color params
                    if (param.type === 'color') {
                      const rawValue =
                        key in sliderValues
                          ? sliderValues[key]
                          : (paramConfig?.paramValue ??
                            (typeof param.defaultValue === 'string'
                              ? hexToPackedInt(param.defaultValue)
                              : 0));
                      const colorValue =
                        typeof rawValue === 'string'
                          ? hexToPackedInt(rawValue)
                          : rawValue;
                      const hexValue = packedIntToHex(colorValue);

                      return (
                        <ShaderParamColorPicker
                          key={param.name}
                          param={param}
                          colorValue={hexValue}
                          loading={paramLoading[shader.id] === param.name}
                          onChange={(hexColor) => {
                            const packed = hexToPackedInt(hexColor);
                            onSliderChange(shader.id, param.name, packed);
                          }}
                        />
                      );
                    }

                    // Regular number param
                    const rawParamValue =
                      key in sliderValues
                        ? sliderValues[key]
                        : (paramConfig?.paramValue ??
                          (typeof param.defaultValue === 'number'
                            ? param.defaultValue
                            : 0));
                    const paramValue =
                      typeof rawParamValue === 'number' ? rawParamValue : 0;
                    return (
                      <ShaderParamSlider
                        key={param.name}
                        param={param}
                        paramValue={paramValue}
                        loading={paramLoading[shader.id] === param.name}
                        onChange={(value) =>
                          onSliderChange(shader.id, param.name, value)
                        }
                        sliderClass={
                          'w-full h-2 rounded-none bg-neutral-700 outline-none transition-all duration-300 ' +
                          'appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-500'
                        }
                        accentColor='#a0a0a0'
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className='mt-2 cursor-default' data-no-dnd>
      {availableShaders.map((shader) => {
        const enabled =
          input.shaders?.find((s) => s.shaderId === shader.id)?.enabled ??
          false;
        return (
          <div
            key={shader.name}
            className={`mb-3 p-4 rounded-none border transition-all duration-500
              ${
                enabled
                  ? 'bg-neutral-900 border-neutral-600'
                  : 'bg-neutral-800 border-neutral-700'
              }
            `}>
            <div className='flex items-center justify-between mb-2'>
              <div>
                <h3 className='font-semibold text-white text-lg'>
                  {shader.name}
                </h3>
                <p className='text-xs text-white opacity-80'>
                  {shader.description}
                </p>
              </div>
              <div className='flex items-center gap-2'>
                {shader.params && shader.params.length > 0 && (
                  <Button
                    data-no-dnd
                    size='sm'
                    variant='ghost'
                    className='transition-all duration-300 ease-in-out h-8 w-8 p-2 cursor-pointer'
                    aria-label='Configure shader'
                    onClick={() => setOpenShaderId(shader.id)}>
                    <SlidersHorizontal className='text-neutral-400 size-5' />
                  </Button>
                )}
                <Button
                  data-no-dnd
                  size='sm'
                  variant='ghost'
                  className='transition-all duration-300 ease-in-out h-8 w-8 p-2 cursor-pointer'
                  aria-label={enabled ? 'Disable shader' : 'Enable shader'}
                  disabled={shaderLoading === shader.id}
                  onClick={() => onShaderToggle(shader.id)}>
                  {shaderLoading === shader.id ? (
                    <LoadingSpinner size='sm' variant='spinner' />
                  ) : enabled ? (
                    <ToggleRight className='text-white size-5' />
                  ) : (
                    <ToggleLeft className='text-neutral-400 size-5' />
                  )}
                </Button>
                <Button
                  data-no-dnd
                  size='sm'
                  variant='ghost'
                  className='transition-all duration-300 ease-in-out h-8 w-8 p-2 cursor-pointer'
                  aria-label='Remove shader'
                  onClick={() => onShaderRemove(shader.id)}>
                  <XIcon className='text-neutral-400 size-5' />
                </Button>
              </div>
            </div>
            {/* Sliders moved to modal */}
          </div>
        );
      })}

      {openShaderId && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center'
          data-no-dnd
          onClick={() => setOpenShaderId(null)}>
          <div className='absolute inset-0 bg-black/60' />
          <div
            className='relative z-10 w-full max-w-xl mx-4 rounded-none border border-neutral-700 bg-[#0a0a0a]'
            onClick={(e) => e.stopPropagation()}>
            <div className='flex items-center justify-between p-4 border-b border-neutral-800'>
              <div className='text-white font-medium'>
                {availableShaders.find((s) => s.id === openShaderId)?.name ||
                  'Shader configuration'}
              </div>
              <button
                className='h-8 w-8 p-2 text-neutral-400 hover:text-white'
                onClick={() => setOpenShaderId(null)}
                aria-label='Close modal'>
                <XIcon className='size-4' />
              </button>
            </div>
            <div
              className='max-h-[70vh] overflow-auto p-4 space-y-5'
              data-tour='shader-params-container'>
              {(() => {
                const shader = availableShaders.find(
                  (s) => s.id === openShaderId,
                );
                if (!shader || !shader.params || shader.params.length === 0) {
                  return (
                    <div className='text-sm text-neutral-400'>
                      No configurable parameters for this shader.
                    </div>
                  );
                }
                return shader.params.map((param) => {
                  const paramConfig = getShaderParamConfig(
                    shader.id,
                    param.name,
                  );
                  const key = `${shader.id}:${param.name}`;

                  // Handle color params
                  if (param.type === 'color') {
                    const rawColorValue =
                      key in sliderValues
                        ? sliderValues[key]
                        : (paramConfig?.paramValue ??
                          (typeof param.defaultValue === 'string'
                            ? hexToPackedInt(param.defaultValue)
                            : 0));
                    const colorValue =
                      typeof rawColorValue === 'string'
                        ? hexToPackedInt(rawColorValue)
                        : rawColorValue;
                    const hexValue = packedIntToHex(colorValue);

                    return (
                      <ShaderParamColorPicker
                        key={param.name}
                        param={param}
                        colorValue={hexValue}
                        loading={paramLoading[shader.id] === param.name}
                        onChange={(hexColor) => {
                          const packed = hexToPackedInt(hexColor);
                          onSliderChange(shader.id, param.name, packed);
                        }}
                      />
                    );
                  }

                  // Regular number param
                  const rawParamValue =
                    key in sliderValues
                      ? sliderValues[key]
                      : (paramConfig?.paramValue ??
                        (typeof param.defaultValue === 'number'
                          ? param.defaultValue
                          : 0));
                  const paramValue =
                    typeof rawParamValue === 'number' ? rawParamValue : 0;
                  return (
                    <ShaderParamSlider
                      key={param.name}
                      param={param}
                      paramValue={paramValue}
                      loading={paramLoading[shader.id] === param.name}
                      onChange={(value) =>
                        onSliderChange(shader.id, param.name, value)
                      }
                      sliderClass={
                        'w-full h-2 rounded-none bg-neutral-700 outline-none transition-all duration-300 ' +
                        'appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-500'
                      }
                    />
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShaderParamSlider({
  param,
  paramValue,
  onChange,
  sliderClass,
  accentColor,
}: {
  param: {
    name: string;
    minValue?: number;
    maxValue?: number;
    defaultValue?: number | string;
  };
  paramValue: number;
  loading: boolean;
  onChange: (value: number) => void;
  sliderClass: string;
  accentColor?: string;
}) {
  const min = param?.minValue ?? 0;
  const max = param?.maxValue ?? 1;
  const step = (max - min) / 100;

  return (
    <div data-no-dnd className='flex flex-col gap-2' key={param.name}>
      <label className='text-xs text-white font-semibold flex justify-between items-center mb-1'>
        <span className='uppercase tracking-wide'>{param.name}</span>
        <span
          data-no-dnd
          className='ml-2 text-neutral-300 font-mono text-sm px-2 py-0.5 rounded-none bg-neutral-900'>
          {typeof paramValue === 'number' ? paramValue.toFixed(2) : paramValue}
        </span>
      </label>
      <input
        data-no-dnd
        type='range'
        min={min}
        max={max}
        step={step}
        value={paramValue}
        onChange={(e) => onChange(Number(e.target.value))}
        className={sliderClass}
        style={{ accentColor: accentColor ?? '#a0a0a0' }}
      />
    </div>
  );
}

function ShaderParamColorPicker({
  param,
  colorValue,
  onChange,
  loading,
}: {
  param: {
    name: string;
    type?: string;
  };
  colorValue: string;
  loading: boolean;
  onChange: (hexColor: string) => void;
}) {
  return (
    <div data-no-dnd className='flex flex-col gap-2' key={param.name}>
      <label className='text-xs text-white font-semibold flex justify-between items-center mb-1'>
        <span className='uppercase tracking-wide'>{param.name}</span>
        <div className='flex items-center gap-2'>
          {loading && <LoadingSpinner size='sm' variant='spinner' />}
          <span
            data-no-dnd
            className='text-neutral-300 font-mono text-sm px-2 py-0.5 rounded-none bg-neutral-900'>
            {colorValue.toUpperCase()}
          </span>
        </div>
      </label>
      <div className='flex items-center gap-2'>
        <input
          data-no-dnd
          type='color'
          value={colorValue}
          onChange={(e) => onChange(e.target.value)}
          className='h-10 w-20 rounded-none border-2 border-neutral-700 bg-neutral-900 cursor-pointer'
          disabled={loading}
        />
        <input
          data-no-dnd
          type='text'
          value={colorValue}
          onChange={(e) => {
            const value = e.target.value;
            // Validate hex color format
            if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
              onChange(value);
            }
          }}
          className='flex-1 px-2 py-1 text-sm font-mono text-white bg-neutral-900 border-2 border-neutral-700 rounded-none focus:outline-none focus:border-neutral-500'
          placeholder='#000000'
          disabled={loading}
        />
      </div>
    </div>
  );
}
