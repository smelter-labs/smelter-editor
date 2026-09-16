'use client';

import React, { useState } from 'react';
import {
  Arrow,
  ChipIcon,
  EyeIcon,
  FilmIcon,
  Phone,
  ScreenIcon,
  TapIcon,
} from '../illustrations';
import {
  ACCENT_LINE,
  LedText,
  PixelButton,
  PixelPanel,
  R5,
  RetroFooter,
  RetroFrame,
  monoFont,
  pixelFont,
  type RetroAccent,
} from '../retro-kit';
import { useArcadeKeys } from '../use-arcade-input';

export type PipelineNode = {
  title: string;
  /** One-line tag under the title on the chain. */
  tag: string;
  accent: RetroAccent;
  icon: (size: number) => React.ReactNode;
  /** The detail panel: a headline and a few lines. */
  headline: string;
  lines: string[];
  /** Where it lives, for the engineers in the room. */
  code: string;
};

/**
 * The tech pipeline, in signal order. Facts come from the code and the
 * workshop write-up (workshops/smelter-workshop-blog-articles.md, article 5).
 * Shared with the TV banner (banner.tsx) so both tell the same story.
 */
export const PIPELINE_NODES: PipelineNode[] = [
  {
    title: 'STAGE VIDEO',
    tag: 'MP4 / HLS IN',
    accent: 'cyan',
    icon: (s) => <FilmIcon size={s} />,
    headline: 'A VIDEO WITH REAL BIRDS IS THE HUNTING GROUND.',
    lines: [
      'THE HOST PICKS A STAGE ON GAME SETUP: A BUNDLED MP4 OR A LIVE HLS STREAM.',
      'IT IS REGISTERED AS AN INPUT OF A 1920×1080 SMELTER ROOM AND DECODED BY THE ENGINE.',
      'DUCKS ONLY EVER APPEAR WHERE THE FOOTAGE ACTUALLY HAS A BIRD.',
    ],
    code: 'server/src/room/InputManager.ts · use-duck-hunter-room.ts',
  },
  {
    title: 'SIDE CHANNEL',
    tag: 'FRAMES → PYTHON',
    accent: 'orange',
    icon: (s) => <TapIcon size={s} />,
    headline:
      'DECODED FRAMES ARE TAPPED OFF THE PIPELINE AND SENT TO A SIDECAR.',
    lines: [
      'THE NODE SERVER STREAMS FRAMES OVER A WEBSOCKET TO A PYTHON WORKER, STAMPED WITH THE PIPELINE CLOCK.',
      'THE INPUT IS DELAYED BY A FIXED BUDGET (3 S FOR PHONE CAMERAS) SO DETECTIONS LINE UP WITH THE FRAME THEY CAME FROM.',
      'SUBSCRIBE / CONFIGURE / REPLAY: THE WORKER CAN RESTART WITHOUT THE GAME NOTICING.',
    ],
    code: 'server/src/ai-models/base-sidecar.ts · side-channel-config.ts',
  },
  {
    title: 'YOLO BIRDS',
    tag: 'TILED DETECTION',
    accent: 'green',
    icon: (s) => <EyeIcon size={s} />,
    headline:
      'A BIRD IN THE SKY IS TWELVE PIXELS — SO THE FRAME IS INFERRED IN TILES.',
    lines: [
      'YOLOV8 TUNED FOR BIRDS: THE FRAME IS SPLIT INTO AN OVERLAPPING 2×2 OR 3×2 GRID, EACH TILE AT FULL DETAIL, MERGED WITH CROSS-TILE NMS.',
      'MOTION FUSION: CHEAP FRAME-DIFFERENCING CATCHES MOVING BLOBS THE MODEL MISSED (AND BACKS OFF ON A CAMERA PAN).',
      'BOXES COME BACK WITH A TRACK ID AND THE FRAME TIMESTAMP.',
    ],
    code: 'server/src/ai-models/people-counter/manifest.ts · ai-model/worker.py',
  },
  {
    title: 'DUCK LOGIC',
    tag: 'HITS · AMMO · COMBOS',
    accent: 'yellow',
    icon: (s) => <ChipIcon size={s} />,
    headline:
      'EVERY NEW TRACK HATCHES A DUCK. ITS FLIGHT IS A PURE FUNCTION OF TIME.',
    lines: [
      'SERVER AND RENDERER COMPUTE THE SAME POSITION FROM THE SAME SPAWN TIME — SO A SHOT IS TESTED EXACTLY WHERE THE SPRITE IS DRAWN, DESPITE WEBRTC LATENCY.',
      'THE CONTROLLER OWNS THE MATCH: AURA LEAD, HOLD, 45° FLIGHT, MAGAZINE + RELOAD, COMBO MULTIPLIERS, THE TAUNTING DOG, THE SCOREBOARD.',
      'IT PUBLISHES CROSSHAIRS, BURSTS AND SCORES INTO THE RENDER STORE.',
    ],
    code: 'server/src/duckHunter/DuckHunterController.ts · duckFlight.ts · combo.ts',
  },
  {
    title: 'PHONES',
    tag: 'GYRO GUNS',
    accent: 'red',
    icon: (s) => (
      <Phone size={s} accent={R5.red}>
        <rect x='18' y='32' width='4' height='4' fill={R5.red} />
      </Phone>
    ),
    headline: 'THE QR OPENS A WEB PAGE — NO APP. THE PHONE IS A LIGHT GUN.',
    lines: [
      'A WEBSOCKET CARRIES JOIN, AIM AND FIRE. AIM IS A GYRO-MOUSE: ANGULAR RATES INTEGRATED, YAW PROJECTED ONTO GRAVITY, SO IT WORKS AT ANY TILT.',
      'THE PHONE CAN PUBLISH ITS CAMERA OVER WHIP (THE HUNTER PORTRAITS) AND WATCHES THE BROADCAST OVER WHEP.',
      'ONE HTTPS ORIGIN FRONTS THE PAGE, THE API AND THE MEDIA.',
    ],
    code: 'editor/app/mobile/[roomId]/shoot · server/src/room/RoomState.ts',
  },
  {
    title: 'ON AIR',
    tag: 'COMPOSITOR → WHEP',
    accent: 'pink',
    icon: (s) => <ScreenIcon size={s} />,
    headline:
      'SMELTER DRAWS THE GAME OVER THE VIDEO AT 60 FPS AND STREAMS IT OUT.',
    lines: [
      'NES DUCK SPRITES (THREE FLAP FRAMES + THE SHOT POSE), WGSL SHADERS FOR THE SPAWN AURA AND HIT FLASH, THE RETRO HUD, QR AND SCOREBOARD.',
      'ONE WEBRTC OUTPUT FEEDS THIS SCREEN AND EVERY PHONE — EVERYBODY SEES THE SAME FRAME.',
      'THE OPENING, COUNTDOWN AND RESULTS SCREENS ARE BURNED IN SERVER-SIDE TOO.',
    ],
    code: 'server/src/inputs/PacmanBirdsInput.tsx · ShooterLobbyScene.tsx · shaders/*.wgsl',
  },
];

/**
 * PIPELINE — HOW IT WORKS. A chain of six nodes in signal order; ◀ ▶ (or a
 * click) selects one and the panel below explains it.
 */
export function PipelineScreen({ onBack }: { onBack: () => void }) {
  const [idx, setIdx] = useState(0);
  useArcadeKeys({
    left: () => setIdx((i) => Math.max(0, i - 1)),
    right: () => setIdx((i) => Math.min(PIPELINE_NODES.length - 1, i + 1)),
    confirm: onBack,
    back: onBack,
  });
  const node = PIPELINE_NODES[idx];

  return (
    <RetroFrame
      title='PIPELINE'
      eyebrow='DUCK HUNTER · HOW IT WORKS'
      subtitle='REAL BIRDS → YOLO → DUCKS → YOUR PHONE'
      titleSize={26}
      footer={
        <RetroFooter
          tip='◀ ▶ step through · esc back to the lobby'
          right={
            <PixelButton accent='red' glyph='B' label='BACK' onClick={onBack} />
          }
        />
      }>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}>
        {/* The chain */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          {PIPELINE_NODES.map((n, i) => {
            const selected = i === idx;
            return (
              <React.Fragment key={n.title}>
                {i > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                    }}>
                    <Arrow
                      size={18}
                      color={i <= idx ? ACCENT_LINE[n.accent] : R5.inkMuted}
                    />
                  </div>
                ) : null}
                <button
                  type='button'
                  className='r5-btn'
                  onClick={() => setIdx(i)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <PixelPanel
                    accent={selected ? n.accent : 'blue'}
                    cut={8}
                    glow={selected ? 0.8 : 0.15}
                    fill={selected ? `rgba(${R5.gridRgb},0.18)` : undefined}
                    innerStyle={{
                      height: 118,
                      padding: '12px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}>
                    {n.icon(40)}
                    <span
                      style={{
                        fontFamily: pixelFont,
                        fontSize: 8,
                        letterSpacing: 1,
                        color: selected ? ACCENT_LINE[n.accent] : R5.ink,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}>
                      {n.title}
                    </span>
                    <span
                      style={{
                        fontFamily: monoFont,
                        fontSize: 9,
                        letterSpacing: 1,
                        color: R5.inkMuted,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                      }}>
                      {n.tag}
                    </span>
                  </PixelPanel>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* The selected node, explained */}
        <PixelPanel
          accent={node.accent}
          cut={10}
          glow={0.25}
          stretch
          style={{ flex: 1 }}
          innerStyle={{
            padding: '22px 26px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 16,
          }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <LedText
              size={22}
              color={ACCENT_LINE[node.accent]}
              glowRgb={R5.yellowRgb}>
              {idx + 1}/{PIPELINE_NODES.length}
            </LedText>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 11,
                letterSpacing: 1.5,
                lineHeight: 1.5,
                color: R5.ink,
              }}>
              {node.headline}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
            {node.lines.map((l, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  fontFamily: monoFont,
                  fontSize: 13,
                  lineHeight: 1.5,
                  letterSpacing: 0.5,
                  color: R5.ink,
                }}>
                <span
                  style={{ color: ACCENT_LINE[node.accent], flexShrink: 0 }}>
                  ▸
                </span>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <span
            style={{
              fontFamily: monoFont,
              fontSize: 10,
              letterSpacing: 1,
              color: R5.inkMuted,
            }}>
            {node.code}
          </span>
        </PixelPanel>
      </div>
    </RetroFrame>
  );
}
