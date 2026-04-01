/**
 * Computes "contain" fit: the largest rectangle with the source aspect ratio
 * that fits inside the canvas, clamped to a minimum size.
 */
function fitSourceToCanvas(
  sourceW: number,
  sourceH: number,
  canvasW: number,
  canvasH: number,
  minSize = 20,
): { width: number; height: number } {
  const aspect = sourceW / sourceH;
  let width: number;
  let height: number;

  if (canvasW / canvasH > aspect) {
    height = canvasH;
    width = Math.round(height * aspect);
  } else {
    width = canvasW;
    height = Math.round(width / aspect);
  }

  width = Math.max(minSize, width);
  height = Math.max(minSize, height);
  return { width, height };
}

/**
 * Returns the default absolute-position rectangle for an input,
 * preferring the source's native dimensions (fit to canvas) when known,
 * falling back to half the canvas.
 */
export function defaultAbsoluteRect(
  input: { sourceWidth?: number; sourceHeight?: number },
  canvas: { width: number; height: number },
): { width: number; height: number } {
  if (input.sourceWidth && input.sourceHeight) {
    return fitSourceToCanvas(
      input.sourceWidth,
      input.sourceHeight,
      canvas.width,
      canvas.height,
    );
  }
  return {
    width: Math.round(canvas.width * 0.5),
    height: Math.round(canvas.height * 0.5),
  };
}
