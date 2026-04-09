export type FxPt = { x: number; y: number };

export type FxSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  bright: number;
};

export type FxBolt = {
  pts: FxPt[];
  branches: FxPt[][];
  life: number;
  maxLife: number;
  w: number;
  hue: number;
};

export type FxPulse = {
  path: number;
  t: number;
  speed: number;
  hue: number;
  tail: number;
};

export type FxWave = {
  cx: number;
  cy: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
};

export type FxState = {
  w: number;
  h: number;
  dpr: number;
  sparks: FxSpark[];
  bolts: FxBolt[];
  circuits: FxPt[][];
  pulses: FxPulse[];
  waves: FxWave[];
  dots: HTMLCanvasElement | null;
  nextBolt: number;
  nextWave: number;
  nextPulse: number;
};

export type FxLayers = {
  dots?: boolean;
  circuits?: boolean;
  pulses?: boolean;
  waves?: boolean;
  sparks?: boolean;
  bolts?: boolean;
};

export type FxConfig = {
  layers: FxLayers;
  hues: number[];
  intensity: number;
  sparkCount: number;
  sparkIntensityScale: number;
  sparkOrigin: 'bottom' | 'left';
  boltInterval: number;
  boltBurstMax: number;
  boltComplexity: 'full' | 'mini';
  boltIntensityThreshold: number;
  circuitCount: number;
  pulseInterval: number;
  waveInterval: number;
  initialSparkCount: number;
  glowScale: number;
};
