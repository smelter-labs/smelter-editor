import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { CHALK, DIM, FAINT, RED, showClock } from "./theme";

// Shared framing every fake take carries: REC badge, burned-in show clock,
// the count-in numbers and the white clap flash (the visual sync check —
// ob-prep-takes finds the clap in the AUDIO; the flash just makes a bad trim
// obvious in a single ffmpeg frame grab).

export const RecBadge: React.FC<{ label: string }> = ({ label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const on = Math.floor(frame / fps) % 2 === 0;
  return (
    <div
      style={{
        position: "absolute",
        top: 40,
        left: 48,
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontFamily: "Plex",
        fontWeight: 600,
        fontSize: 26,
        letterSpacing: ".18em",
        color: DIM,
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          background: RED,
          opacity: on ? 1 : 0.25,
        }}
      />
      REC · {label}
    </div>
  );
};

export const Clock: React.FC<{ showStartS: number }> = ({ showStartS }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        bottom: 44,
        fontFamily: "Plex",
        fontWeight: 600,
        fontSize: 30,
        letterSpacing: ".08em",
        color: CHALK,
        opacity: 0.85,
      }}
    >
      {showClock(frame / fps, showStartS)}
    </div>
  );
};

export const ClapFlash: React.FC<{ clapAtS: number }> = ({ clapAtS }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const countdown = clapAtS - t;
  const flash = t >= clapAtS && t < clapAtS + 3 / fps;
  return (
    <>
      {countdown > 0 && countdown <= 3 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              fontFamily: "BSD",
              fontWeight: 900,
              fontSize: 420,
              color: FAINT,
            }}
          >
            {Math.ceil(countdown)}
          </div>
        </AbsoluteFill>
      ) : null}
      {flash ? (
        <AbsoluteFill style={{ background: "rgba(255,255,255,.88)" }} />
      ) : null}
    </>
  );
};

export const Waveform: React.FC<{
  active: boolean;
  color: string;
  bars?: number;
  width?: number;
  height?: number;
}> = ({ active, color, bars = 40, width = 640, height = 90 }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        width,
        height,
      }}
    >
      {Array.from({ length: bars }, (_, i) => {
        const h = active
          ? 10 +
            Math.abs(
              Math.sin(frame * 0.31 + i * 1.7) *
                Math.sin(frame * 0.11 + i * 0.4),
            ) *
              (height - 14)
          : 6;
        return (
          <div
            key={i}
            style={{
              width: 8,
              height: h,
              borderRadius: 3,
              background: active ? color : "rgba(242,244,248,.22)",
            }}
          />
        );
      })}
    </div>
  );
};
