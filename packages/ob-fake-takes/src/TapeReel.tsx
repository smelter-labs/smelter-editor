import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CHALK, DIM, FAINT, RED, RULE, SKY } from "./theme";

export type TapeReelProps = {
  title: string;
  durationS: number;
};

const COURT = "#10151B";
const BALL = "#F97316";

// Stand-in highlights: basketball motion graphics — court lines, an arcing
// ball, an ARCHIVE FOOTAGE wash. Muted by design (the tape cam airs silent);
// ob-tape-reel.mjs normalises it exactly like a real downloaded clip.
export const TapeReel: React.FC<TapeReelProps> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  // One "play" every 6 s: the ball arcs from a side toward the hoop.
  const play = Math.floor(t / 6);
  const p = (t % 6) / 6;
  const fromLeft = play % 2 === 0;
  const x0 = fromLeft ? width * 0.12 : width * 0.88;
  const x1 = fromLeft ? width * 0.82 : width * 0.18;
  const bx = x0 + (x1 - x0) * p;
  const by = height * 0.72 - Math.sin(Math.PI * p) * height * 0.42;
  const pan = Math.sin(t * 0.21) * 30;
  return (
    <AbsoluteFill style={{ background: COURT, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translateX(${pan}px) scale(1.06)` }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0 }}
        >
          {/* floor */}
          <rect
            x={60}
            y={140}
            width={width - 120}
            height={height - 260}
            fill="none"
            stroke={RULE}
            strokeWidth={5}
          />
          <line
            x1={width / 2}
            y1={140}
            x2={width / 2}
            y2={height - 120}
            stroke={RULE}
            strokeWidth={5}
          />
          <circle
            cx={width / 2}
            cy={height / 2 + 10}
            r={130}
            fill="none"
            stroke={RULE}
            strokeWidth={5}
          />
          {/* three-point arcs */}
          <path
            d={`M 60 ${height * 0.25} Q ${width * 0.28} ${height / 2 + 10} 60 ${height * 0.78}`}
            fill="none"
            stroke={RULE}
            strokeWidth={5}
          />
          <path
            d={`M ${width - 60} ${height * 0.25} Q ${width * 0.72} ${height / 2 + 10} ${width - 60} ${height * 0.78}`}
            fill="none"
            stroke={RULE}
            strokeWidth={5}
          />
          {/* ball trail */}
          {Array.from({ length: 6 }, (_, i) => {
            const tp = Math.max(0, p - i * 0.035);
            const tx = x0 + (x1 - x0) * tp;
            const ty = height * 0.72 - Math.sin(Math.PI * tp) * height * 0.42;
            return (
              <circle
                key={i}
                cx={tx}
                cy={ty}
                r={34 - i * 4}
                fill={BALL}
                opacity={0.28 - i * 0.04}
              />
            );
          })}
          {/* ball */}
          <g transform={`translate(${bx} ${by}) rotate(${t * 240})`}>
            <circle r={38} fill={BALL} />
            <path
              d="M -38 0 A 38 38 0 0 1 38 0"
              fill="none"
              stroke="#7C2D12"
              strokeWidth={4}
            />
            <line
              x1={0}
              y1={-38}
              x2={0}
              y2={38}
              stroke="#7C2D12"
              strokeWidth={4}
            />
          </g>
        </svg>
      </AbsoluteFill>
      {/* archive wash */}
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: "rotate(-8deg)",
        }}
      >
        <div
          style={{
            fontFamily: "Plex",
            fontWeight: 600,
            fontSize: 96,
            letterSpacing: ".34em",
            color: FAINT,
            whiteSpace: "nowrap",
          }}
        >
          ARCHIVE FOOTAGE
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 44,
          left: 52,
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontFamily: "Plex",
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: ".2em",
          color: DIM,
        }}
      >
        <span style={{ color: RED }}>●</span>
        {title.toUpperCase()} · THE TAPE
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 48,
          right: 60,
          fontFamily: "BSD",
          fontWeight: 900,
          fontSize: 54,
          letterSpacing: ".04em",
          color: CHALK,
          opacity: 0.8,
        }}
      >
        <span style={{ color: SKY }}>PLAY {play + 1}</span>
      </div>
    </AbsoluteFill>
  );
};
