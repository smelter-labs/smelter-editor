import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from '@swmansion/smelter';
import type { PersonBox } from '../app/store';
import { MotionPredictor } from './motionPredictor';

type TrackedBox = PersonBox & { id: number };

type SmoothedBoxesProps = {
  data: { boxes: TrackedBox[]; frameW: number; frameH: number };
  parent: { width: number; height: number };
  /**
   * Dead-reckon each box along its estimated velocity between responses
   * (default). Pass false when the boxes were already extrapolated upstream
   * (PeopleTracker withLead), so motion isn't predicted twice — the box then
   * just eases toward each led detection.
   */
  predict?: boolean;
  /** Show the detection-confidence label above each box. */
  showConf?: boolean;
  /**
   * Ease each box toward its target (default). Pass false for detections that
   * are already exact — the marker backend keys its boxes straight out of the
   * frame, and easing would leave the outline trailing the marker it was read
   * from by a few frames.
   */
  smooth?: boolean;
  /** Outline thickness in px. Raised to cover a marker burned into the video. */
  borderWidth?: number;
};

// Smooth-motion tuning (matches CarHueWrapper).
const TICK_MS = 16;
const SMOOTH = 0.25; // exponential easing toward the latest detection per tick

/** A box in tile pixels: [left, top, width, height]. */
type PxRect = number[];

/**
 * Confidence badge for one detection, pinned just ABOVE the box's top-left
 * corner (outside the outline, so it never covers the subject). Smelter Views
 * don't auto-size to content, so the badge gets explicit dimensions hugging the
 * text (same trick as PeopleCountBadge).
 */
export function BoxConfLabel({
  text,
  boxTop,
  boxLeft,
  parent,
}: {
  text: string;
  boxTop: number;
  boxLeft: number;
  parent: { width: number; height: number };
}) {
  const fontSize = Math.max(12, Math.round(parent.height * 0.022));
  const padH = Math.round(fontSize * 0.35);
  const padV = Math.round(fontSize * 0.15);
  const width = padH * 2 + Math.round(fontSize * 0.6 * text.length);
  const height = padV * 2 + Math.round(fontSize * 1.2);
  // Sit just above the box. If it would run off the top edge, tuck it just
  // inside the top line instead so the number stays on screen.
  const gap = 2;
  const top = boxTop - height - gap >= 0 ? boxTop - height - gap : boxTop + gap;
  return (
    <View
      style={{
        top,
        left: boxLeft,
        width,
        height,
        backgroundColor: '#00FF66CC',
        borderRadius: Math.round(fontSize * 0.25),
        paddingHorizontal: padH,
        paddingVertical: padV,
        overflow: 'hidden',
      }}>
      <Text style={{ fontSize, color: '#000000FF' }}>{text}</Text>
    </View>
  );
}

/**
 * Green tracked-box overlay with smooth motion — the drawn counterpart of the
 * raw `PeopleBoxes` for boxes that carry a stable track id. Detections arrive
 * only a few times per second, so a raw overlay jumps to each response and
 * lags a moving car in between; here each box is dead-reckoned between
 * responses (MotionPredictor extrapolates it along its estimated velocity
 * every tick) and eased toward that moving target, so the box glides with the
 * car and new responses correct it without a visible snap.
 */
export function SmoothedBoxes({
  data,
  parent,
  predict = true,
  showConf = false,
  smooth = true,
  borderWidth = 4,
}: SmoothedBoxesProps) {
  const { width, height } = parent;
  // Live track ids + per-track motion estimate + eased, currently-drawn rect.
  const idsRef = useRef<number[]>([]);
  const predictorRef = useRef(new MotionPredictor());
  const cursRef = useRef<Map<number, PxRect>>(new Map());
  // Latest raw rect per track — the easing target when predict is off.
  const latestRef = useRef<Map<number, PxRect>>(new Map());
  const confRef = useRef<Map<number, number>>(new Map());
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
      const rect = [
        offX + b.x * dispW,
        offY + b.y * dispH,
        b.w * dispW,
        b.h * dispH,
      ];
      predictorRef.current.update(b.id, rect, now);
      latestRef.current.set(b.id, rect);
      if (b.conf != null) confRef.current.set(b.id, b.conf);
    }
    idsRef.current = [...live].sort((a, b) => a - b);
    predictorRef.current.prune(live);
    for (const id of [...cursRef.current.keys()]) {
      if (!live.has(id)) cursRef.current.delete(id);
    }
    for (const id of [...latestRef.current.keys()]) {
      if (!live.has(id)) {
        latestRef.current.delete(id);
        confRef.current.delete(id);
      }
    }
  }, [data, width, height]);

  // Every tick, ease each drawn rect toward its *predicted* position — the
  // target itself moves along the track's velocity between responses.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const curs = cursRef.current;
      for (const id of idsRef.current) {
        const tgt = predict
          ? predictorRef.current.predict(id, now)
          : latestRef.current.get(id);
        if (!tgt) continue;
        const cur = curs.get(id);
        if (!cur) {
          // New track: the box appears in place rather than sliding in.
          curs.set(id, [...tgt]);
        } else {
          // ease = 1 lands on the target outright, skipping the easing.
          const ease = smooth ? SMOOTH : 1;
          for (let i = 0; i < tgt.length; i++) {
            cur[i] += (tgt[i] - cur[i]) * ease;
          }
        }
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [predict, smooth]);

  return (
    <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
      {idsRef.current.flatMap((id) => {
        const rect =
          cursRef.current.get(id) ??
          (predict
            ? predictorRef.current.predict(id, Date.now())
            : latestRef.current.get(id));
        if (!rect) return [];
        const [left, top, w, h] = rect;
        const boxTop = Math.round(top);
        const boxLeft = Math.round(left);
        // The border grows outward from the View, so a View sized to the box
        // draws its outline just *outside* the box — which leaves a marker
        // burned into the video showing through inside the green. Inset the
        // View by the border so the outline's outer edge lands on the box and
        // the stroke covers the marker instead of ringing it.
        const inset = Math.max(0, borderWidth);
        const els = [
          <View
            key={id}
            style={{
              top: boxTop + inset,
              left: boxLeft + inset,
              width: Math.max(2, Math.round(w) - 2 * inset),
              height: Math.max(2, Math.round(h) - 2 * inset),
              borderWidth,
              borderColor: '#00FF66FF',
              borderRadius: 4,
            }}
          />,
        ];
        const conf = showConf ? confRef.current.get(id) : undefined;
        if (conf != null) {
          els.push(
            <BoxConfLabel
              key={`conf-${id}`}
              text={conf.toFixed(2)}
              boxTop={boxTop}
              boxLeft={boxLeft}
              parent={parent}
            />,
          );
        }
        return els;
      })}
    </View>
  );
}
