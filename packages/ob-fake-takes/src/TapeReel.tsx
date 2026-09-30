import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { HAIR, SKIN } from "./characters";
import { CHALK, DIM, FAINT, RED, RULE, SKY } from "./theme";

export type TapeReelProps = {
  title: string;
  durationS: number;
};

const BALL = "#F97316";
const BALL_SEAM = "#7C2D12";
const FLOOR = "#2A1F12";
const PLANK = "rgba(242,244,248,.05)";
const CROWD_BG = "#0C0F14";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type ArmMode = "dribble" | "up" | "guard" | "land";

// A full-body illustrated player, feet at the local origin, ~380 px tall.
// `phase` drives the run cycle; `facing` flips the figure.
const Player: React.FC<{
  x: number;
  y: number;
  facing: 1 | -1;
  color: string;
  number: string;
  phase: number;
  run: number; // 0 = standing, 1 = full stride
  arms: ArmMode;
}> = ({ x, y, facing, color, number, phase, run, arms }) => {
  const stride = Math.sin(phase) * 46 * run;
  const lift = (s: number) => Math.max(0, Math.sin(s)) * 26 * run;
  const bob = Math.abs(Math.sin(phase)) * 8 * run;
  const footA = { x: stride, y: -lift(phase) };
  const footB = { x: -stride, y: -lift(phase + Math.PI) };
  const hipY = -190 - bob;
  const chestY = -300 - bob;
  const headY = -352 - bob;
  const leg = (foot: { x: number; y: number }, hipX: number) => (
    <polyline
      points={`${hipX},${hipY} ${(hipX + foot.x) / 2 + 8 * facing},${hipY + 60} ${foot.x},${foot.y - 12}`}
      fill="none"
      stroke={SKIN}
      strokeWidth={26}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  const shoe = (foot: { x: number; y: number }) => (
    <rect x={foot.x - 24} y={foot.y - 18} width={52} height={20} rx={9} fill="#E7EAF0" />
  );
  const arm = (hand: { x: number; y: number }, shoulderX: number) => (
    <polyline
      points={`${shoulderX},${chestY + 26} ${(shoulderX + hand.x) / 2 + 10 * facing},${(chestY + 26 + hand.y) / 2 + 14} ${hand.x},${hand.y}`}
      fill="none"
      stroke={SKIN}
      strokeWidth={22}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  const hands: { a: { x: number; y: number }; b: { x: number; y: number } } =
    arms === "up"
      ? { a: { x: 20 * facing, y: -430 - bob }, b: { x: 52 * facing, y: -418 - bob } }
      : arms === "guard"
        ? { a: { x: 88 * facing, y: -250 - bob }, b: { x: -74 * facing, y: -246 - bob } }
        : arms === "land"
          ? { a: { x: 46 * facing, y: -190 - bob }, b: { x: -40 * facing, y: -196 - bob } }
          : {
              // dribble: lead hand pumps low over the ball, trail arm swings
              a: { x: 84 * facing, y: -150 - bob + Math.sin(phase * 2) * 20 },
              b: { x: -50 * facing - stride * 0.4, y: -236 - bob },
            };
  return (
    <g transform={`translate(${x} ${y})`}>
      {leg(footA, -12)}
      {leg(footB, 12)}
      {shoe(footA)}
      {shoe(footB)}
      {/* shorts */}
      <path
        d={`M -34 ${hipY - 34} L 34 ${hipY - 34} L 42 ${hipY + 26} L 12 ${hipY + 30} L 0 ${hipY - 2} L -12 ${hipY + 30} L -42 ${hipY + 26} Z`}
        fill="#141922"
      />
      {arm(hands.b, -30 * facing)}
      {/* jersey */}
      <path
        d={`M -44 ${chestY + 10} C -50 ${hipY - 50} -40 ${hipY - 26} -34 ${hipY - 24}
           L 34 ${hipY - 24} C 40 ${hipY - 26} 50 ${hipY - 50} 44 ${chestY + 10}
           C 30 ${chestY - 6} -30 ${chestY - 6} -44 ${chestY + 10} Z`}
        fill={color}
      />
      <text
        x={0}
        y={hipY - 68}
        textAnchor="middle"
        fontFamily="BSD"
        fontWeight={900}
        fontSize={54}
        fill="#0A0C10"
      >
        {number}
      </text>
      {arm(hands.a, 30 * facing)}
      {/* neck + head */}
      <rect x={10 * facing - 9} y={headY + 14} width={18} height={26} rx={7} fill={SKIN} />
      <circle cx={10 * facing} cy={headY} r={28} fill={SKIN} />
      <path
        d={`M ${10 * facing - 28} ${headY} A 28 28 0 0 1 ${10 * facing + 28} ${headY}
           L ${10 * facing + 20} ${headY - 12} L ${10 * facing - 22} ${headY - 10} Z`}
        fill={HAIR}
      />
    </g>
  );
};

// Stand-in highlights for the tape cam: an illustrated broadcast side view —
// crowd, LED band, parquet, and a drive-and-shoot play every 6 s (jersey 23,
// of course). Muted by design (the tape airs silent); ob-tape-reel.mjs
// normalises it exactly like a real downloaded clip.
export const TapeReel: React.FC<TapeReelProps> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const play = Math.floor(t / 6);
  const p = (t % 6) / 6;
  const fromLeft = play % 2 === 0;
  const facing: 1 | -1 = fromLeft ? 1 : -1;

  const feetY = height * 0.9;
  const rimY = height * 0.5;
  // Rim centers: the board hangs toward the court, the rim in front of it.
  const liveHoopX = fromLeft ? width - 128 : 128;
  const liveDir: 1 | -1 = fromLeft ? 1 : -1;
  const rimX = liveHoopX - 95 * liveDir;

  // Phases of the play: drive → gather/jump → ball flight → reset.
  const drive = clamp01(p / 0.52);
  const jump = clamp01((p - 0.52) / 0.1);
  const flight = clamp01((p - 0.62) / 0.3);
  const landed = p > 0.78;

  const xStart = fromLeft ? width * 0.16 : width * 0.84;
  const xRelease = fromLeft ? width * 0.6 : width * 0.4;
  const shooterX = lerp(xStart, xRelease, drive);
  const jumpH = Math.sin(Math.min(jump + flight * 0.55, 1) * Math.PI) * 120;
  const shooterY = feetY - jumpH;

  const defenderX = shooterX + 210 * facing;
  const swish = flight >= 1;
  const swishT = swish ? (p - 0.92) * 6 : 0;

  // Ball: dribbled to the gather, then a clean arc into the rim.
  const releaseX = shooterX + 40 * facing;
  const releaseY = shooterY - 430;
  let ballX: number;
  let ballY: number;
  if (flight > 0) {
    ballX = lerp(releaseX, rimX, flight);
    ballY = lerp(releaseY, rimY + 6, flight) - Math.sin(flight * Math.PI) * 240;
  } else if (jump > 0) {
    ballX = releaseX;
    ballY = lerp(feetY - 190, releaseY, jump);
  } else {
    ballX = shooterX + 62 * facing;
    const bounce = Math.abs(Math.sin(t * Math.PI * 2.4));
    ballY = feetY - 18 - bounce * 170;
  }

  const crowdRows = [140, 205, 270, 335];
  // `hx` = baseline pole; the board and rim hang toward the court (−dir side).
  const hoop = (hx: number, dir: 1 | -1, live: boolean) => {
    const netSway = live && swish ? Math.sin(swishT * Math.PI * 3) * (1 - swishT) * 14 : 0;
    const boardX = hx - 38 * dir;
    const rimIn = boardX - 108 * dir; // rim tip (court side)
    const rimCx = boardX - 57 * dir;
    return (
      <g>
        {/* pole + arm */}
        <rect x={hx - 8} y={rimY - 190} width={16} height={feetY - rimY + 168} fill="rgba(242,244,248,.22)" />
        <rect x={Math.min(hx, boardX)} y={rimY - 190} width={Math.abs(hx - boardX)} height={13} fill="rgba(242,244,248,.22)" />
        {/* backboard */}
        <rect x={boardX - 6} y={rimY - 196} width={12} height={210} rx={4} fill="rgba(242,244,248,.55)" />
        <rect x={boardX - 6} y={rimY - 78} width={12} height={64} fill={live && swish ? RED : "rgba(255,45,45,.55)"} />
        {/* rim */}
        <line x1={boardX - 6 * dir} y1={rimY} x2={rimIn} y2={rimY} stroke={RED} strokeWidth={10} strokeLinecap="round" />
        {/* net: tapers toward the middle */}
        {[0, 1, 2, 3, 4].map((i) => {
          const topX = lerp(boardX - 12 * dir, rimIn + 6 * dir, i / 4);
          const botX = lerp(rimCx + 26 * dir, rimCx - 26 * dir, i / 4) + netSway;
          return (
            <line
              key={i}
              x1={topX}
              y1={rimY + 5}
              x2={botX}
              y2={rimY + 62}
              stroke="rgba(242,244,248,.55)"
              strokeWidth={3.5}
            />
          );
        })}
        <line
          x1={rimCx - 26 * dir + netSway}
          y1={rimY + 62}
          x2={rimCx + 26 * dir + netSway}
          y2={rimY + 62}
          stroke="rgba(242,244,248,.45)"
          strokeWidth={3.5}
        />
      </g>
    );
  };

  return (
    <AbsoluteFill style={{ background: CROWD_BG, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translateX(${Math.sin(t * 0.21) * 26}px) scale(1.05)` }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", inset: 0 }}>
          {/* crowd */}
          {crowdRows.map((ry, r) =>
            Array.from({ length: 34 }, (_, i) => {
              const cx = -30 + i * 60 + (r % 2) * 30;
              const pop = swish ? Math.max(0, Math.sin((i + r) * 1.7)) * (1 - swishT) * 16 : 0;
              const bobble = Math.sin(frame * 0.06 + i * 1.3 + r) * 2.5;
              return (
                <circle
                  key={`${r}-${i}`}
                  cx={cx}
                  cy={ry + bobble - pop}
                  r={17}
                  fill={`rgba(242,244,248,${0.1 + ((i * 7 + r * 3) % 5) * 0.022})`}
                />
              );
            }),
          )}
          {/* LED band */}
          <rect x={0} y={396} width={width} height={54} fill="#10141B" />
          {[0, 1].map((k) => (
            <text
              key={k}
              x={((frame * 3) % (width + 1400)) - 700 - k * (width + 1400)}
              y={433}
              fontFamily="Plex"
              fontWeight={600}
              fontSize={26}
              letterSpacing=".3em"
              fill={DIM}
            >
              {`${title.toUpperCase()} · THE TAPE · ${title.toUpperCase()} · THE TAPE`}
            </text>
          ))}
          {/* floor */}
          <rect x={0} y={450} width={width} height={height - 450} fill={FLOOR} />
          {Array.from({ length: 24 }, (_, i) => (
            <line key={i} x1={i * 90 - 40} y1={450} x2={i * 90 - 180} y2={height} stroke={PLANK} strokeWidth={5} />
          ))}
          <line x1={0} y1={452} x2={width} y2={452} stroke={RULE} strokeWidth={4} />
          {/* court markings */}
          <ellipse cx={width / 2} cy={feetY - 24} rx={250} ry={54} fill="none" stroke="rgba(242,244,248,.14)" strokeWidth={6} />

          {hoop(liveHoopX, liveDir, true)}
          {hoop(fromLeft ? 128 : width - 128, (-liveDir) as 1 | -1, false)}

          {/* defender backpedals, hands out, small hop at the release */}
          <Player
            x={defenderX}
            y={feetY - (jump > 0 ? Math.sin(Math.min(jump + flight, 1) * Math.PI) * 60 : 0)}
            facing={-facing as 1 | -1}
            color={RED}
            number="7"
            phase={t * 9 + 2}
            run={jump > 0 ? 0.2 : 0.75}
            arms="guard"
          />
          {/* shooter */}
          <Player
            x={shooterX}
            y={shooterY}
            facing={facing}
            color={SKY}
            number="23"
            phase={t * 11}
            run={jump > 0 ? 0.15 : 1}
            arms={flight > 0 ? (landed ? "land" : "up") : jump > 0 ? "up" : "dribble"}
          />

          {/* ball trail while it flies */}
          {flight > 0
            ? Array.from({ length: 5 }, (_, i) => {
                const fq = Math.max(0, flight - (i + 1) * 0.05);
                const tx = lerp(releaseX, rimX, fq);
                const ty = lerp(releaseY, rimY + 6, fq) - Math.sin(fq * Math.PI) * 240;
                return <circle key={i} cx={tx} cy={ty} r={20 - i * 3} fill={BALL} opacity={0.22 - i * 0.04} />;
              })
            : null}
          {/* ball */}
          {!swish || swishT < 0.6 ? (
            <g transform={`translate(${ballX} ${swish ? rimY + 20 + swishT * 160 : ballY}) rotate(${t * 320})`}>
              <circle r={22} fill={BALL} />
              <path d="M -22 0 A 22 22 0 0 1 22 0" fill="none" stroke={BALL_SEAM} strokeWidth={3.5} />
              <line x1={0} y1={-22} x2={0} y2={22} stroke={BALL_SEAM} strokeWidth={3.5} />
            </g>
          ) : null}
          {/* bucket! */}
          {swish ? (
            <text
              x={rimX - 40 * facing}
              y={rimY - 130 - swishT * 70}
              textAnchor="middle"
              fontFamily="BSD"
              fontWeight={900}
              fontSize={72}
              fill={SKY}
              opacity={Math.max(0, 1 - swishT)}
            >
              +3
            </text>
          ) : null}
        </svg>
      </AbsoluteFill>

      {/* archive wash */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: "rotate(-8deg)" }}>
        <div
          style={{
            fontFamily: "Plex",
            fontWeight: 600,
            fontSize: 96,
            letterSpacing: ".34em",
            color: FAINT,
            whiteSpace: "nowrap",
            opacity: 0.75,
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
