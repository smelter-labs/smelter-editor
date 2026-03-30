import { Dimensions } from "react-native";

const EDGE_ZONE_WIDTH = 44;

/**
 * Returns true if the x position is within the left edge zone.
 */
export function isLeftEdge(x: number): boolean {
  return x <= EDGE_ZONE_WIDTH;
}

/**
 * Returns true if the x position is within the right edge zone.
 */
export function isRightEdge(x: number): boolean {
  const { width } = Dimensions.get("window");
  return x >= width - EDGE_ZONE_WIDTH;
}

/**
 * Returns the edge zone hit slop object for left or right edge.
 */
export function getEdgeHitSlop(side: "left" | "right"): {
  left?: number;
  right?: number;
  width: number;
  top: number;
  bottom: number;
} {
  const { height } = Dimensions.get("window");
  return {
    [side]: 0,
    width: EDGE_ZONE_WIDTH,
    top: 0,
    bottom: height,
  };
}
