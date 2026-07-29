import React, { useEffect, useRef, useState } from 'react';
import { View } from '@swmansion/smelter';
import type { PersonBox } from '../app/store';
import { MotionPredictor } from './motionPredictor';

type TrackedBox = PersonBox & { id: number };

type SmoothedBoxesProps = {
  data: { boxes: TrackedBox[]; frameW: number; frameH: number };
  parent: { width: number; height: number };
};

// Smooth-motion tuning (matches CarHueWrapper).
const TICK_MS = 16;
const SMOOTH = 0.25; // exponential easing toward the latest detection per tick

/** A box in tile pixels: [left, top, width, height]. */
type PxRect = number[];

/**
 * Green tracked-box overlay with smooth motion — the drawn counterpart of the
 * raw `PeopleBoxes` for boxes that carry a stable track id. Detections arrive
 * only a few times per second, so a raw overlay jumps to each response and
 * lags a moving car in between; here each box is dead-reckoned between
 * responses (MotionPredictor extrapolates it along its estimated velocity
 * every tick) and eased toward that moving target, so the box glides with the
 * car and new responses correct it without a visible snap.
 */
export function SmoothedBoxes({ data, parent }: SmoothedBoxesProps) {
  const { width, height } = parent;
  // Live track ids + per-track motion estimate + eased, currently-drawn rect.
  const idsRef = useRef<number[]>([]);
  const predictorRef = useRef(new MotionPredictor());
  const cursRef = useRef<Map<number, PxRect>>(new Map());
  const [, setTick] = useState(0);

  // Map normalized detection boxes through the same rescale 'fill' (cover)
  // transform the video uses into tile pixels, keyed by stable track id.
  useEffect(() => {
    const { boxes, frameW, frameH } = data;
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;

    const now = Date.now();
    const live = new Set<number>();
    for (const b of boxes) {
      live.add(b.id);
      predictorRef.current.update(
        b.id,
        [offX + b.x * dispW, offY + b.y * dispH, b.w * dispW, b.h * dispH],
        now,
      );
    }
    idsRef.current = [...live].sort((a, b) => a - b);
    predictorRef.current.prune(live);
    for (const id of [...cursRef.current.keys()]) {
      if (!live.has(id)) cursRef.current.delete(id);
    }
  }, [data, width, height]);

  // Every tick, ease each drawn rect toward its *predicted* position — the
  // target itself moves along the track's velocity between responses.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const curs = cursRef.current;
      for (const id of idsRef.current) {
        const tgt = predictorRef.current.predict(id, now);
        if (!tgt) continue;
        const cur = curs.get(id);
        if (!cur) {
          // New track: the box appears in place rather than sliding in.
          curs.set(id, [...tgt]);
        } else {
          for (let i = 0; i < tgt.length; i++) {
            cur[i] += (tgt[i] - cur[i]) * SMOOTH;
          }
        }
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
      {idsRef.current.map((id) => {
        const rect =
          cursRef.current.get(id) ??
          predictorRef.current.predict(id, Date.now());
        if (!rect) return null;
        const [left, top, w, h] = rect;
        return (
          <View
            key={id}
            style={{
              top: Math.round(top),
              left: Math.round(left),
              width: Math.max(2, Math.round(w)),
              height: Math.max(2, Math.round(h)),
              borderWidth: 4,
              borderColor: '#00FF66FF',
              borderRadius: 4,
            }}
          />
        );
      })}
    </View>
  );
}
