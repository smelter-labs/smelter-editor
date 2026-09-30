import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ClapFlash, Clock, RecBadge, Waveform } from "./chrome";
import {
  BG,
  CHALK,
  DIM,
  FAINT,
  PLATE,
  RULE,
  speakingAt,
  type FakePersona,
} from "./theme";

export type WideTakeProps = {
  title: string;
  personas: FakePersona[];
  clapAtS: number;
  showStartS: number;
  trackS: number;
};

// The locked wide "tripod" shot: every persona at the desk at once, the one
// who is speaking lit up. Stands in for the ob-wide-composite of three real
// wide takes.
export const WideTake: React.FC<WideTakeProps> = ({
  title,
  personas,
  clapAtS,
  showStartS,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <div
        style={{
          position: "absolute",
          top: 90,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "BSD",
          fontWeight: 900,
          fontSize: 84,
          letterSpacing: ".04em",
          color: FAINT,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 60,
          paddingTop: 60,
        }}
      >
        {personas.map((p) => {
          const active = speakingAt(t, p.lines);
          return (
            <div
              key={p.key}
              style={{
                width: 480,
                height: 600,
                borderRadius: 12,
                background: PLATE,
                border: `3px solid ${active ? p.color : RULE}`,
                boxShadow: active ? `0 0 90px ${p.color}44` : "none",
                transform: active ? "scale(1.03)" : "scale(1)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 30,
              }}
            >
              <div
                style={{
                  width: 200,
                  height: 200,
                  borderRadius: 100,
                  background: `${p.color}2E`,
                  border: `4px solid ${p.color}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "BSD",
                    fontWeight: 900,
                    fontSize: 110,
                    color: CHALK,
                  }}
                >
                  {p.key.slice(0, 1)}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "BSD",
                  fontWeight: 900,
                  fontSize: 60,
                  color: CHALK,
                  textTransform: "uppercase",
                }}
              >
                {p.key}
              </div>
              {p.talent ? (
                <div
                  style={{
                    fontFamily: "Plex",
                    fontWeight: 400,
                    fontSize: 22,
                    color: DIM,
                    textAlign: "center",
                    padding: "0 24px",
                  }}
                >
                  {p.talent}
                </div>
              ) : null}
              <Waveform
                active={active}
                color={p.color}
                bars={22}
                width={340}
                height={56}
              />
            </div>
          );
        })}
      </AbsoluteFill>
      {/* the desk */}
      <div
        style={{
          position: "absolute",
          left: 120,
          right: 120,
          bottom: 70,
          height: 80,
          borderRadius: 10,
          background:
            "linear-gradient(180deg, rgba(242,244,248,.10), rgba(242,244,248,.03))",
          border: `1px solid ${RULE}`,
        }}
      />
      <RecBadge label="CAM · WIDE" />
      <Clock showStartS={showStartS} />
      <ClapFlash clapAtS={clapAtS} />
    </AbsoluteFill>
  );
};
