import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from '@swmansion/smelter';
import { KETTLEBELL_ISSUE_LABELS } from '@smelter-editor/types';
import type { KettlebellIssueCode } from '@smelter-editor/types';
import type { KettlebellOverlayState } from '../app/store';
import { MotionPredictor } from './motionPredictor';

// COCO-17 bone segments (keypoint index pairs) drawn as rotated Views.
const BONES: [number, number][] = [
  [0, 5],
  [0, 6], // nose → shoulders
  [5, 6], // shoulder line
  [5, 7],
  [7, 9], // left arm
  [6, 8],
  [8, 10], // right arm
  [5, 11],
  [6, 12], // torso
  [11, 12], // hip line
  [11, 13],
  [13, 15], // left leg
  [12, 14],
  [14, 16], // right leg
];

// Joints below this confidence are hidden (mirrors the worker's own floor).
const KPT_CONF_MIN = 0.35;

// Smooth-motion tuning (same shape as SmoothedBoxes): results arrive at
// ~12-16/s while the output renders at 60fps, so each joint is dead-reckoned
// along its estimated velocity every tick and the drawn position eased toward
// that moving target — the skeleton glides with the athlete instead of
// stepping behind them.
const TICK_MS = 16;
const SMOOTH = 0.35;
/** MotionPredictor id for the bell box (joints use their keypoint index). */
const BELL_TRACK_ID = 100;

const BONE_COLOR = '#22D3EEDD';
const JOINT_COLOR = '#E0F2FEEE';
const BELL_COLOR = '#F97316FF';

const VERDICT_COLORS: Record<string, string> = {
  correct: '#16A34ACC',
  incorrect: '#DC2626CC',
  none: '#000000CC',
};

type Parent = { width: number; height: number };

/** The rescale-'fill' (cover) transform the video uses, precomputed. */
function coverTransform(parent: Parent, frameW: number, frameH: number) {
  const scale = Math.max(parent.width / frameW, parent.height / frameH);
  const dispW = frameW * scale;
  const dispH = frameH * scale;
  return {
    offX: (parent.width - dispW) / 2,
    offY: (parent.height - dispH) / 2,
    dispW,
    dispH,
  };
}

/**
 * Pose skeleton + tracked bell with dead-reckoned motion. Each bone is a thin
 * View centered on its segment midpoint and rotated to the segment angle
 * (Smelter rotates around the View center), plus a dot per visible joint —
 * ~30 Views per pose, same order as SmoothedBoxes' per-tick churn.
 */
function SkeletonAndBell({
  data,
  parent,
}: {
  data: KettlebellOverlayState;
  parent: Parent;
}) {
  const predictorRef = useRef(new MotionPredictor());
  // Eased, currently-drawn vectors: joints are [x, y], the bell [x, y, w, h].
  const drawnRef = useRef<Map<number, number[]>>(new Map());
  const confRef = useRef<number[]>(new Array(17).fill(0));
  const bellActiveRef = useRef(false);
  const [, setTick] = useState(0);

  // Feed each result into the per-joint predictors (px, via cover transform).
  useEffect(() => {
    const { offX, offY, dispW, dispH } = coverTransform(
      parent,
      data.frameW,
      data.frameH,
    );
    const now = Date.now();
    if (data.kpts) {
      data.kpts.forEach((k, i) => {
        confRef.current[i] = k[2];
        if (k[2] < KPT_CONF_MIN) return;
        predictorRef.current.update(
          i,
          [offX + k[0] * dispW, offY + k[1] * dispH],
          now,
        );
      });
    } else {
      confRef.current.fill(0);
    }
    bellActiveRef.current = !!data.kb;
    if (data.kb) {
      predictorRef.current.update(
        BELL_TRACK_ID,
        [
          offX + data.kb.x * dispW,
          offY + data.kb.y * dispH,
          data.kb.w * dispW,
          data.kb.h * dispH,
        ],
        now,
      );
    } else {
      drawnRef.current.delete(BELL_TRACK_ID);
    }
  }, [data, parent.width, parent.height]);

  // Every tick, ease each drawn vector toward its predicted position.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const ids = [...confRef.current.keys()];
      if (bellActiveRef.current) ids.push(BELL_TRACK_ID);
      for (const id of ids) {
        if (id !== BELL_TRACK_ID && confRef.current[id] < KPT_CONF_MIN) {
          continue;
        }
        const tgt = predictorRef.current.predict(id, now);
        if (!tgt) continue;
        const cur = drawnRef.current.get(id);
        if (!cur || cur.length !== tgt.length) {
          drawnRef.current.set(id, [...tgt]);
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

  const joint = (i: number): number[] | undefined =>
    confRef.current[i] >= KPT_CONF_MIN ? drawnRef.current.get(i) : undefined;

  const els: React.ReactElement[] = [];

  if (data.skeleton) {
    const thickness = Math.max(3, Math.round(parent.height * 0.006));
    const dot = thickness * 2;
    BONES.forEach(([a, b], i) => {
      const pa = joint(a);
      const pb = joint(b);
      if (!pa || !pb) return;
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      if (len < 2) return;
      const angle = (Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180) / Math.PI;
      els.push(
        <View
          key={`bone-${i}`}
          style={{
            top: Math.round((pa[1] + pb[1]) / 2 - thickness / 2),
            left: Math.round((pa[0] + pb[0]) / 2 - len / 2),
            width: Math.max(2, Math.round(len)),
            height: thickness,
            rotation: angle,
            backgroundColor: BONE_COLOR,
            borderRadius: thickness,
          }}
        />,
      );
    });
    for (let i = 0; i < 17; i++) {
      const p = joint(i);
      if (!p) continue;
      els.push(
        <View
          key={`joint-${i}`}
          style={{
            top: Math.round(p[1] - dot / 2),
            left: Math.round(p[0] - dot / 2),
            width: dot,
            height: dot,
            backgroundColor: JOINT_COLOR,
            borderRadius: dot,
          }}
        />,
      );
    }
  }

  const bell = data.kb ? drawnRef.current.get(BELL_TRACK_ID) : undefined;
  if (bell) {
    const [left, top, w, h] = bell;
    els.push(
      <View
        key='bell'
        style={{
          top: Math.round(top),
          left: Math.round(left),
          width: Math.max(2, Math.round(w)),
          height: Math.max(2, Math.round(h)),
          borderWidth: data.drawBoxes ? 4 : 2,
          borderColor: BELL_COLOR,
          borderRadius: 6,
        }}
      />,
    );
    if (data.drawBoxes && data.kb?.conf != null) {
      const fontSize = Math.max(12, Math.round(parent.height * 0.022));
      els.push(
        <View
          key='bell-conf'
          style={{
            top: Math.max(0, Math.round(top) - Math.round(fontSize * 1.6)),
            left: Math.round(left),
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
        </View>,
      );
    }
  }

  return <>{els}</>;
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
 * Kettlebell Coach on-output overlay: pose skeleton + tracked bell box +
 * reps/exercise/verdict badge. Mounted whenever the model is enabled (the
 * store entry persists between detections so the badge never flickers).
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
      {data.skeleton || data.kb ? (
        <SkeletonAndBell data={data} parent={parent} />
      ) : null}
      <CoachBadge data={data} parent={parent} />
    </View>
  );
}
