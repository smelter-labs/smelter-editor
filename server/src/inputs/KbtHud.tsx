import React, { useEffect, useRef, useState } from 'react';
import { Image, Rescaler, Text, View } from '@swmansion/smelter';
import type { KbtHudState, KbtHudTile } from '../app/store';
import {
  KBT_VIEW_TRANSITION_MS,
  barScale,
  kbtCasterCamRect,
  kbtCasterVisible,
} from '../app/store';
import type { KbtViewTransitionStyle } from '@smelter-editor/types';
import { KBT_EXERCISE_COLORS } from '@smelter-editor/types';
import { KbtRepFloaters } from './KbtRepFloat';
import { TransitionShaderWrapper } from './transitionWrapper';

/**
 * Kettlebell Tournament broadcast chrome — a port of the approved kb_design
 * ("Smelter Overlays"): dark industrial plates with cut corners, accent
 * #FF5A1F, Big Shoulders Display + IBM Plex Mono. The static art (frames,
 * plates, baked labels) is pre-rendered by scripts/kbt-render-assets.mjs into
 * imgs/kbt/*.png (registered as `kbt-<name>`); this file composites the
 * dynamic values (reps, clock, names, RPM, QR) on top. All coordinates are
 * the design's 1080p pixel values scaled by resolution.height/1080 — when an
 * offset changes here, check the matching fragment in the render script.
 *
 * Every value rendered here comes from a snapshot the controller applied with
 * a ~3s hold (matching the delayed WHIP video), so time-based effects must use
 * snapshot fields (flash, remainingMs) — never live Date.now() age math. The
 * ~10 Hz snapshot cadence is what animates flashes and the clock blink.
 */

const DISPLAY = 'Big Shoulders Display';
const MONO = 'IBM Plex Mono';
const ACCENT = '#FF5A1F';
const CREAM = '#E8E4DA';
const DIM = '#E8E4DA8C';
const DARK = '#0D0E10';
const BG = '#0D0E10F0';
const GOOD = '#38E08A';
const AMBER = '#FFB800';
const BAD = '#FF4030';
const SILVER = '#C9CED6';
const BRONZE = '#A9743F';
const RANK_COLORS = [ACCENT, SILVER, BRONZE];

type Resolution = { width: number; height: number };

function formatClock(ms: number | null): string {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** IBM Plex Mono advance width is exactly 0.6em. */
function monoW(label: string, fontSize: number): number {
  return Math.ceil(fontSize * 0.6 * (label.length + 1));
}

/** Big Shoulders is condensed; ~0.5em/char overshoots safely for box sizing. */
function bsW(label: string, fontSize: number): number {
  return Math.ceil(fontSize * 0.5 * (label.length + 2));
}

/** Pre-rendered design fragment at design-px coords (k = height/1080). */
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

/**
 * Square profile photo with a colored edge at design-px coords. Photos are
 * uploaded as squares, so fill == fit; the surrounding color frame doubles
 * as the fallback block when no photo was registered.
 */
function PhotoBox({
  imageId,
  color,
  x,
  y,
  size,
  k,
}: {
  imageId: string | null | undefined;
  color: string;
  x: number;
  y: number;
  size: number;
  k: number;
}) {
  const s = Math.round(size * k);
  const border = Math.max(1, Math.round(2 * k));
  const inner = s - 2 * border;
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: s,
        height: s,
        backgroundColor: color,
        overflow: 'hidden',
      }}>
      {imageId ? (
        <View
          style={{
            top: border,
            left: border,
            width: inner,
            height: inner,
            overflow: 'hidden',
          }}>
          <Rescaler
            style={{ width: inner, height: inner, rescaleMode: 'fill' }}>
            <Image imageId={imageId} />
          </Rescaler>
        </View>
      ) : null}
    </View>
  );
}

/** Cap-band center below the text-box top, as a fraction of fontSize.
 * Smelter's Text pins glyphs to the wrapper top and has no vertical align,
 * so optical centering must offset the wrapper by font metrics. Big Shoulders
 * Display: (asc 1971 − capHeight 1600/2) / upem 2000 ≈ 0.585. IBM Plex Mono:
 * (asc 1025 − cap 698/2) / upem 1000 ≈ 0.68 — the MONO labels that already
 * looked centered sat exactly at y = H/2 − 0.68·fs. All-caps strings only. */
const CAP_CENTER: Record<string, number> = { [DISPLAY]: 0.585, [MONO]: 0.68 };

/** One clipped line of text at design-px coords. */
function Label({
  x,
  y = 0,
  w,
  text,
  fs,
  k,
  color = CREAM,
  font = DISPLAY,
  weight = 'bold',
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
  weight?: 'normal' | 'medium' | 'semi_bold' | 'bold' | 'extra_bold';
  align?: 'left' | 'center' | 'right';
  /** Optically center the caps within a box of this design-px height
   * (overrides `y`). */
  centerIn?: number;
}) {
  const width = Math.round(w * k);
  const top =
    centerIn != null ? centerIn / 2 - (CAP_CENTER[font] ?? 0.585) * fs : y;
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

// ── Per-tile chrome ──────────────────────────────────────────────────────────

/**
 * One player's tile chrome. On the grid scene this draws the design's bottom
 * plate (rank block, name, giant reps, RPM); the solo scene's hero plate is
 * scene-level instead. Rep flash, streak chip and the SIGNAL LOST veil render
 * on every heat scene.
 */
export function KbtTileHud({
  tile,
  scene,
  parent,
  floatText,
  countIncorrect,
}: {
  tile: KbtHudTile;
  scene: KbtHudState['scene'];
  parent: { width: number; height: number };
  /** config.repFloatText — floating rep text instead of the static pop. */
  floatText: boolean;
  /** config.countIncorrectReps — incorrect-rep floater style. */
  countIncorrect: boolean;
}) {
  // The tile spans the full output height on ≤3-wide heats; scale the plate
  // with the column so the ×4 grid gets the narrow variant at its true size.
  const k = parent.height / 1080;
  const plateW = Math.min(parent.width, Math.round(608 * k));
  const use480 = plateW < Math.round(550 * k);
  const assetW = use480 ? 480 : 608;
  const s = plateW / assetW;
  const plateH = Math.round(227 * s);
  const plateX = Math.round((parent.width - plateW) / 2);
  const plateY = parent.height - plateH;
  const fs = Math.max(14, Math.round(parent.height * 0.02));
  const pad = Math.round(fs * 0.5);
  const bw = Math.max(3, Math.round(parent.width * 0.008));
  const meta = tile.exercise === 'idle' ? 'READY' : tile.exercise.toUpperCase();

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      {/* Rep flash: the tile edge lights in the player's color for a beat.
          The border grows outward from the View while top/left place its
          outer edge, so inset by the border width or the right/bottom
          strokes land past the parent and the root clip eats them (same
          correction as SmoothedBoxes). */}
      {tile.flash ? (
        <View
          style={{
            top: bw,
            left: bw,
            width: parent.width - 2 * bw,
            height: parent.height - 2 * bw,
            borderWidth: bw,
            borderColor: tile.lastRepVerdict === 'incorrect' ? BAD : tile.color,
          }}
        />
      ) : null}
      {/* Per-rep feedback: floating game text when enabled; otherwise the
          static +points pop (above the grid plate; under the streak chip when
          the scene has no per-tile plate — solo hero plate is scene-level).
          The floaters mount unconditionally while enabled so their spawn
          detection sees every snapshot. */}
      {floatText ? (
        <KbtRepFloaters
          tile={tile}
          parent={parent}
          countIncorrect={countIncorrect}
        />
      ) : null}
      {!floatText && tile.flash && tile.lastRepPoints > 0 ? (
        <View
          style={{
            top:
              scene === 'grid'
                ? plateY - Math.round(fs * 2.2)
                : pad + Math.round(fs * 2.1),
            left: scene === 'grid' ? plateX : pad,
            width: monoW(`+${tile.lastRepPoints}`, fs) + pad,
            height: Math.round(fs * 1.7),
            backgroundColor: BG,
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: tile.lastRepVerdict === 'incorrect' ? BAD : GOOD,
              fontFamily: MONO,
              fontWeight: 'semi_bold',
            }}>
            {` +${tile.lastRepPoints}`}
          </Text>
        </View>
      ) : null}
      {/* Streak chip (3+ keeps the pressure visible). */}
      {tile.streak >= 3 ? (
        <View
          style={{
            top: pad,
            left: pad,
            width: monoW(`×${tile.streak}`, fs) + pad,
            height: Math.round(fs * 1.7),
            backgroundColor: BG,
            borderWidth: 1,
            borderColor: GOOD,
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: GOOD,
              fontFamily: MONO,
              fontWeight: 'semi_bold',
            }}>
            {` ×${tile.streak}`}
          </Text>
        </View>
      ) : null}
      {/* Grid plate (kb_design GRID scene, one per column). */}
      {scene === 'grid' ? (
        <View
          style={{
            top: plateY,
            left: plateX,
            width: plateW,
            height: plateH,
            overflow: 'hidden',
          }}>
          {/* 'fill', not 'fit': plateH rounding skews the box aspect off the
              asset's, and 'fit' letterboxes that error into 1px side slivers.
              'fill' crops the sub-pixel excess vertically instead. */}
          <Rescaler
            style={{ width: plateW, height: plateH, rescaleMode: 'fill' }}>
            <Image
              imageId={use480 ? 'kbt-grid-plate-480' : 'kbt-grid-plate-608'}
            />
          </Rescaler>
          {/* Rank digit in the accent block (0,0,48,60). */}
          <View
            style={{
              top: Math.round(10 * s),
              left: 0,
              width: Math.round(48 * s),
              height: Math.round(44 * s),
              overflow: 'hidden',
            }}>
            <Text
              style={{
                fontSize: Math.round(30 * s),
                color: DARK,
                width: Math.round(48 * s),
                align: 'center',
                fontFamily: DISPLAY,
                fontWeight: 'extra_bold',
              }}>
              {`${tile.rank}`}
            </Text>
          </View>
          {/* Coords in the asset's design px; k=s maps them into the plate's
              (content-space) footprint so they track the plate scale. */}
          <Label
            x={64}
            y={8}
            w={assetW - 296}
            k={s}
            text={tile.name.toUpperCase()}
            fs={24}
            weight='bold'
          />
          <Label
            x={64}
            y={38}
            w={assetW - 296}
            k={s}
            text={meta}
            fs={12}
            font={MONO}
            weight='normal'
            color={DIM}
          />
          {/* Big points, spanning the name+meta band (glyphs stay above the
              baked separator at y=60); its window starts where the name's
              window ends, so long names clip instead of colliding. */}
          <Label
            x={assetW - 232}
            y={6}
            w={170}
            k={s}
            text={`${tile.points}`}
            fs={40}
            weight='extra_bold'
            align='right'
          />
          <Label
            x={assetW - 56}
            y={38}
            w={34}
            k={s}
            text='PTS'
            fs={11}
            font={MONO}
            weight='normal'
            color={DIM}
          />
          {/* Giant reps below the baked REPS label (22,74). */}
          <Label
            x={20}
            y={92}
            w={220}
            k={s}
            text={`${tile.reps}`}
            fs={92}
            weight='extra_bold'
          />
          <Label
            x={assetW - 160}
            y={130}
            w={138}
            k={s}
            text={`${tile.rpm} RPM`}
            fs={16}
            font={MONO}
            weight='semi_bold'
            color={ACCENT}
            align='right'
          />
        </View>
      ) : null}
      {tile.signalLost ? (
        <View
          style={{
            top: Math.round(parent.height * 0.4),
            left: 0,
            width: parent.width,
            height: Math.round(fs * 2.4),
            backgroundColor: '#7F1D1DCC',
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: Math.round(fs * 1.2),
              color: '#FECACA',
              width: parent.width,
              align: 'center',
              fontFamily: MONO,
              fontWeight: 'semi_bold',
            }}>
            SIGNAL LOST
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Scene-level chrome ───────────────────────────────────────────────────────

/** Top-center chip: baked frame + heat label (left) and clock (right). */
function ClockChip({ hud, k }: { hud: KbtHudState; k: number }) {
  const match = hud.match;
  if (!match) return null;
  let label =
    hud.heatLabel ?? (match.final ? 'FINAL' : `HEAT ${match.heatIndex + 1}`);
  let clock: string;
  let clockColor = CREAM;
  if (match.phase === 'intro') {
    label = `${label} · GET READY`;
    clock = '--:--';
  } else if (match.phase === 'countdown') {
    clock = formatClock(
      match.endsAt != null && match.startsAt != null
        ? match.endsAt - match.startsAt
        : null,
    );
  } else if (match.phase === 'playing') {
    clock = formatClock(match.remainingMs);
    if (match.remainingMs != null && match.remainingMs <= 60_000) {
      clockColor = ACCENT;
    }
    // Final 10s: blink keyed to the snapshot clock (applies land ~10/s).
    // Parity of the 500ms bucket gives even 500ms on/off phases at the 10Hz
    // cadence; `% 500 < 250` sampled at 100ms steps aliased to 200/300ms.
    if (
      match.remainingMs != null &&
      match.remainingMs <= 10_000 &&
      Math.floor(match.remainingMs / 500) % 2 === 0
    ) {
      clockColor = BAD;
    }
  } else {
    clock = 'TIME!';
    clockColor = ACCENT;
  }
  const x = (1920 - 550) / 2;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(120 * k),
        overflow: 'visible',
      }}>
      <Art id='kbt-chip-frame' x={x} y={30} w={550} h={54} k={k} />
      <Label
        x={x + 44}
        y={44}
        w={296}
        k={k}
        text={label}
        fs={20}
        weight='bold'
        align='center'
      />
      <Label
        x={x + 355}
        y={41}
        w={190}
        k={k}
        text={clock}
        fs={28}
        font={MONO}
        weight='semi_bold'
        color={clockColor}
        align='center'
      />
    </View>
  );
}

/** Giant center countdown (3·2·1) and the winner card after the buzzer. */
function CenterStage({
  hud,
  resolution,
  k,
}: {
  hud: KbtHudState;
  resolution: Resolution;
  k: number;
}) {
  const match = hud.match;
  if (!match) return null;
  if (match.phase === 'countdown') {
    const n = Math.max(1, Math.ceil((match.remainingMs ?? 0) / 1000));
    const bigFs = Math.round(300 * k);
    return (
      <View
        style={{
          top: Math.round((resolution.height - bigFs * 1.3) / 2),
          left: 0,
          width: resolution.width,
          height: Math.round(bigFs * 1.4),
          overflow: 'visible',
        }}>
        <Text
          style={{
            fontSize: bigFs,
            color: CREAM,
            width: resolution.width,
            align: 'center',
            fontFamily: DISPLAY,
            fontWeight: 'extra_bold',
          }}>
          {`${n}`}
        </Text>
      </View>
    );
  }
  if (match.phase === 'ended' && match.winner) {
    const fs = Math.round(64 * k);
    const label = `${match.winner.name.toUpperCase()} WINS · ${match.winner.points}`;
    const width = bsW(label, fs) + Math.round(fs * 1.2);
    const height = Math.round(fs * 2);
    return (
      <View
        style={{
          top: Math.round(resolution.height * 0.42),
          left: Math.round((resolution.width - width) / 2),
          width,
          height,
          backgroundColor: BG,
          borderWidth: Math.max(2, Math.round(2 * k)),
          borderColor: ACCENT,
          overflow: 'hidden',
        }}>
        <View
          style={{
            top: Math.round((height - fs * 1.3) / 2),
            left: 0,
            width,
            height: Math.round(fs * 1.5),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: CREAM,
              width,
              align: 'center',
              fontFamily: DISPLAY,
              fontWeight: 'extra_bold',
            }}>
            {label}
          </Text>
        </View>
      </View>
    );
  }
  return null;
}

/** Celebration strip under the clock chip (lead change / streak milestone). */
function Banner({ hud, k }: { hud: KbtHudState; k: number }) {
  const banner = hud.banner;
  if (!banner) return null;
  const fs = Math.round(22 * k);
  const width = bsW(banner.text, fs) + Math.round(fs * 1.4);
  const height = Math.round(fs * 1.9);
  return (
    <View
      style={{
        top: Math.round(96 * k),
        left: Math.round((1920 * k - width) / 2),
        width,
        height,
        backgroundColor: BG,
        borderWidth: 1,
        borderColor: banner.color,
        overflow: 'hidden',
      }}>
      <View
        style={{
          top: Math.round((height - fs * 1.3) / 2),
          left: 0,
          width,
          height: Math.round(fs * 1.5),
          overflow: 'hidden',
        }}>
        <Text
          style={{
            fontSize: fs,
            color: banner.color,
            width,
            align: 'center',
            fontFamily: DISPLAY,
            fontWeight: 'bold',
          }}>
          {banner.text}
        </Text>
      </View>
    </View>
  );
}

/** LOBBY: title block + join panel (QR, address, connected athletes). */
function LobbyScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const lobby = hud.lobby;
  if (!lobby) return null;
  const PX = 1400; // panel left (design px)
  const PY = 230;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(1080 * k),
        overflow: 'hidden',
      }}>
      <Art id='kbt-lobby-title' x={70} y={60} w={720} h={150} k={k} />
      <Art id='kbt-lobby-panel' x={PX} y={PY} w={450} h={620} k={k} />
      {/* QR in the panel's baked cream square (measured slot 36,92 + 13px). */}
      {lobby.qrImageId ? (
        <Art
          id={lobby.qrImageId}
          x={PX + 49}
          y={PY + 105}
          w={144}
          h={144}
          k={k}
        />
      ) : null}
      {lobby.joinLabel ? (
        <Label
          x={PX + 231}
          y={PY + 148}
          w={185}
          k={k}
          text={lobby.joinLabel}
          fs={15}
          font={MONO}
          weight='semi_bold'
          color={ACCENT}
        />
      ) : null}
      {/* Count on the baked ATHLETES CONNECTED row (divider at y 282). */}
      <Label
        x={PX + 300}
        y={PY + 288}
        w={115}
        k={k}
        text={`${lobby.joinedCount}`}
        fs={26}
        weight='extra_bold'
        align='right'
      />
      {lobby.joined.slice(0, 6).map((p, i) => {
        const rowY = PY + 330 + i * 42;
        return (
          <View
            key={`${p.name}-${i}`}
            style={{
              top: Math.round(rowY * k),
              left: Math.round((PX + 35) * k),
              width: Math.round(380 * k),
              height: Math.round(34 * k),
              backgroundColor: '#FFFFFF0A',
              overflow: 'hidden',
            }}>
            {p.photoImageId ? (
              <PhotoBox
                imageId={p.photoImageId}
                color={p.color}
                x={4}
                y={4}
                size={26}
                k={k}
              />
            ) : (
              <View
                style={{
                  top: Math.round(9 * k),
                  left: Math.round(10 * k),
                  width: Math.round(6 * k),
                  height: Math.round(16 * k),
                  backgroundColor: p.color,
                }}
              />
            )}
            <View
              style={{
                top: Math.round(5 * k),
                left: Math.round((p.photoImageId ? 40 : 28) * k),
                width: Math.round((p.photoImageId ? 288 : 300) * k),
                height: Math.round(26 * k),
                overflow: 'hidden',
              }}>
              <Text
                style={{
                  fontSize: Math.round(18 * k),
                  color: CREAM,
                  fontFamily: DISPLAY,
                  fontWeight: 'bold',
                }}>
                {p.name.toUpperCase()}
              </Text>
            </View>
            <View
              style={{
                top: Math.round(13 * k),
                left: Math.round(362 * k),
                width: Math.round(8 * k),
                height: Math.round(8 * k),
                borderRadius: Math.round(4 * k),
                backgroundColor: p.camConnected ? GOOD : '#E8E4DA40',
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/** SOLO: hero plate (lift tag, giant points, pace, name) + AI rep tracker. */
function SoloScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const tile = Object.values(hud.tiles)[0];
  if (!tile) return null;
  const HX = 70; // hero plate origin (design px)
  const HY = 690;
  const TX = 1570; // tracker origin
  const TY = 720;
  const rows: { count: number; color: string }[] = [
    { count: tile.repsByExercise.snatch, color: KBT_EXERCISE_COLORS.snatch },
    { count: tile.repsByExercise.clean, color: KBT_EXERCISE_COLORS.clean },
    { count: tile.repsByExercise.swing, color: KBT_EXERCISE_COLORS.swing },
  ];
  const maxCount = barScale(Math.max(...rows.map((r) => r.count)));
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(1080 * k),
        overflow: 'hidden',
      }}>
      <Art id='kbt-hero-plate' x={HX} y={HY} w={420} h={320} k={k} />
      {/* Lift tag (accent block 0,0,190,42). */}
      <Label
        x={HX + 20}
        y={HY + 7}
        w={160}
        k={k}
        text={tile.exercise === 'idle' ? 'READY' : tile.exercise.toUpperCase()}
        fs={22}
        weight='extra_bold'
        color={DARK}
      />
      {/* Giant points under the baked POINTS label. */}
      <Label
        x={HX + 28}
        y={HY + 66}
        w={230}
        k={k}
        text={`${tile.points}`}
        fs={150}
        weight='extra_bold'
      />
      {/* Pace under the baked PACE label (280,102). */}
      <Label
        x={HX + 278}
        y={HY + 122}
        w={130}
        k={k}
        text={`${tile.rpm}`}
        fs={44}
        weight='bold'
      />
      <Label
        x={HX + 278}
        y={HY + 178}
        w={130}
        k={k}
        text='RPM'
        fs={13}
        font={MONO}
        weight='normal'
        color={DIM}
      />
      {/* Name bar (0,260,420,60). */}
      {tile.photoImageId ? (
        <PhotoBox
          imageId={tile.photoImageId}
          color={tile.color}
          x={HX + 22}
          y={HY + 266}
          size={44}
          k={k}
        />
      ) : (
        <View
          style={{
            top: Math.round((HY + 278) * k),
            left: Math.round((HX + 28) * k),
            width: Math.round(7 * k),
            height: Math.round(24 * k),
            backgroundColor: tile.color,
          }}
        />
      )}
      <Label
        x={HX + (tile.photoImageId ? 76 : 48)}
        y={HY + 272}
        w={tile.photoImageId ? 222 : 250}
        k={k}
        text={tile.name.toUpperCase()}
        fs={30}
        weight='extra_bold'
      />
      <Label
        x={HX + 270}
        y={HY + 281}
        w={120}
        k={k}
        text={`${tile.reps} REPS`}
        fs={14}
        font={MONO}
        weight='normal'
        color={DIM}
        align='right'
      />
      {/* AI rep tracker: counts + bars next to baked SNATCH/CLEAN/SWING. */}
      <Art id='kbt-tracker-panel' x={TX} y={TY} w={280} h={290} k={k} />
      {rows.map((row, i) => (
        <View
          key={i}
          style={{
            top: 0,
            left: 0,
            width: Math.round(1920 * k),
            height: Math.round(1080 * k),
            overflow: 'visible',
          }}>
          <Label
            x={TX + 140}
            y={TY + 50 + i * 62}
            w={115}
            k={k}
            text={`${row.count}`}
            fs={24}
            font={MONO}
            weight='semi_bold'
            color={row.color}
            align='right'
          />
          <View
            style={{
              top: Math.round((TY + 88 + i * 62) * k),
              left: Math.round((TX + 25) * k),
              width: Math.max(
                1,
                Math.round(230 * k * Math.min(1, row.count / maxCount)),
              ),
              height: Math.round(5 * k),
              backgroundColor: row.color,
            }}
          />
        </View>
      ))}
    </View>
  );
}

/** BOARD: centered standings panel between heats. */
function BoardScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const board = hud.board;
  if (!board) return null;
  const BX = 360;
  const BY = 210;
  const maxPoints = barScale(Math.max(...board.rows.map((r) => r.points)));
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(1080 * k),
        overflow: 'hidden',
      }}>
      <Art id='kbt-board-panel' x={BX} y={BY} w={1200} h={660} k={k} />
      <Label
        x={BX + 600}
        y={BY + 58}
        w={555}
        k={k}
        text={`SMELTER KETTLEBELL${board.final ? ' · FINAL' : ''}`}
        fs={16}
        font={MONO}
        weight='normal'
        color={DIM}
        align='right'
      />
      {board.rows.map((row, i) => {
        const rowY = BY + 130 + i * 62;
        return (
          <View
            key={row.name}
            id={`kbt-board-row-${row.name}`}
            // Stable per-player id + transition: rank swaps on a live board
            // (forced 'board' during a heat) slide rows instead of teleporting.
            transition={{
              durationMs: 300,
              easingFunction: {
                functionName: 'cubic_bezier',
                points: [0.65, 0, 0.35, 1],
              },
              shouldInterrupt: true,
            }}
            style={{
              top: Math.round(rowY * k),
              left: Math.round((BX + 45) * k),
              width: Math.round(1110 * k),
              height: Math.round(52 * k),
              backgroundColor: row.rank === 1 ? '#FF5A1F1A' : '#FFFFFF08',
              overflow: 'visible',
            }}>
            <Label
              x={18}
              centerIn={52}
              w={50}
              k={k}
              text={`${row.rank}`}
              fs={30}
              weight='extra_bold'
              color={RANK_COLORS[row.rank - 1] ?? DIM}
            />
            {row.photoImageId ? (
              <PhotoBox
                imageId={row.photoImageId}
                color={row.color}
                x={68}
                y={6}
                size={40}
                k={k}
              />
            ) : (
              <View
                style={{
                  top: Math.round(15 * k),
                  left: Math.round(74 * k),
                  width: Math.round(6 * k),
                  height: Math.round(22 * k),
                  backgroundColor: row.color,
                }}
              />
            )}
            <Label
              x={row.photoImageId ? 122 : 94}
              centerIn={52}
              w={row.photoImageId ? 372 : 400}
              k={k}
              text={row.name.toUpperCase()}
              fs={26}
              weight='bold'
            />
            <View
              style={{
                top: Math.round(22 * k),
                left: Math.round(520 * k),
                width: Math.round(180 * k),
                height: Math.round(8 * k),
                backgroundColor: '#FFFFFF12',
              }}
            />
            <View
              style={{
                top: Math.round(22 * k),
                left: Math.round(520 * k),
                width: Math.max(
                  1,
                  Math.round(180 * k * (row.points / maxPoints)),
                ),
                height: Math.round(8 * k),
                backgroundColor: ACCENT,
              }}
            />
            <Label
              x={730}
              centerIn={52}
              w={140}
              k={k}
              text={`${row.rpm} RPM`}
              fs={15}
              font={MONO}
              weight='normal'
              color={DIM}
              align='right'
            />
            <Label
              x={950}
              centerIn={52}
              w={140}
              k={k}
              text={`${row.points}`}
              fs={34}
              weight='extra_bold'
              align='right'
            />
          </View>
        );
      })}
    </View>
  );
}

/** PODIUM: title + three blocks (2·1·3), names and scores above. */
function PodiumScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const podium = hud.podium;
  if (!podium) return null;
  const COLS: Record<number, number> = { 2: 460, 1: 800, 3: 1140 };
  const HEIGHTS: Record<number, number> = { 1: 240, 2: 170, 3: 130 };
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(1080 * k),
        overflow: 'hidden',
      }}>
      <Art id='kbt-podium-title' x={510} y={85} w={900} h={160} k={k} />
      {podium.rows.map((row) => {
        const x = COLS[row.rank];
        const h = HEIGHTS[row.rank];
        if (x == null || h == null) return null;
        const blockTop = 1080 - 110 - h;
        const color = RANK_COLORS[row.rank - 1] ?? DIM;
        return (
          <View
            key={row.rank}
            style={{
              top: 0,
              left: 0,
              width: Math.round(1920 * k),
              height: Math.round(1080 * k),
              overflow: 'visible',
            }}>
            <Art
              id={`kbt-podium-block-${row.rank}`}
              x={x}
              y={blockTop}
              w={320}
              h={h}
              k={k}
            />
            {row.photoImageId ? (
              <PhotoBox
                imageId={row.photoImageId}
                color={color}
                x={x + 112}
                y={blockTop - 234}
                size={96}
                k={k}
              />
            ) : null}
            <Label
              x={x}
              y={blockTop - 124}
              w={320}
              k={k}
              text={row.name.toUpperCase()}
              fs={30}
              weight='extra_bold'
              align='center'
            />
            <Label
              x={x}
              y={blockTop - 78}
              w={320}
              k={k}
              text={`${row.points} PTS`}
              fs={40}
              weight='extra_bold'
              color={color}
              align='center'
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * Commentator lower-third (CASTER design): frame around the caster cam tile
 * (the controller lays the WHIP input at kbtCasterCamRect), ON AIR tag, name
 * plate and the LEADER chip on the right. Shown on the "talking head" scenes;
 * during heats the commentator is audio-only with a mini ON AIR chip.
 */
function CasterLowerThird({
  hud,
  resolution,
  k,
}: {
  hud: KbtHudState;
  resolution: Resolution;
  k: number;
}) {
  const caster = hud.commentator;
  if (!caster?.camConnected) return null;
  const cam = kbtCasterCamRect(resolution, true);
  const px = (n: number) => Math.round(n * k);
  const clusterX = cam.x + cam.width + px(10);
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {/* Cam frame over the video tile. */}
      <View
        style={{
          top: cam.y,
          left: cam.x,
          width: cam.width,
          height: cam.height,
          borderWidth: 1,
          borderColor: '#FFFFFF2E',
        }}
      />
      <Art
        id='kbt-caster-onair'
        x={clusterX / k}
        y={cam.y / k}
        w={130}
        h={36}
        k={k}
      />
      <Art
        id='kbt-caster-plate'
        x={clusterX / k}
        y={cam.y / k + 36}
        w={470}
        h={88}
        k={k}
      />
      <Label
        x={clusterX / k + 30}
        y={cam.y / k + 36 + 10}
        w={410}
        k={k}
        text={caster.name.toUpperCase()}
        fs={34}
        weight='extra_bold'
      />
      {hud.leader ? (
        <View
          style={{
            top: 0,
            left: 0,
            width: resolution.width,
            height: resolution.height,
            overflow: 'visible',
          }}>
          <Art
            id='kbt-leader-chip'
            x={1920 - 70 - 300}
            y={cam.y / k + 124 - 56}
            w={300}
            h={56}
            k={k}
          />
          <Label
            x={1920 - 70 - 300 + 95}
            y={cam.y / k + 124 - 56 + 16}
            w={110}
            k={k}
            text={hud.leader.name.toUpperCase()}
            fs={20}
            weight='bold'
          />
          <Label
            x={1920 - 70 - 300 + 205}
            y={cam.y / k + 124 - 56 + 12}
            w={70}
            k={k}
            text={`${hud.leader.points}`}
            fs={28}
            weight='extra_bold'
            color={ACCENT}
            align='right'
          />
        </View>
      ) : null}
    </View>
  );
}

/** Small ON AIR chip during heats — commentary is audio-only over the action. */
function CasterOnAirMini({ hud, k }: { hud: KbtHudState; k: number }) {
  const caster = hud.commentator;
  if (!caster?.camConnected) return null;
  const label = `ON AIR · ${caster.name.toUpperCase()}`;
  const fs = Math.round(14 * k);
  const width = monoW(label, fs) + Math.round(34 * k);
  return (
    <View
      style={{
        top: Math.round(30 * k),
        left: Math.round(70 * k),
        width,
        height: Math.round(38 * k),
        backgroundColor: BG,
        borderWidth: 1,
        borderColor: '#FFFFFF17',
        overflow: 'hidden',
      }}>
      <View
        style={{
          top: Math.round(15 * k),
          left: Math.round(12 * k),
          width: Math.round(8 * k),
          height: Math.round(8 * k),
          borderRadius: Math.round(4 * k),
          backgroundColor: ACCENT,
        }}
      />
      <View
        style={{
          top: Math.round(10 * k),
          left: Math.round(28 * k),
          width: width - Math.round(30 * k),
          height: Math.round(fs * 1.5),
          overflow: 'hidden',
        }}>
        <Text
          style={{
            fontSize: fs,
            color: CREAM,
            fontFamily: MONO,
            fontWeight: 'semi_bold',
          }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/**
 * CASTER scene: the commentator's cam fills the stage (forced from the
 * panel); chrome is a scaled-up lower-third cluster bottom-left, reusing the
 * baked ON AIR + name plate art. No cam frame — the tile IS the scene.
 */
function CasterFullScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const caster = hud.commentator;
  if (!caster) return null;
  const S = 1.5; // lower-third art scaled up for the fullscreen scene
  const X = 70;
  const PLATE_H = 88 * S;
  const PLATE_Y = 1080 - 70 - PLATE_H;
  const ONAIR_Y = PLATE_Y - 36 * S;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: Math.round(1920 * k),
        height: Math.round(1080 * k),
        overflow: 'hidden',
      }}>
      <Art
        id='kbt-caster-onair'
        x={X}
        y={ONAIR_Y}
        w={130 * S}
        h={36 * S}
        k={k}
      />
      <Art
        id='kbt-caster-plate'
        x={X}
        y={PLATE_Y}
        w={470 * S}
        h={PLATE_H}
        k={k}
      />
      <Label
        x={X + 30 * S}
        y={PLATE_Y + 10 * S}
        w={410 * S}
        k={k}
        text={caster.name.toUpperCase()}
        fs={34 * S}
        weight='extra_bold'
      />
    </View>
  );
}

type KbtOverlayState = NonNullable<KbtHudState['overlay']>;

/** Small mono caption + big display value, one stat cell (panel-relative). */
function StatCell({
  x,
  y,
  w,
  caption,
  value,
  k,
  color = CREAM,
}: {
  x: number;
  y: number;
  w: number;
  caption: string;
  value: string;
  k: number;
  color?: string;
}) {
  return (
    <View
      style={{
        top: Math.round(y * k),
        left: Math.round(x * k),
        width: Math.round(w * k),
        height: Math.round(64 * k),
        overflow: 'hidden',
      }}>
      <Label
        x={0}
        y={0}
        w={w}
        k={k}
        text={caption}
        fs={12}
        font={MONO}
        weight='normal'
        color={DIM}
        align='center'
      />
      <Label
        x={0}
        y={20}
        w={w}
        k={k}
        text={value}
        fs={30}
        weight='extra_bold'
        color={color}
        align='center'
      />
    </View>
  );
}

/** 'LIVE' (green) vs 'LAST HEAT' (dim) source tag for stat overlays. */
function LiveTag({
  x,
  y,
  w,
  live,
  k,
  align = 'left',
}: {
  x: number;
  y: number;
  w: number;
  live: boolean;
  k: number;
  align?: 'left' | 'center' | 'right';
}) {
  return (
    <Label
      x={x}
      y={y}
      w={w}
      k={k}
      text={live ? '● LIVE' : 'LAST HEAT'}
      fs={12}
      font={MONO}
      weight='normal'
      color={live ? GOOD : DIM}
      align={align}
    />
  );
}

/** REP CAM: the commentator's chosen apex still, right-hand panel slot. */
function RepShotOverlay({
  overlay,
  k,
}: {
  overlay: Extract<KbtOverlayState, { kind: 'rep_shot' }>;
  k: number;
}) {
  const PX = 1400;
  const PY = 150;
  const W = 460;
  const PAD = 20;
  const PHOTO = W - PAD * 2;
  const shot = overlay.shot;
  const issues = overlay.showVerdict ? shot.issues.slice(0, 3) : [];
  const verdictH = overlay.showVerdict ? 40 + issues.length * 24 + 6 : 0;
  const H = 56 + PHOTO + 96 + verdictH;
  const metaY = 56 + PHOTO + 14;
  return (
    <View
      style={{
        top: Math.round(PY * k),
        left: Math.round(PX * k),
        width: Math.round(W * k),
        height: Math.round(H * k),
        backgroundColor: BG,
        borderWidth: 1,
        borderColor: ACCENT,
        overflow: 'hidden',
      }}>
      <Label
        x={PAD}
        y={18}
        w={200}
        k={k}
        text='REP CAM'
        fs={16}
        font={MONO}
        weight='normal'
        color={ACCENT}
      />
      <Label
        x={W - PAD - 160}
        y={18}
        w={160}
        k={k}
        text={`${overlay.index + 1} / ${overlay.total}`}
        fs={16}
        font={MONO}
        weight='normal'
        color={DIM}
        align='right'
      />
      <PhotoBox
        imageId={shot.imageId}
        color={overlay.player.color}
        x={PAD}
        y={56}
        size={PHOTO}
        k={k}
      />
      <Label
        x={PAD}
        y={metaY}
        w={300}
        k={k}
        text={overlay.player.name.toUpperCase()}
        fs={30}
        weight='bold'
      />
      <Label
        x={W - PAD - 120}
        y={metaY + 6}
        w={120}
        k={k}
        text={`+${shot.points} PTS`}
        fs={16}
        font={MONO}
        weight='normal'
        color={ACCENT}
        align='right'
      />
      <Label
        x={PAD}
        y={metaY + 44}
        w={150}
        k={k}
        text={shot.exercise.toUpperCase()}
        fs={14}
        font={MONO}
        weight='normal'
        color={KBT_EXERCISE_COLORS[shot.exercise]}
      />
      <Label
        x={PAD + 130}
        y={metaY + 44}
        w={150}
        k={k}
        text={`REP #${shot.repIndex}`}
        fs={14}
        font={MONO}
        weight='normal'
        color={DIM}
      />
      {overlay.showVerdict ? (
        <View
          style={{
            top: Math.round((metaY + 78) * k),
            left: Math.round(PAD * k),
            width: Math.round((W - PAD * 2) * k),
            height: Math.round(verdictH * k),
            overflow: 'hidden',
          }}>
          <Label
            x={0}
            y={0}
            w={W - PAD * 2}
            k={k}
            text={shot.verdict === 'correct' ? 'CORRECT' : 'NO COUNT'}
            fs={24}
            weight='extra_bold'
            color={shot.verdict === 'correct' ? GOOD : BAD}
          />
          {issues.map((issue, i) => (
            <Label
              key={issue}
              x={0}
              y={38 + i * 24}
              w={W - PAD * 2}
              k={k}
              text={`· ${issue.toUpperCase()}`}
              fs={14}
              font={MONO}
              weight='normal'
              color={DIM}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** SPOTLIGHT: one player's stat card, bottom-right (clear of the caster). */
function SpotlightOverlay({
  overlay,
  k,
}: {
  overlay: Extract<KbtOverlayState, { kind: 'spotlight' }>;
  k: number;
}) {
  const PX = 1330;
  const PY = 770;
  const W = 520;
  const H = 240;
  const side = overlay.side;
  const cellW = (W - 40) / 4;
  return (
    <View
      style={{
        top: Math.round(PY * k),
        left: Math.round(PX * k),
        width: Math.round(W * k),
        height: Math.round(H * k),
        backgroundColor: BG,
        borderWidth: 1,
        borderColor: ACCENT,
        overflow: 'hidden',
      }}>
      <PhotoBox
        imageId={side.photoImageId}
        color={side.color}
        x={20}
        y={20}
        size={110}
        k={k}
      />
      <Label
        x={150}
        y={30}
        w={W - 170}
        k={k}
        text={side.name.toUpperCase()}
        fs={38}
        weight='extra_bold'
      />
      <LiveTag x={150} y={86} w={200} live={overlay.live} k={k} />
      <StatCell
        x={20}
        y={150}
        w={cellW}
        k={k}
        caption='POINTS'
        value={`${side.points}`}
        color={ACCENT}
      />
      <StatCell
        x={20 + cellW}
        y={150}
        w={cellW}
        k={k}
        caption='RPM'
        value={`${side.rpm}`}
      />
      <StatCell
        x={20 + cellW * 2}
        y={150}
        w={cellW}
        k={k}
        caption={overlay.live ? 'STREAK' : 'BEST STREAK'}
        value={`${overlay.live ? side.streak : side.bestStreak}`}
      />
      <StatCell
        x={20 + cellW * 3}
        y={150}
        w={cellW}
        k={k}
        caption='ACCURACY'
        value={
          side.accuracy != null ? `${Math.round(side.accuracy * 100)}%` : '—'
        }
      />
      {/* Player-color underline. */}
      <View
        style={{
          top: Math.round((H - 4) * k),
          left: 0,
          width: Math.round(W * k),
          height: Math.max(1, Math.round(4 * k)),
          backgroundColor: side.color,
        }}
      />
    </View>
  );
}

/** HEAD-TO-HEAD: two players compared, bottom-center panel. */
function H2hOverlay({
  overlay,
  k,
}: {
  overlay: Extract<KbtOverlayState, { kind: 'h2h' }>;
  k: number;
}) {
  const PX = 460;
  const PY = 760;
  const W = 1000;
  const H = 250;
  const { a, b } = overlay;
  const rows: { caption: string; va: number; vb: number }[] = [
    { caption: 'POINTS', va: a.points, vb: b.points },
    { caption: 'RPM', va: a.rpm, vb: b.rpm },
    { caption: 'REPS', va: a.reps, vb: b.reps },
  ];
  // One shared axis across all rows keeps bar lengths comparable.
  const scale = barScale(Math.max(...rows.map((r) => Math.max(r.va, r.vb))));
  const BAR_W = 300;
  const BAR_H = 10;
  return (
    <View
      style={{
        top: Math.round(PY * k),
        left: Math.round(PX * k),
        width: Math.round(W * k),
        height: Math.round(H * k),
        backgroundColor: BG,
        borderWidth: 1,
        borderColor: ACCENT,
        overflow: 'hidden',
      }}>
      <PhotoBox
        imageId={a.photoImageId}
        color={a.color}
        x={20}
        y={16}
        size={60}
        k={k}
      />
      <Label
        x={96}
        y={26}
        w={330}
        k={k}
        text={a.name.toUpperCase()}
        fs={30}
        weight='extra_bold'
      />
      <Label
        x={430}
        y={20}
        w={140}
        k={k}
        text='VS'
        fs={36}
        weight='extra_bold'
        color={ACCENT}
        align='center'
      />
      <LiveTag
        x={430}
        y={66}
        w={140}
        live={overlay.live}
        k={k}
        align='center'
      />
      <PhotoBox
        imageId={b.photoImageId}
        color={b.color}
        x={W - 20 - 60}
        y={16}
        size={60}
        k={k}
      />
      <Label
        x={W - 96 - 330}
        y={26}
        w={330}
        k={k}
        text={b.name.toUpperCase()}
        fs={30}
        weight='extra_bold'
        align='right'
      />
      {rows.map((row, i) => {
        const rowY = 104 + i * 46;
        const wa = Math.round(BAR_W * Math.min(1, row.va / scale) * k);
        const wb = Math.round(BAR_W * Math.min(1, row.vb / scale) * k);
        const aLeads = row.va > row.vb;
        const bLeads = row.vb > row.va;
        return (
          <View
            key={row.caption}
            style={{
              top: Math.round(rowY * k),
              left: 0,
              width: Math.round(W * k),
              height: Math.round(40 * k),
              overflow: 'hidden',
            }}>
            <Label
              x={20}
              centerIn={40}
              w={80}
              k={k}
              text={`${row.va}`}
              fs={24}
              weight='extra_bold'
              color={aLeads ? ACCENT : CREAM}
            />
            <Label
              x={W - 100}
              centerIn={40}
              w={80}
              k={k}
              text={`${row.vb}`}
              fs={24}
              weight='extra_bold'
              color={bLeads ? ACCENT : CREAM}
              align='right'
            />
            <Label
              x={430}
              centerIn={40}
              w={140}
              k={k}
              text={row.caption}
              fs={14}
              font={MONO}
              weight='normal'
              color={DIM}
              align='center'
            />
            {/* Bars grow toward the center from each player's side. */}
            <View
              style={{
                top: Math.round((20 - BAR_H / 2) * k),
                left: Math.round(430 * k) - wa - Math.round(10 * k),
                width: wa,
                height: Math.round(BAR_H * k),
                backgroundColor: a.color,
              }}
            />
            <View
              style={{
                top: Math.round((20 - BAR_H / 2) * k),
                left: Math.round(570 * k) + Math.round(10 * k),
                width: wb,
                height: Math.round(BAR_H * k),
                backgroundColor: b.color,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Commentator overlay dispatch (single exclusive slot, all scenes but podium). */
function CommentatorOverlay({ hud, k }: { hud: KbtHudState; k: number }) {
  const overlay = hud.overlay;
  if (!overlay || hud.scene === 'podium') return null;
  if (overlay.kind === 'rep_shot') {
    return <RepShotOverlay overlay={overlay} k={k} />;
  }
  if (overlay.kind === 'spotlight') {
    return <SpotlightOverlay overlay={overlay} k={k} />;
  }
  return <H2hOverlay overlay={overlay} k={k} />;
}

/** One full snapshot of the scene chrome — rendered twice during a view
 * crossfade (outgoing frozen snapshot + incoming live one). */
function SceneChrome({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: Resolution;
}) {
  const k = resolution.height / 1080;
  const heatScene = hud.scene === 'solo' || hud.scene === 'grid';
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      {hud.scene === 'lobby' ? <LobbyScene hud={hud} k={k} /> : null}
      {hud.scene === 'board' ? <BoardScene hud={hud} k={k} /> : null}
      {hud.scene === 'podium' ? <PodiumScene hud={hud} k={k} /> : null}
      {hud.scene === 'solo' ? <SoloScene hud={hud} k={k} /> : null}
      {hud.scene === 'caster' ? <CasterFullScene hud={hud} k={k} /> : null}
      {heatScene || hud.scene === 'split' ? (
        <View
          style={{
            top: 0,
            left: 0,
            width: resolution.width,
            height: resolution.height,
            overflow: 'visible',
          }}>
          <ClockChip hud={hud} k={k} />
          {/* No countdown/winner card over the split — the caster half is on
              stage; the clock chip carries the state. */}
          {heatScene ? (
            <CenterStage hud={hud} resolution={resolution} k={k} />
          ) : null}
        </View>
      ) : null}
      {/* Banner also fires over the board (commentator hype over standings);
          lobby and podium stay clean. */}
      {heatScene || hud.scene === 'split' || hud.scene === 'board' ? (
        <Banner hud={hud} k={k} />
      ) : null}
      <CommentatorOverlay hud={hud} k={k} />
      {/* On caster/split the commentator IS the scene — no lower-third or
          mini chip on top of their own camera. */}
      {hud.scene === 'caster' ||
      hud.scene === 'split' ? null : kbtCasterVisible(
          hud.scene,
          hud.commentator?.casterPip ?? true,
        ) ? (
        <CasterLowerThird hud={hud} resolution={resolution} k={k} />
      ) : (
        <CasterOnAirMini hud={hud} k={k} />
      )}
    </View>
  );
}

/**
 * Scene-level tournament chrome, mounted once in the output scene above all
 * layers; per-tile chrome lives in KbtTileHud next to each input.
 *
 * View switches crossfade instead of hard-cutting: when the swap key (scene +
 * caster-chip variant) changes, the previous snapshot keeps rendering through
 * a fade/dissolve-out while the new one fades in — the same shader pair the
 * per-input transitions use, over KBT_VIEW_TRANSITION_MS. A switch landing
 * mid-transition replaces the outgoing snapshot with the one we were fading
 * to (its half-faded predecessor drops instantly — accepted).
 */
export function KbtMatchHud({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: Resolution;
}) {
  const swapKey = `${hud.scene}|${kbtCasterVisible(
    hud.scene,
    hud.commentator?.casterPip ?? true,
  )}`;
  const lastRef = useRef({ key: swapKey, hud });
  const [outgoing, setOutgoing] = useState<{
    hud: KbtHudState;
    style: KbtViewTransitionStyle;
    startedAtMs: number;
  } | null>(null);

  // No dep array: the ref must track every ~10 Hz snapshot so the outgoing
  // copy freezes the last frame that actually aired, not a stale one.
  useEffect(() => {
    if (lastRef.current.key !== swapKey) {
      setOutgoing({
        hud: lastRef.current.hud,
        style: hud.viewTransitionStyle ?? 'fade',
        startedAtMs: Date.now(),
      });
    }
    lastRef.current = { key: swapKey, hud };
  });

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
  return (
    <View style={{ ...frame, overflow: 'visible' }}>
      {outgoing ? (
        <View style={frame}>
          <TransitionShaderWrapper
            transition={{
              type: outgoing.style,
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
              type: outgoing.style,
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
    </View>
  );
}
