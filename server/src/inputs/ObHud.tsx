import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  InputStream,
  Rescaler,
  Shader,
  Text,
  View,
  useInputStreams,
} from '@swmansion/smelter';
import type { Api } from '@swmansion/smelter';
import type { ObHudState } from '../app/store';
import { KBT_VIEW_TRANSITION_MS } from '../app/store';
import { dipOpacity } from '../obVan/program';
import { ObQuizOverlay } from './ObQuizHud';
import { TransitionShaderWrapper } from './transitionWrapper';

type TextWeight = Api.TextWeight;
type Resolution = { width: number; height: number };

/**
 * OB Van broadcast chrome: a dark control-room look with red tally accents.
 * Static plates come from scripts/ob-render-assets.mjs (imgs/ob/*.png,
 * registered as `ob-<name>`); this file draws the dynamic values on top at
 * the design's 1080p positions scaled by resolution.height/1080.
 *
 * Every time-driven value (lower-third fade-in, dip opacity) is computed in
 * the render body from wall time: smelter-core ships each commit to the
 * engine BEFORE effects run, so a value seeded in state / an effect would
 * air one stale frame. Intervals only force re-renders.
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const CHALK = '#F2F4F8';
const DIM = '#F2F4F8B3';
const DIM2 = '#F2F4F880';
const RED = '#FF2D2D';
const GREEN = '#22C55E';
const AMBER = '#FFB020';
const SKY = '#38BDF8';
const INK = '#0A0C10';
const FRAME_MS = 33;
const LOWER_THIRD_FADE_MS = 250;

function Art({
  id,
  x,
  y,
  w,
  h,
  k,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
}) {
  const width = Math.round(w * k);
  const height = Math.round(h * k);
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width,
        height,
        overflow: 'hidden',
      }}>
      <Rescaler style={{ width, height, rescaleMode: 'fit' }}>
        <Image imageId={id} />
      </Rescaler>
    </View>
  );
}

function Block({
  x,
  y,
  w,
  h,
  k,
  color,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  color: string;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.max(1, Math.round(w * k)),
        height: Math.max(1, Math.round(h * k)),
        backgroundColor: color,
      }}
    />
  );
}

function Group({
  x,
  y,
  w,
  h,
  k,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  k: number;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.round(w * k),
        height: Math.round(h * k),
        overflow: 'visible',
      }}>
      {children}
    </View>
  );
}

const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

function Label({
  x,
  y = 0,
  w,
  text,
  fs,
  k,
  color = CHALK,
  font = DISPLAY,
  weight = 'extra_bold',
  align = 'left',
  centerIn,
}: {
  x: number;
  y?: number;
  w: number;
  text: string;
  fs: number;
  k: number;
  color?: string;
  font?: string;
  weight?: TextWeight;
  align?: 'left' | 'center' | 'right';
  centerIn?: number;
}) {
  const width = Math.round(w * k);
  const top =
    centerIn != null ? y + centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
  return (
    <View
      style={{
        top: Math.round(top * k),
        left: Math.round(x * k),
        width,
        height: Math.round(fs * 1.45 * k),
        overflow: 'hidden',
      }}>
      <Text
        style={{
          fontSize: Math.round(fs * k),
          color,
          width,
          align,
          fontFamily: font,
          fontWeight: weight,
        }}>
        {text}
      </Text>
    </View>
  );
}

/** Re-render every frame until `untilMs` (wall time); the value is derived in render. */
function useFrameTicker(untilMs: number | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (untilMs == null || Date.now() >= untilMs) return;
    const timer = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= untilMs) clearInterval(timer);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [untilMs]);
}

// ── On-air chrome ─────────────────────────────────────────────────────────

const TITLE_BUG = { x: 56, y: 44, w: 640, h: 64 };

function TitleBug({
  bug,
  k,
}: {
  bug: NonNullable<ObHudState['titleBug']>;
  k: number;
}) {
  return (
    <Group
      x={TITLE_BUG.x}
      y={TITLE_BUG.y}
      w={TITLE_BUG.w}
      h={TITLE_BUG.h}
      k={k}>
      <Art
        id='ob-title-bug-plate'
        x={0}
        y={0}
        w={TITLE_BUG.w}
        h={TITLE_BUG.h}
        k={k}
      />
      <Label
        x={120}
        y={0}
        w={bug.segment ? 250 : 490}
        text={bug.event.toUpperCase()}
        fs={30}
        k={k}
        centerIn={64}
      />
      {bug.segment ? (
        <Label
          x={380}
          y={0}
          w={236}
          text={bug.segment.toUpperCase()}
          fs={15}
          k={k}
          font={MONO}
          weight='semi_bold'
          color={DIM}
          align='right'
          centerIn={64}
        />
      ) : null}
    </Group>
  );
}

const LOWER_THIRD = { x: 96, y: 832, w: 980, h: 150 };

function LowerThird({
  lt,
  k,
  resolution,
}: {
  lt: NonNullable<ObHudState['lowerThird']>;
  k: number;
  resolution: Resolution;
}) {
  return (
    <TransitionShaderWrapper
      transition={{
        type: 'fade',
        durationMs: LOWER_THIRD_FADE_MS,
        direction: 'in',
        startedAtMs: lt.startedAtMs,
      }}
      resolution={resolution}>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
          overflow: 'visible',
        }}>
        <Group
          x={LOWER_THIRD.x}
          y={LOWER_THIRD.y}
          w={LOWER_THIRD.w}
          h={LOWER_THIRD.h}
          k={k}>
          <Art
            id='ob-lower-third-plate'
            x={0}
            y={0}
            w={LOWER_THIRD.w}
            h={LOWER_THIRD.h}
            k={k}
          />
          <Label
            x={48}
            y={18}
            w={900}
            text={lt.name.toUpperCase()}
            fs={62}
            k={k}
            weight='black'
          />
          {lt.subtitle ? (
            <Label
              x={50}
              y={104}
              w={880}
              text={lt.subtitle}
              fs={22}
              k={k}
              font={MONO}
              weight='medium'
              color={DIM}
            />
          ) : null}
        </Group>
      </View>
    </TransitionShaderWrapper>
  );
}

const REPLAY_PLATE = { x: 312, y: 162, w: 1296, h: 764 };
const REPLAY_CLIP = { x: 320, y: 204, w: 1280, h: 720 };

function ReplayWindow({
  replay,
  k,
  resolution,
}: {
  replay: NonNullable<ObHudState['stage']['replay']>;
  k: number;
  resolution: Resolution;
}) {
  const streams = useInputStreams();
  const playing = streams[replay.inputId]?.videoState === 'playing';
  const clipW = Math.round(REPLAY_CLIP.w * k);
  const clipH = Math.round(REPLAY_CLIP.h * k);
  return (
    <>
      <View
        style={{
          top: 0,
          left: 0,
          width: resolution.width,
          height: resolution.height,
          backgroundColor: '#0A0C10B3',
        }}
      />
      <Block
        x={REPLAY_CLIP.x}
        y={REPLAY_CLIP.y}
        w={REPLAY_CLIP.w}
        h={REPLAY_CLIP.h}
        k={k}
        color='#05070A'
      />
      {playing ? (
        <View
          style={{
            top: Math.round(REPLAY_CLIP.y * k),
            left: Math.round(REPLAY_CLIP.x * k),
            width: clipW,
            height: clipH,
            overflow: 'hidden',
          }}>
          <Rescaler
            style={{ width: clipW, height: clipH, rescaleMode: 'fill' }}>
            <InputStream inputId={replay.inputId} />
          </Rescaler>
        </View>
      ) : null}
      <Art
        id='ob-replay-frame'
        x={REPLAY_PLATE.x}
        y={REPLAY_PLATE.y}
        w={REPLAY_PLATE.w}
        h={REPLAY_PLATE.h}
        k={k}
      />
      <Group
        x={REPLAY_PLATE.x}
        y={REPLAY_PLATE.y}
        w={REPLAY_PLATE.w}
        h={42}
        k={k}>
        <Label
          x={700}
          y={8}
          w={580}
          text={replay.camName.toUpperCase()}
          fs={22}
          k={k}
          align='right'
          centerIn={26}
        />
      </Group>
    </>
  );
}

// ── Setup slate ───────────────────────────────────────────────────────────

const SETUP_PANEL = { x: 96, y: 300, w: 1728, h: 680 };

function SetupScene({
  setup,
  k,
}: {
  setup: NonNullable<ObHudState['setup']>;
  k: number;
}) {
  return (
    <>
      <Art id='ob-setup-scrim' x={0} y={0} w={1920} h={1080} k={k} />
      <Art id='ob-setup-title' x={96} y={70} w={900} h={190} k={k} />
      <Label
        x={1000}
        y={96}
        w={824}
        text={setup.eventName.toUpperCase()}
        fs={64}
        k={k}
        align='right'
        weight='black'
      />
      <Label
        x={1000}
        y={196}
        w={824}
        text={setup.presetLabel.toUpperCase()}
        fs={18}
        k={k}
        font={MONO}
        weight='semi_bold'
        color={SKY}
        align='right'
      />
      <Group
        x={SETUP_PANEL.x}
        y={SETUP_PANEL.y}
        w={SETUP_PANEL.w}
        h={SETUP_PANEL.h}
        k={k}>
        <Art
          id='ob-setup-panel'
          x={0}
          y={0}
          w={SETUP_PANEL.w}
          h={SETUP_PANEL.h}
          k={k}
        />
        {setup.qr.imageId ? (
          <Art id={setup.qr.imageId} x={58} y={130} w={260} h={260} k={k} />
        ) : null}
        {setup.qr.label ? (
          <Label
            x={48}
            y={500}
            w={320}
            text={setup.qr.label}
            fs={12}
            k={k}
            font={MONO}
            weight='normal'
            color={DIM2}
          />
        ) : null}
        {setup.cams.length === 0 ? (
          <Label
            x={440}
            y={140}
            w={1200}
            text='○ WAITING FOR CAMERAS · SCAN THE CODE OR ATTACH A CLIP'
            fs={20}
            k={k}
            font={MONO}
            weight='medium'
            color={AMBER}
            centerIn={40}
          />
        ) : (
          setup.cams.slice(0, 8).map((c, i) => {
            const y = 130 + i * 62;
            return (
              <React.Fragment key={c.number}>
                <Block
                  x={440}
                  y={y}
                  w={56}
                  h={48}
                  k={k}
                  color={c.live ? RED : '#2A2F38'}
                />
                <Label
                  x={440}
                  y={y}
                  w={56}
                  text={String(c.number)}
                  fs={32}
                  k={k}
                  align='center'
                  centerIn={48}
                />
                <Label
                  x={520}
                  y={y}
                  w={640}
                  text={c.name.toUpperCase()}
                  fs={30}
                  k={k}
                  centerIn={48}
                />
                <Label
                  x={1170}
                  y={y}
                  w={260}
                  text={`${c.role} · ${c.kind === 'whip' ? 'PHONE' : c.kind === 'file' ? 'FILE' : 'INPUT'}`}
                  fs={15}
                  k={k}
                  font={MONO}
                  weight='semi_bold'
                  color={DIM}
                  centerIn={48}
                />
                <Label
                  x={1440}
                  y={y}
                  w={240}
                  text={c.live ? '● LIVE' : '○ WAITING'}
                  fs={16}
                  k={k}
                  font={MONO}
                  weight='semi_bold'
                  color={c.live ? GREEN : AMBER}
                  align='right'
                  centerIn={48}
                />
              </React.Fragment>
            );
          })
        )}
      </Group>
    </>
  );
}

// ── Wrap card ─────────────────────────────────────────────────────────────

const WRAP_PANEL = { x: 360, y: 150, w: 1200, h: 780 };

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function WrapScene({
  wrap,
  k,
}: {
  wrap: NonNullable<ObHudState['wrap']>;
  k: number;
}) {
  const stats: [string, string][] = [
    ['CUTS', String(wrap.cuts)],
    ['AVG HOLD', `${(wrap.avgHoldMs / 1000).toFixed(1)} s`],
    ['ON AIR', fmtDuration(wrap.durationMs)],
  ];
  const sources = (['operator', 'auto', 'llm', 'system'] as const)
    .map((s) => `${s.toUpperCase()} ${wrap.bySource[s]}`)
    .join('   ·   ');
  return (
    <>
      <Art id='ob-setup-scrim' x={0} y={0} w={1920} h={1080} k={k} />
      <Group
        x={WRAP_PANEL.x}
        y={WRAP_PANEL.y}
        w={WRAP_PANEL.w}
        h={WRAP_PANEL.h}
        k={k}>
        <Art
          id='ob-wrap-panel'
          x={0}
          y={0}
          w={WRAP_PANEL.w}
          h={WRAP_PANEL.h}
          k={k}
        />
        <Label
          x={56}
          y={150}
          w={1088}
          text={wrap.eventName.toUpperCase()}
          fs={40}
          k={k}
          color={DIM}
        />
        {stats.map(([label, value], i) => (
          <React.Fragment key={label}>
            <Label
              x={56 + i * 370}
              y={226}
              w={340}
              text={value}
              fs={110}
              k={k}
              weight='black'
            />
            <Label
              x={60 + i * 370}
              y={372}
              w={340}
              text={label}
              fs={16}
              k={k}
              font={MONO}
              weight='semi_bold'
              color={DIM}
            />
          </React.Fragment>
        ))}
        <Label
          x={60}
          y={430}
          w={1080}
          text={sources}
          fs={16}
          k={k}
          font={MONO}
          weight='medium'
          color={SKY}
        />
        {wrap.shares.map((s, i) => {
          const y = 490 + i * 42;
          return (
            <React.Fragment key={s.number}>
              <Label
                x={60}
                y={y}
                w={380}
                text={`${s.number} · ${s.name.toUpperCase()}`}
                fs={22}
                k={k}
                centerIn={30}
              />
              <Block
                x={450}
                y={y + 9}
                w={Math.max(4, (s.pct / 100) * 560)}
                h={14}
                k={k}
                color={i === 0 ? RED : '#8A93A3'}
              />
              <Label
                x={1030}
                y={y}
                w={110}
                text={`${s.pct}%`}
                fs={18}
                k={k}
                font={MONO}
                weight='semi_bold'
                align='right'
                color={DIM}
                centerIn={30}
              />
            </React.Fragment>
          );
        })}
      </Group>
    </>
  );
}

// ── Dip to black ──────────────────────────────────────────────────────────

/** Full-frame black plate; opacity from `dipOpacity` in the render body. */
function DipPlate({
  dip,
  resolution,
}: {
  dip: NonNullable<ObHudState['stage']['dip']>;
  resolution: Resolution;
}) {
  const endsAt = dip.startedAtMs + dip.inMs + dip.holdMs + dip.outMs;
  useFrameTicker(endsAt);
  const opacity = dipOpacity(dip, Date.now());
  return (
    <Shader
      shaderId='opacity'
      resolution={resolution}
      shaderParam={{
        type: 'struct',
        value: [{ type: 'f32', fieldName: 'opacity', value: opacity }],
      }}>
      <View
        style={{
          width: resolution.width,
          height: resolution.height,
          backgroundColor: INK,
        }}
      />
    </Shader>
  );
}

// ── Scene dispatch + crossfade ────────────────────────────────────────────

function SceneChrome({
  hud,
  resolution,
}: {
  hud: ObHudState;
  resolution: Resolution;
}) {
  const k = resolution.height / 1080;
  const { phase, replay } = hud.stage;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {phase === 'setup' && hud.setup ? (
        <SetupScene setup={hud.setup} k={k} />
      ) : null}
      {phase === 'wrap' && hud.wrap ? (
        <WrapScene wrap={hud.wrap} k={k} />
      ) : null}
      {phase !== 'setup' && replay ? (
        <ReplayWindow replay={replay} k={k} resolution={resolution} />
      ) : null}
      {phase === 'on-air' && hud.quiz && !replay ? (
        <ObQuizOverlay quiz={hud.quiz} k={k} resolution={resolution} />
      ) : null}
      {hud.titleBug ? <TitleBug bug={hud.titleBug} k={k} /> : null}
      {hud.lowerThird && !replay && !hud.quiz?.board ? (
        <LowerThird
          key={hud.lowerThird.startedAtMs}
          lt={hud.lowerThird}
          k={k}
          resolution={resolution}
        />
      ) : null}
    </View>
  );
}

/** OB Van chrome; crossfades over KBT_VIEW_TRANSITION_MS when the phase / replay changes. */
export function ObMatchHud({
  hud,
  resolution,
}: {
  hud: ObHudState;
  resolution: Resolution;
}) {
  const swapKey = `${hud.stage.phase}|${hud.stage.replay?.inputId ?? ''}`;
  const lastRef = useRef({ key: swapKey, hud });
  const [outgoingState, setOutgoing] = useState<{
    hud: ObHudState;
    startedAtMs: number;
  } | null>(null);
  let outgoing = outgoingState;
  if (lastRef.current.key !== swapKey) {
    outgoing = { hud: lastRef.current.hud, startedAtMs: Date.now() };
    setOutgoing(outgoing);
  }
  lastRef.current = { key: swapKey, hud };
  useEffect(() => {
    if (!outgoing) return;
    const timer = setTimeout(() => setOutgoing(null), KBT_VIEW_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [outgoing]);
  const frame = {
    top: 0,
    left: 0,
    width: resolution.width,
    height: resolution.height,
  };
  const dip = hud.stage.dip;
  return (
    <View style={{ ...frame, overflow: 'visible' }}>
      {outgoing ? (
        <View style={frame}>
          <TransitionShaderWrapper
            transition={{
              type: 'fade',
              durationMs: KBT_VIEW_TRANSITION_MS,
              direction: 'out',
              startedAtMs: outgoing.startedAtMs,
            }}
            resolution={resolution}>
            <SceneChrome hud={outgoing.hud} resolution={resolution} />
          </TransitionShaderWrapper>
        </View>
      ) : null}
      {outgoing ? (
        <View style={frame}>
          <TransitionShaderWrapper
            transition={{
              type: 'fade',
              durationMs: KBT_VIEW_TRANSITION_MS,
              direction: 'in',
              startedAtMs: outgoing.startedAtMs,
            }}
            resolution={resolution}>
            <SceneChrome hud={hud} resolution={resolution} />
          </TransitionShaderWrapper>
        </View>
      ) : (
        <SceneChrome hud={hud} resolution={resolution} />
      )}
      {dip ? (
        <View style={frame}>
          <DipPlate key={dip.startedAtMs} dip={dip} resolution={resolution} />
        </View>
      ) : null}
    </View>
  );
}

/** Backdrop is blurred at 1/8 of the output, then scaled up (cheap and smooth). */
const BACKDROP_DOWNSCALE = 8;

/** Blurred full-frame copy of the main camera behind split / PiP / portrait shots. */
export function ObBackdrop({
  inputId,
  resolution,
}: {
  inputId: string;
  resolution: Resolution;
}) {
  const { width, height } = resolution;
  const small = {
    width: Math.max(16, Math.round(width / BACKDROP_DOWNSCALE)),
    height: Math.max(16, Math.round(height / BACKDROP_DOWNSCALE)),
  };
  return (
    <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
      <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
        <Shader
          shaderId='blur'
          resolution={small}
          shaderParam={{
            type: 'struct',
            value: [
              { type: 'f32', fieldName: 'radius', value: 1.5 },
              { type: 'f32', fieldName: 'strength', value: 1 },
              { type: 'f32', fieldName: 'direction_x', value: 0 },
              { type: 'f32', fieldName: 'direction_y', value: 0 },
              { type: 'f32', fieldName: 'preserve_alpha', value: 0 },
              { type: 'f32', fieldName: 'quality', value: 3 },
            ],
          }}>
          <View style={small}>
            <Rescaler style={{ ...small, rescaleMode: 'fill' }}>
              <InputStream inputId={inputId} volume={0} />
            </Rescaler>
          </View>
        </Shader>
      </Rescaler>
      <View
        style={{
          top: 0,
          left: 0,
          width,
          height,
          backgroundColor: '#0A0C10A6',
        }}
      />
    </View>
  );
}
