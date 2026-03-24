export type {
  Layer,
  LayerInput,
  LayerBehaviorConfig,
  EqualGridConfig,
  PreserveApproximateAspectGridConfig,
  PreserveExactAspectGridConfig,
  PictureInPictureConfig,
  ObjectFit,
  BehaviorInputInfo,
} from "@smelter-editor/types";

/** Grid item used by GridWrapper and GridItem components. */
export type GridItem = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
