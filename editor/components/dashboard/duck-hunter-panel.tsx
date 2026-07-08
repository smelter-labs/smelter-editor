'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import type { AIModelInfo } from '@smelter-editor/types';
import type { Input } from '@/lib/types';
import {
  getAvailableAIModels,
  getRoomInfo,
  setAIModel,
  setDuckHunterConfig,
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

const PUBLIC_BASE_KEY = 'smelter-public-base';
const AMMO_CFG_KEY = 'duck-hunter-ammo';

// The AI model that replaces detected birds with Duck Hunt sprites — enabling
// it (in ghost mode) on an input is what makes a shootable target.
const BIRD_MODEL_ID = 'people-counter-yolo-birds';

// Ammo config bounds — mirror the server clamps (DuckHunterController).
const DEFAULT_MAX_AMMO = 3;
const DEFAULT_RELOAD_SEC = 5;
const MIN_MAX_AMMO = 1;
const MAX_MAX_AMMO = 12;
const MIN_RELOAD_SEC = 1;
const MAX_RELOAD_SEC = 30;

// Duck-size multiplier bounds — mirror the server clamp (RoomState.setDuckHunterConfig).
const DEFAULT_DUCK_SCALE = 1;
const MIN_DUCK_SCALE = 0.25;
const MAX_DUCK_SCALE = 3;

// Free-flight timing bounds — mirror the server clamps (RoomState.setDuckHunterConfig).
// Pause = how long a duck holds before flying off; speed = fly speed as a
// fraction of the larger screen edge per second (lower = ducks linger longer).
const DEFAULT_FLEE_SEC = 0.7;
const MIN_FLEE_SEC = 0;
const MAX_FLEE_SEC = 10;
const DEFAULT_FLY_SPEED = 0.9;
const MIN_FLY_SPEED = 0.1;
const MAX_FLY_SPEED = 2;

/** Default public base for the QR: env override, else the current origin. */
function defaultPublicBase(): string {
  if (typeof window === 'undefined') return '';
  return (
    process.env.NEXT_PUBLIC_SMELTER_PUBLIC_URL?.trim() || window.location.origin
  );
}

/**
 * Duck Hunter — the operator's control panel for the phone shooting game.
 *
 * Left: a QR that phones scan to open the touch/gyro controller for this room.
 * Right: the game config — pick the input with birds, tune the room-wide ammo
 * rules, and Start Game (which flips the Bird Counter model into duck-sprite
 * mode on that input so there's something to shoot). Live crosshairs and the
 * scoreboard render on the Smelter output.
 */
export function DuckHunterPanel({ roomId }: Props) {
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('');

  // Room-wide ammo rules, controlled here and pushed to the server. These apply
  // to every player (current + future joiners); phones no longer set their own.
  const [maxAmmo, setMaxAmmo] = useState(DEFAULT_MAX_AMMO);
  const [reloadSec, setReloadSec] = useState(DEFAULT_RELOAD_SEC);
  // Duck-size multiplier (1 = default; 0.5 = ducks half as big), pushed to the
  // server which forwards it to the sprite renderer.
  const [duckScale, setDuckScale] = useState(DEFAULT_DUCK_SCALE);
  // Free-flight timing: after how many seconds a duck flies off, and how fast.
  const [fleeSec, setFleeSec] = useState(DEFAULT_FLEE_SEC);
  const [flySpeed, setFlySpeed] = useState(DEFAULT_FLY_SPEED);
  const firstAmmoSaveRef = useRef(true);

  // Inputs + the bird model, for the "start game" flow.
  const [birdModel, setBirdModel] = useState<AIModelInfo | null>(null);
  const [inputs, setInputs] = useState<Input[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const [starting, setStarting] = useState(false);

  // Load saved base (or default) once on mount.
  useEffect(() => {
    const saved =
      typeof window !== 'undefined'
        ? window.localStorage.getItem(PUBLIC_BASE_KEY)
        : null;
    setBase(saved || defaultPublicBase());
  }, []);

  // Load saved ammo config once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(AMMO_CFG_KEY);
      if (raw) {
        const p = JSON.parse(raw) as {
          maxAmmo?: number;
          reloadSec?: number;
          duckScale?: number;
          fleeSec?: number;
          flySpeed?: number;
        };
        if (typeof p.maxAmmo === 'number') setMaxAmmo(p.maxAmmo);
        if (typeof p.reloadSec === 'number') setReloadSec(p.reloadSec);
        if (typeof p.duckScale === 'number') setDuckScale(p.duckScale);
        if (typeof p.fleeSec === 'number') setFleeSec(p.fleeSec);
        if (typeof p.flySpeed === 'number') setFlySpeed(p.flySpeed);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  // Persist + push ammo config to the server whenever it changes (debounced so
  // dragging a slider doesn't spam requests). Pushes once on mount too so the
  // room adopts the stored panel config.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        AMMO_CFG_KEY,
        JSON.stringify({ maxAmmo, reloadSec, duckScale, fleeSec, flySpeed }),
      );
    } catch {
      /* ignore */
    }
    const delay = firstAmmoSaveRef.current ? 0 : 300;
    firstAmmoSaveRef.current = false;
    const t = window.setTimeout(() => {
      void setDuckHunterConfig(roomId, {
        maxAmmo,
        reloadMs: Math.round(reloadSec * 1000),
        duckScale,
        duckPauseMs: Math.round(fleeSec * 1000),
        duckFlySpeed: flySpeed,
      }).catch(() => {
        /* transient — next change retries */
      });
    }, delay);
    return () => window.clearTimeout(t);
  }, [roomId, maxAmmo, reloadSec, duckScale, fleeSec, flySpeed]);

  // Load the bird model once (used to know which input types are supported).
  useEffect(() => {
    void getAvailableAIModels()
      .then((models) =>
        setBirdModel(models.find((m) => m.id === BIRD_MODEL_ID) ?? null),
      )
      .catch(() => setBirdModel(null));
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

  // Inputs the bird model can run on.
  const eligibleInputs = useMemo(() => {
    if (!birdModel) return [];
    return inputs.filter((i) => birdModel.supportedInputTypes.includes(i.type));
  }, [inputs, birdModel]);

  // Keep a valid selection: default to an input already running the game, else
  // the first eligible one.
  useEffect(() => {
    if (
      selectedInputId &&
      eligibleInputs.some((i) => i.inputId === selectedInputId)
    ) {
      return;
    }
    const active = eligibleInputs.find(
      (i) => i.aiModels?.[BIRD_MODEL_ID]?.ghostMode,
    );
    setSelectedInputId(active?.inputId ?? eligibleInputs[0]?.inputId ?? '');
  }, [eligibleInputs, selectedInputId]);

  const selectedInput = eligibleInputs.find(
    (i) => i.inputId === selectedInputId,
  );
  const gameActive = !!selectedInput?.aiModels?.[BIRD_MODEL_ID]?.ghostMode;

  const shootUrl = useMemo(() => {
    const b = base.trim().replace(/\/+$/, '');
    if (!b) return '';
    return `${b}/mobile/${encodeURIComponent(roomId)}/shoot`;
  }, [base, roomId]);

  const onBaseChange = (value: string) => {
    setBase(value);
    try {
      window.localStorage.setItem(PUBLIC_BASE_KEY, value);
    } catch {
      /* ignore */
    }
  };

  // Enable (or disable) the bird model in duck-sprite mode on the chosen input.
  const toggleGame = useCallback(
    async (on: boolean) => {
      if (!birdModel || !selectedInputId) return;
      setStarting(true);
      try {
        await setAIModel(
          roomId,
          selectedInputId,
          birdModel.id,
          on,
          birdModel.defaultDelayMs,
          false, // drawBoxes off — ghosts and boxes are mutually exclusive
          undefined,
          on, // ghostMode = duck sprites
        );
        await refreshInputs();
      } finally {
        setStarting(false);
      }
    },
    [birdModel, selectedInputId, roomId, refreshInputs],
  );

  return (
    <div className='h-full overflow-y-auto p-4 text-neutral-200'>
      <div className='text-[11px] uppercase tracking-wide text-neutral-500 mb-3'>
        Duck Hunter
      </div>

      <div className='flex flex-col md:flex-row gap-4 items-start'>
        {/* Left — QR + link */}
        <div className='flex flex-col items-center gap-2 shrink-0'>
          {shootUrl ? (
            <div className='rounded-lg bg-white p-3'>
              <QRCode value={shootUrl} size={180} />
            </div>
          ) : (
            <div className='w-[204px] h-[204px] rounded-lg border border-dashed border-neutral-700 flex items-center justify-center text-[11px] text-neutral-500 text-center px-4'>
              Ustaw publiczny adres, aby wygenerować QR
            </div>
          )}
          <Button
            type='button'
            size='sm'
            variant='outline'
            disabled={!shootUrl}
            onClick={() => {
              void navigator.clipboard?.writeText(shootUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}>
            {copied ? 'Skopiowano!' : 'Kopiuj link'}
          </Button>
          <p className='text-[11px] text-neutral-500 text-center max-w-[204px] break-all'>
            {shootUrl}
          </p>
        </div>

        {/* Right — game config */}
        <div className='flex-1 min-w-0 w-full space-y-4'>
          {/* Start game: pick the input with birds, then flip on duck sprites. */}
          <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 space-y-3'>
            <div className='text-sm font-medium'>Gra 🎯</div>
            <div className='space-y-1'>
              <span className='text-[11px] text-neutral-400'>
                Input z kaczkami/ptakami
              </span>
              <Select
                value={selectedInputId}
                onValueChange={setSelectedInputId}>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue placeholder='Wybierz input…' />
                </SelectTrigger>
                <SelectContent>
                  {eligibleInputs.length === 0 ? (
                    <SelectItem value='__none' disabled className='text-xs'>
                      Brak pasujących inputów
                    </SelectItem>
                  ) : (
                    eligibleInputs.map((i) => (
                      <SelectItem
                        key={i.inputId}
                        value={i.inputId}
                        className='text-xs'>
                        {i.title || i.inputId}
                        {i.aiModels?.[BIRD_MODEL_ID]?.ghostMode ? ' • gra' : ''}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              type='button'
              size='sm'
              variant={gameActive ? 'outline' : 'default'}
              disabled={!selectedInputId || starting}
              className='w-full'
              onClick={() => void toggleGame(!gameActive)}>
              {starting ? 'Chwila…' : gameActive ? 'Zakończ grę' : 'Start game'}
            </Button>
            <div className='text-[10px] text-neutral-500'>
              Włącza Bird Counter (tryb kaczek) na wybranym inpucie. Dla
              celności ustaw ten input na pełny ekran (broadcast/solo).
            </div>
          </div>

          {/* Room-wide ammo rules. */}
          <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 space-y-3'>
            <div className='text-sm font-medium'>Amunicja 🔫</div>
            <AmmoSlider
              label='naboje (max)'
              value={maxAmmo}
              display={String(maxAmmo)}
              min={MIN_MAX_AMMO}
              max={MAX_MAX_AMMO}
              step={1}
              onChange={setMaxAmmo}
            />
            <AmmoSlider
              label='przeładowanie'
              value={reloadSec}
              display={`${reloadSec.toFixed(1)}s`}
              min={MIN_RELOAD_SEC}
              max={MAX_RELOAD_SEC}
              step={0.5}
              onChange={setReloadSec}
            />
            <div className='text-[10px] text-neutral-500'>
              Regeneracja: 1 nabój co {reloadSec.toFixed(1)}s. Dotyczy
              wszystkich graczy.
            </div>
          </div>

          {/* Duck size. */}
          <div className='rounded-lg border border-neutral-700 bg-neutral-900/60 p-3 space-y-3'>
            <div className='text-sm font-medium'>Kaczki 🦆</div>
            <AmmoSlider
              label='rozmiar'
              value={duckScale}
              display={`${duckScale.toFixed(2)}×`}
              min={MIN_DUCK_SCALE}
              max={MAX_DUCK_SCALE}
              step={0.05}
              onChange={setDuckScale}
            />
            <div className='text-[10px] text-neutral-500'>
              Mnożnik wielkości sprite'ów kaczek. 1× = domyślny, 0.5× = dwa razy
              mniejsze.
            </div>
            <AmmoSlider
              label='odlot po'
              value={fleeSec}
              display={`${fleeSec.toFixed(1)}s`}
              min={MIN_FLEE_SEC}
              max={MAX_FLEE_SEC}
              step={0.1}
              onChange={setFleeSec}
            />
            <AmmoSlider
              label='prędkość odlotu'
              value={flySpeed}
              display={`${flySpeed.toFixed(2)}×`}
              min={MIN_FLY_SPEED}
              max={MAX_FLY_SPEED}
              step={0.05}
              onChange={setFlySpeed}
            />
            <div className='text-[10px] text-neutral-500'>
              Kaczka stoi w miejscu przez „odlot po”, potem odlatuje z zadaną
              prędkością. Mniejsza prędkość = kaczki dłużej na ekranie.
            </div>
          </div>

          <label className='block text-[11px] text-neutral-500'>
            Publiczny adres (np. tunel HTTPS dla żyroskopu):
            <input
              value={base}
              onChange={(e) => onBaseChange(e.target.value)}
              placeholder='https://xxx.ngrok-free.dev'
              className='mt-1 w-full rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs text-neutral-100'
            />
          </label>

          <p className='text-[11px] text-neutral-500'>
            Żyroskop wymaga HTTPS (tunel). Bez czujnika działa celowanie palcem.
            Wielu graczy = własny celownik i tablica wyników na obrazie.
          </p>
        </div>
      </div>
    </div>
  );
}

function AmmoSlider({
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
