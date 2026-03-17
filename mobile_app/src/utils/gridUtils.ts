/**
 * Calculate the grid dimensions (columns x rows) based on input count.
 * Default is 2x4; reduces for fewer inputs.
 */
export function getGridDimensions(inputCount: number): {
  columns: number;
  rows: number;
} {
  if (inputCount <= 4) return { columns: 2, rows: 2 };
  if (inputCount <= 6) return { columns: 2, rows: 3 };
  return { columns: 2, rows: 4 };
}

/**
 * Determine which side a side panel should open on, so it doesn't obscure
 * the tapped card. Cards in the left column -> panel opens right, and vice versa.
 */
export function getPanelSide(
  cardIndex: number,
  totalColumns: number,
): "left" | "right" {
  const columnPosition = cardIndex % totalColumns;
  return columnPosition < totalColumns / 2 ? "right" : "left";
}

/**
 * Map an audioLevel (0.0-1.0) to a DAW-style color.
 */
export function getAudioLevelColor(level: number): string {
  "worklet";
  if (level > 0.85) return "#ef4444"; // red
  if (level > 0.7) return "#eab308"; // yellow
  return "#22c55e"; // green
}

/**
 * Map movementPercent (0-100) to a display color.
 */
export function getMovementColor(percent: number): string {
  "worklet";
  if (percent > 70) return "#22c55e"; // high movement — green
  if (percent > 30) return "#eab308"; // medium — yellow
  return "#94a3b8"; // low — gray
}
