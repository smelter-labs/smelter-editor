import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ClapFlash, Clock, DeskMic, RecBadge, Waveform } from "./chrome";
import { Character, archetypeOf } from "./characters";
import {
  BG,
  CHALK,
  DIM,
  PLATE,
  RULE,
  speakingAt,
  type FakePersona,
} from "./theme";

export type CloseTakeProps = {
  persona: FakePersona;
  clapAtS: number;
  showStartS: number;
  trackS: number;
};

// One persona's "phone on a tripod": an illustrated panelist at their desk —
// the mouth, brows and hands move while this persona's lines are live, the
// waveform confirms it, and the shared REC/clock/clap chrome stays for the
// prep pipeline's visual sync check.
export const CloseTake: React.FC<CloseTakeProps> = ({
  persona,
  clapAtS,
  showStartS,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const active = speakingAt(t, persona.lines);
  const drift = 1.02 + 0.05 * (frame / durationInFrames);
  const sway = Math.sin(frame * 0.013) * 7;
  const seed = (persona.key.charCodeAt(0) + persona.key.length * 7) % 23;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1300px 850px at 50% 24%, ${persona.color}26, transparent 62%), ${BG}`,
      }}
    >
      {/* studio backdrop: soft panels + persona color edge light */}
      <AbsoluteFill style={{ transform: `scale(${drift}) translateX(${sway}px)` }}>
        {[220, 700, 1180, 1660].map((x) => (
          <div
            key={x}
            style={{
              position: "absolute",
              left: x,
              top: 60,
              width: 320,
              height: 540,
              borderRadius: 10,
              border: `1px solid ${RULE}`,
              background: "rgba(242,244,248,.025)",
            }}
          />
        ))}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 700,
            height: 6,
            background: `linear-gradient(90deg, transparent, ${persona.color}66, transparent)`,
          }}
        />
        {/* the panelist, waist-up behind the desk (medium close-up) */}
        <div style={{ position: "absolute", left: 530, top: 30 }}>
          <Character
            archetype={archetypeOf(persona.key)}
            color={persona.color}
            frame={frame}
            fps={fps}
            seed={seed}
            speaking={active}
            width={860}
          />
        </div>
        {/* desk with a mic */}
        <div
          style={{
            position: "absolute",
            left: 240,
            right: 240,
            top: 880,
            height: 210,
            borderRadius: "14px 14px 0 0",
            background: "linear-gradient(180deg, #20262F, #14181E)",
            borderTop: `2px solid ${RULE}`,
          }}
        />
        <DeskMic x={565} y={886} color={persona.color} active={active} scale={1.15} />
      </AbsoluteFill>

      {/* lower third */}
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 120,
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        <div
          style={{
            padding: "16px 30px 12px",
            background: "rgba(10,12,16,.86)",
            borderLeft: `5px solid ${persona.color}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: "BSD",
              fontWeight: 900,
              fontSize: 64,
              lineHeight: 1,
              letterSpacing: ".02em",
              color: CHALK,
              textTransform: "uppercase",
            }}
          >
            {persona.key}
          </span>
          {persona.talent ? (
            <span
              style={{
                fontFamily: "Plex",
                fontWeight: 400,
                fontSize: 24,
                color: DIM,
              }}
            >
              {persona.talent}
              {persona.subtitle ? ` · ${persona.subtitle}` : ""}
            </span>
          ) : null}
        </div>
        <div
          style={{
            alignSelf: "flex-start",
            marginTop: 10,
            padding: "10px 18px",
            background: PLATE,
            border: `1px solid ${RULE}`,
            borderRadius: 8,
          }}
        >
          <Waveform active={active} color={persona.color} bars={26} width={380} height={44} />
        </div>
      </div>

      <RecBadge label={`CAM · ${persona.key}`} />
      <Clock showStartS={showStartS} />
      <ClapFlash clapAtS={clapAtS} />
    </AbsoluteFill>
  );
};
