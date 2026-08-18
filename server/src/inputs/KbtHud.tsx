import React from 'react';
import { Text, View } from '@swmansion/smelter';
import type { KbtHudState, KbtHudTile } from '../app/store';

// Same family as the shooter HUD so the two games share a broadcast look.
const HUD_FONT = 'Doto';
const HUD_BG = '#000000B8';
const GOOD = '#76FF03';
const BAD = '#FF4030';

/**
 * Every value rendered here comes from a snapshot the controller applied with
 * a ~3s hold (matching the delayed WHIP video), so time-based effects must use
 * snapshot fields (flash, remainingMs) — never live Date.now() age math. The
 * ~10 Hz snapshot cadence is what animates flashes and the clock blink.
 */

function formatClock(ms: number | null): string {
  if (ms == null) return '--:--';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Text-box helper: Smelter Views don't auto-size, so measure by heuristic. */
function textWidth(label: string, fontSize: number): number {
  return Math.round(fontSize * 0.62 * (label.length + 1));
}

/**
 * One player's tile chrome: a bottom bar with name + points, a streak chip,
 * a rep flash, and a SIGNAL LOST veil. The coach's own badge (reps/exercise,
 * top-right) and the skeleton shader render independently of this.
 */
export function KbtTileHud({
  tile,
  parent,
}: {
  tile: KbtHudTile;
  parent: { width: number; height: number };
}) {
  const fs = Math.max(20, Math.round(parent.height * 0.032));
  const barH = Math.round(fs * 2.4);
  const pad = Math.round(fs * 0.5);
  const pointsFs = Math.round(fs * 1.6);
  const pointsLabel = `${tile.points}`;
  const pointsW = textWidth(pointsLabel, pointsFs) + pad;

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
            borderWidth: Math.max(4, Math.round(parent.width * 0.012)),
            borderColor:
              tile.lastRepVerdict === 'incorrect' ? BAD : tile.color,
          }}
        />
      ) : null}
      {/* +points pop next to the score while the flash lasts. */}
      {tile.flash && tile.lastRepPoints > 0 ? (
        <View
          style={{
            top: parent.height - barH - Math.round(fs * 1.9),
            left: pad,
            width: textWidth(`+${tile.lastRepPoints}`, fs) + pad,
            height: Math.round(fs * 1.6),
            backgroundColor: HUD_BG,
            borderRadius: Math.round(fs * 0.3),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: tile.lastRepVerdict === 'incorrect' ? BAD : GOOD,
              fontFamily: HUD_FONT,
              fontWeight: 'black',
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
            width: textWidth(`x${tile.streak}`, fs) + pad,
            height: Math.round(fs * 1.6),
            backgroundColor: HUD_BG,
            borderWidth: 2,
            borderColor: GOOD,
            borderRadius: Math.round(fs * 0.3),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: GOOD,
              fontFamily: HUD_FONT,
              fontWeight: 'black',
            }}>
            {` x${tile.streak}`}
          </Text>
        </View>
      ) : null}
      {/* Bottom bar: player color strip, name, big points. */}
      <View
        style={{
          top: parent.height - barH,
          left: 0,
          width: parent.width,
          height: barH,
          backgroundColor: HUD_BG,
          overflow: 'hidden',
        }}>
        <View
          style={{
            top: 0,
            left: 0,
            width: Math.round(fs * 0.5),
            height: barH,
            backgroundColor: tile.color,
          }}
        />
        <View
          style={{
            top: Math.round((barH - fs * 1.4) / 2),
            left: Math.round(fs * 1.1),
            width: Math.max(1, parent.width - pointsW - Math.round(fs * 2.2)),
            height: Math.round(fs * 1.5),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: '#FFFFFF',
              fontFamily: HUD_FONT,
              fontWeight: 'black',
            }}>
            {tile.name}
          </Text>
        </View>
        <View
          style={{
            top: Math.round((barH - pointsFs * 1.35) / 2),
            left: parent.width - pointsW - pad,
            width: pointsW,
            height: Math.round(pointsFs * 1.5),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: pointsFs,
              color: tile.color,
              width: pointsW,
              align: 'right',
              fontFamily: HUD_FONT,
              fontWeight: 'black',
            }}>
            {pointsLabel}
          </Text>
        </View>
      </View>
      {tile.signalLost ? (
        <View
          style={{
            top: Math.round(parent.height * 0.4),
            left: 0,
            width: parent.width,
            height: Math.round(fs * 2),
            backgroundColor: '#7F1D1DCC',
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: Math.round(fs * 1.2),
              color: '#FECACA',
              width: parent.width,
              align: 'center',
              fontFamily: HUD_FONT,
              fontWeight: 'black',
            }}>
            SIGNAL LOST
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Top-center chip: heat label + clock (or phase text). */
function HeatChip({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: { width: number; height: number };
}) {
  const match = hud.match;
  if (!match) return null;
  const fs = Math.max(24, Math.round(resolution.height * 0.038));
  const heatLabel = match.final ? 'FINAL' : `HEAT ${match.heatIndex + 1}`;
  let label: string;
  let color = '#FFFFFF';
  if (match.phase === 'intro') {
    label = `${heatLabel} · GET READY`;
  } else if (match.phase === 'countdown') {
    label = `${heatLabel} · ${formatClock(
      match.endsAt != null && match.startsAt != null
        ? match.endsAt - match.startsAt
        : null,
    )}`;
  } else if (match.phase === 'playing') {
    label = `${heatLabel} · ${formatClock(match.remainingMs)}`;
    // Final 10s: blink keyed to the snapshot clock (applies land ~10/s).
    if (
      match.remainingMs != null &&
      match.remainingMs <= 10_000 &&
      match.remainingMs % 500 < 250
    ) {
      color = BAD;
    }
  } else {
    label = `${heatLabel} · TIME!`;
    color = BAD;
  }
  const width = textWidth(label, fs) + Math.round(fs * 1.2);
  const height = Math.round(fs * 1.9);
  return (
    <View
      style={{
        top: Math.round(resolution.height * 0.025),
        left: Math.round((resolution.width - width) / 2),
        width,
        height,
        backgroundColor: HUD_BG,
        borderWidth: Math.max(3, Math.round(fs * 0.14)),
        borderColor: '#FFFFFF',
        overflow: 'hidden',
      }}>
      <View
        style={{
          top: Math.round((height - fs * 1.4) / 2),
          left: 0,
          width,
          height: Math.round(fs * 1.5),
          overflow: 'hidden',
        }}>
        <Text
          style={{
            fontSize: fs,
            color,
            width,
            align: 'center',
            fontFamily: HUD_FONT,
            fontWeight: 'black',
          }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Giant center countdown (3·2·1) and the winner card after the buzzer. */
function CenterStage({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: { width: number; height: number };
}) {
  const match = hud.match;
  if (!match) return null;
  if (match.phase === 'countdown') {
    // remainingMs counts down the 3s gate; applies land ~10/s so the digit
    // steps cleanly.
    const n = Math.max(1, Math.ceil((match.remainingMs ?? 0) / 1000));
    const bigFs = Math.round(resolution.height * 0.28);
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
            color: '#FFDE59',
            width: resolution.width,
            align: 'center',
            fontFamily: HUD_FONT,
            fontWeight: 'black',
          }}>
          {`${n}`}
        </Text>
      </View>
    );
  }
  if (match.phase === 'ended' && match.winner) {
    const fs = Math.round(resolution.height * 0.07);
    const label = `${match.winner.name} WINS · ${match.winner.points}`;
    const width = textWidth(label, fs) + Math.round(fs * 1.4);
    const height = Math.round(fs * 2.1);
    return (
      <View
        style={{
          top: Math.round(resolution.height * 0.42),
          left: Math.round((resolution.width - width) / 2),
          width,
          height,
          backgroundColor: HUD_BG,
          borderWidth: Math.max(4, Math.round(fs * 0.1)),
          borderColor: match.winner.color,
          overflow: 'hidden',
        }}>
        <View
          style={{
            top: Math.round((height - fs * 1.4) / 2),
            left: 0,
            width,
            height: Math.round(fs * 1.5),
            overflow: 'hidden',
          }}>
          <Text
            style={{
              fontSize: fs,
              color: match.winner.color,
              width,
              align: 'center',
              fontFamily: HUD_FONT,
              fontWeight: 'black',
            }}>
            {label}
          </Text>
        </View>
      </View>
    );
  }
  return null;
}

/** Celebration strip under the heat chip (lead change / streak milestone). */
function Banner({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: { width: number; height: number };
}) {
  const banner = hud.banner;
  if (!banner) return null;
  const fs = Math.max(20, Math.round(resolution.height * 0.032));
  const width = textWidth(banner.text, fs) + Math.round(fs * 1.2);
  const height = Math.round(fs * 1.8);
  return (
    <View
      style={{
        top: Math.round(resolution.height * 0.025) + Math.round(fs * 2.4),
        left: Math.round((resolution.width - width) / 2),
        width,
        height,
        backgroundColor: HUD_BG,
        borderWidth: 2,
        borderColor: banner.color,
        overflow: 'hidden',
      }}>
      <View
        style={{
          top: Math.round((height - fs * 1.4) / 2),
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
            fontFamily: HUD_FONT,
            fontWeight: 'black',
          }}>
          {banner.text}
        </Text>
      </View>
    </View>
  );
}

/** Bottom-right standings strip (top 4 by best/final score). */
function LeaderboardStrip({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: { width: number; height: number };
}) {
  if (hud.leaderboard.length === 0) return null;
  const fs = Math.max(16, Math.round(resolution.height * 0.024));
  const rowH = Math.round(fs * 1.7);
  const width = Math.round(resolution.width * 0.18);
  const height = rowH * hud.leaderboard.length + Math.round(fs * 0.6);
  return (
    <View
      style={{
        top: Math.round(resolution.height * 0.025),
        left: resolution.width - width - Math.round(resolution.width * 0.015),
        width,
        height,
        backgroundColor: HUD_BG,
        borderRadius: Math.round(fs * 0.3),
        paddingVertical: Math.round(fs * 0.3),
        overflow: 'hidden',
      }}>
      {hud.leaderboard.map((row, i) => (
        <View
          key={`${row.name}-${i}`}
          style={{
            top: Math.round(fs * 0.3) + i * rowH,
            left: 0,
            width,
            height: rowH,
            overflow: 'hidden',
          }}>
          <View
            style={{
              top: Math.round(rowH * 0.2),
              left: Math.round(fs * 0.5),
              width: Math.round(fs * 0.45),
              height: Math.round(rowH * 0.6),
              backgroundColor: row.color,
            }}
          />
          <View
            style={{
              top: Math.round((rowH - fs * 1.4) / 2),
              left: Math.round(fs * 1.3),
              width: width - Math.round(fs * 1.6),
              height: Math.round(fs * 1.5),
              overflow: 'hidden',
            }}>
            <Text
              style={{
                fontSize: fs,
                color: '#FFFFFF',
                fontFamily: HUD_FONT,
                fontWeight: 'black',
              }}>
              {`${i + 1}. ${row.name} ${row.points}`}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Scene-level tournament chrome (heat chip + clock, countdown, banner, winner,
 * standings). Mounted once in the output scene, above all layers; per-tile
 * chrome lives in KbtTileHud next to each input.
 */
export function KbtMatchHud({
  hud,
  resolution,
}: {
  hud: KbtHudState;
  resolution: { width: number; height: number };
}) {
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: resolution.width,
        height: resolution.height,
        overflow: 'visible',
      }}>
      <HeatChip hud={hud} resolution={resolution} />
      <Banner hud={hud} resolution={resolution} />
      <CenterStage hud={hud} resolution={resolution} />
      <LeaderboardStrip hud={hud} resolution={resolution} />
    </View>
  );
}
