'use client';

import { useEffect, useRef, useMemo } from 'react';
import type { Input } from '@/lib/types';
import type { TimelineState } from '@/components/control-panel/hooks/use-timeline-state';
import { OUTPUT_TRACK_ID } from '@smelter-editor/types';
import { buildInputColorMap } from '@/components/control-panel/components/timeline/timeline-utils';
import { emitTimelineEventNotification } from '@/lib/timeline-event-notifications';
import { getTimelineEventsEnabledSetting } from '@/lib/timeline-event-settings';

const POLL_MS = 50;

export function useTimelineEventDetection(
  stateRef: React.RefObject<TimelineState | null>,
  inputs: Input[],
): void {
  const prevPlayheadRef = useRef<number | null>(null);
  const prevActiveClipsRef = useRef<Set<string>>(new Set());
  const prevCrossedKeyframesRef = useRef<Map<string, Set<number>>>(new Map());
  const wasPlayingRef = useRef(false);

  const colorMap = useMemo(() => buildInputColorMap(inputs), [inputs]);
  const colorMapRef = useRef(colorMap);
  colorMapRef.current = colorMap;

  const inputLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const input of inputs) {
      map.set(input.inputId, input.title || input.type);
    }
    return map;
  }, [inputs]);
  const inputLabelMapRef = useRef(inputLabelMap);
  inputLabelMapRef.current = inputLabelMap;

  useEffect(() => {
    const interval = setInterval(() => {
      const state = stateRef.current;

      if (!state?.isPlaying) {
        if (wasPlayingRef.current) {
          prevPlayheadRef.current = null;
          prevActiveClipsRef.current = new Set();
          prevCrossedKeyframesRef.current = new Map();
          wasPlayingRef.current = false;
        }
        return;
      }

      wasPlayingRef.current = true;

      if (!getTimelineEventsEnabledSetting()) {
        prevPlayheadRef.current = state.playheadMs;
        return;
      }

      const prevMs = prevPlayheadRef.current;
      const currMs = state.playheadMs;

      if (prevMs === null || currMs === prevMs) {
        prevPlayheadRef.current = currMs;
        return;
      }

      const cMap = colorMapRef.current;
      const lMap = inputLabelMapRef.current;
      const currentActiveClips = new Set<string>();
      const currentCrossedKeyframes = new Map<string, Set<number>>();

      for (const track of state.tracks) {
        if (track.id === OUTPUT_TRACK_ID) continue;

        for (const clip of track.clips) {
          const isActive = currMs >= clip.startMs && currMs < clip.endMs;
          const wasActive = prevActiveClipsRef.current.has(clip.id);

          if (isActive) {
            currentActiveClips.add(clip.id);

            const color =
              clip.blockSettings.timelineColor ||
              cMap.get(clip.inputId)?.dot ||
              '#3b82f6';
            const label = lMap.get(clip.inputId) || clip.inputId;

            if (!wasActive) {
              emitTimelineEventNotification({
                type: 'block-enter',
                inputLabel: label,
                color,
                detail: 'Block started',
              });
            }

            const crossedSet = new Set<number>();

            for (const kf of clip.keyframes) {
              const absKfMs = clip.startMs + kf.timeMs;
              crossedSet.add(absKfMs);

              if (prevMs < absKfMs && currMs >= absKfMs) {
                const bs = kf.blockSettings;
                const hasPositionChange =
                  bs.absolutePosition !== undefined ||
                  bs.absoluteTop !== undefined ||
                  bs.absoluteLeft !== undefined ||
                  bs.absoluteWidth !== undefined ||
                  bs.absoluteHeight !== undefined;

                if (hasPositionChange) {
                  emitTimelineEventNotification({
                    type: 'position-change',
                    inputLabel: label,
                    color,
                    detail: 'Position changed',
                  });
                } else {
                  const timeSec = (kf.timeMs / 1000).toFixed(1);
                  emitTimelineEventNotification({
                    type: 'keyframe',
                    inputLabel: label,
                    color,
                    detail: `Keyframe at ${timeSec}s`,
                  });
                }
              }
            }

            currentCrossedKeyframes.set(clip.id, crossedSet);
          } else if (wasActive && !isActive) {
            const color =
              clip.blockSettings.timelineColor ||
              cMap.get(clip.inputId)?.dot ||
              '#3b82f6';
            const label = lMap.get(clip.inputId) || clip.inputId;
            emitTimelineEventNotification({
              type: 'block-exit',
              inputLabel: label,
              color,
              detail: 'Block ended',
            });
          }
        }
      }

      prevPlayheadRef.current = currMs;
      prevActiveClipsRef.current = currentActiveClips;
      prevCrossedKeyframesRef.current = currentCrossedKeyframes;
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [stateRef]);
}
