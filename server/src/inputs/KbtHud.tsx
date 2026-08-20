import React from 'react';
import { Image, Rescaler, Text, View } from '@swmansion/smelter';
import type { KbtHudState, KbtHudTile } from '../app/store';
import { kbtCasterCamRect, kbtCasterVisible } from '../app/store';

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

/** One clipped line of text at design-px coords. */
function Label({
  x,
  y,
  w,
  text,
  fs,
  k,
  color = CREAM,
  font = DISPLAY,
  weight = 'bold',
  align = 'left',
}: {
  x: number;
  y: number;
  w: number;
  text: string;
  fs: number;
  k: number;
  color?: string;
  font?: string;
  weight?: 'normal' | 'medium' | 'semi_bold' | 'bold' | 'extra_bold';
  align?: 'left' | 'center' | 'right';
}) {
  const width = Math.round(w * k);
  return (
    <View
      style={{
        top: Math.round(y * k),
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
}: {
  tile: KbtHudTile;
  scene: KbtHudState['scene'];
  parent: { width: number; height: number };
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
  const meta = `${tile.exercise === 'idle' ? 'READY' : tile.exercise.toUpperCase()} · ${tile.points} PTS`;

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      {/* Rep flash: the tile edge lights in the player's color for a beat. */}
      {tile.flash ? (
        <View
          style={{
            top: 0,
            left: 0,
            width: parent.width,
            height: parent.height,
            borderWidth: Math.max(3, Math.round(parent.width * 0.008)),
            borderColor:
              tile.lastRepVerdict === 'incorrect' ? BAD : tile.color,
          }}
        />
      ) : null}
      {/* +points pop: above the grid plate; under the streak chip when the
          scene has no per-tile plate (solo hero plate is scene-level). */}
      {tile.flash && tile.lastRepPoints > 0 ? (
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
          <Rescaler
            style={{ width: plateW, height: plateH, rescaleMode: 'fit' }}>
            <Image imageId={use480 ? 'kbt-grid-plate-480' : 'kbt-grid-plate-608'} />
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
          <Label x={64} y={8} w={assetW - 80} k={s}
            text={tile.name.toUpperCase()} fs={24} weight='bold' />
          <Label x={64} y={38} w={assetW - 80} k={s}
            text={meta} fs={12} font={MONO} weight='normal' color={DIM} />
          {/* Giant reps below the baked REPS label (22,74). */}
          <Label x={20} y={92} w={220} k={s}
            text={`${tile.reps}`} fs={92} weight='extra_bold' />
          <Label x={assetW - 160} y={130} w={138} k={s}
            text={`${tile.rpm} RPM`} fs={16} font={MONO}
            weight='semi_bold' color={ACCENT} align='right' />
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
  let label = hud.heatLabel ?? (match.final ? 'FINAL' : `HEAT ${match.heatIndex + 1}`);
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
    if (
      match.remainingMs != null &&
      match.remainingMs <= 10_000 &&
      match.remainingMs % 500 < 250
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
      <Label x={x + 44} y={44} w={296} k={k} text={label} fs={20}
        weight='bold' align='center' />
      <Label x={x + 355} y={41} w={190} k={k} text={clock} fs={28}
        font={MONO} weight='semi_bold' color={clockColor} align='center' />
    </View>
  );
}

/** Giant center countdown (3·2·1) and the winner card after the buzzer. */
function CenterStage({ hud, resolution, k }: { hud: KbtHudState; resolution: Resolution; k: number }) {
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
        <Art id={lobby.qrImageId} x={PX + 49} y={PY + 105} w={144} h={144} k={k} />
      ) : null}
      {lobby.joinLabel ? (
        <Label x={PX + 231} y={PY + 148} w={185} k={k} text={lobby.joinLabel}
          fs={15} font={MONO} weight='semi_bold' color={ACCENT} />
      ) : null}
      {/* Count on the baked ATHLETES CONNECTED row (divider at y 282). */}
      <Label x={PX + 300} y={PY + 288} w={115} k={k}
        text={`${lobby.joinedCount}`} fs={26} weight='extra_bold' align='right' />
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
            <View
              style={{
                top: Math.round(9 * k),
                left: Math.round(10 * k),
                width: Math.round(6 * k),
                height: Math.round(16 * k),
                backgroundColor: p.color,
              }}
            />
            <View
              style={{
                top: Math.round(5 * k),
                left: Math.round(28 * k),
                width: Math.round(300 * k),
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

/** SOLO: hero plate (lift tag, giant reps, pace, name) + AI rep tracker. */
function SoloScene({ hud, k }: { hud: KbtHudState; k: number }) {
  const tile = Object.values(hud.tiles)[0];
  if (!tile) return null;
  const HX = 70; // hero plate origin (design px)
  const HY = 690;
  const TX = 1570; // tracker origin
  const TY = 720;
  const rows: { count: number; color: string }[] = [
    { count: tile.repsByExercise.snatch, color: ACCENT },
    { count: tile.repsByExercise.clean, color: AMBER },
    { count: tile.repsByExercise.swing, color: GOOD },
  ];
  const maxCount = Math.max(10, ...rows.map((r) => r.count));
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
      <Label x={HX + 20} y={HY + 7} w={160} k={k}
        text={tile.exercise === 'idle' ? 'READY' : tile.exercise.toUpperCase()}
        fs={22} weight='extra_bold' color={DARK} />
      {/* Giant reps under the baked REPS label. */}
      <Label x={HX + 28} y={HY + 66} w={230} k={k} text={`${tile.reps}`}
        fs={150} weight='extra_bold' />
      {/* Pace under the baked PACE label (280,102). */}
      <Label x={HX + 278} y={HY + 122} w={130} k={k} text={`${tile.rpm}`}
        fs={44} weight='bold' />
      <Label x={HX + 278} y={HY + 178} w={130} k={k} text='RPM'
        fs={13} font={MONO} weight='normal' color={DIM} />
      {/* Name bar (0,260,420,60). */}
      <View
        style={{
          top: Math.round((HY + 278) * k),
          left: Math.round((HX + 28) * k),
          width: Math.round(7 * k),
          height: Math.round(24 * k),
          backgroundColor: tile.color,
        }}
      />
      <Label x={HX + 48} y={HY + 272} w={250} k={k}
        text={tile.name.toUpperCase()} fs={30} weight='extra_bold' />
      <Label x={HX + 270} y={HY + 281} w={120} k={k}
        text={`${tile.points} PTS`} fs={14} font={MONO} weight='normal'
        color={DIM} align='right' />
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
          <Label x={TX + 140} y={TY + 50 + i * 62} w={115} k={k}
            text={`${row.count}`} fs={24} font={MONO} weight='semi_bold'
            color={row.color} align='right' />
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
  const maxPoints = Math.max(1, ...board.rows.map((r) => r.points));
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
      <Label x={BX + 600} y={BY + 58} w={555} k={k}
        text={`SMELTER KETTLEBELL${board.final ? ' · FINAL' : ''}`}
        fs={16} font={MONO} weight='normal' color={DIM} align='right' />
      {board.rows.map((row, i) => {
        const rowY = BY + 130 + i * 62;
        return (
          <View
            key={`${row.name}-${i}`}
            style={{
              top: Math.round(rowY * k),
              left: Math.round((BX + 45) * k),
              width: Math.round(1110 * k),
              height: Math.round(52 * k),
              backgroundColor: row.rank === 1 ? '#FF5A1F1A' : '#FFFFFF08',
              overflow: 'visible',
            }}>
            <Label x={18} y={6} w={50} k={k} text={`${row.rank}`} fs={30}
              weight='extra_bold'
              color={RANK_COLORS[row.rank - 1] ?? DIM} />
            <View
              style={{
                top: Math.round(15 * k),
                left: Math.round(74 * k),
                width: Math.round(6 * k),
                height: Math.round(22 * k),
                backgroundColor: row.color,
              }}
            />
            <Label x={94} y={8} w={400} k={k} text={row.name.toUpperCase()}
              fs={26} weight='bold' />
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
            <Label x={730} y={16} w={140} k={k} text={`${row.rpm} RPM`}
              fs={15} font={MONO} weight='normal' color={DIM} align='right' />
            <Label x={950} y={2} w={140} k={k} text={`${row.points}`}
              fs={34} weight='extra_bold' align='right' />
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
            <Art id={`kbt-podium-block-${row.rank}`} x={x} y={blockTop}
              w={320} h={h} k={k} />
            <Label x={x} y={blockTop - 124} w={320} k={k}
              text={row.name.toUpperCase()} fs={30} weight='extra_bold'
              align='center' />
            <Label x={x} y={blockTop - 78} w={320} k={k}
              text={`${row.points} PTS`} fs={40} weight='extra_bold'
              color={color} align='center' />
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
      <Art id='kbt-caster-onair' x={clusterX / k} y={cam.y / k} w={130} h={36} k={k} />
      <Art id='kbt-caster-plate' x={clusterX / k} y={cam.y / k + 36} w={470} h={88} k={k} />
      <Label x={clusterX / k + 30} y={cam.y / k + 36 + 10} w={410} k={k}
        text={caster.name.toUpperCase()} fs={34} weight='extra_bold' />
      {hud.leader ? (
        <View
          style={{
            top: 0,
            left: 0,
            width: resolution.width,
            height: resolution.height,
            overflow: 'visible',
          }}>
          <Art id='kbt-leader-chip' x={1920 - 70 - 300}
            y={cam.y / k + 124 - 56} w={300} h={56} k={k} />
          <Label x={1920 - 70 - 300 + 95} y={cam.y / k + 124 - 56 + 16}
            w={110} k={k} text={hud.leader.name.toUpperCase()} fs={20}
            weight='bold' />
          <Label x={1920 - 70 - 300 + 205} y={cam.y / k + 124 - 56 + 12}
            w={70} k={k} text={`${hud.leader.points}`} fs={28}
            weight='extra_bold' color={ACCENT} align='right' />
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
 * Scene-level tournament chrome, mounted once in the output scene above all
 * layers; per-tile chrome lives in KbtTileHud next to each input.
 */
export function KbtMatchHud({
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
      {heatScene ? (
        <View
          style={{
            top: 0,
            left: 0,
            width: resolution.width,
            height: resolution.height,
            overflow: 'visible',
          }}>
          <ClockChip hud={hud} k={k} />
          <Banner hud={hud} k={k} />
          <CenterStage hud={hud} resolution={resolution} k={k} />
        </View>
      ) : null}
      {kbtCasterVisible(hud.scene) ? (
        <CasterLowerThird hud={hud} resolution={resolution} k={k} />
      ) : (
        <CasterOnAirMini hud={hud} k={k} />
      )}
    </View>
  );
}
