import type { Layer } from '@/lib/types';

export type TimelineTrackOrder = Record<string, number>;
export type TimelineOrderDirection = 'asc' | 'desc';

type LayerInputLike = Layer['inputs'][number];

export function sortInputsByTimelineTrackOrder<T extends LayerInputLike>(
  inputs: T[],
  timelineTrackOrder: TimelineTrackOrder,
  direction: TimelineOrderDirection,
): T[] {
  const indexed = inputs.map((input, index) => ({
    input,
    index,
    trackIndex: timelineTrackOrder[input.inputId],
  }));

  indexed.sort((a, b) => {
    const aHasTrack = a.trackIndex !== undefined;
    const bHasTrack = b.trackIndex !== undefined;

    if (aHasTrack && bHasTrack && a.trackIndex !== b.trackIndex) {
      return direction === 'asc'
        ? a.trackIndex - b.trackIndex
        : b.trackIndex - a.trackIndex;
    }
    if (aHasTrack !== bHasTrack) {
      return aHasTrack ? -1 : 1;
    }
    return a.index - b.index;
  });

  return indexed.map(({ input }) => input);
}
