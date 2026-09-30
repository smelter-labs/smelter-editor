import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ClapFlash, Clock, RecBadge, Waveform } from "./chrome";
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

// One persona's "phone on a tripod": a stylised talking-head card — avatar,
// name, lower-third line, a waveform that only moves when this persona
// speaks, slow camera drift, and the shared REC/clock/clap chrome.
export const CloseTake: React.FC<CloseTakeProps> = ({
  persona,
  clapAtS,
  showStartS,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const t = frame / fps;
  const active = speakingAt(t, persona.lines);
  const drift = 1.02 + 0.04 * (frame / durationInFrames);
  const sway = Math.sin(frame * 0.013) * 6;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 800px at 50% 20%, ${persona.color}22, transparent 65%), ${BG}`,
      }}
    >
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          transform: `scale(${drift}) translateX(${sway}px)`,
        }}
      >
        <div
          style={{
            width: 340,
            height: 340,
            borderRadius: 170,
            background: `${persona.color}2E`,
            border: `6px solid ${persona.color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: active ? "scale(1.04)" : "scale(1)",
            boxShadow: active ? `0 0 120px ${persona.color}55` : "none",
          }}
        >
          <span
            style={{
              fontFamily: "BSD",
              fontWeight: 900,
              fontSize: 190,
              color: CHALK,
            }}
          >
            {persona.key.slice(0, 1)}
          </span>
        </div>
        <div
          style={{
            marginTop: 44,
            fontFamily: "BSD",
            fontWeight: 900,
            fontSize: 110,
            lineHeight: 1,
            letterSpacing: ".02em",
            color: CHALK,
            textTransform: "uppercase",
          }}
        >
          {persona.key}
        </div>
        {persona.talent ? (
          <div
            style={{
              marginTop: 18,
              fontFamily: "Plex",
              fontWeight: 400,
              fontSize: 32,
              color: DIM,
            }}
          >
            {persona.talent}
            {persona.subtitle ? ` · ${persona.subtitle}` : ""}
          </div>
        ) : null}
        <div
          style={{
            marginTop: 46,
            padding: "18px 30px",
            background: PLATE,
            border: `1px solid ${RULE}`,
            borderRadius: 8,
          }}
        >
          <Waveform active={active} color={persona.color} />
        </div>
      </AbsoluteFill>
      <RecBadge label={`CAM · ${persona.key}`} />
      <Clock showStartS={showStartS} />
      <ClapFlash clapAtS={clapAtS} />
    </AbsoluteFill>
  );
};
