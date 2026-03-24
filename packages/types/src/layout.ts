// ── Object fit ────────────────────────────────────────────────────────────────

export type ObjectFit = 'fill' | 'cover' | 'contain';

// ── Layer behavior configs (discriminated union) ─────────────────────────────

export type EqualGridConfig = {
  type: 'equal-grid';
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
  type: 'approximate-aspect-grid';
  /** Whether to resolve tile collisions. Default true. */
  resolveCollisions?: boolean;
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type PreserveExactAspectGridConfig = {
  type: 'exact-aspect-grid';
  /** Horizontal spacing between tiles in pixels. Default 0. */
  horizontalSpacing?: number;
  /** Vertical spacing between tiles in pixels. Default 0. */
  verticalSpacing?: number;
};

export type PictureInPictureConfig = {
  type: 'picture-in-picture';
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
};

export type Layer = {
  id: string;
  inputs: LayerInput[];
  /** Layout behavior for this layer. If undefined, positions are manual. */
  behavior?: LayerBehaviorConfig;
};

// ── Deprecated (kept for room-config backward compat) ────────────────────────

/** @deprecated Use LayerBehaviorConfig instead. Will be removed in a future version. */
export const Layouts = [
  'grid',
  'primary-on-left',
  'primary-on-top',
  'picture-in-picture',
  'wrapped',
  'wrapped-static',
  'picture-on-picture',
] as const;

/** @deprecated Use LayerBehaviorConfig instead. Will be removed in a future version. */
export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'picture-on-picture';
