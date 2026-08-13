'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Input } from '@/lib/types';
import type {
  AIModelInfo,
  ModelParamSpec,
  NumberParamSpec,
} from '@smelter-editor/types';
import {
  getAvailableAIModels,
  setAIModel,
  toggleTranscription,
} from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import { KettlebellLiveStatus } from './KettlebellLiveStatus';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DEBOUNCE_MS = 300;

// Input types whose audio can be transcribed into live captions.
const CAPTION_INPUT_TYPES = new Set([
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
]);

type Draft = {
  delayMs?: number;
  params?: Record<string, number | string>;
};

export function AIModelsPanel({
  roomId,
  selectedInput,
  handleRefreshState,
}: {
  roomId: string;
  selectedInput: Input | null;
  handleRefreshState: () => Promise<void>;
}) {
  const [availableModels, setAvailableModels] = useState<AIModelInfo[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [captionsPending, setCaptionsPending] = useState(false);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    void getAvailableAIModels()
      .then(setAvailableModels)
      .catch(() => setAvailableModels([]));
  }, []);

  // Drop drafts when the selection changes so we show server truth.
  useEffect(() => {
    setDrafts({});
  }, [selectedInput?.inputId]);

  const applicableModels = useMemo(() => {
    if (!selectedInput) return [];
    return availableModels.filter((m) =>
      m.supportedInputTypes.includes(selectedInput.type),
    );
  }, [availableModels, selectedInput]);

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const statusOf = useCallback(
    (modelId: string) => selectedInput?.aiModels?.[modelId],
    [selectedInput],
  );

  const isEnabled = useCallback(
    (model: AIModelInfo) =>
      statusOf(model.id)?.enabled ??
      (model.id === 'motion' ? (selectedInput?.motionEnabled ?? false) : false),
    [statusOf, selectedInput],
  );

  const delayOf = useCallback(
    (model: AIModelInfo) =>
      drafts[model.id]?.delayMs ??
      statusOf(model.id)?.delayMs ??
      model.defaultDelayMs,
    [drafts, statusOf],
  );

  const paramOf = useCallback(
    (model: AIModelInfo, spec: ModelParamSpec) =>
      drafts[model.id]?.params?.[spec.key] ??
      statusOf(model.id)?.params?.[spec.key] ??
      spec.default,
    [drafts, statusOf],
  );

  /**
   * Whether this model is currently reading rectangles drawn into the footage
   * rather than detecting. Only then is there anything for the erase shader to
   * remove, so the toggle stays hidden otherwise.
   */
  const usesMarkerSource = useCallback(
    (model: AIModelInfo) => {
      const source = model.params?.find((p) => p.key === 'source');
      const color = model.params?.some((p) => p.key === 'markerColor');
      return (
        !!source && !!color && String(paramOf(model, source)) === 'markers'
      );
    },
    [paramOf],
  );

  /** Full params object for a model, with an optional single override. */
  const resolveParams = useCallback(
    (
      model: AIModelInfo,
      override?: { key: string; value: number | string },
    ) => {
      if (!model.params?.length) return undefined;
      const obj: Record<string, number | string> = {};
      for (const spec of model.params) {
        obj[spec.key] =
          override && override.key === spec.key
            ? override.value
            : paramOf(model, spec);
      }
      return obj;
    },
    [paramOf],
  );

  const pushChange = useCallback(
    async (
      model: AIModelInfo,
      next: {
        enabled?: boolean;
        delayMs?: number;
        drawBoxes?: boolean;
        ghostMode?: boolean;
        eraseMarkers?: boolean;
        params?: Record<string, number | string>;
      },
    ) => {
      if (!selectedInput) return;
      const status = statusOf(model.id);
      const enabled = next.enabled ?? isEnabled(model);
      markPending(model.id, true);
      try {
        await setAIModel(
          roomId,
          selectedInput.inputId,
          model.id,
          enabled,
          next.delayMs ?? delayOf(model),
          next.drawBoxes ?? status?.drawBoxes,
          next.params ?? resolveParams(model),
          next.ghostMode ?? status?.ghostMode,
          next.eraseMarkers ?? status?.eraseMarkers,
        );
        await handleRefreshState();
      } finally {
        markPending(model.id, false);
      }
    },
    [
      selectedInput,
      roomId,
      statusOf,
      isEnabled,
      delayOf,
      resolveParams,
      markPending,
      handleRefreshState,
    ],
  );

  const debounced = useCallback((key: string, fn: () => void) => {
    const existing = debounceRef.current[key];
    if (existing) clearTimeout(existing);
    debounceRef.current[key] = setTimeout(fn, DEBOUNCE_MS);
  }, []);

  const onDelayChange = useCallback(
    (model: AIModelInfo, value: number) => {
      setDrafts((prev) => ({
        ...prev,
        [model.id]: { ...prev[model.id], delayMs: value },
      }));
      debounced(`${model.id}:delay`, () => {
        void pushChange(model, { enabled: true, delayMs: value });
      });
    },
    [debounced, pushChange],
  );

  const onParamChange = useCallback(
    (model: AIModelInfo, spec: ModelParamSpec, value: number | string) => {
      setDrafts((prev) => ({
        ...prev,
        [model.id]: {
          ...prev[model.id],
          params: { ...prev[model.id]?.params, [spec.key]: value },
        },
      }));
      debounced(`${model.id}:${spec.key}`, () => {
        void pushChange(model, {
          enabled: true,
          params: resolveParams(model, { key: spec.key, value }),
        });
      });
    },
    [debounced, pushChange, resolveParams],
  );

  const showCaptions =
    !!selectedInput && CAPTION_INPUT_TYPES.has(selectedInput.type);

  if (!selectedInput) {
    return <Empty>Select a block to configure its AI models.</Empty>;
  }
  if (applicableModels.length === 0 && !showCaptions) {
    return <Empty>No AI models available for this input type.</Empty>;
  }

  return (
    <div className='h-full overflow-y-auto p-3 space-y-3'>
      <div className='text-[11px] uppercase tracking-wide text-neutral-500'>
        AI models · {selectedInput.title}
      </div>

      {showCaptions && (
        <div
          className={`rounded-lg border ${
            selectedInput.transcription
              ? 'border-cyan/40 bg-neutral-900/60'
              : 'border-neutral-800 bg-neutral-900/30'
          }`}>
          <div className='flex items-center justify-between gap-2 p-3'>
            <div className='min-w-0'>
              <div className='text-sm font-medium text-neutral-100 truncate'>
                Captions
              </div>
              <div className='text-[11px] text-neutral-500 truncate'>
                Transcribe audio (Whisper) into live on-screen captions
              </div>
            </div>
            <Switch
              checked={!!selectedInput.transcription}
              disabled={captionsPending}
              onCheckedChange={(v) => {
                setCaptionsPending(true);
                void toggleTranscription(roomId, selectedInput.inputId, v)
                  .then(() => handleRefreshState())
                  .finally(() => setCaptionsPending(false));
              }}
            />
          </div>
        </div>
      )}
      {applicableModels.map((model) => {
        const enabled = isEnabled(model);
        const pending = pendingIds.has(model.id);
        const status = statusOf(model.id);
        const count =
          (status?.lastResult as { count?: number })?.count ??
          selectedInput.peopleCount;

        return (
          <div
            key={model.id}
            className={`rounded-lg border ${
              enabled
                ? 'border-cyan/40 bg-neutral-900/60'
                : 'border-neutral-800 bg-neutral-900/30'
            }`}>
            <div className='flex items-center justify-between gap-2 p-3'>
              <div className='min-w-0'>
                <div className='text-sm font-medium text-neutral-100 truncate'>
                  {model.name}
                </div>
                {model.description && (
                  <div className='text-[11px] text-neutral-500 truncate'>
                    {model.description}
                  </div>
                )}
              </div>
              <Switch
                checked={enabled}
                disabled={pending}
                onCheckedChange={(v) => void pushChange(model, { enabled: v })}
              />
            </div>

            {enabled && (
              <div className='space-y-4 border-t border-neutral-800 p-3'>
                {model.maxDelayMs > 0 && (
                  <Field
                    label='Delay'
                    value={`${delayOf(model)} ms`}
                    hint='Output is held this long so detections sync to the video'>
                    <Slider
                      min={0}
                      max={model.maxDelayMs}
                      step={50}
                      value={[delayOf(model)]}
                      onValueChange={([v]) => onDelayChange(model, v)}
                    />
                  </Field>
                )}

                {model.params?.map((spec) =>
                  spec.type === 'color' ? (
                    <Field
                      key={spec.key}
                      label={spec.label}
                      value={String(paramOf(model, spec)).toLowerCase()}
                      hint={spec.description}>
                      <div className='flex items-center gap-2'>
                        <input
                          type='color'
                          aria-label={spec.label}
                          value={normalizeHex(
                            String(paramOf(model, spec)),
                            spec.default,
                          )}
                          onChange={(e) =>
                            onParamChange(model, spec, e.target.value)
                          }
                          className='h-8 w-10 shrink-0 cursor-pointer rounded border border-neutral-700 bg-neutral-900 p-0.5'
                        />
                        <input
                          type='text'
                          spellCheck={false}
                          aria-label={`${spec.label} hex`}
                          value={String(paramOf(model, spec))}
                          // Typing a hex goes through character by character, so
                          // only push once it is a complete colour — otherwise
                          // '#f' would reach the worker and key nothing.
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) {
                              onParamChange(model, spec, v);
                            }
                          }}
                          className='h-8 w-full rounded border border-neutral-700 bg-neutral-900 px-2 font-mono text-xs text-neutral-200 outline-none focus:border-neutral-500'
                        />
                      </div>
                    </Field>
                  ) : spec.type === 'select' ? (
                    <Field
                      key={spec.key}
                      label={spec.label}
                      value=''
                      hint={spec.description}>
                      <Select
                        value={String(paramOf(model, spec))}
                        onValueChange={(v) => onParamChange(model, spec, v)}>
                        <SelectTrigger className='h-8 text-xs'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {spec.options.map((o) => (
                            <SelectItem
                              key={o.value}
                              value={o.value}
                              className='text-xs'>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <Field
                      key={spec.key}
                      label={spec.label}
                      value={formatParam(spec, Number(paramOf(model, spec)))}
                      hint={spec.description}>
                      <Slider
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={[Number(paramOf(model, spec))]}
                        onValueChange={([v]) => onParamChange(model, spec, v)}
                      />
                    </Field>
                  ),
                )}

                {model.supportsBoxes && (
                  <div className='flex items-center justify-between'>
                    <div>
                      <div className='text-xs text-neutral-300'>
                        Bounding boxes
                      </div>
                      <div className='text-[11px] text-neutral-500'>
                        Draw a rectangle around each detection on the output
                      </div>
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant={status?.drawBoxes ? 'default' : 'outline'}
                      disabled={pending}
                      className='h-6 px-2 text-[10px] font-mono uppercase'
                      onClick={() => {
                        const on = !status?.drawBoxes;
                        void pushChange(model, {
                          drawBoxes: on,
                          // Boxes and ghosts are mutually exclusive overlays.
                          ...(on ? { ghostMode: false } : {}),
                        });
                      }}>
                      {status?.drawBoxes ? 'On' : 'Off'}
                    </Button>
                  </div>
                )}

                {usesMarkerSource(model) && (
                  <div className='flex items-center justify-between'>
                    <div>
                      <div className='text-xs text-neutral-300'>
                        Erase markers
                      </div>
                      <div className='text-[11px] text-neutral-500'>
                        Remove the drawn rectangles from the picture, filling
                        them with the surrounding image
                      </div>
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant={status?.eraseMarkers ? 'default' : 'outline'}
                      disabled={pending}
                      className='h-6 px-2 text-[10px] font-mono uppercase'
                      onClick={() => {
                        void pushChange(model, {
                          eraseMarkers: !status?.eraseMarkers,
                        });
                      }}>
                      {status?.eraseMarkers ? 'On' : 'Off'}
                    </Button>
                  </div>
                )}

                {model.supportsBoxes && (
                  <div className='flex items-center justify-between'>
                    <div>
                      <div className='text-xs text-neutral-300'>
                        {model.id.includes('bird')
                          ? 'Duck sprites'
                          : model.id === 'car-ads'
                            ? 'Ad overlay'
                            : model.id === 'car-hue-topdown'
                              ? 'Hue overlay'
                              : 'Ghost overlay'}
                      </div>
                      <div className='text-[11px] text-neutral-500'>
                        {model.id.includes('bird')
                          ? 'Replace each detected bird with a Duck Hunt duck sprite'
                          : model.id === 'car-ads'
                            ? 'Stick the ad image onto each car side, in perspective from its wheels'
                            : model.id === 'car-hue-topdown'
                              ? 'Recolor each detected car (hue shift inside its box)'
                              : 'Haunting ghosts chase detected people (tune them in the Ghosts panel)'}
                      </div>
                    </div>
                    <Button
                      type='button'
                      size='sm'
                      variant={status?.ghostMode ? 'default' : 'outline'}
                      disabled={pending}
                      className='h-6 px-2 text-[10px] font-mono uppercase'
                      onClick={() => {
                        const on = !status?.ghostMode;
                        void pushChange(model, {
                          ghostMode: on,
                          // Boxes and ghosts are mutually exclusive overlays.
                          ...(on ? { drawBoxes: false } : {}),
                        });
                      }}>
                      {status?.ghostMode ? 'On' : 'Off'}
                    </Button>
                  </div>
                )}

                {model.id === 'kettlebell-coach' && (
                  <KettlebellLiveStatus
                    roomId={roomId}
                    inputId={selectedInput.inputId}
                  />
                )}

                {count !== undefined && model.id !== 'kettlebell-coach' && (
                  <div className='rounded-md bg-neutral-800/60 px-2 py-1 text-xs text-neutral-200'>
                    Detected: <span className='font-mono'>{count}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * `<input type="color">` refuses anything that is not exactly `#rrggbb` and
 * silently falls back to black, which would show the wrong swatch while the
 * user is still typing a hex into the field next to it.
 */
function normalizeHex(value: string, fallback: string): string {
  const v = value.trim();
  const full = /^#?([0-9a-fA-F]{6})$/.exec(v);
  if (full) return `#${full[1].toLowerCase()}`;
  const short = /^#?([0-9a-fA-F]{3})$/.exec(v);
  if (short) {
    const [r, g, b] = short[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return fallback;
}

function Field({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between'>
        <span className='text-xs text-neutral-300'>{label}</span>
        <span className='text-[11px] font-mono text-neutral-400'>{value}</span>
      </div>
      {children}
      {hint && <div className='text-[11px] text-neutral-500'>{hint}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-full flex items-center justify-center p-4 text-center'>
      <p className='text-xs text-neutral-500'>{children}</p>
    </div>
  );
}

function formatParam(spec: NumberParamSpec, value: number): string {
  // Fractional steps (e.g. confidence) read better with 2 decimals.
  return spec.step < 1 ? value.toFixed(2) : String(Math.round(value));
}
