'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import {
  AmmoPips,
  Arrow,
  Crosshair,
  Phone,
  QrGlyph,
  Sprite,
} from './illustrations';
import { PIPELINE_NODES } from './screens/pipeline';
import {
  CHARACTERS,
  characterVideoUrl,
  type ArcadeCharacter,
} from './characters';
import {
  ACCENT_LINE,
  ACCENT_RGB,
  ArcadeStage,
  BlueprintBackdrop,
  LedText,
  PanelTitle,
  PixelPanel,
  PixelWing,
  ArcadeText,
  R5,
  RetroFooter,
  StarLine,
  monoFont,
  pixelFont,
  type RetroAccent,
} from './retro-kit';
import './retro.css';

/* ------------------------------------------------------------------ *
 * /duck-hunter-banner — the standing TV placard shown next to the Duck
 * Hunter screen at an event: HOW TO PLAY on the left, HOW IT WORKS (the
 * signal chain) in the middle, and two QR codes (smelter.dev + the
 * workshop) on the right. No interaction beyond click / F = fullscreen;
 * the chain steps through its nodes on a timer — thumbnails in signal
 * order, the lit one popped out and explained in a CRT-style panel — and
 * after every full lap the screen cuts to an attract-mode title card for a
 * few seconds, so the placard is never a dead frame on the TV.
 * ------------------------------------------------------------------ */

const SMELTER_URL = 'https://smelter.dev';
const WORKSHOP_URL = 'https://workshop.smelter.dev';

/** Milliseconds each pipeline step stays lit. */
const STEP_DWELL_MS = 30_000;
/** The title card's CRT power-off, played before it unmounts. */
const TITLE_OFF_MS = 450;
/** If a character clip never ends (failed load, stalled), move on anyway. */
const CLIP_FALLBACK_MS = 8_000;

export function DuckHunterBanner() {
  // Attract loop: the chain steps through its nodes; after the last one the
  // whole screen cuts to the title card, which plays every character clip
  // in full, then the lap restarts.
  const [lit, setLit] = useState(0);
  const [phase, setPhase] = useState<'steps' | 'title'>('steps');
  const [titleOff, setTitleOff] = useState(false);
  useEffect(() => {
    if (phase !== 'steps') return;
    const t = window.setTimeout(() => {
      if (lit === PIPELINE_NODES.length - 1) setPhase('title');
      else setLit(lit + 1);
    }, STEP_DWELL_MS);
    return () => window.clearTimeout(t);
  }, [phase, lit]);

  // Power the title card off, then hand back to step 1. Guarded: the last
  // clip's `ended` and a right-click can both ask for it.
  const leavingRef = useRef(false);
  const finishTitle = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setTitleOff(true);
    window.setTimeout(() => {
      leavingRef.current = false;
      setTitleOff(false);
      setLit(0);
      setPhase('steps');
    }, TITLE_OFF_MS);
  };

  // Right-click = next step (the host skipping ahead for the room).
  const advance = () => {
    if (phase === 'title') finishTitle();
    else if (lit === PIPELINE_NODES.length - 1) setPhase('title');
    else setLit(lit + 1);
  };

  // TV mode: a click or F toggles fullscreen (the page has nothing else to
  // click), so the placard can be parked on a second display with the
  // browser chrome gone.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <ArcadeStage>
      <div
        onClick={toggleFullscreen}
        onContextMenu={(e) => {
          e.preventDefault();
          advance();
        }}
        style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}>
        <PixelPanel
          accent='blue'
          cut={16}
          fill={R5.bgDeep}
          glow={0.3}
          style={{ position: 'absolute', inset: 10 }}
          innerStyle={{
            display: 'flex',
            flexDirection: 'column',
            height: 690,
          }}>
          <Backdrop />

          {/* Header */}
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              paddingTop: 14,
              gap: 6,
            }}>
            <div
              style={{
                fontFamily: pixelFont,
                fontSize: 8,
                letterSpacing: 4,
                color: R5.inkMuted,
              }}>
              EST. 1984 · SMELTER ARCADE · LIVE AI ON REAL VIDEO
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <PixelWing size={44} />
              <ArcadeText size={34}>DUCK HUNTER</ArcadeText>
              <PixelWing size={44} flip />
            </div>
            <StarLine size={10}>PHONES ARE GUNS · TV IS THE MARSH</StarLine>
            <div
              style={{
                alignSelf: 'stretch',
                margin: '4px 22px 0',
                height: 2,
                background: `linear-gradient(90deg, transparent, rgba(${R5.gridRgb},0.6) 20%, rgba(${R5.gridRgb},0.6) 80%, transparent)`,
              }}
            />
          </div>

          {/* Body: rules | pipeline | QR */}
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              flex: 1,
              minHeight: 0,
              padding: '14px 24px 10px',
              display: 'grid',
              gridTemplateColumns: '400px 1fr 232px',
              gap: 18,
            }}>
            <Rules />
            <Pipeline lit={lit} />
            <Links />
          </div>

          {/* Footer */}
          <div
            style={{
              position: 'relative',
              zIndex: 1,
              padding: '0 28px 12px',
            }}>
            <RetroFooter
              tip='scan a code · click or F for fullscreen · right-click next step'
              right={
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 10,
                    letterSpacing: 2,
                    color: R5.inkMuted,
                    textTransform: 'uppercase',
                  }}>
                  smelter.dev · workshop.smelter.dev
                </span>
              }
            />
          </div>

          <div className='r5-scanlines' />
        </PixelPanel>
        {phase === 'title' ? (
          <TitleCard clips={CHARACTERS} off={titleOff} onDone={finishTitle} />
        ) : null}
      </div>
    </ArcadeStage>
  );
}

/* ----------------------------- title card ----------------------------- */

/**
 * Ducks on the title card, flown the way the game flies them: hatch, hold a
 * beat, then a straight 45° flee (up-left or up-right) at the game's speed,
 * wings on the three NES flap frames. `x` is the hatch point (stage px), so
 * left-goers start right of center; `color` picks one of the three ducks.
 */
const TITLE_DUCKS: Array<{
  x: number;
  dir: 'ul' | 'ur';
  color: 0 | 1 | 2;
  delaySec: number;
  /** Full cycle: hold + flight + a quiet gap before the next hatch. */
  cycleSec: number;
  size: number;
}> = [
  { x: 140, dir: 'ur', color: 0, delaySec: 0.8, cycleSec: 11, size: 84 },
  { x: 1060, dir: 'ul', color: 1, delaySec: 3.6, cycleSec: 12.5, size: 92 },
  { x: 520, dir: 'ur', color: 2, delaySec: 6.1, cycleSec: 11.5, size: 72 },
  { x: 760, dir: 'ul', color: 0, delaySec: 8.9, cycleSec: 12, size: 80 },
  { x: 340, dir: 'ur', color: 1, delaySec: 11.4, cycleSec: 13, size: 100 },
];

/** Game flap cadence: ~112 ms a frame, three frames (PacmanBirdsInput). */
const FLAP_FRAME_MS = 112;

/** One duck: the three flap frames stacked, shown one at a time. */
function FlapDuck({
  color,
  size,
  mirror,
  phaseMs,
}: {
  color: 0 | 1 | 2;
  size: number;
  mirror: boolean;
  phaseMs: number;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        transform: mirror ? 'scaleX(-1)' : undefined,
      }}>
      {[0, 1, 2].map((frame) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={frame}
          src={`/duck-hunter/duck-${color}-${frame}.png`}
          alt=''
          className='r5-flap-frame'
          style={{
            position: 'absolute',
            inset: 0,
            width: size,
            height: size,
            imageRendering: 'pixelated',
            animationDelay: `${-(frame * FLAP_FRAME_MS + phaseMs)}ms`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Attract-mode interlude: the cabinet title over the character clips, each
 * played in full, one after another (the card ends with the last one).
 * Powers on like a CRT, the headline slams in, the wings slide up to it,
 * ducks hatch at the bottom and flee at 45°; `off` swaps in the power-off
 * so the card collapses to a line before the placard returns.
 */
function TitleCard({
  clips,
  off,
  onDone,
}: {
  clips: ArcadeCharacter[];
  off: boolean;
  onDone: () => void;
}) {
  const [clipIdx, setClipIdx] = useState(0);
  const clip = clips[clipIdx];
  const next = () => {
    if (clipIdx >= clips.length - 1) onDone();
    else setClipIdx(clipIdx + 1);
  };
  // A clip that never fires `ended` must not park the card forever.
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    const t = window.setTimeout(() => nextRef.current(), CLIP_FALLBACK_MS);
    return () => window.clearTimeout(t);
  }, [clipIdx]);

  return (
    <div
      className={off ? 'r5-crt-off' : 'r5-crt-on'}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        background: R5.bgDeep,
        overflow: 'hidden',
      }}>
      <video
        key={clip.id}
        src={characterVideoUrl(clip)}
        autoPlay
        muted
        playsInline
        onEnded={next}
        onError={next}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: 0.32,
        }}
      />
      <BlueprintBackdrop />

      {TITLE_DUCKS.map((d, i) => (
        <div
          key={i}
          className={d.dir === 'ul' ? 'r5-duck-ul' : 'r5-duck-ur'}
          style={{
            position: 'absolute',
            left: d.x,
            bottom: -d.size - 10,
            animationDuration: `${d.cycleSec}s`,
            animationDelay: `${d.delaySec}s`,
          }}>
          <FlapDuck
            color={d.color}
            size={d.size}
            // The frames face up-right; mirror them for the left-goers.
            mirror={d.dir === 'ul'}
            phaseMs={i * 70}
          />
        </div>
      ))}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}>
        <div
          className='r5-pop-in'
          style={{
            animationDelay: '1.1s',
            fontFamily: pixelFont,
            fontSize: 10,
            letterSpacing: 5,
            color: R5.inkMuted,
          }}>
          EST. 1984 · SMELTER ARCADE
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div className='r5-wing-in' style={{ animationDelay: '0.85s' }}>
            <PixelWing size={96} />
          </div>
          <div className='r5-slam' style={{ animationDelay: '0.4s' }}>
            <ArcadeText size={78}>DUCK HUNTER</ArcadeText>
          </div>
          <div
            className='r5-wing-in'
            style={{ animationDelay: '0.85s', animationName: 'r5-wing-in-r' }}>
            <PixelWing size={96} flip />
          </div>
        </div>
        <div className='r5-pop-in' style={{ animationDelay: '1.3s' }}>
          <StarLine size={15}>PHONES ARE GUNS · TV IS THE MARSH</StarLine>
        </div>
        <div
          className='r5-pop-in'
          style={{ animationDelay: '1.7s', marginTop: 30 }}>
          <span
            className='r5-blink'
            style={{
              display: 'inline-block',
              fontFamily: pixelFont,
              fontSize: 22,
              letterSpacing: 3,
              color: R5.yellow,
              textShadow: `0 0 12px rgba(${R5.yellowRgb},0.7)`,
            }}>
            SCAN THE QR · PLAY ON YOUR PHONE
          </span>
        </div>
        <div
          className='r5-pop-in'
          style={{
            animationDelay: '2s',
            fontFamily: monoFont,
            fontSize: 13,
            letterSpacing: 3,
            color: R5.cyan,
            textTransform: 'uppercase',
          }}>
          smelter.dev · workshop.smelter.dev
        </div>
      </div>
      <div className='r5-scanlines' />
    </div>
  );
}

/* ---------------------------- rules column ---------------------------- */

type Rule = {
  accent: RetroAccent;
  title: string;
  line: string;
  art: React.ReactNode;
};

const RULES: Rule[] = [
  {
    accent: 'cyan',
    title: 'SCAN TO JOIN',
    line: 'POINT YOUR PHONE AT THE QR ON THE GAME SCREEN. NO APP — THE PAGE IS THE GUN.',
    art: (
      <PixelPanel accent='blue' cut={4} fill='#fff' innerStyle={{ padding: 3 }}>
        <svg width={34} height={34} viewBox='0 0 26 26'>
          <QrGlyph x={1} y={1} cell={2} color={R5.edge} />
        </svg>
      </PixelPanel>
    ),
  },
  {
    accent: 'orange',
    title: 'PICK YOUR HUNTER',
    line: 'CALL SIGN + CHARACTER, THEN CALIBRATE: HOLD THE PHONE AT THE SCREEN CENTER AND TAP.',
    art: (
      <Phone size={44} accent={R5.orange}>
        <rect x='7' y='14' width='8' height='10' fill={R5.orange} />
        <rect x='16' y='14' width='8' height='10' fill={R5.line} />
        <rect x='25' y='14' width='8' height='10' fill={R5.line} />
      </Phone>
    ),
  },
  {
    accent: 'yellow',
    title: 'TILT TO AIM',
    line: 'TILT THE PHONE — YOUR CROSSHAIR FOLLOWS ON THE BIG SCREEN.',
    art: <Crosshair size={38} />,
  },
  {
    accent: 'green',
    title: 'TAP TO SHOOT',
    line: 'A REAL BIRD GETS AN AURA, A DUCK HATCHES ON IT AND FLIES OFF. HIT IT ON SCREEN: +1.',
    art: <Sprite name='duck-fly' size={44} />,
  },
  {
    accent: 'red',
    title: 'WATCH YOUR PIPS',
    line: 'A MAGAZINE, AUTO RELOAD. QUICK KILLS CHAIN INTO ×COMBO UP TO ×3. THE DOG SCORES NOTHING.',
    art: <AmmoPips max={4} loaded={3} size={10} />,
  },
  {
    accent: 'pink',
    title: 'WIN THE ROUND',
    line: 'TIME ATTACK: MOST POINTS AT ZERO. SCORE RUSH: FIRST TO THE TARGET. TOP SCORES GO ON THE BOARD.',
    art: (
      <LedText size={26} color={R5.green} glowRgb={R5.greenRgb}>
        1ST
      </LedText>
    ),
  },
];

function Rules() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 0,
      }}>
      <PanelTitle>HOW TO PLAY</PanelTitle>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
        {RULES.map((r, i) => (
          <PixelPanel
            key={r.title}
            accent={r.accent}
            cut={8}
            glow={0.15}
            stretch
            style={{ flex: 1 }}
            innerStyle={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '6px 12px',
            }}>
            <div
              style={{
                width: 56,
                display: 'flex',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
              {r.art}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                minWidth: 0,
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <LedText size={16} color={ACCENT_LINE[r.accent]}>
                  {i + 1}
                </LedText>
                <span
                  style={{
                    fontFamily: pixelFont,
                    fontSize: 8,
                    letterSpacing: 1.5,
                    color: R5.ink,
                  }}>
                  {r.title}
                </span>
              </div>
              <span
                style={{
                  fontFamily: monoFont,
                  fontSize: 9.5,
                  lineHeight: 1.35,
                  letterSpacing: 0.4,
                  color: R5.inkMuted,
                }}>
                {r.line}
              </span>
            </div>
          </PixelPanel>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- pipeline column --------------------------- */

/**
 * Thumbnail strip of the six nodes (signal order, top to bottom) beside a
 * detail panel for the lit one. The panel is keyed by the step so each
 * change remounts it and replays the CRT power-on.
 */
function Pipeline({ lit }: { lit: number }) {
  const node = PIPELINE_NODES[lit];
  const color = ACCENT_LINE[node.accent];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 0,
      }}>
      <PanelTitle>HOW IT WORKS</PanelTitle>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          gap: 14,
        }}>
        {/* Thumbnails */}
        <div
          style={{
            // Wide enough for the longest title, so every thumb is the
            // same width instead of the labels pushing some panels out.
            width: 156,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            // Room for the popped thumb to grow past its slot.
            padding: '0 6px',
          }}>
          {PIPELINE_NODES.map((n, i) => {
            const on = i === lit;
            const c = ACCENT_LINE[n.accent];
            return (
              <React.Fragment key={n.title}>
                {i > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      height: 10,
                      flexShrink: 0,
                    }}>
                    <Arrow
                      size={10}
                      dir='down'
                      color={i <= lit ? c : `rgba(${R5.gridRgb},0.5)`}
                    />
                  </div>
                ) : null}
                <div
                  className={on ? 'r5-thumb-pop' : undefined}
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: '100%',
                    display: 'flex',
                    position: 'relative',
                    zIndex: on ? 2 : 1,
                    transition: 'transform 200ms steps(3, end)',
                  }}>
                  <PixelPanel
                    accent={on ? n.accent : 'blue'}
                    cut={6}
                    glow={on ? 0.9 : 0.1}
                    fill={on ? `rgba(${ACCENT_RGB[n.accent]},0.12)` : undefined}
                    stretch
                    style={{ flex: 1, minWidth: 0 }}
                    innerStyle={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 8px',
                      overflow: 'hidden',
                    }}>
                    <div
                      style={{
                        width: 26,
                        display: 'flex',
                        justifyContent: 'center',
                        flexShrink: 0,
                        opacity: on ? 1 : 0.6,
                      }}>
                      {n.icon(22)}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                        minWidth: 0,
                      }}>
                      <span
                        style={{
                          fontFamily: pixelFont,
                          fontSize: 6,
                          letterSpacing: 0.5,
                          whiteSpace: 'nowrap',
                          color: on ? c : R5.inkMuted,
                          textShadow: on
                            ? `0 0 6px rgba(${ACCENT_RGB[n.accent]},0.7)`
                            : undefined,
                        }}>
                        {n.title}
                      </span>
                      <LedText size={11} color={on ? c : R5.inkMuted}>
                        {String(i + 1).padStart(2, '0')}
                      </LedText>
                    </div>
                  </PixelPanel>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* The lit node, explained — remounts per step for the CRT pop. */}
        <div
          key={lit}
          className='r5-crt-on'
          style={{ flex: 1, minWidth: 0, display: 'flex' }}>
          <PixelPanel
            accent={node.accent}
            cut={10}
            glow={0.5}
            fill={`rgba(${ACCENT_RGB[node.accent]},0.06)`}
            stretch
            style={{ flex: 1 }}
            innerStyle={{
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: `rgba(${ACCENT_RGB[node.accent]},0.1)`,
                  boxShadow: `inset 0 0 0 2px rgba(${ACCENT_RGB[node.accent]},0.45)`,
                }}>
                {node.icon(44)}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  minWidth: 0,
                }}>
                <div
                  style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <LedText
                    size={20}
                    color={color}
                    glowRgb={ACCENT_RGB[node.accent]}>
                    {lit + 1}/{PIPELINE_NODES.length}
                  </LedText>
                  <span
                    style={{
                      fontFamily: pixelFont,
                      fontSize: 13,
                      letterSpacing: 1.5,
                      color,
                      textShadow: `0 0 10px rgba(${ACCENT_RGB[node.accent]},0.6)`,
                      whiteSpace: 'nowrap',
                    }}>
                    {node.title}
                  </span>
                </div>
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 10,
                    letterSpacing: 1.5,
                    color: R5.inkMuted,
                  }}>
                  {node.tag}
                </span>
              </div>
            </div>
            <span
              style={{
                fontFamily: pixelFont,
                fontSize: 10,
                letterSpacing: 1,
                lineHeight: 1.7,
                color: R5.ink,
              }}>
              {node.headline}
            </span>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                flex: 1,
                justifyContent: 'center',
              }}>
              {node.lines.map((l, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontFamily: monoFont,
                    fontSize: 12,
                    lineHeight: 1.5,
                    letterSpacing: 0.4,
                    color: R5.ink,
                  }}>
                  <span style={{ color, flexShrink: 0 }}>▸</span>
                  <span>{l}</span>
                </div>
              ))}
            </div>
            {/* Progress pips: where the loop is. */}
            <div style={{ display: 'flex', gap: 6 }}>
              {PIPELINE_NODES.map((n, i) => (
                <div
                  key={n.title}
                  style={{
                    flex: 1,
                    height: 4,
                    background:
                      i === lit
                        ? ACCENT_LINE[n.accent]
                        : `rgba(${R5.gridRgb},0.35)`,
                    boxShadow:
                      i === lit
                        ? `0 0 6px rgba(${ACCENT_RGB[n.accent]},0.7)`
                        : undefined,
                  }}
                />
              ))}
            </div>
          </PixelPanel>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- QR column ----------------------------- */

function Links() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 0,
      }}>
      <PanelTitle>SCAN</PanelTitle>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
        <QrCard
          accent='yellow'
          url={SMELTER_URL}
          label='SMELTER.DEV'
          caption='THE VIDEO COMPOSITOR BEHIND THE GAME'
        />
        <QrCard
          accent='cyan'
          url={WORKSHOP_URL}
          label='WORKSHOP'
          caption='WORKSHOP.SMELTER.DEV · BUILD IT YOURSELF'
        />
      </div>
    </div>
  );
}

function QrCard({
  accent,
  url,
  label,
  caption,
}: {
  accent: RetroAccent;
  url: string;
  label: string;
  caption: string;
}) {
  return (
    <PixelPanel
      accent={accent}
      cut={10}
      glow={0.35}
      stretch
      style={{ flex: 1 }}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '10px 8px',
      }}>
      <PixelPanel
        accent={accent}
        cut={6}
        fill='#fff'
        innerStyle={{ padding: 6, display: 'flex' }}>
        <QRCode value={url} size={150} fgColor={R5.edge} bgColor='#fff' />
      </PixelPanel>
      <span
        style={{
          fontFamily: pixelFont,
          fontSize: 10,
          letterSpacing: 2,
          color: ACCENT_LINE[accent],
          textShadow: `0 0 8px rgba(${ACCENT_RGB[accent]},0.6)`,
        }}>
        {label}
      </span>
      <span
        style={{
          fontFamily: monoFont,
          fontSize: 8,
          letterSpacing: 0.5,
          color: R5.inkMuted,
          textAlign: 'center',
          lineHeight: 1.4,
        }}>
        {caption}
      </span>
    </PixelPanel>
  );
}

/* ----------------------------- backdrop ----------------------------- */

/** The arcade's blueprint grid plus a faint duck-fly watermark. */
function Backdrop() {
  return (
    <>
      <BlueprintBackdrop />
      <Sprite
        name='duck-fly'
        size={420}
        style={{
          position: 'absolute',
          right: -60,
          bottom: -80,
          opacity: 0.05,
          transform: 'scaleX(-1)',
          zIndex: 0,
        }}
      />
    </>
  );
}
