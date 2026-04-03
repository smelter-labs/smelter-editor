import type { AvailableShader, Input, ShaderConfig } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import LoadingSpinner from '@/components/ui/spinner';
import {
  X as XIcon,
  Plus,
  Trash2,
  ArrowLeft,
  Save,
  FolderOpen,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  SaveShaderPresetModal,
  LoadShaderPresetModal,
} from '../components/ShaderPresetModals';
import { hexToPackedInt, packedIntToHex } from '@/lib/color-utils';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';

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
  onOpenAddShader: () => void;
  /** When set, clicking a shader name calls this instead of opening a dialog */
  onOpenShaderInline?: (shaderId: string) => void;
  onApplyPreset?: (shaders: ShaderConfig[], mode: 'replace' | 'append') => void;
  allowInlineValueEdit?: boolean;
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
  onOpenAddShader,
  onOpenShaderInline,
  onApplyPreset,
  allowInlineValueEdit,
}: ShaderPanelProps) {
  const [openShaderId, setOpenShaderId] = useState<string | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [loadPresetOpen, setLoadPresetOpen] = useState(false);

  const appliedShaders = input.shaders ?? [];
  const openShaderDef = openShaderId
    ? availableShaders.find((s) => s.id === openShaderId)
    : null;
  const openShaderConfig = openShaderId
    ? appliedShaders.find((s) => s.shaderId === openShaderId)
    : null;

  const handleShaderClick = (shaderId: string) => {
    if (onOpenShaderInline) {
      onOpenShaderInline(shaderId);
    } else {
      setOpenShaderId(shaderId);
    }
  };

  return (
    <div className='mt-1 cursor-default' data-no-dnd>
      {appliedShaders.length === 0 ? (
        <div className='text-xs text-neutral-500 py-1'>No shaders added.</div>
      ) : (
        <div className='flex flex-col gap-1'>
          {appliedShaders.map((shaderConfig) => {
            const def = availableShaders.find(
              (s) => s.id === shaderConfig.shaderId,
            );
            const name = def?.name ?? shaderConfig.shaderName;
            const hasParams = def?.params && def.params.length > 0;

            return (
              <div
                key={shaderConfig.shaderId}
                className='flex items-center gap-2 px-2 py-1.5 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors group'>
                <span
                  className={`shrink-0 w-2 h-2 rounded-full ${shaderConfig.enabled ? 'bg-green-500' : 'bg-neutral-600'}`}
                />
                <Button
                  variant='ghost'
                  className='flex-1 justify-start text-left text-white truncate h-auto px-0 py-0 cursor-pointer hover:underline font-normal'
                  onClick={() =>
                    hasParams && handleShaderClick(shaderConfig.shaderId)
                  }
                  title={hasParams ? 'Configure shader' : name}>
                  {name}
                </Button>
                {shaderLoading === shaderConfig.shaderId ? (
                  <LoadingSpinner size='sm' variant='spinner' />
                ) : (
                  <Switch
                    data-no-dnd
                    checked={shaderConfig.enabled}
                    onCheckedChange={() =>
                      onShaderToggle(shaderConfig.shaderId)
                    }
                    className='scale-75'
                  />
                )}
                <Button
                  data-no-dnd
                  size='sm'
                  variant='ghost'
                  className='h-6 w-6 p-0.5 cursor-pointer opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity'
                  aria-label='Remove shader'
                  onClick={() => onShaderRemove(shaderConfig.shaderId)}>
                  <XIcon className='text-neutral-400 size-3.5' />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className='flex items-center gap-1 mt-1.5'>
        <Button
          data-no-dnd
          size='sm'
          variant='ghost'
          className='h-7 px-2 text-xs text-neutral-400 hover:text-white cursor-pointer gap-1'
          onClick={onOpenAddShader}>
          <Plus className='size-3.5' />
          Add shader
        </Button>
        {onApplyPreset && (
          <>
            <Button
              data-no-dnd
              size='sm'
              variant='ghost'
              className='h-7 px-2 text-xs text-neutral-400 hover:text-white cursor-pointer gap-1'
              onClick={() => setLoadPresetOpen(true)}>
              <FolderOpen className='size-3.5' />
              Load preset
            </Button>
            {appliedShaders.length > 0 && (
              <Button
                data-no-dnd
                size='sm'
                variant='ghost'
                className='h-7 px-2 text-xs text-neutral-400 hover:text-white cursor-pointer gap-1'
                onClick={() => setSavePresetOpen(true)}>
                <Save className='size-3.5' />
                Save preset
              </Button>
            )}
          </>
        )}
      </div>

      {onApplyPreset && (
        <>
          <SaveShaderPresetModal
            open={savePresetOpen}
            onOpenChange={setSavePresetOpen}
            shaders={appliedShaders}
          />
          <LoadShaderPresetModal
            open={loadPresetOpen}
            onOpenChange={setLoadPresetOpen}
            onApply={onApplyPreset}
          />
        </>
      )}

      {/* Fallback dialog for non-inline mode */}
      {!onOpenShaderInline && (
        <Dialog
          open={!!openShaderId}
          onOpenChange={(open) => {
            if (!open) setOpenShaderId(null);
          }}>
          <DialogContent className='max-w-xl'>
            <DialogHeader>
              <DialogTitle>{openShaderDef?.name ?? 'Shader'}</DialogTitle>
              {openShaderDef?.description && (
                <DialogDescription>
                  {openShaderDef.description}
                </DialogDescription>
              )}
            </DialogHeader>

            {openShaderConfig && (
              <div className='flex items-center justify-between py-2 border-b border-neutral-800'>
                <span className='text-sm text-neutral-300'>Enabled</span>
                <Switch
                  data-no-dnd
                  checked={openShaderConfig.enabled}
                  onCheckedChange={() =>
                    onShaderToggle(openShaderConfig.shaderId)
                  }
                />
              </div>
            )}

            <div className='space-y-5 max-h-[60vh] overflow-auto py-2'>
              {(() => {
                if (
                  !openShaderDef?.params ||
                  openShaderDef.params.length === 0
                ) {
                  return (
                    <div className='text-sm text-neutral-500'>
                      No configurable parameters.
                    </div>
                  );
                }
                return openShaderDef.params.map((param) => {
                  const paramConfig = getShaderParamConfig(
                    openShaderDef.id,
                    param.name,
                  );
                  const key = `${openShaderDef.id}:${param.name}`;

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
                        loading={paramLoading[openShaderDef.id] === param.name}
                        onChange={(hexColor) => {
                          const packed = hexToPackedInt(hexColor);
                          onSliderChange(openShaderDef.id, param.name, packed);
                        }}
                      />
                    );
                  }

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
                      loading={paramLoading[openShaderDef.id] === param.name}
                      onChange={(value) =>
                        onSliderChange(openShaderDef.id, param.name, value)
                      }
                      allowInlineEdit={allowInlineValueEdit}
                    />
                  );
                });
              })()}
            </div>

            {openShaderConfig && (
              <div className='pt-3 border-t border-neutral-800'>
                <Button
                  data-no-dnd
                  size='sm'
                  variant='ghost'
                  className='h-8 px-3 text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer gap-1.5'
                  onClick={() => {
                    onShaderRemove(openShaderConfig.shaderId);
                    setOpenShaderId(null);
                  }}>
                  <Trash2 className='size-3.5' />
                  Remove shader
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export function InlineShaderParams({
  shaderId,
  availableShaders,
  shaders,
  sliderValues,
  paramLoading,
  onShaderToggle,
  onShaderRemove,
  onSliderChange,
  getShaderParamConfig,
  onBack,
  allowInlineValueEdit,
}: {
  shaderId: string;
  availableShaders: AvailableShader[];
  shaders: {
    shaderId: string;
    shaderName: string;
    enabled: boolean;
    params: { paramName: string; paramValue: number | string }[];
  }[];
  sliderValues: { [key: string]: number };
  paramLoading: { [shaderId: string]: string | null };
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
  onBack: () => void;
  allowInlineValueEdit?: boolean;
}) {
  const shaderDef = availableShaders.find((s) => s.id === shaderId);
  const shaderConfig = shaders.find((s) => s.shaderId === shaderId);

  if (!shaderDef || !shaderConfig) {
    onBack();
    return null;
  }

  return (
    <div data-no-dnd>
      <Button
        variant='ghost'
        className='h-auto px-0 py-0 gap-1.5 text-xs text-neutral-400 hover:text-white cursor-pointer mb-3 font-normal'
        onClick={onBack}>
        <ArrowLeft className='size-3.5' />
        Back to block properties
      </Button>

      <div className='text-sm text-white font-medium mb-1'>
        {shaderDef.name}
      </div>
      {shaderDef.description && (
        <div className='text-xs text-neutral-500 mb-3'>
          {shaderDef.description}
        </div>
      )}

      <div className='flex items-center justify-between py-2 border-b border-neutral-800 mb-3'>
        <span className='text-sm text-neutral-300'>Enabled</span>
        <Switch
          data-no-dnd
          checked={shaderConfig.enabled}
          onCheckedChange={() => onShaderToggle(shaderConfig.shaderId)}
        />
      </div>

      <div className='space-y-5 py-2'>
        {!shaderDef.params || shaderDef.params.length === 0 ? (
          <div className='text-sm text-neutral-500'>
            No configurable parameters.
          </div>
        ) : (
          shaderDef.params.map((param) => {
            const paramConfig = getShaderParamConfig(shaderDef.id, param.name);
            const key = `${shaderDef.id}:${param.name}`;

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
                  loading={paramLoading[shaderDef.id] === param.name}
                  onChange={(hexColor) => {
                    const packed = hexToPackedInt(hexColor);
                    onSliderChange(shaderDef.id, param.name, packed);
                  }}
                />
              );
            }

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
                loading={paramLoading[shaderDef.id] === param.name}
                onChange={(value) =>
                  onSliderChange(shaderDef.id, param.name, value)
                }
                allowInlineEdit={allowInlineValueEdit}
              />
            );
          })
        )}
      </div>

      <div className='pt-3 border-t border-neutral-800'>
        <Button
          data-no-dnd
          size='sm'
          variant='ghost'
          className='h-8 px-3 text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer gap-1.5'
          onClick={() => {
            onShaderRemove(shaderConfig.shaderId);
            onBack();
          }}>
          <Trash2 className='size-3.5' />
          Remove shader
        </Button>
      </div>
    </div>
  );
}

function ShaderParamSlider({
  param,
  paramValue,
  onChange,
  allowInlineEdit,
}: {
  param: {
    name: string;
    minValue?: number;
    maxValue?: number;
    defaultValue?: number | string;
    step?: number;
  };
  paramValue: number;
  loading: boolean;
  onChange: (value: number) => void;
  allowInlineEdit?: boolean;
}) {
  const min = param?.minValue ?? 0;
  const max = param?.maxValue ?? 1;
  const step = param.step ?? (max - min) / 100;
  const decimals = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (Number.isNaN(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
  }, [draft, onChange, min, max]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(false);
      }
    },
    [commitEdit],
  );

  const startEditing = useCallback(() => {
    if (!allowInlineEdit) return;
    setDraft(paramValue.toFixed(decimals));
    setEditing(true);
  }, [allowInlineEdit, paramValue, decimals]);

  return (
    <div data-no-dnd className='flex flex-col gap-2'>
      <label className='text-xs text-white font-semibold flex justify-between items-center mb-1'>
        <span className='uppercase tracking-wide'>{param.name}</span>
        {editing ? (
          <input
            ref={inputRef}
            data-no-dnd
            type='text'
            inputMode='decimal'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className='ml-2 w-16 text-right text-neutral-300 font-mono text-sm px-2 py-0.5 rounded bg-neutral-900 border border-neutral-600 outline-none focus:border-cyan'
          />
        ) : (
          <span
            data-no-dnd
            onClick={startEditing}
            className={`ml-2 text-neutral-300 font-mono text-sm px-2 py-0.5 rounded bg-neutral-900${allowInlineEdit ? ' cursor-pointer hover:border hover:border-neutral-600' : ''}`}>
            {typeof paramValue === 'number'
              ? paramValue.toFixed(decimals)
              : paramValue}
          </span>
        )}
      </label>
      <Slider
        data-no-dnd
        min={min}
        max={max}
        step={step}
        value={[paramValue]}
        onValueChange={(v) => onChange(v[0])}
        className='w-full'
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
    <div data-no-dnd className='flex flex-col gap-2'>
      <label className='text-xs text-white font-semibold flex justify-between items-center mb-1'>
        <span className='uppercase tracking-wide'>{param.name}</span>
        <div className='flex items-center gap-2'>
          {loading && <LoadingSpinner size='sm' variant='spinner' />}
          <span
            data-no-dnd
            className='text-neutral-300 font-mono text-sm px-2 py-0.5 rounded bg-neutral-900'>
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
          className='h-10 w-20 rounded border-2 border-neutral-700 bg-neutral-900 cursor-pointer'
          disabled={loading}
        />
        <ShadcnInput
          data-no-dnd
          type='text'
          value={colorValue}
          onChange={(e) => {
            const value = e.target.value;
            if (/^#[0-9A-Fa-f]{0,6}$/.test(value)) {
              onChange(value);
            }
          }}
          className='flex-1 px-2 py-1 text-sm font-mono text-white bg-neutral-900 border-2 border-neutral-700 rounded focus:outline-none focus:border-neutral-500'
          placeholder='#000000'
          disabled={loading}
        />
      </div>
    </div>
  );
}
