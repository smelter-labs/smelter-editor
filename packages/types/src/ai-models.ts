import type { InputType } from "./input.js";

export type AIModelConfig = {
  enabled: boolean;
  delayMs: number;
};

export type AIModelStatus = {
  enabled: boolean;
  delayMs: number;
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
};
