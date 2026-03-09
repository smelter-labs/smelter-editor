export type Resolution = {
  width: number;
  height: number;
};

export const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
  '720p-vertical': { width: 720, height: 1280 },
  '1080p-vertical': { width: 1080, height: 1920 },
  '1440p-vertical': { width: 1440, height: 2560 },
  '4k-vertical': { width: 2160, height: 3840 },
} as const;

export type ResolutionPreset = keyof typeof RESOLUTION_PRESETS;
