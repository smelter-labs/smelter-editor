'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getMP4Suggestions,
  listHlsStreams,
  loadHlsStream,
  saveHlsStream,
} from '@/app/actions/actions';
import type { MatchSetup } from '../arcade';
import {
  stageKey,
  stageLabel,
  type DuckHunterSliderConfig,
  type StageRef,
} from '../use-duck-hunter-room';
import {
  ACCENT_RGB,
  LedText,
  PanelTitle,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

const TIME_PRESETS_MS = [30_000, 60_000, 90_000, 120_000] as const;
const POINT_PRESETS = [10, 25, 50] as const;

// Slider bounds — mirror the server clamps (DuckHunterController/RoomState),
// same as the dashboard DuckHunterPanel.
const SLIDER_DEFS: Array<{
  key: keyof DuckHunterSliderConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}> = [
  {
    key: 'maxAmmo',
    label: 'ROUNDS',
    min: 1,
    max: 12,
    step: 1,
    format: (v) => String(v),
  },
  {
    key: 'reloadSec',
    label: 'RELOAD',
    min: 1,
    max: 30,
    step: 0.5,
    format: (v) => `${v.toFixed(1)}S`,
  },
  {
    key: 'duckScale',
    label: 'DUCK SIZE',
    min: 0.25,
    max: 3,
    step: 0.05,
    format: (v) => `${v.toFixed(2)}X`,
  },
  {
    key: 'fleeSec',
    label: 'FLY OFF',
    min: 0,
    max: 10,
    step: 0.1,
    format: (v) => `${v.toFixed(1)}S`,
  },
  {
    key: 'flySpeed',
    label: 'FLY SPEED',
    min: 0.1,
    max: 2,
    step: 0.05,
    format: (v) => `${v.toFixed(2)}X`,
  },
];

/** A saved-library HLS stream hydrated with its URL. */
type SavedHls = { fileName: string; name: string; url: string };

type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; objectUrl: string }
  | { state: 'error'; message: string };

/**
 * Mode + config: pick TIME ATTACK or SCORE RUSH (with presets), the hunt
 * stage (mp4s with "ducks" in the name from the server library, or a saved /
 * custom HLS stream — this is where ducks are detected and spawned) and the
 * room tuning sliders.
 */
export function ModeSelect({
  setup,
  onSetup,
  sliders,
  onSliders,
  stage,
  onStage,
  onConfirm,
  onBack,
}: {
  setup: MatchSetup;
  onSetup: (s: MatchSetup) => void;
  sliders: DuckHunterSliderConfig;
  onSliders: (s: DuckHunterSliderConfig) => void;
  stage: StageRef;
  onStage: (s: StageRef) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [mp4s, setMp4s] = useState<string[]>([]);
  const [savedHls, setSavedHls] = useState<SavedHls[]>([]);

  useEffect(() => {
    void getMP4Suggestions()
      .then((s) => setMp4s(s.mp4s))
      .catch(() => setMp4s([]));
    // The list endpoint has no URLs — hydrate each saved stream, dropping
    // ones that fail to load.
    void listHlsStreams()
      .then(async (res) => {
        if (!res.ok) return;
        const loaded = await Promise.all(
          res.items.map(async (item) => {
            const stream = await loadHlsStream(item.fileName);
            return stream.ok
              ? {
                  fileName: item.fileName,
                  name: stream.name,
                  url: stream.data.url,
                }
              : null;
          }),
        );
        setSavedHls(loaded.filter((s): s is SavedHls => s !== null));
      })
      .catch(() => setSavedHls([]));
  }, []);

  // Hunting grounds: mp4s with "ducks" in the path (the character select-
  // screen clips are menu assets, excluded regardless) plus saved HLS streams.
  const stages = useMemo<StageRef[]>(() => {
    const mp4Stages: StageRef[] = mp4s
      .filter((f) => !f.startsWith('duck-hunter-characters/'))
      .filter((f) => f.toLowerCase().includes('ducks'))
      .map((file) => ({ kind: 'mp4', file }));
    const hlsStages: StageRef[] = savedHls.map(({ url, name }) => ({
      kind: 'hls',
      url,
      name,
    }));
    const list = [...mp4Stages, ...hlsStages];
    // Keep the current pick visible even before the suggestions load.
    return list.some((s) => stageKey(s) === stageKey(stage))
      ? list
      : [stage, ...list];
  }, [mp4s, savedHls, stage]);

  // Saved-stream thumbnails are keyed by library file name, which StageRef
  // doesn't carry — look it up by URL (a fresh custom URL falls back to the
  // preview endpoint's disk cache).
  const hlsThumbByUrl = useMemo(
    () => new Map(savedHls.map((s) => [s.url, s.fileName])),
    [savedHls],
  );

  const stageIdx = Math.max(
    0,
    stages.findIndex((s) => stageKey(s) === stageKey(stage)),
  );

  useArcadeKeys({
    left: () => onSetup({ ...setup, mode: 'time' }),
    right: () => onSetup({ ...setup, mode: 'points' }),
    up: () => {
      if (stages.length > 0) {
        onStage(stages[(stageIdx - 1 + stages.length) % stages.length]);
      }
    },
    down: () => {
      if (stages.length > 0) {
        onStage(stages[(stageIdx + 1) % stages.length]);
      }
    },
    confirm: onConfirm,
    back: onBack,
  });

  // ── Custom HLS entry ──────────────────────────────────────
  const [customUrl, setCustomUrl] = useState('');
  const [preview, setPreview] = useState<PreviewState>({ state: 'idle' });
  const [savingCustom, setSavingCustom] = useState(false);
  // Invalidates in-flight previews when the URL changes; also owns revoking
  // the previous frame's object URL.
  const previewSeqRef = useRef(0);
  const previewObjectUrlRef = useRef<string | null>(null);

  const applyPreview = (next: PreviewState) => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    if (next.state === 'ready') previewObjectUrlRef.current = next.objectUrl;
    setPreview(next);
  };

  useEffect(
    () => () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    },
    [],
  );

  const runPreview = async () => {
    const url = customUrl.trim();
    if (!url || preview.state === 'loading') return;
    const seq = ++previewSeqRef.current;
    applyPreview({ state: 'loading' });
    try {
      const res = await fetch(
        `/api/hls-preview?url=${encodeURIComponent(url)}`,
      );
      if (seq !== previewSeqRef.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        applyPreview({
          state: 'error',
          message: body?.error ?? 'Preview failed',
        });
        return;
      }
      const objectUrl = URL.createObjectURL(await res.blob());
      if (seq !== previewSeqRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      applyPreview({ state: 'ready', objectUrl });
    } catch {
      if (seq !== previewSeqRef.current) return;
      applyPreview({ state: 'error', message: 'Preview failed' });
    }
  };

  const confirmCustomStage = async () => {
    const url = customUrl.trim();
    if (!url || savingCustom) return;
    setSavingCustom(true);
    try {
      const existing = savedHls.find((s) => s.url === url);
      let name = existing?.name;
      if (!name) {
        try {
          name = new URL(url).hostname;
        } catch {
          name = url;
        }
        const saved = await saveHlsStream(name, { url });
        if (!saved.ok) {
          applyPreview({ state: 'error', message: saved.error });
          return;
        }
        name = saved.name;
        setSavedHls((prev) => [
          ...prev,
          { fileName: saved.fileName, name: saved.name, url },
        ]);
      }
      onStage({ kind: 'hls', url, name });
      setCustomUrl('');
      previewSeqRef.current++;
      applyPreview({ state: 'idle' });
    } finally {
      setSavingCustom(false);
    }
  };

  const modeCard = (
    mode: MatchSetup['mode'],
    title: string,
    desc: string,
    presets: React.ReactNode,
  ) => {
    const active = setup.mode === mode;
    const accent = active ? 'yellow' : 'blue';
    // A div, not a <button>: the preset chips inside are buttons themselves
    // and buttons must not nest.
    return (
      <div
        role='button'
        tabIndex={0}
        className='r5-btn'
        onClick={() => onSetup({ ...setup, mode })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSetup({ ...setup, mode });
        }}
        style={{ display: 'block', width: '100%' }}>
        <PixelPanel
          accent={accent}
          cut={10}
          glow={active ? 0.7 : 0}
          fill={active ? `rgba(${ACCENT_RGB.yellow},0.08)` : undefined}
          innerStyle={{
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
          <span
            style={{
              fontFamily: pixelFont,
              fontSize: 13,
              letterSpacing: 1.5,
              color: active ? R5.yellow : R5.ink,
              textShadow: active
                ? `0 0 10px rgba(${R5.yellowRgb},0.6)`
                : undefined,
            }}>
            {title}
          </span>
          <span
            style={{ fontFamily: monoFont, fontSize: 11, color: R5.inkMuted }}>
            {desc}
          </span>
          {/* Wraps: four time presets overflow the 330px mode column otherwise. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {presets}
          </div>
        </PixelPanel>
      </div>
    );
  };

  const presetChip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type='button'
      className='r5-btn'
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        fontFamily: pixelFont,
        fontSize: 10,
        letterSpacing: 1,
        padding: '6px 10px',
        color: active ? R5.bgDeep : R5.inkMuted,
        background: active ? R5.yellow : 'rgba(120,150,200,0.12)',
        boxShadow: active
          ? `0 0 8px rgba(${R5.yellowRgb},0.6)`
          : 'inset 0 0 0 1px rgba(120,150,200,0.25)',
      }}>
      {label}
    </button>
  );

  return (
    <RetroFrame
      title='GAME SETUP'
      eyebrow='DUCK HUNTER'
      titleSize={26}
      footer={
        <RetroFooter
          tip='◀ ▶ mode · ▲ ▼ stage · enter lobby'
          right={
            <div style={{ display: 'flex', gap: 12 }}>
              <PixelButton
                accent='red'
                glyph='B'
                label='BACK'
                onClick={onBack}
              />
              <PixelButton
                accent='green'
                glyph='A'
                label='OPEN LOBBY'
                active
                onClick={onConfirm}
              />
            </div>
          }
        />
      }>
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
        {/* Mode */}
        <div
          style={{
            width: 330,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>MODE</PanelTitle>
          {modeCard(
            'time',
            'TIME ATTACK',
            'Fixed clock. Most ducks when the timer hits zero wins.',
            TIME_PRESETS_MS.map((ms) =>
              presetChip(
                `${ms / 1000}S`,
                setup.mode === 'time' && setup.durationMs === ms,
                () => onSetup({ ...setup, mode: 'time', durationMs: ms }),
              ),
            ),
          )}
          {modeCard(
            'points',
            'SCORE RUSH',
            'No clock. First hunter to the target score wins.',
            POINT_PRESETS.map((n) =>
              presetChip(
                `${n} PTS`,
                setup.mode === 'points' && setup.targetScore === n,
                () => onSetup({ ...setup, mode: 'points', targetScore: n }),
              ),
            ),
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              justifyContent: 'center',
              marginTop: 4,
            }}>
            <span
              style={{
                fontFamily: monoFont,
                fontSize: 11,
                color: R5.inkMuted,
                textTransform: 'uppercase',
              }}>
              round
            </span>
            <LedText size={26}>
              {setup.mode === 'time'
                ? `${setup.durationMs / 1000}s`
                : `${setup.targetScore} pts`}
            </LedText>
          </div>
        </div>

        {/* Hunting grounds (stage mp4) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>HUNTING GROUNDS</PanelTitle>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              paddingRight: 6,
            }}>
            {stages.length === 0 ? (
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 12,
                  color: R5.inkMuted,
                }}>
                No &apos;ducks&apos; footage on the server — drop mp4s with
                &quot;ducks&quot; in the name into data/mp4s, or paste an HLS
                URL below.
              </span>
            ) : (
              stages.map((s) => {
                const active = stageKey(s) === stageKey(stage);
                const thumbSrc =
                  s.kind === 'mp4'
                    ? `/api/mp4-thumbnail?fileName=${encodeURIComponent(s.file)}`
                    : hlsThumbByUrl.has(s.url)
                      ? `/api/hls-thumbnail/${encodeURIComponent(hlsThumbByUrl.get(s.url)!)}`
                      : `/api/hls-preview?url=${encodeURIComponent(s.url)}`;
                return (
                  <button
                    key={stageKey(s)}
                    type='button'
                    className='r5-btn'
                    onClick={() => onStage(s)}
                    style={{ display: 'block', width: '100%' }}>
                    <PixelPanel
                      accent={active ? 'yellow' : 'blue'}
                      cut={8}
                      glow={active ? 0.6 : 0}
                      innerStyle={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: 8,
                      }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumbSrc}
                        alt=''
                        width={92}
                        height={52}
                        style={{
                          width: 92,
                          height: 52,
                          objectFit: 'cover',
                          background: R5.panelDark,
                          imageRendering: 'auto',
                          flexShrink: 0,
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.visibility =
                            'hidden';
                        }}
                      />
                      <span
                        style={{
                          fontFamily: monoFont,
                          fontSize: 12,
                          color: active ? R5.yellow : R5.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                          minWidth: 0,
                          textAlign: 'left',
                        }}>
                        {stageLabel(s)}
                      </span>
                      {s.kind === 'hls' ? (
                        <LedText size={12}>HLS</LedText>
                      ) : null}
                    </PixelPanel>
                  </button>
                );
              })
            )}
          </div>
          <PixelPanel
            cut={8}
            innerStyle={{
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 8,
                letterSpacing: 1,
                color: R5.ink,
              }}>
              CUSTOM HLS STREAM
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type='text'
                value={customUrl}
                placeholder='https://example.com/stream.m3u8'
                onChange={(e) => {
                  setCustomUrl(e.target.value);
                  previewSeqRef.current++;
                  applyPreview({ state: 'idle' });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runPreview();
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: monoFont,
                  fontSize: 12,
                  color: R5.ink,
                  background: R5.panelDark,
                  border: '1px solid rgba(120,150,200,0.35)',
                  outline: 'none',
                  padding: '6px 8px',
                }}
              />
              <PixelButton
                accent='blue'
                glyph='▶'
                label={preview.state === 'loading' ? 'LOADING' : 'PREVIEW'}
                disabled={preview.state === 'loading' || !customUrl.trim()}
                onClick={() => void runPreview()}
              />
            </div>
            {preview.state === 'error' ? (
              <span
                style={{ fontFamily: monoFont, fontSize: 11, color: R5.red }}>
                STREAM PREVIEW FAILED — {preview.message}
              </span>
            ) : null}
            {preview.state === 'ready' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview.objectUrl}
                  alt=''
                  width={120}
                  height={68}
                  style={{
                    width: 120,
                    height: 68,
                    objectFit: 'cover',
                    background: R5.panelDark,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 11,
                    color: R5.inkMuted,
                    flex: 1,
                  }}>
                  Stream reachable — frame grabbed by the server.
                </span>
                <PixelButton
                  accent='green'
                  glyph='✓'
                  label={savingCustom ? 'SAVING' : 'USE STAGE'}
                  disabled={savingCustom}
                  onClick={() => void confirmCustomStage()}
                />
              </div>
            ) : null}
          </PixelPanel>
          <span
            style={{ fontFamily: monoFont, fontSize: 10, color: R5.inkMuted }}>
            Ducks are detected in this footage and turned into targets.
          </span>
        </div>

        {/* Tuning sliders */}
        <div
          style={{
            width: 300,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
          <PanelTitle>TUNING</PanelTitle>
          <PixelPanel
            cut={10}
            innerStyle={{
              padding: '16px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}>
            {SLIDER_DEFS.map((def) => (
              <label key={def.key} style={{ display: 'block' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 4,
                  }}>
                  <span
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 8,
                      letterSpacing: 1,
                      color: R5.ink,
                    }}>
                    {def.label}
                  </span>
                  <LedText size={16}>{def.format(sliders[def.key])}</LedText>
                </div>
                <input
                  type='range'
                  className='r5-range'
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={sliders[def.key]}
                  onChange={(e) =>
                    onSliders({
                      ...sliders,
                      [def.key]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </PixelPanel>
        </div>
      </div>
    </RetroFrame>
  );
}
