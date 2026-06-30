import type { InputType } from "./input.js";

/** A numeric, model-specific tunable rendered as a slider/number field in the UI. */
export type ModelParamSpec = {
  key: string;
  label: string;
  /** Optional one-line hint shown under the field. */
  description?: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type AIModelConfig = {
  enabled: boolean;
  delayMs: number;
  /** Draw detection bounding boxes on the output (people-counter YOLO only). */
  drawBoxes?: boolean;
  /** Model-specific tunables, keyed by ModelParamSpec.key. */
  params?: Record<string, number>;
};

export type AIModelStatus = {
  enabled: boolean;
  delayMs: number;
  drawBoxes?: boolean;
  params?: Record<string, number>;
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
