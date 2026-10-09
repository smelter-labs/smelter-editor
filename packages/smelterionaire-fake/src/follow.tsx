/**
 * FOLLOW demo — the "AI finds the guy in the golden cap" proof segment of
 * workshop episode 6. Three compositions:
 *
 *  - FollowSetup    — opening multiviewer of the three placeholder cameras
 *  - FollowCamSlate — full-frame placeholder for one camera segment (V1);
 *                     the presenter replaces these with real footage
 *  - FollowHud      — transparent overlay (V2, ProRes 4444): program/tally
 *                     chip, target chip, WHY log, mini-multiviewer
 *
 * Cut times come from server/scripts/follow-fake.mjs via --props, so the
 * HUD stays in sync with the butt-joined slates on the Premiere timeline.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { Label, SegmentWipe } from './hud';
import { CHALK, DIM, DISPLAY, GOLD, INK, MONO, RED, SKY, clamp01 } from './theme';

const NAVY = 'rgba(7,11,24,.85)';
const FRAME_LINE = 'rgba(242,244,248,.14)';

const useSceneTime = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tS = frame / fps;
  return { tS, width, height };
};

// ── Golden cap glyph ──────────────────────────────────────────────────────

export function GoldenCap({ size, opacity = 1 }: { size: number; opacity?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.66}
      viewBox='0 0 100 66'
      style={{ display: 'block', opacity }}>
      <path d='M12 44 C12 18 29 5 50 5 C71 5 88 18 88 44 L88 47 L12 47 Z' fill={GOLD} />
      <path d='M50 5 C71 5 88 18 88 44 L88 47 L74 47 C74 25 64 11 48 5.2 Z' fill='#E3B452' />
      <rect x='45' y='1' width='10' height='7' rx='3.5' fill='#CC9E3B' />
      <path d='M9 47 L91 47 C96 47 98.5 51 94 54.5 C78 63 38 65 18 58 C10 55 5 51 9 47 Z' fill='#CC9E3B' />
    </svg>
  );
}

// ── Shared viewfinder chrome ──────────────────────────────────────────────

/** Corner brackets + thirds grid, so a slate reads as a camera frame. */
function Viewfinder({ width, height }: { width: number; height: number }) {
  const b = 46;
  const corner = (x: number, y: number, fx: number, fy: number) => (
    <div
      key={`${fx}${fy}`}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 70,
        height: 70,
        borderLeft: fx === 0 ? `3px solid ${FRAME_LINE}` : 'none',
        borderRight: fx === 1 ? `3px solid ${FRAME_LINE}` : 'none',
        borderTop: fy === 0 ? `3px solid ${FRAME_LINE}` : 'none',
        borderBottom: fy === 1 ? `3px solid ${FRAME_LINE}` : 'none',
      }}
    />
  );
  return (
    <>
      {corner(b, b, 0, 0)}
      {corner(width - b - 70, b, 1, 0)}
      {corner(b, height - b - 70, 0, 1)}
      {corner(width - b - 70, height - b - 70, 1, 1)}
      {[1, 2].map((i) => (
        <div
          key={`v${i}`}
          style={{
            position: 'absolute',
            left: (width * i) / 3,
            top: 0,
            width: 1,
            height,
            backgroundColor: FRAME_LINE,
          }}
        />
      ))}
      {[1, 2].map((i) => (
        <div
          key={`h${i}`}
          style={{
            position: 'absolute',
            left: 0,
            top: (height * i) / 3,
            width,
            height: 1,
            backgroundColor: FRAME_LINE,
          }}
        />
      ))}
    </>
  );
}

// ── FollowCamSlate ────────────────────────────────────────────────────────

export type FollowCamSlateProps = {
  durationS: number;
  cam: number;
  /** What the presenter does in this shot (Premiere replacement note). */
  action: string;
  /** e.g. `SEGMENT 03 · 5.0 s`. */
  note: string;
};

export const FollowCamSlate: React.FC<FollowCamSlateProps> = ({
  durationS,
  cam,
  action,
  note,
}) => {
  const { tS, width, height } = useSceneTime();
  const breathe = 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.4 * tS) ** 2;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: height / 2 - 290,
          width,
          textAlign: 'center',
          fontFamily: DISPLAY,
          fontWeight: 900,
          fontSize: 430,
          lineHeight: 1,
          color: 'rgba(242,244,248,.07)',
        }}>
        {`CAM ${cam}`}
      </div>
      <Viewfinder width={width} height={height} />
      <div
        style={{
          position: 'absolute',
          left: width / 2 - 90,
          top: height / 2 - 220,
        }}>
        <GoldenCap size={180} opacity={breathe} />
      </div>
      <Label
        x={0}
        y={height / 2 - 10}
        w={width}
        text='PODMIEŃ NA NAGRANIE'
        fs={64}
        weight={900}
        align='center'
      />
      <Label
        x={0}
        y={height / 2 + 86}
        w={width}
        text={action}
        fs={26}
        font={MONO}
        weight={500}
        color={DIM}
        align='center'
      />
      <Label
        x={0}
        y={height - 108}
        w={width}
        text={`FOLLOW DEMO · ${note}`}
        fs={20}
        font={MONO}
        weight={600}
        color={SKY}
        align='center'
      />
      <SegmentWipe tS={tS} durationS={durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── FollowSetup (opening multiviewer) ─────────────────────────────────────

export type FollowSetupProps = {
  durationS: number;
  camCount: number;
};

export const FollowSetup: React.FC<FollowSetupProps> = ({ durationS, camCount }) => {
  const { tS, width, height } = useSceneTime();
  const tileW = 520;
  const tileH = 292;
  const gap = 48;
  const rowW = camCount * tileW + (camCount - 1) * gap;
  const x0 = (width - rowW) / 2;
  const y0 = height / 2 - 60;
  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <Label
        x={0}
        y={168}
        w={width}
        text='FOLLOW'
        fs={120}
        weight={900}
        color={GOLD}
        align='center'
      />
      <Label
        x={0}
        y={318}
        w={width}
        text='THREE CAMERAS · ONE GOLDEN CAP'
        fs={30}
        font={MONO}
        weight={600}
        color={CHALK}
        align='center'
      />
      {Array.from({ length: camCount }, (_, i) => {
        const inAt = 0.5 + i * 0.35;
        const opacity = clamp01((tS - inAt) / 0.3);
        const tally = i === 0 && tS > 1.9;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x0 + i * (tileW + gap),
              top: y0,
              width: tileW,
              height: tileH,
              opacity,
              boxSizing: 'border-box',
              border: `${tally ? 5 : 2}px solid ${tally ? GOLD : 'rgba(242,244,248,.28)'}`,
              backgroundColor: '#0E1118',
            }}>
            <div style={{ position: 'absolute', left: tileW / 2 - 55, top: 54 }}>
              <GoldenCap size={110} opacity={i === 0 ? 0.95 : 0.18} />
            </div>
            <Label
              x={0}
              y={186}
              w={tileW}
              text='PODMIEŃ: UJĘCIE Z TEJ KAMERY'
              fs={17}
              font={MONO}
              weight={500}
              color={DIM}
              align='center'
            />
            <div
              style={{
                position: 'absolute',
                left: 14,
                top: 12,
                padding: '4px 10px',
                backgroundColor: NAVY,
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: 2,
                color: tally ? GOLD : 'rgba(242,244,248,.7)',
              }}>
              {`CAM ${i + 1}`}
            </div>
            {tally ? (
              <div
                style={{
                  position: 'absolute',
                  right: 14,
                  top: 12,
                  padding: '4px 10px',
                  backgroundColor: RED,
                  fontFamily: MONO,
                  fontWeight: 600,
                  fontSize: 15,
                  letterSpacing: 2,
                  color: '#fff',
                }}>
                LIVE
              </div>
            ) : null}
          </div>
        );
      })}
      <Label
        x={0}
        y={y0 + tileH + 72}
        w={width}
        text='HOST STARTUJE PRZY KAMERZE 1 — PODMIEŃ KAFLE ALBO ZOSTAW PLANSZĘ'
        fs={20}
        font={MONO}
        weight={500}
        color={DIM}
        align='center'
      />
      <SegmentWipe tS={tS} durationS={durationS} width={width} height={height} />
    </AbsoluteFill>
  );
};

// ── FollowHud (transparent overlay) ───────────────────────────────────────

export type FollowCut = {
  /** Timeline-seconds when the program cuts to `cam`. */
  atS: number;
  cam: number;
  /** Detection lines logged shortly BEFORE the cut (the 3 s head start). */
  detect: string[];
};

export type FollowHudProps = {
  durationS: number;
  camCount: number;
  target: string;
  cuts: FollowCut[];
};

type LogEntry = { atS: number; text: string; color: string };

function buildLog(cuts: FollowCut[]): LogEntry[] {
  const entries: LogEntry[] = [
    { atS: 0.6, text: 'autopilot armed · follow preset · 3 inputs', color: CHALK },
    { atS: 1.4, text: 'scanning for host…', color: DIM },
  ];
  for (const cut of cuts) {
    cut.detect.forEach((text, i) => {
      entries.push({
        atS: cut.atS - 0.6 * (cut.detect.length - i),
        text,
        color: SKY,
      });
    });
    entries.push({
      atS: cut.atS,
      text: `CUT → CAM ${cut.cam} · hold ≥ 2.0 s`,
      color: GOLD,
    });
  }
  return entries.sort((a, b) => a.atS - b.atS);
}

export const FollowHud: React.FC<FollowHudProps> = ({
  durationS: _durationS,
  camCount,
  target,
  cuts,
}) => {
  const { tS } = useSceneTime();
  const activeCam = cuts.reduce<number | null>(
    (acc, c) => (tS >= c.atS ? c.cam : acc),
    null,
  );
  const log = buildLog(cuts).filter((e) => e.atS <= tS);
  const shown = log.slice(-4);

  const chip = (extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    backgroundColor: NAVY,
    fontFamily: MONO,
    fontWeight: 600,
    letterSpacing: 2,
    ...extra,
  });

  return (
    <AbsoluteFill>
      {/* Program chip (top left). */}
      <div style={chip({ left: 48, top: 44, padding: '12px 18px', fontSize: 24, color: CHALK })}>
        <span style={{ color: RED }}>● </span>
        {activeCam == null ? 'PROGRAM · MULTIVIEW' : `PROGRAM · CAM ${activeCam}`}
      </div>
      {/* Target chip (top right). */}
      <div
        style={chip({
          right: 48,
          top: 44,
          padding: '10px 18px',
          fontSize: 17,
          color: DIM,
          textAlign: 'right',
          lineHeight: 1.5,
        })}>
        <span style={{ color: GOLD, fontWeight: 600 }}>AI DIRECTOR · FOLLOW</span>
        <br />
        {`TARGET: ${target.toUpperCase()}`}
      </div>
      {/* WHY log (bottom left). */}
      <div style={{ position: 'absolute', left: 48, bottom: 44 }}>
        <div style={chip({ position: 'relative', padding: '6px 14px', fontSize: 15, color: GOLD, display: 'inline-block' })}>
          WHY
        </div>
        {shown.map((e) => (
          <div
            key={`${e.atS}-${e.text}`}
            style={chip({
              position: 'relative',
              marginTop: 6,
              padding: '8px 14px',
              fontSize: 17,
              letterSpacing: 1,
              color: e.color,
              display: 'block',
              width: 'fit-content',
              opacity: clamp01((tS - e.atS) / 0.25),
            })}>
            {`[${e.atS.toFixed(1).padStart(5, '0')}]  ${e.text}`}
          </div>
        ))}
      </div>
      {/* Mini-multiviewer (bottom right). */}
      {Array.from({ length: camCount }, (_, i) => {
        const cam = i + 1;
        const on = cam === activeCam;
        const w = 150;
        const h = 86;
        return (
          <div
            key={cam}
            style={{
              position: 'absolute',
              right: 48 + (camCount - 1 - i) * (w + 14),
              bottom: 44,
              width: w,
              height: h,
              boxSizing: 'border-box',
              border: `${on ? 4 : 2}px solid ${on ? GOLD : 'rgba(242,244,248,.3)'}`,
              backgroundColor: 'rgba(7,11,24,.6)',
            }}>
            <Label
              x={0}
              y={0}
              w={w}
              text={`CAM ${cam}`}
              fs={20}
              font={MONO}
              weight={600}
              color={on ? GOLD : DIM}
              align='center'
              centerIn={h}
            />
            {on ? (
              <div
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 6,
                  color: RED,
                  fontSize: 16,
                }}>
                ●
              </div>
            ) : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
