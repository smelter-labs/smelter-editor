import type { InputType } from "./input.js";

/** A numeric, model-specific tunable rendered as a slider/number field in the UI. */
export type NumberParamSpec = {
  /** Discriminant — omit or 'number' for a slider. */
  type?: "number";
  key: string;
  label: string;
  /** Optional one-line hint shown under the field. */
  description?: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

/** A string choice rendered as a dropdown in the UI. */
export type SelectParamSpec = {
  type: "select";
  key: string;
  label: string;
  /** Optional one-line hint shown under the field. */
  description?: string;
  options: { value: string; label: string }[];
  default: string;
};

/** A model-specific tunable exposed in the UI (slider or dropdown). */
export type ModelParamSpec = NumberParamSpec | SelectParamSpec;

/** A tunable value: number for sliders, string for dropdowns. */
export type ModelParamValue = number | string;

export type AIModelConfig = {
  enabled: boolean;
  delayMs: number;
  /** Draw detection bounding boxes on the output (people-counter YOLO only). */
  drawBoxes?: boolean;
  /** Replace detected people with Pac-Man ghosts (people-counter YOLO only). */
  ghostMode?: boolean;
  /** Model-specific tunables, keyed by ModelParamSpec.key. */
  params?: Record<string, ModelParamValue>;
};

export type AIModelStatus = {
  enabled: boolean;
  delayMs: number;
  drawBoxes?: boolean;
  ghostMode?: boolean;
  params?: Record<string, ModelParamValue>;
  lastResult?: unknown;
};

export type AIModelInfo = {
  id: string;
  name: string;
  description: string;
  defaultDelayMs: number;
  maxDelayMs: number;
  needsVideo: boolean;
  needsAudio: boolean;
  supportedInputTypes: InputType[];
  /** Whether this model supports the drawBoxes overlay toggle. */
  supportsBoxes?: boolean;
  /** Model-specific numeric tunables exposed in the UI. */
  params?: ModelParamSpec[];
};
