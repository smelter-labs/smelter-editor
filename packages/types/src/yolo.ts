export type YoloSearchConfig = {
  enabled: boolean;
  serverUrl: string;
  targetClass: string;
  boxColor: string;
};

export type YoloBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  confidence: number;
};
