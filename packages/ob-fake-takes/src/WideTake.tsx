import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ClapFlash, Clock, DeskMic, RecBadge } from "./chrome";
import { Character, archetypeOf } from "./characters";
import {
  BG,
  CHALK,
  DIM,
  FAINT,
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

// The locked wide "tripod" shot: the whole illustrated panel at one desk.
// Whoever is speaking gets the spotlight, a moving mouth and a live mic;
// the others idle (blink, breathe, small sways).
export const WideTake: React.FC<WideTakeProps> = ({
  title,
  personas,
  clapAtS,
  showStartS,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const n = Math.max(personas.length, 1);
  const step = 1920 / (n + 1);
  const charW = Math.min(430, step * 0.92);
  return (
    <AbsoluteFill style={{ background: BG }}>
      {/* show title on the backdrop */}
      <div
        style={{
          position: "absolute",
          top: 84,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily: "BSD",
          fontWeight: 900,
          fontSize: 78,
          letterSpacing: ".05em",
          color: FAINT,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 196,
          height: 3,
          background: `linear-gradient(90deg, transparent, ${RULE}, transparent)`,
        }}
      />

      {personas.map((p, i) => {
        const active = speakingAt(t, p.lines);
        const cx = step * (i + 1);
        const seed = (p.key.charCodeAt(0) + p.key.length * 7) % 23;
        const tilt = i === 0 ? 2.5 : i === n - 1 ? -2.5 : 0;
        return (
          <React.Fragment key={p.key}>
            {/* spotlight behind the live speaker */}
            <div
              style={{
                position: "absolute",
                left: cx - charW * 0.75,
                top: 250,
                width: charW * 1.5,
                height: 640,
                borderRadius: "50%",
                background: `radial-gradient(ellipse at 50% 42%, ${p.color}30, transparent 68%)`,
                opacity: active ? 1 : 0,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: cx - charW / 2,
                top: 330,
                transform: active ? "translateY(-8px)" : "none",
              }}
            >
              <Character
                archetype={archetypeOf(p.key)}
                color={p.color}
                frame={frame}
                fps={fps}
                seed={seed}
                speaking={active}
                width={charW}
                tilt={tilt}
              />
            </div>
          </React.Fragment>
        );
      })}

      {/* the shared desk covers everyone's waist */}
      <div
        style={{
          position: "absolute",
          left: 110,
          right: 110,
          top: 828,
          height: 252,
          borderRadius: "16px 16px 0 0",
          background: "linear-gradient(180deg, #1E242D, #13171D)",
          borderTop: `2px solid ${RULE}`,
        }}
      />
      {personas.map((p, i) => {
        const active = speakingAt(t, p.lines);
        const cx = 1920 / (personas.length + 1) * (i + 1);
        return (
          <React.Fragment key={p.key}>
            <DeskMic x={cx + 136} y={866} color={p.color} active={active} scale={0.62} />
            <div
              style={{
                position: "absolute",
                left: cx - 130,
                top: 900,
                width: 260,
                padding: "10px 0 8px",
                textAlign: "center",
                background: "rgba(10,12,16,.6)",
                borderTop: `4px solid ${p.color}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontFamily: "BSD",
                  fontWeight: 900,
                  fontSize: 40,
                  lineHeight: 1,
                  color: CHALK,
                  textTransform: "uppercase",
                }}
              >
                {p.key}
              </div>
              {p.talent ? (
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "Plex",
                    fontWeight: 400,
                    fontSize: 16,
                    color: DIM,
                  }}
                >
                  {p.talent}
                </div>
              ) : null}
            </div>
          </React.Fragment>
        );
      })}

      <RecBadge label="CAM · WIDE" />
      <Clock showStartS={showStartS} />
      <ClapFlash clapAtS={clapAtS} />
    </AbsoluteFill>
  );
};
