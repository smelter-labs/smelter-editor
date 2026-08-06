'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AIModelInfo } from '@smelter-editor/types';
import type { Input } from '@/lib/types';
import {
  getAvailableAIModels,
  getRoomInfo,
  setAIModel,
  setHaunterConfig,
} from '@/app/actions/actions';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  roomId: string;
};

const HAUNTER_CFG_KEY = 'haunter-config';

// The AI model whose person detections drive the haunting ghosts — enabling it
// in ghost mode on an input starts the effect (ghost mode is always the
// haunting-ghosts style, whether flipped here or in the AI models panel).
const PEOPLE_MODEL_ID = 'people-counter-yolo';

// Config bounds — mirror the server clamps (RoomState.setHaunterConfig).
const DEFAULT_COUNT = 3;
const MIN_COUNT = 1;
const MAX_COUNT = 8;
// Attach range as a fraction of the smaller output edge.
const DEFAULT_DIST = 0.35;
const MIN_DIST = 0.1;
const MAX_DIST = 1;
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const DEFAULT_SPEED = 1;
const MIN_SPEED = 0.25;
const MAX_SPEED = 3;

/**
 * Haunting Ghosts — the operator's panel for the ambient haunting-ghosts
 * effect. Pick the input with people and start haunting (flips the People
 * Counter into ghost mode), then tune the room-wide ghost pool live: count,
 * attach range, sprite size, follow speed. No player interaction — the ghosts
 * chase whoever the camera sees.
 */
export function HaunterPanel({ roomId }: Props) {
  // Room-wide ghost tuning, controlled here and pushed to the server.
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [dist, setDist] = useState(DEFAULT_DIST);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const firstSaveRef = useRef(true);

  // Inputs + the people model, for the "start haunting" flow.
  const [peopleModel, setPeopleModel] = useState<AIModelInfo | null>(null);
  const [inputs, setInputs] = useState<Input[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [starting, setStarting] = useState(false);

  // Load saved config once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HAUNTER_CFG_KEY);
      if (raw) {
        const p = JSON.parse(raw) as {
          count?: number;
          dist?: number;
          scale?: number;
          speed?: number;
        };
        if (typeof p.count === 'number') setCount(p.count);
        if (typeof p.dist === 'number') setDist(p.dist);
        if (typeof p.scale === 'number') setScale(p.scale);
        if (typeof p.speed === 'number') setSpeed(p.speed);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Persist + push the config to the server whenever it changes (debounced so
  // dragging a slider doesn't spam requests). Pushes once on mount too so the
  // room adopts the stored panel config.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        HAUNTER_CFG_KEY,
        JSON.stringify({ count, dist, scale, speed }),
      );
    } catch {
      /* ignore */
    }
    const delay = firstSaveRef.current ? 0 : 300;
    firstSaveRef.current = false;
    const t = window.setTimeout(() => {
      void setHaunterConfig(roomId, {
        haunterCount: count,
        haunterDist: dist,
        haunterScale: scale,
        haunterSpeed: speed,
      }).catch(() => {
        /* transient — next change retries */
      });
    }, delay);
    return () => window.clearTimeout(t);
  }, [roomId, count, dist, scale, speed]);

  // Load the people model once (used to know which input types are supported).
  useEffect(() => {
    void getAvailableAIModels()
      .then((models) =>
        setPeopleModel(models.find((m) => m.id === PEOPLE_MODEL_ID) ?? null),
      )
      .catch(() => setPeopleModel(null));
  }, []);

  const refreshInputs = useCallback(async () => {
    const info = await getRoomInfo(roomId);
    if (info && info !== 'not-found') setInputs(info.inputs);
  }, [roomId]);

  // Load inputs on mount and keep them fresh (inputs come and go while the
  // operator sets up the scene).
  useEffect(() => {
    void refreshInputs();
    const t = window.setInterval(() => void refreshInputs(), 4000);
    return () => window.clearInterval(t);
  }, [refreshInputs]);

  // Inputs the people model can run on.
  const eligibleInputs = useMemo(() => {
    if (!peopleModel) return [];
    return inputs.filter((i) =>
      peopleModel.supportedInputTypes.includes(i.type),
    );
  }, [inputs, peopleModel]);

  const isHaunting = useCallback(
    (i: Input) => !!i.aiModels?.[PEOPLE_MODEL_ID]?.ghostMode,
    [],
  );

  // Keep a valid selection: default to an input already haunting, else the
  // first eligible one.
  useEffect(() => {
    if (
      selectedInputId &&
      eligibleInputs.some((i) => i.inputId === selectedInputId)
    ) {
      return;
    }
    const active = eligibleInputs.find(isHaunting);
    setSelectedInputId(active?.inputId ?? eligibleInputs[0]?.inputId ?? '');
  }, [eligibleInputs, selectedInputId, isHaunting]);

  const selectedInput = eligibleInputs.find(
    (i) => i.inputId === selectedInputId,
  );
  const hauntActive = !!selectedInput && isHaunting(selectedInput);

  // Enable (or disable) the people model in ghost mode on the chosen input.
  // setAIModel replaces params wholesale, so pass through whatever the input
  // already has (confidence/imgsz survive).
  const toggleHaunt = useCallback(
    async (on: boolean) => {
      if (!peopleModel || !selectedInputId) return;
      setStarting(true);
      try {
        const current =
          eligibleInputs.find((i) => i.inputId === selectedInputId)?.aiModels?.[
            PEOPLE_MODEL_ID
          ]?.params ?? {};
        await setAIModel(
          roomId,
          selectedInputId,
          peopleModel.id,
          on,
          peopleModel.defaultDelayMs,
          false, // drawBoxes off — ghosts and boxes are mutually exclusive
          current,
          on, // ghostMode = ghost sprites over the video
        );
        await refreshInputs();
      } finally {
        setStarting(false);
      }
    },
    [peopleModel, selectedInputId, eligibleInputs, roomId, refreshInputs],
  );

  return (
    <div className='h-full overflow-y-auto p-4 text-neutral-200'>
      <div className='text-[11px] uppercase tracking-wide text-neutral-500 mb-3'>
        Haunting Ghosts
      </div>

      <div className='space-y-4'>
        {/* Start haunting: pick the input with people, flip on the haunters. */}
        <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 space-y-3'>
          <div className='text-sm font-medium'>Haunting 👻</div>
          <div className='space-y-1'>
            <span className='text-[11px] text-neutral-400'>
              Input with people
            </span>
            <Select value={selectedInputId} onValueChange={setSelectedInputId}>
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Select an input…' />
              </SelectTrigger>
              <SelectContent>
                {eligibleInputs.length === 0 ? (
                  <SelectItem value='__none' disabled className='text-xs'>
                    No matching inputs
                  </SelectItem>
                ) : (
                  eligibleInputs.map((i) => (
                    <SelectItem
                      key={i.inputId}
                      value={i.inputId}
                      className='text-xs'>
                      {i.title || i.inputId}
                      {isHaunting(i) ? ' • haunting' : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            type='button'
            size='sm'
            variant={hauntActive ? 'outline' : 'default'}
            disabled={!selectedInputId || starting}
            className='w-full'
            onClick={() => void toggleHaunt(!hauntActive)}>
            {starting
              ? 'One sec…'
              : hauntActive
                ? 'Stop haunting'
                : 'Start haunting'}
          </Button>
          <div className='text-[10px] text-neutral-500'>
            Enables the People Counter (YOLO) in haunting-ghosts mode on the
            selected input. The ghosts chase detected people on their own.
          </div>
        </div>

        {/* Room-wide ghost tuning. */}
        <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 space-y-3'>
          <div className='text-sm font-medium'>Ghosts 👻</div>
          <CfgSlider
            label='ghost count'
            value={count}
            display={String(count)}
            min={MIN_COUNT}
            max={MAX_COUNT}
            step={1}
            onChange={setCount}
          />
          <CfgSlider
            label='haunt range'
            value={dist}
            display={`${Math.round(dist * 100)}%`}
            min={MIN_DIST}
            max={MAX_DIST}
            step={0.05}
            onChange={setDist}
          />
          <div className='text-[10px] text-neutral-500'>
            How close (as % of the shorter screen edge) a person must be for a
            free ghost to attach to them. A ghost keeps its person until they
            leave the frame — then it waits in place for the next one.
          </div>
          <CfgSlider
            label='size'
            value={scale}
            display={`${scale.toFixed(2)}×`}
            min={MIN_SCALE}
            max={MAX_SCALE}
            step={0.05}
            onChange={setScale}
          />
          <CfgSlider
            label='follow speed'
            value={speed}
            display={`${speed.toFixed(2)}×`}
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.05}
            onChange={setSpeed}
          />
        </div>
      </div>
    </div>
  );
}

function CfgSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className='space-y-1'>
      <div className='flex items-center justify-between'>
        <span className='text-xs text-neutral-300'>{label}</span>
        <span className='text-[11px] font-mono text-neutral-400'>
          {display}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
