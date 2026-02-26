'use client';

import { useState, useRef, useCallback } from 'react';
import {
  SnakeEventType,
  SnakeEventShaderConfig,
  SnakeEventShaderMapping,
  SnakeEventApplicationMode,
  AvailableShader,
  ShaderParamConfig,
  updateInput,
} from '@/app/actions/actions';
import { SNAKE_EVENT_TYPES } from '@/lib/snake-events';
import { ChevronDown, ChevronRight } from 'lucide-react';

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

function packedIntToHex(packed: number): string {
  const r = ((packed >> 16) & 0xff).toString(16).padStart(2, '0');
  const g = ((packed >> 8) & 0xff).toString(16).padStart(2, '0');
  const b = (packed & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

const DEFAULT_EFFECT_TYPES: Record<
  SnakeEventType,
  { shaderId: string; effectType: number }
> = {
  speed_up: { shaderId: 'snake-event-highlight', effectType: 3 },
  cut_opponent: { shaderId: 'snake-event-highlight', effectType: 7 },
  got_cut: { shaderId: 'snake-event-highlight', effectType: 2 },
  cut_self: { shaderId: 'snake-event-highlight', effectType: 6 },
  eat_block: { shaderId: 'snake-event-highlight', effectType: 1 },
  bounce_block: { shaderId: 'snake-event-highlight', effectType: 5 },
  no_moves: { shaderId: 'snake-event-highlight', effectType: 8 },
  game_over: { shaderId: 'snake-event-highlight', effectType: 6 },
};

const DEFAULT_EFFECT_DURATION_MS = 600;

interface SnakeEventShaderPanelProps {
  roomId: string;
  inputId: string;
  config: SnakeEventShaderConfig | undefined;
  availableShaders: AvailableShader[];
  onUpdate: () => Promise<void>;
  onConfigChange?: (updated: SnakeEventShaderConfig) => void;
}

export default function SnakeEventShaderPanel({
  roomId,
  inputId,
  config,
  availableShaders,
  onUpdate,
  onConfigChange,
}: SnakeEventShaderPanelProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<SnakeEventType>>(
    new Set(),
  );
  const debounceTimers = useRef<{ [key: string]: NodeJS.Timeout | null }>({});

  const visibleShaders = availableShaders.filter(
    (s) => (s as any).isVisible !== false,
  );

  const toggleEventExpanded = (eventType: SnakeEventType) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventType)) {
        next.delete(eventType);
      } else {
        next.add(eventType);
      }
      return next;
    });
  };

  const persistConfig = useCallback(
    async (updated: SnakeEventShaderConfig) => {
      if (onConfigChange) {
        onConfigChange(updated);
      } else {
        await updateInput(roomId, inputId, { snakeEventShaders: updated });
      }
      await onUpdate();
    },
    [roomId, inputId, onUpdate, onConfigChange],
  );

  const debouncedPersist = useCallback(
    (key: string, updated: SnakeEventShaderConfig) => {
      if (debounceTimers.current[key]) {
        clearTimeout(debounceTimers.current[key]!);
      }
      debounceTimers.current[key] = setTimeout(() => {
        persistConfig(updated);
        debounceTimers.current[key] = null;
      }, 300);
    },
    [persistConfig],
  );

  const getMapping = (
    eventType: SnakeEventType,
  ): SnakeEventShaderMapping | undefined => {
    return config?.[eventType];
  };

  const buildDefaultMapping = (
    eventType: SnakeEventType,
  ): SnakeEventShaderMapping => {
    const defaults = DEFAULT_EFFECT_TYPES[eventType];
    const shaderDef = availableShaders.find((s) => s.id === defaults.shaderId);
    const params: ShaderParamConfig[] = (shaderDef?.params ?? []).map((p) => ({
      paramName: p.name,
      paramValue:
        p.name === 'effect_type' ? defaults.effectType : (p.defaultValue ?? 0),
    }));

    return {
      enabled: true,
      shaderId: defaults.shaderId,
      params,
      application: { mode: 'all' },
      effectDurationMs: DEFAULT_EFFECT_DURATION_MS,
    };
  };

  const setMapping = (
    eventType: SnakeEventType,
    mapping: SnakeEventShaderMapping | undefined,
    debounce = false,
  ) => {
    const updated: SnakeEventShaderConfig = { ...config };
    if (mapping) {
      updated[eventType] = mapping;
    } else {
      delete updated[eventType];
    }
    if (debounce) {
      debouncedPersist(eventType, updated);
    } else {
      persistConfig(updated);
    }
  };

  const handleToggleEnabled = (eventType: SnakeEventType) => {
    const existing = getMapping(eventType);
    if (existing) {
      setMapping(eventType, { ...existing, enabled: !existing.enabled });
    } else {
      const mapping = buildDefaultMapping(eventType);
      setMapping(eventType, mapping);
      setExpandedEvents((prev) => new Set(prev).add(eventType));
    }
  };

  const handleShaderChange = (eventType: SnakeEventType, shaderId: string) => {
    const existing = getMapping(eventType);
    if (!existing) return;
    const shaderDef = availableShaders.find((s) => s.id === shaderId);
    const params: ShaderParamConfig[] = (shaderDef?.params ?? []).map((p) => ({
      paramName: p.name,
      paramValue: p.defaultValue ?? 0,
    }));
    setMapping(eventType, { ...existing, shaderId, params });
  };

  const handleApplicationModeChange = (
    eventType: SnakeEventType,
    mode: 'all' | 'snake_cells' | 'first_n' | 'sequential',
  ) => {
    const existing = getMapping(eventType);
    if (!existing) return;
    let application: SnakeEventApplicationMode;
    if (mode === 'all') {
      application = { mode: 'all' };
    } else if (mode === 'snake_cells') {
      application = { mode: 'snake_cells' };
    } else if (mode === 'first_n') {
      application = { mode: 'first_n', n: 3 };
    } else {
      application = { mode: 'sequential', durationMs: 200, delayMs: 50 };
    }
    setMapping(eventType, { ...existing, application });
  };

  const handleApplicationParamChange = (
    eventType: SnakeEventType,
    field: string,
    value: number,
  ) => {
    const existing = getMapping(eventType);
    if (!existing) return;
    const app = { ...existing.application } as any;
    app[field] = value;
    setMapping(eventType, { ...existing, application: app }, true);
  };

  const handleDurationChange = (eventType: SnakeEventType, value: number) => {
    const existing = getMapping(eventType);
    if (!existing) return;
    setMapping(eventType, { ...existing, effectDurationMs: value }, true);
  };

  const handleParamChange = (
    eventType: SnakeEventType,
    paramName: string,
    value: number | string,
  ) => {
    const existing = getMapping(eventType);
    if (!existing) return;
    const params = existing.params.map((p) =>
      p.paramName === paramName ? { ...p, paramValue: value } : p,
    );
    setMapping(eventType, { ...existing, params }, true);
  };

  const enabledCount = SNAKE_EVENT_TYPES.filter(
    (e) => getMapping(e.type)?.enabled,
  ).length;

  return (
    <div className='mt-2' data-no-dnd>
      <button
        type='button'
        className='flex items-center gap-1.5 w-full text-left text-sm font-medium text-neutral-300 hover:text-white transition-colors py-1 cursor-pointer'
        onClick={() => setPanelOpen(!panelOpen)}>
        {panelOpen ? (
          <ChevronDown className='size-3.5' />
        ) : (
          <ChevronRight className='size-3.5' />
        )}
        <span>🐍 Snake Event Effects</span>
        {enabledCount > 0 && (
          <span className='ml-auto text-xs text-neutral-500'>
            {enabledCount} active
          </span>
        )}
      </button>

      {panelOpen && (
        <div className='mt-1 flex flex-col gap-0.5'>
          {SNAKE_EVENT_TYPES.map(({ type, label, description }) => {
            const mapping = getMapping(type);
            const isEnabled = mapping?.enabled ?? false;
            const isExpanded = expandedEvents.has(type);
            const shaderDef = mapping
              ? availableShaders.find((s) => s.id === mapping.shaderId)
              : null;

            return (
              <div
                key={type}
                className='rounded bg-neutral-800/60 border border-neutral-700/50'>
                <div className='flex items-center gap-2 px-2 py-1.5'>
                  <input
                    type='checkbox'
                    checked={isEnabled}
                    onChange={() => handleToggleEnabled(type)}
                    className='accent-green-500 cursor-pointer shrink-0'
                  />
                  <button
                    type='button'
                    className='flex-1 text-left text-sm text-white truncate cursor-pointer hover:text-neutral-200'
                    onClick={() => toggleEventExpanded(type)}
                    title={description}>
                    {label}
                  </button>
                  {isEnabled && (
                    <span className='text-xs text-neutral-500 truncate max-w-24'>
                      {shaderDef?.name ?? mapping?.shaderId}
                    </span>
                  )}
                  {isEnabled && (
                    <button
                      type='button'
                      className='text-neutral-500 hover:text-white cursor-pointer'
                      onClick={() => toggleEventExpanded(type)}>
                      {isExpanded ? (
                        <ChevronDown className='size-3.5' />
                      ) : (
                        <ChevronRight className='size-3.5' />
                      )}
                    </button>
                  )}
                </div>

                {isEnabled && isExpanded && mapping && (
                  <div className='px-3 pb-2 pt-1 border-t border-neutral-700/50 flex flex-col gap-2'>
                    {/* Shader selector */}
                    <div className='flex flex-col gap-1'>
                      <label className='text-xs text-neutral-400'>Shader</label>
                      <select
                        value={mapping.shaderId}
                        onChange={(e) =>
                          handleShaderChange(type, e.target.value)
                        }
                        className='w-full text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500 cursor-pointer'>
                        {visibleShaders.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Application mode */}
                    <div className='flex flex-col gap-1'>
                      <label className='text-xs text-neutral-400'>
                        Application Mode
                      </label>
                      <select
                        value={mapping.application.mode}
                        onChange={(e) =>
                          handleApplicationModeChange(
                            type,
                            e.target.value as
                              | 'all'
                              | 'snake_cells'
                              | 'first_n'
                              | 'sequential',
                          )
                        }
                        className='w-full text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500 cursor-pointer'>
                        <option value='all'>All Cells</option>
                        <option value='snake_cells'>Snake Cells</option>
                        <option value='first_n'>First N Cells</option>
                        <option value='sequential'>Sequential</option>
                      </select>
                    </div>

                    {/* First N param */}
                    {mapping.application.mode === 'first_n' && (
                      <div className='flex items-center gap-2'>
                        <label className='text-xs text-neutral-400 shrink-0'>
                          N:
                        </label>
                        <input
                          type='number'
                          min={1}
                          value={
                            (
                              mapping.application as {
                                mode: 'first_n';
                                n: number;
                              }
                            ).n
                          }
                          onChange={(e) =>
                            handleApplicationParamChange(
                              type,
                              'n',
                              Math.max(1, parseInt(e.target.value) || 1),
                            )
                          }
                          className='w-16 text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500'
                        />
                      </div>
                    )}

                    {/* Sequential params */}
                    {mapping.application.mode === 'sequential' && (
                      <div className='flex gap-3'>
                        <div className='flex items-center gap-1'>
                          <label className='text-xs text-neutral-400 shrink-0'>
                            Duration:
                          </label>
                          <input
                            type='number'
                            min={0}
                            step={50}
                            value={
                              (
                                mapping.application as {
                                  mode: 'sequential';
                                  durationMs: number;
                                  delayMs: number;
                                }
                              ).durationMs
                            }
                            onChange={(e) =>
                              handleApplicationParamChange(
                                type,
                                'durationMs',
                                Math.max(0, parseInt(e.target.value) || 0),
                              )
                            }
                            className='w-16 text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500'
                          />
                          <span className='text-xs text-neutral-500'>ms</span>
                        </div>
                        <div className='flex items-center gap-1'>
                          <label className='text-xs text-neutral-400 shrink-0'>
                            Delay:
                          </label>
                          <input
                            type='number'
                            min={0}
                            step={10}
                            value={
                              (
                                mapping.application as {
                                  mode: 'sequential';
                                  durationMs: number;
                                  delayMs: number;
                                }
                              ).delayMs
                            }
                            onChange={(e) =>
                              handleApplicationParamChange(
                                type,
                                'delayMs',
                                Math.max(0, parseInt(e.target.value) || 0),
                              )
                            }
                            className='w-16 text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500'
                          />
                          <span className='text-xs text-neutral-500'>ms</span>
                        </div>
                      </div>
                    )}

                    {/* Effect duration */}
                    <div className='flex items-center gap-2'>
                      <label className='text-xs text-neutral-400 shrink-0'>
                        Effect Duration:
                      </label>
                      <input
                        type='number'
                        min={50}
                        step={50}
                        value={mapping.effectDurationMs}
                        onChange={(e) =>
                          handleDurationChange(
                            type,
                            Math.max(
                              50,
                              parseInt(e.target.value) ||
                                DEFAULT_EFFECT_DURATION_MS,
                            ),
                          )
                        }
                        className='w-20 text-xs bg-neutral-900 text-white border border-neutral-700 rounded px-2 py-1 focus:outline-none focus:border-neutral-500'
                      />
                      <span className='text-xs text-neutral-500'>ms</span>
                    </div>

                    {/* Shader params */}
                    {shaderDef?.params && shaderDef.params.length > 0 && (
                      <div className='flex flex-col gap-2 pt-1 border-t border-neutral-700/30'>
                        <span className='text-xs text-neutral-500 uppercase tracking-wide'>
                          Shader Parameters
                        </span>
                        {shaderDef.params.map((param) => {
                          const paramConfig = mapping.params.find(
                            (p) => p.paramName === param.name,
                          );
                          const rawValue =
                            paramConfig?.paramValue ?? param.defaultValue ?? 0;

                          if (param.type === 'color') {
                            const colorNum =
                              typeof rawValue === 'string'
                                ? hexToPackedInt(rawValue)
                                : typeof rawValue === 'number'
                                  ? rawValue
                                  : 0;
                            const hexValue = packedIntToHex(colorNum);

                            return (
                              <div
                                key={param.name}
                                className='flex items-center gap-2'>
                                <label className='text-xs text-neutral-400 shrink-0 min-w-16'>
                                  {param.name}
                                </label>
                                <input
                                  type='color'
                                  value={hexValue}
                                  onChange={(e) =>
                                    handleParamChange(
                                      type,
                                      param.name,
                                      hexToPackedInt(e.target.value),
                                    )
                                  }
                                  className='h-6 w-10 rounded border border-neutral-700 bg-neutral-900 cursor-pointer'
                                />
                                <span className='text-xs text-neutral-500 font-mono'>
                                  {hexValue.toUpperCase()}
                                </span>
                              </div>
                            );
                          }

                          const numValue =
                            typeof rawValue === 'number' ? rawValue : 0;
                          const min = param.minValue ?? 0;
                          const max = param.maxValue ?? 1;
                          const step = (max - min) / 100;

                          return (
                            <div
                              key={param.name}
                              className='flex flex-col gap-1'>
                              <div className='flex items-center justify-between'>
                                <label className='text-xs text-neutral-400'>
                                  {param.name}
                                </label>
                                <span className='text-xs text-neutral-500 font-mono'>
                                  {numValue.toFixed(2)}
                                </span>
                              </div>
                              <input
                                type='range'
                                min={min}
                                max={max}
                                step={step}
                                value={numValue}
                                onChange={(e) =>
                                  handleParamChange(
                                    type,
                                    param.name,
                                    Number(e.target.value),
                                  )
                                }
                                className='w-full h-1.5 rounded bg-neutral-700 outline-none appearance-none'
                                style={{ accentColor: '#a0a0a0' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
