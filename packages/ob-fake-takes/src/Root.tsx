import React from "react";
import { Composition } from "remotion";
import { CloseTake, type CloseTakeProps } from "./CloseTake";
import { TapeReel, type TapeReelProps } from "./TapeReel";
import { WideTake, type WideTakeProps } from "./WideTake";

const FPS = 30;
const W = 1920;
const H = 1080;

// Preview-only defaults; real props come from server/scripts/ob-fake-takes.mjs
// via --props (built from the conductor's timing.json).
const demoPersona = (key: string, color: string, offset: number) => ({
  key,
  talent: `Piotr · the ${key.toLowerCase()}`,
  subtitle: "THE DESK",
  color,
  lines: [
    { startS: 13 + offset, endS: 17 + offset },
    { startS: 25 + offset, endS: 29 + offset },
  ],
});

const closeDefaults: CloseTakeProps = {
  persona: demoPersona("HOST", "#F2B134", 0),
  clapAtS: 10,
  showStartS: 12,
  trackS: 40,
};

const wideDefaults: WideTakeProps = {
  title: "Full Court Press",
  personas: [
    demoPersona("HOST", "#F2B134", 0),
    demoPersona("COACH", "#38BDF8", 4),
    demoPersona("STATS", "#F472B6", 8),
  ],
  clapAtS: 10,
  showStartS: 12,
  trackS: 40,
};

const tapeDefaults: TapeReelProps = {
  title: "Full Court Press",
  durationS: 30,
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="CloseTake"
      component={CloseTake}
      defaultProps={closeDefaults}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={Math.ceil(closeDefaults.trackS * FPS)}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.trackS * FPS),
      })}
    />
    <Composition
      id="WideTake"
      component={WideTake}
      defaultProps={wideDefaults}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={Math.ceil(wideDefaults.trackS * FPS)}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.trackS * FPS),
      })}
    />
    <Composition
      id="TapeReel"
      component={TapeReel}
      defaultProps={tapeDefaults}
      fps={FPS}
      width={W}
      height={H}
      durationInFrames={Math.ceil(tapeDefaults.durationS * FPS)}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.durationS * FPS),
      })}
    />
  </>
);
