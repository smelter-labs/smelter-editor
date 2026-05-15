import { useEffect, useRef } from 'react';
import type { Input, Layer } from '@/lib/types';
import type { TimelineState } from '../../hooks/use-timeline-state';
import { OUTPUT_TRACK_INPUT_ID } from '../../hooks/use-timeline-state';

type LayerInput = Layer['inputs'][number];

type Params = {
  inputs: Input[];
  layers: Layer[];
  state: Pick<TimelineState, 'tracks'>;
  updateClipSettings: (
    trackId: string,
    clipId: string,
    patch: Record<string, unknown>,
  ) => void;
};

function buildLookups(
  inputs: Input[],
  layers: Layer[],
): { inputById: Map<string, Input>; layerInputById: Map<string, LayerInput> } {
  const inputById = new Map(inputs.map((i) => [i.inputId, i]));
  const layerInputById = new Map<string, LayerInput>();
  for (const layer of layers) {
    for (const li of layer.inputs) {
      if (!layerInputById.has(li.inputId)) {
        layerInputById.set(li.inputId, li);
      }
    }
  }
  return { inputById, layerInputById };
}

function buildPatch(input: Input, layerInput: LayerInput | undefined) {
  return {
    absoluteTop: layerInput ? layerInput.y : input.absoluteTop,
    absoluteLeft: layerInput ? layerInput.x : input.absoluteLeft,
    absoluteWidth: layerInput ? layerInput.width : input.absoluteWidth,
    absoluteHeight: layerInput ? layerInput.height : input.absoluteHeight,
    absoluteTransitionDurationMs: layerInput
      ? layerInput.transitionDurationMs
      : input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: layerInput
      ? layerInput.transitionEasing
      : input.absoluteTransitionEasing,
    cropTop: input.cropTop,
    cropLeft: input.cropLeft,
    cropRight: input.cropRight,
    cropBottom: input.cropBottom,
  };
}

function patchDiffersFromBlockSettings(
  patch: ReturnType<typeof buildPatch>,
  bs: Record<string, unknown>,
): boolean {
  return (
    bs['absoluteTop'] !== patch.absoluteTop ||
    bs['absoluteLeft'] !== patch.absoluteLeft ||
    bs['absoluteWidth'] !== patch.absoluteWidth ||
    bs['absoluteHeight'] !== patch.absoluteHeight ||
    bs['absoluteTransitionDurationMs'] !== patch.absoluteTransitionDurationMs ||
    bs['absoluteTransitionEasing'] !== patch.absoluteTransitionEasing ||
    bs['cropTop'] !== patch.cropTop ||
    bs['cropLeft'] !== patch.cropLeft ||
    bs['cropRight'] !== patch.cropRight ||
    bs['cropBottom'] !== patch.cropBottom
  );
}

export function useTimelineServerSync({
  inputs,
  layers,
  state,
  updateClipSettings,
}: Params): void {
  // Kept in a ref so the inputs/layers effect can read current tracks without
  // adding them as deps (which would loop through updateClipSettings).
  const stateSnapshotRef = useRef(state);
  useEffect(() => {
    stateSnapshotRef.current = state;
  });

  // Reactively sync server-side position data (inputs / layers) into clip
  // blockSettings so the position editor stays current when mobile or a
  // server auto managed behavior moves/resizes an input.
  // Lookup maps are built once per effect run to avoid O(n²) linear scans.
  useEffect(() => {
    const { tracks } = stateSnapshotRef.current;
    const { inputById, layerInputById } = buildLookups(inputs, layers);

    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.inputId === OUTPUT_TRACK_INPUT_ID) continue;
        const input = inputById.get(clip.inputId);
        if (!input) continue;
        const layerInput = layerInputById.get(clip.inputId);
        const patch = buildPatch(input, layerInput);
        if (
          !patchDiffersFromBlockSettings(
            patch,
            clip.blockSettings as Record<string, unknown>,
          )
        )
          continue;
        updateClipSettings(track.id, clip.id, patch);
      }
    }
  }, [inputs, layers, updateClipSettings]);

  // When a new input is added its clip lands in state.tracks one render cycle
  // AFTER inputs/layers update (SYNC_TRACKS fires in a subsequent render), so the
  // effect above misses it. This effect catches newly-appearing clips, reading
  // inputs/layers from a ref to avoid them as deps (which would loop).
  const serverStateRef = useRef({ inputs, layers });
  useEffect(() => {
    serverStateRef.current = { inputs, layers };
  });
  const seenClipIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const { inputs: serverInputs, layers: serverLayers } =
      serverStateRef.current;
    const { inputById, layerInputById } = buildLookups(
      serverInputs,
      serverLayers,
    );

    // Prune seenClipIdsRef of clip ids that no longer exist in tracks.
    // This prevents unbounded growth when clips are removed.
    const currentClipIds = new Set<string>();
    for (const t of state.tracks) {
      for (const c of t.clips) currentClipIds.add(c.id);
    }
    for (const id of Array.from(seenClipIdsRef.current)) {
      if (!currentClipIds.has(id)) seenClipIdsRef.current.delete(id);
    }

    for (const track of state.tracks) {
      for (const clip of track.clips) {
        if (clip.inputId === OUTPUT_TRACK_INPUT_ID) continue;
        if (seenClipIdsRef.current.has(clip.id)) continue;
        const input = inputById.get(clip.inputId);
        // Do not mark as seen when input is absent — retry on the next tracks change.
        if (!input) continue;
        const layerInput = layerInputById.get(clip.inputId);
        updateClipSettings(track.id, clip.id, buildPatch(input, layerInput));
        seenClipIdsRef.current.add(clip.id);
      }
    }
  }, [state.tracks, updateClipSettings]);
}
