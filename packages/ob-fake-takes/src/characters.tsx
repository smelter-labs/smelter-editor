import React from "react";

// Illustrated cast for the fake takes. Every persona is the same face — the
// demos are "a panel with myself", so one actor, many costumes — and the
// costume comes from the persona key (HOST → anchor's blazer and tie, COACH →
// cap and whistle, …). All motion is deterministic in (frame, seed): the
// mouth cycles while the persona's line slots are active, eyes blink on a
// seeded period, one hand lifts and waves while talking.

export const SKIN = "#EBBF97";
export const SKIN_SHADE = "#D9A87C";
export const HAIR = "#3B2B1E";
export const INK = "#211913";
export const MOUTH = "#5C2B26";
export const TEETH = "#F6EFE6";

export type Archetype =
  | "anchor"
  | "coach"
  | "analyst"
  | "skeptic"
  | "nerd"
  | "guest";

export const archetypeOf = (key: string): Archetype => {
  const k = key.toUpperCase();
  if (k.includes("HOST") || k.includes("ANCHOR")) return "anchor";
  if (k.includes("COACH")) return "coach";
  if (k.includes("STAT") || k.includes("ANALY")) return "analyst";
  if (k.includes("SKEPT")) return "skeptic";
  if (k.includes("NERD") || k.includes("RESEARCH")) return "nerd";
  return "guest";
};

/** 0..1 mouth openness while talking; 0 when quiet. */
export const talkAmount = (
  frame: number,
  seed: number,
  speaking: boolean,
): number => {
  if (!speaking) return 0;
  const a = Math.abs(Math.sin(frame * 0.45 + seed * 2.1));
  const b = 0.4 + 0.6 * Math.abs(Math.sin(frame * 0.117 + seed));
  return Math.min(1, a * b * 1.5);
};

/** 0..1 eyelid closure: a seeded blink every ~2.2–3.8 s. */
const blinkAmount = (frame: number, fps: number, seed: number): number => {
  const period = Math.round(fps * (2.2 + ((seed * 7919) % 97) / 60));
  const ph = (frame + Math.round(seed * 13)) % Math.max(period, 8);
  if (ph > 5) return 0;
  return ph < 3 ? 1 : (5 - ph) / 2;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type CharacterProps = {
  archetype: Archetype;
  /** Persona accent color (tie, cap, hoodie…). */
  color: string;
  frame: number;
  fps: number;
  /** Small integer; de-syncs blinks/gestures between personas. */
  seed: number;
  speaking: boolean;
  /** Rendered width in px (viewBox is 400×470, waist-up at a desk). */
  width?: number;
  /** Small head tilt in degrees (wide shot: lean toward the desk center). */
  tilt?: number;
};

export const Character: React.FC<CharacterProps> = ({
  archetype,
  color,
  frame,
  fps,
  seed,
  speaking,
  width = 400,
  tilt = 0,
}) => {
  const talk = talkAmount(frame, seed, speaking);
  const blink = blinkAmount(frame, fps, seed);
  const breathe = Math.sin(frame * 0.035 + seed) * 2.4;
  const headRot =
    tilt +
    Math.sin(frame * 0.05 + seed * 3) * 1.3 +
    (speaking ? Math.sin(frame * 0.16 + seed) * 2.0 : 0);
  // One hand lifts while talking and waves; otherwise both rest on the desk.
  const gestureTarget = speaking
    ? 0.55 + 0.45 * clamp01(Math.sin(frame * 0.055 + seed * 5) * 0.8 + 0.5)
    : 0;
  const wave = speaking ? Math.sin(frame * 0.24 + seed) * 10 : 0;
  const handX = lerp(258, 316, gestureTarget);
  const handY = lerp(438, 320, gestureTarget) + wave * 0.6;
  const browLift = speaking ? 2 + Math.sin(frame * 0.09 + seed) * 2.5 : 0;

  const glasses =
    archetype === "analyst" ? (
      <g stroke={INK} strokeWidth={5} fill="rgba(242,244,248,.08)">
        <rect x={156} y={136} width={42} height={26} rx={6} />
        <rect x={202} y={136} width={42} height={26} rx={6} />
        <line x1={198} y1={146} x2={202} y2={146} />
        <line x1={156} y1={146} x2={140} y2={142} />
        <line x1={244} y1={146} x2={260} y2={142} />
      </g>
    ) : archetype === "nerd" ? (
      <g stroke={INK} strokeWidth={6} fill="rgba(242,244,248,.08)">
        <circle cx={177} cy={149} r={21} />
        <circle cx={223} cy={149} r={21} />
        <line x1={198} y1={147} x2={202} y2={147} />
        <line x1={156} y1={145} x2={141} y2={141} />
        <line x1={244} y1={145} x2={259} y2={141} />
      </g>
    ) : null;

  const hair = (() => {
    switch (archetype) {
      case "coach":
        // Sideburns only — the cap covers the rest.
        return (
          <g fill={HAIR}>
            <rect x={139} y={140} width={12} height={26} rx={5} />
            <rect x={249} y={140} width={12} height={26} rx={5} />
          </g>
        );
      case "nerd":
        // Messy spikes.
        return (
          <path
            fill={HAIR}
            d="M138 140 C 134 96 156 70 200 68 C 244 70 266 96 262 140
               L 252 128 L 248 142 L 238 122 L 230 138 L 218 116 L 208 134
               L 196 114 L 186 134 L 174 118 L 166 138 L 156 124 L 150 142 Z"
          />
        );
      case "skeptic":
        // Swept back, a little volume.
        return (
          <path
            fill={HAIR}
            d="M136 146 C 130 92 158 62 200 62 C 246 62 270 94 264 146
               C 262 118 252 102 240 96 C 236 108 230 112 224 112
               C 224 100 216 92 200 90 C 176 92 160 104 152 122
               C 146 130 140 138 136 146 Z"
          />
        );
      case "analyst":
        // Short flat top.
        return (
          <path
            fill={HAIR}
            d="M138 138 C 136 100 160 76 200 74 C 240 76 264 100 262 138
               C 252 116 236 106 200 106 C 164 106 148 116 138 138 Z"
          />
        );
      case "anchor":
        // Neat side part.
        return (
          <path
            fill={HAIR}
            d="M137 142 C 132 96 158 70 200 70 C 244 70 268 96 263 142
               C 258 116 246 102 232 98 L 226 110 C 214 98 186 94 168 102
               C 152 110 142 124 137 142 Z"
          />
        );
      default:
        return (
          <path
            fill={HAIR}
            d="M138 142 C 134 98 160 72 200 72 C 240 72 266 98 262 142
               C 252 114 232 102 200 102 C 168 102 148 114 138 142 Z"
          />
        );
    }
  })();

  const costume = (() => {
    const torso = (fill: string) => (
      <path
        fill={fill}
        d="M52 470 C 60 348 116 268 200 268 C 284 268 340 348 348 470 Z"
      />
    );
    switch (archetype) {
      case "anchor":
        return (
          <g>
            {torso("#232B3A")}
            {/* shirt + lapels + tie */}
            <path fill="#E7EAF0" d="M168 274 L 200 328 L 232 274 L 200 262 Z" />
            <path fill="#1B2230" d="M168 272 L 200 330 L 146 308 Z" />
            <path fill="#1B2230" d="M232 272 L 200 330 L 254 308 Z" />
            <path
              fill={color}
              d="M193 292 L 207 292 L 212 306 L 204 388 L 196 388 L 188 306 Z"
            />
            <rect x={191} y={284} width={18} height={12} rx={3} fill={color} />
          </g>
        );
      case "coach":
        return (
          <g>
            {torso("#26313F")}
            {/* polo collar + zip, whistle on a lanyard */}
            <path fill="#314052" d="M164 276 L 200 304 L 236 276 L 200 262 Z" />
            <line
              x1={200}
              y1={304}
              x2={200}
              y2={368}
              stroke="#1A222D"
              strokeWidth={5}
            />
            <path
              stroke="#0F1319"
              strokeWidth={5}
              fill="none"
              d="M168 280 C 180 316 190 332 199 342 M232 280 C 220 316 210 332 201 342"
            />
            <g transform="translate(199 344) rotate(18)">
              <rect x={-12} y={0} width={24} height={15} rx={6} fill={color} />
              <circle cx={13} cy={7} r={6.5} fill={color} />
              <circle cx={1} cy={7} r={3.4} fill="#0F1319" />
            </g>
          </g>
        );
      case "analyst":
        return (
          <g>
            {/* shirt, sleeves rolled, tie loosened sideways */}
            {torso("#DDE2EA")}
            <path fill="#C6CEDA" d="M170 274 L 200 310 L 230 274 L 200 262 Z" />
            <path
              fill={color}
              d="M196 292 L 212 296 L 218 312 L 214 382 L 202 378 L 194 308 Z"
            />
            <rect
              x={193}
              y={284}
              width={20}
              height={13}
              rx={3}
              fill={color}
              transform="rotate(8 203 290)"
            />
            <rect x={112} y={352} width={26} height={34} rx={4} fill="#C6CEDA" />
            <rect x={116} y={354} width={6} height={20} rx={2} fill={INK} />
          </g>
        );
      case "skeptic":
        return (
          <g>
            {torso("#1C2129")}
            <path fill="#E7EAF0" d="M174 272 L 200 314 L 226 272 L 200 262 Z" />
            <path fill="#12161C" d="M174 270 L 200 318 L 148 310 Z" />
            <path fill="#12161C" d="M226 270 L 200 318 L 252 310 Z" />
            {/* pocket square, no tie — open collar */}
            <path fill={color} d="M256 348 L 280 348 L 268 364 Z" />
          </g>
        );
      case "nerd":
        return (
          <g>
            {/* hood bunched behind the neck + drawstrings */}
            <path
              fill="#2A3240"
              d="M116 296 C 116 254 150 234 200 234 C 250 234 284 254 284 296
                 C 258 276 232 268 200 268 C 168 268 142 276 116 296 Z"
            />
            {torso("#333D4E")}
            <path
              fill="#2A3240"
              d="M168 272 C 178 294 189 302 200 302 C 211 302 222 294 232 272
                 C 220 264 180 264 168 272 Z"
            />
            <line
              x1={188}
              y1={300}
              x2={184}
              y2={358}
              stroke={color}
              strokeWidth={5}
              strokeLinecap="round"
            />
            <line
              x1={212}
              y1={300}
              x2={218}
              y2={362}
              stroke={color}
              strokeWidth={5}
              strokeLinecap="round"
            />
            <circle cx={184} cy={362} r={5} fill={color} />
            <circle cx={218} cy={366} r={5} fill={color} />
          </g>
        );
      default:
        return (
          <g>
            {torso("#2E3644")}
            <path fill={color} d="M166 274 C 180 292 220 292 234 274 L 234 262 L 166 262 Z" />
          </g>
        );
    }
  })();

  const cap =
    archetype === "coach" ? (
      <g>
        <path
          fill={color}
          d="M134 128 C 136 84 162 62 200 62 C 238 62 264 84 266 128
             C 244 118 222 114 200 114 C 178 114 156 118 134 128 Z"
        />
        <ellipse cx={200} cy={116} rx={72} ry={13} fill={color} />
        <ellipse cx={200} cy={120} rx={72} ry={8} fill="#0F1319" opacity={0.3} />
        <circle cx={200} cy={72} r={5} fill="#0F1319" opacity={0.5} />
      </g>
    ) : null;

  const earpiece =
    archetype === "anchor" ? (
      <g>
        <path
          d="M262 150 C 272 152 274 164 266 170"
          stroke={INK}
          strokeWidth={5}
          fill="none"
        />
        <path
          d="M266 170 C 268 196 258 224 252 240"
          stroke="rgba(242,244,248,.5)"
          strokeWidth={2.5}
          fill="none"
        />
      </g>
    ) : null;

  // Brows: the skeptic keeps one permanently arched.
  const browL = 128 - browLift;
  const browR = 128 - browLift - (archetype === "skeptic" ? 7 : 0);

  const mouthH = 2.5 + talk * 19;
  const mouthW = 42 - talk * 9;

  // Forearm sleeves match the costume.
  const sleeve =
    archetype === "analyst"
      ? "#DDE2EA"
      : archetype === "nerd"
        ? "#333D4E"
        : archetype === "coach"
          ? "#26313F"
          : archetype === "skeptic"
            ? "#1C2129"
            : "#232B3A";

  return (
    <svg
      width={width}
      height={(width * 470) / 400}
      viewBox="0 0 400 470"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* neck first — the costume collar overlaps its base */}
      <path fill={SKIN} d="M180 208 L 220 208 L 224 300 L 176 300 Z" />
      <path fill={SKIN_SHADE} d="M182 208 L 218 208 L 216 232 L 184 232 Z" />
      {costume}
      {/* resting hand (always) */}
      <line
        x1={110}
        y1={452}
        x2={158}
        y2={444}
        stroke={sleeve}
        strokeWidth={30}
        strokeLinecap="round"
      />
      <circle cx={148} cy={444} r={16} fill={SKIN} />
      {/* gesturing hand */}
      <line
        x1={306}
        y1={462}
        x2={handX}
        y2={handY + 14}
        stroke={sleeve}
        strokeWidth={30}
        strokeLinecap="round"
      />
      <g transform={`translate(${handX} ${handY}) rotate(${wave})`}>
        <circle r={16} fill={SKIN} />
        {gestureTarget > 0.4 ? (
          <g>
            <rect x={-6} y={-30} width={11} height={22} rx={5} fill={SKIN} />
            <rect x={6} y={-26} width={9} height={18} rx={4} fill={SKIN} />
          </g>
        ) : null}
      </g>
      {/* head */}
      <g transform={`rotate(${headRot} 200 210) translate(0 ${breathe})`}>
        <ellipse cx={137} cy={156} rx={13} ry={16} fill={SKIN} />
        <ellipse cx={263} cy={156} rx={13} ry={16} fill={SKIN} />
        <path
          fill={SKIN}
          d="M138 140 C 138 88 164 64 200 64 C 236 64 262 88 262 140
             C 262 186 240 222 200 222 C 160 222 138 186 138 140 Z"
        />
        {hair}
        {cap}
        {earpiece}
        {/* brows */}
        <path
          d={`M164 ${browL + 4} Q 178 ${browL - 4} 192 ${browL + 2}`}
          stroke={HAIR}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M208 ${browR + 2} Q 222 ${browR - 4} 236 ${browR + 4}`}
          stroke={HAIR}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
        {/* eyes */}
        {blink > 0.85 ? (
          <g stroke={INK} strokeWidth={4} strokeLinecap="round">
            <line x1={170} y1={149} x2={186} y2={149} />
            <line x1={214} y1={149} x2={230} y2={149} />
          </g>
        ) : (
          <g transform={`scale(1 ${1 - blink * 0.8})`} transform-origin="200 149">
            <ellipse cx={178} cy={149} rx={8.5} ry={9.5} fill="#FFFFFF" />
            <ellipse cx={222} cy={149} rx={8.5} ry={9.5} fill="#FFFFFF" />
            <circle cx={180} cy={150} r={5} fill={INK} />
            <circle cx={224} cy={150} r={5} fill={INK} />
            <circle cx={181.6} cy={148} r={1.6} fill="#FFFFFF" />
            <circle cx={225.6} cy={148} r={1.6} fill="#FFFFFF" />
          </g>
        )}
        {glasses}
        {/* nose */}
        <path
          d="M199 152 C 197 162 194 170 191 175 C 194 179 202 179 206 176"
          stroke={SKIN_SHADE}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
        />
        {/* mouth */}
        {talk < 0.08 ? (
          <path
            d="M182 196 Q 200 205 218 196"
            stroke={MOUTH}
            strokeWidth={5.5}
            strokeLinecap="round"
            fill="none"
          />
        ) : (
          <g>
            <ellipse
              cx={200}
              cy={198 + mouthH * 0.35}
              rx={mouthW / 2}
              ry={mouthH / 2 + 2}
              fill={MOUTH}
            />
            {mouthH > 9 ? (
              <rect
                x={200 - mouthW / 2 + 6}
                y={195 - 1}
                width={mouthW - 12}
                height={4.5}
                rx={2}
                fill={TEETH}
              />
            ) : null}
          </g>
        )}
        {/* cheek shade */}
        <ellipse cx={162} cy={178} rx={9} ry={5} fill={SKIN_SHADE} opacity={0.45} />
        <ellipse cx={238} cy={178} rx={9} ry={5} fill={SKIN_SHADE} opacity={0.45} />
      </g>
    </svg>
  );
};
