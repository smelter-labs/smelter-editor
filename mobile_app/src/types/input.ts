import type { ShaderConfig } from "@smelter-editor/types";

export interface InputCard {
  id: string;
  name: string;
  isRunning: boolean;
  isHidden: boolean;
  isMuted: boolean;
  isAudioOnly: boolean;
  /** 0–100 from server; color-coded in UI */
  movementPercent: number;
  /** 0.0–1.0; user-controlled slider */
  inputVolume: number;
  /** 0.0–1.0; live from server; drives DAW-style level meter */
  audioLevel: number;
  /** null means no video stream available for this input */
  videoStreamUrl: string | null;
  /** Pixel area from layout screen; used for default sort ordering */
  displaySize: number;
  /** Active effects (same as shaders) configured for this input */
  shaders: ShaderConfig[];
}

export type SortMode = "prominence" | "timeline" | "manual";

export type SortDirection = "asc" | "desc";

export type SortAxis = "row" | "col";
