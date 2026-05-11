export type {
  Layer,
  LayerInput,
  LayerBehaviorConfig,
} from "@smelter-editor/types";

/** Grid item used by GridWrapper and GridItem components. */
type GridItem = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
