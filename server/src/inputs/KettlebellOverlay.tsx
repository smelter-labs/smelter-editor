import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from '@swmansion/smelter';
import { KETTLEBELL_ISSUE_LABELS } from '@smelter-editor/types';
import type { KettlebellIssueCode } from '@smelter-editor/types';
import type { KettlebellOverlayState } from '../app/store';
import { useAnimTickMs } from '../app/store';
import { MotionPredictor } from './motionPredictor';
import type { Parent } from './kettlebellRig';
import {
  BELL_COLOR,
  BELL_TRACK_ID,
  PREDICT_OPTS,
  SMOOTH,
  coverTransform,
} from './kettlebellRig';

const VERDICT_COLORS: Record<string, string> = {
  correct: '#16A34ACC',
  incorrect: '#DC2626CC',
  none: '#000000CC',
};

/**
 * The tracked bell: an outline box, plus its confidence when drawBoxes is on.
 *
 * The bell rides its own MotionPredictor track and its own ease — it was never
 * part of the pose rig, and since the rig moved into the `kettlebell-skeleton`
 * shader (KettlebellSkeletonWrapper) the two share no state at all. It stays a
 * View because it carries a rounded outline and a text label.
 */
function BellBox({
  data,
  parent,
}: {
  data: KettlebellOverlayState;
  parent: Parent;
}) {
  const predictorRef = useRef(new MotionPredictor(PREDICT_OPTS));
  /** Eased, currently-drawn bell rect [x, y, w, h] in tile px. */
  const drawnBellRef = useRef<number[] | null>(null);
  const [, setTick] = useState(0);
  const tickMs = useAnimTickMs();

  useEffect(() => {
    const { offX, offY, dispW, dispH } = coverTransform(
      parent,
      data.frameW,
      data.frameH,
    );
    if (data.kb) {
      predictorRef.current.update(
        BELL_TRACK_ID,
        [
          offX + data.kb.x * dispW,
          offY + data.kb.y * dispH,
          data.kb.w * dispW,
          data.kb.h * dispH,
        ],
        Date.now(),
      );
    } else {
      predictorRef.current.forget(BELL_TRACK_ID);
      drawnBellRef.current = null;
    }
  }, [data, parent.width, parent.height]);

  // Results arrive at ~12-16/s while the output renders at 60fps, so the box
  // is dead-reckoned along its estimated velocity every tick and the drawn
  // rect eased toward that moving target.
  useEffect(() => {
    const timer = setInterval(() => {
      const bell = predictorRef.current.predict(BELL_TRACK_ID, Date.now());
      const drawn = drawnBellRef.current;
      if (bell) {
        if (!drawn) drawnBellRef.current = [...bell];
        else {
          for (let i = 0; i < bell.length; i++) {
            drawn[i] += (bell[i] - drawn[i]) * SMOOTH;
          }
        }
      } else if (!drawn) {
        // Nothing tracked and nothing on screen — skip the tick rather than
        // re-serializing an unchanged scene 60 times a second.
        return;
      }
      setTick((t) => (t + 1) % 1_000_000);
    }, tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);

  const bell = drawnBellRef.current;
  if (!bell) return null;

  const [left, top, w, h] = bell;
  const boxTop = Math.round(top);
  const boxLeft = Math.round(left);
  // width/height exclude the border while top/left measure to its OUTER
  // edge, so shrinking the size by 2*inset already lands the stroke's outer
  // edge on the tracked rect — the position stays on the box (same
  // correction as SmoothedBoxes).
  const inset = data.drawBoxes ? 4 : 2;
  const fontSize = Math.max(12, Math.round(parent.height * 0.022));

  return (
    <>
      <View
        style={{
          top: boxTop,
          left: boxLeft,
          width: Math.max(2, Math.round(w) - 2 * inset),
          height: Math.max(2, Math.round(h) - 2 * inset),
          borderWidth: inset,
          borderColor: BELL_COLOR,
          borderRadius: 6,
        }}
      />
      {data.drawBoxes && data.kb?.conf != null ? (
        <View
          style={{
            top: Math.max(0, boxTop - Math.round(fontSize * 1.6)),
            left: boxLeft,
            width: Math.round(fontSize * 0.6 * 8),
            height: Math.round(fontSize * 1.5),
            backgroundColor: '#F97316CC',
            borderRadius: Math.round(fontSize * 0.25),
            paddingHorizontal: Math.round(fontSize * 0.3),
            overflow: 'hidden',
          }}>
          <Text style={{ fontSize, color: '#000000FF' }}>
            {`kb ${data.kb.conf.toFixed(2)}`}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Reps / exercise / verdict badge, top-right (top-left belongs to the people
 * counter). Verdict colors the background; the latest technique faults show on
 * a smaller line below it. Explicit sizes — Smelter Views don't auto-size.
 */
function CoachBadge({
  data,
  parent,
}: {
  data: KettlebellOverlayState;
  parent: Parent;
}) {
  const margin = Math.round(parent.width * 0.02);
  const fontSize = Math.max(18, Math.round(parent.height * 0.035));
  const padH = Math.round(fontSize * 0.45);
  const padV = Math.round(fontSize * 0.22);
  const label = `🏋 ${data.repCount} · ${data.exercise.toUpperCase()}`;
  const width = padH * 2 + Math.round(fontSize * 0.62 * (label.length + 1));
  const height = padV * 2 + Math.round(fontSize * 1.25);
  const color = VERDICT_COLORS[data.lastRepVerdict ?? 'none'];

  const issues = data.lastRepVerdict === 'incorrect' ? data.lastRepIssues : [];
  const issueFont = Math.max(14, Math.round(fontSize * 0.6));
  const issueLabel = issues
    .slice(0, 2)
    .map((code) => KETTLEBELL_ISSUE_LABELS[code as KettlebellIssueCode] ?? code)
    .join(' · ');
  const issueWidth =
    padH * 2 + Math.round(issueFont * 0.55 * (issueLabel.length + 1));
  const issueHeight = padV * 2 + Math.round(issueFont * 1.25);

  return (
    <>
      <View
        style={{
          top: margin,
          left: parent.width - margin - width,
          width,
          height,
          backgroundColor: color,
          borderRadius: Math.round(fontSize * 0.3),
          paddingHorizontal: padH,
          paddingVertical: padV,
          overflow: 'hidden',
        }}>
        <Text style={{ fontSize, color: '#FFFFFFFF' }}>{label}</Text>
      </View>
      {issueLabel ? (
        <View
          style={{
            top: margin + height + Math.round(padV * 0.8),
            left: parent.width - margin - issueWidth,
            width: issueWidth,
            height: issueHeight,
            backgroundColor: '#7F1D1DCC',
            borderRadius: Math.round(issueFont * 0.3),
            paddingHorizontal: padH,
            paddingVertical: padV,
            overflow: 'hidden',
          }}>
          <Text style={{ fontSize: issueFont, color: '#FECACAFF' }}>
            {issueLabel}
          </Text>
        </View>
      ) : null}
    </>
  );
}

/**
 * Kettlebell Coach on-output overlay: tracked bell box + reps/exercise/verdict
 * badge. Mounted whenever the model is enabled (the store entry persists
 * between detections so the badge never flickers). The pose skeleton is not
 * here — it is drawn underneath, by KettlebellSkeletonWrapper's shader.
 *
 * BellBox is mounted unconditionally: gating it on `data.kb` would tear down
 * and rebuild its interval every time the bell blinks out, several times a
 * second. It renders null while there is nothing tracked.
 */
export function KettlebellOverlay({
  data,
  parent,
}: {
  data: KettlebellOverlayState;
  parent: Parent;
}) {
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      <BellBox data={data} parent={parent} />
      <CoachBadge data={data} parent={parent} />
    </View>
  );
}
