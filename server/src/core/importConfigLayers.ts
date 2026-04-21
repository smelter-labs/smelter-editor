import type { ImportConfigLayer, Layer } from '@smelter-editor/types';

export function rebuildLayers(
  configLayers: ImportConfigLayer[],
  indexToInputId: Record<number, string>,
  pendingWhipPlaceholderByIndex: Record<number, string>,
): Layer[] {
  return configLayers.map((cl) => ({
    // Some exported configs may accidentally contain repeated entries
    // for the same inputIndex inside one layer. Keep first occurrence.
    id: cl.id,
    behavior: cl.behavior,
    inputs: cl.inputs
      .filter(
        (li, index, arr) =>
          arr.findIndex((x) => x.inputIndex === li.inputIndex) === index,
      )
      .map((li) => {
        const inputId =
          indexToInputId[li.inputIndex] ??
          pendingWhipPlaceholderByIndex[li.inputIndex];
        if (!inputId) return null;
        return {
          inputId,
          x: li.x,
          y: li.y,
          width: li.width,
          height: li.height,
          transitionDurationMs: li.transitionDurationMs,
          transitionEasing: li.transitionEasing,
          cropTop: li.cropTop,
          cropLeft: li.cropLeft,
          cropRight: li.cropRight,
          cropBottom: li.cropBottom,
        };
      })
      .filter((li): li is NonNullable<typeof li> => li !== null),
  }));
}
