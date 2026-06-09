// ── Object fit ────────────────────────────────────────────────────────────────

import { CropProperties } from "./index.js";

export type ObjectFit = "fill" | "cover" | "contain";

// ── Layer behavior configs (discriminated union) ─────────────────────────────

export type EqualGridConfig = {
  type: "equal-grid";
  /** When true (default), grid auto-expands/contracts based on input count. */
  autoscale?: boolean;
  /** Fixed row count (used when autoscale is false). */
  rows?: number;
  /** Fixed column count (used when autoscale is false). */
  cols?: number;
  /** How video content fits inside a tile. Default 'contain'. TODO: implement rendering. */
  objectFit?: ObjectFit;
  /** Whether to resolve tile collisions. Default true. */
  resolveCollisions?: boolean;
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type PreserveApproximateAspectGridConfig = {
  type: "approximate-aspect-grid";
  /** Whether to resolve tile collisions. Default true. */
  resolveCollisions?: boolean;
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type PreserveExactAspectGridConfig = {
  type: "exact-aspect-grid";
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type PictureInPictureConfig = {
  type: "picture-in-picture";
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type LayerBehaviorConfig =
  | EqualGridConfig
  | PreserveApproximateAspectGridConfig
  | PreserveExactAspectGridConfig
  | PictureInPictureConfig;

// ── Input metadata for behavior computations ─────────────────────────────────

export type BehaviorInputInfo = {
  inputId: string;
  /** Native width of the input stream, if known. */
  nativeWidth?: number;
  /** Native height of the input stream, if known. */
  nativeHeight?: number;
};

// ── Core layer types ─────────────────────────────────────────────────────────

export type LayerInput = {
  inputId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
} & Partial<CropProperties>;

export type CarouselConfig = {
  /** Index into Layer.inputs[] of the slide currently displayed. Wrap-around always on. */
  activeIndex: number;
  /** Duration of the slide animation in milliseconds. */
  durationMs: number;
  /** Optional easing function name, matching server App.tsx buildEasingFunction. */
  easing?: "linear" | "cubic_bezier_ease_in_out" | "bounce";
  /** Direction of the last index change. Used by the renderer to position waiting slides. */
  lastDirection?: "next" | "prev";
  /** Index of the slide that was active just before `activeIndex`. Used by the renderer
   * to position the exiting slide on the opposite side of the entering slide. */
  previousActiveIndex?: number;
  /**
   * How many slides are shown side-by-side inside the carousel slot. Default 1.
   * activeIndex is the leftmost visible slide; further visible slides occupy
   * positions activeIndex+1, activeIndex+2, ... (with wrap-around).
   */
  visibleCount?: number;
  /**
   * Visual gap between adjacent visible slides in pixels. Default 0.
   * Each slide is rendered with width = max(0, (slot.width / visibleCount) - gap).
   */
  gap?: number;
};

export type Layer = {
  id: string;
  inputs: LayerInput[];
  /** Layout behavior for this layer. If undefined, positions are manual. */
  behavior?: LayerBehaviorConfig;
  /**
   * When set, the layer renders as a carousel: only `inputs[carousel.activeIndex]`
   * is visible, with a slide animation on activeIndex changes. All inputs share
   * the slot defined by `inputs[0]` geometry (x/y/width/height).
   */
  carousel?: CarouselConfig;
  /**
   * Bumped by the server whenever a behavior layer's computed positions change,
   * or whenever the client explicitly submitted an update for the layer.
   * Clients can use this as a resync signal even when positions are unchanged.
   */
  layoutTimestamp?: number;
  /**
   * When false, this layer's inputs are skipped during compositing.
   * Undefined is treated as enabled (backward compat with existing rooms).
   */
  enabled?: boolean;
  /**
   * Layer-level position/scale on the output canvas. Defaults to full output
   * (top=0, left=0, width=resolution.width, height=resolution.height).
   */
  offsetTop?: number;
  offsetLeft?: number;
  offsetWidth?: number;
  offsetHeight?: number;
  offsetTransitionDurationMs?: number;
  offsetTransitionEasing?: string;
};

// ── Deprecated (kept for room-config backward compat) ────────────────────────

/** @deprecated Use LayerBehaviorConfig instead. Will be removed in a future version. */
export const Layouts = [
  "grid",
  "primary-on-left",
  "primary-on-top",
  "picture-in-picture",
  "wrapped",
  "wrapped-static",
  "picture-on-picture",
] as const;

/** @deprecated Use LayerBehaviorConfig instead. Will be removed in a future version. */
export type Layout =
  | "grid"
  | "primary-on-left"
  | "primary-on-top"
  | "picture-in-picture"
  | "wrapped"
  | "wrapped-static"
  | "picture-on-picture";
