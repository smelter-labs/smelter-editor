import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// OB Van look (same tokens as server/scripts/ob-render-assets.mjs and the
// demo slide decks): chalk on near-black, red for LIVE, sky for data.
export const CHALK = "#F2F4F8";
export const RED = "#FF2D2D";
export const SKY = "#38BDF8";
export const BG = "#0A0C10";
export const DIM = "rgba(242,244,248,.6)";
export const FAINT = "rgba(242,244,248,.35)";
export const RULE = "rgba(242,244,248,.16)";
export const PLATE = "rgba(242,244,248,.06)";

// Fonts are copied into public/fonts by server/scripts/ob-fake-takes.mjs
// (from server/fonts) before a render; loadFont blocks the render until
// they are ready.
loadFont({
  family: "BSD",
  url: staticFile("fonts/BigShouldersDisplay-Black.ttf"),
  weight: "900",
});
loadFont({
  family: "BSD",
  url: staticFile("fonts/BigShouldersDisplay-Bold.ttf"),
  weight: "700",
});
loadFont({
  family: "Plex",
  url: staticFile("fonts/IBMPlexMono-Regular.ttf"),
  weight: "400",
});
loadFont({
  family: "Plex",
  url: staticFile("fonts/IBMPlexMono-SemiBold.ttf"),
  weight: "600",
});

export type LineSlot = { startS: number; endS: number };

export type FakePersona = {
  key: string;
  talent: string | null;
  subtitle: string | null;
  color: string;
  /** Track-time slots (show time + showStartS) where this persona speaks. */
  lines: LineSlot[];
};

export const speakingAt = (t: number, lines: LineSlot[]): boolean =>
  lines.some((l) => t >= l.startS && t <= l.endS);

/** `show −0:07.4` → `show 1:23.6` — the burned-in sync clock. */
export const showClock = (trackT: number, showStartS: number): string => {
  const t = trackT - showStartS;
  const sign = t < 0 ? "−" : "";
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  return `show ${sign}${m}:${s.toFixed(1).padStart(4, "0")}`;
};
