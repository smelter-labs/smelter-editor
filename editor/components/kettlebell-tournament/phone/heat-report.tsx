'use client';

import React from 'react';
import {
  KETTLEBELL_ISSUE_LABELS,
  type KettlebellExercise,
  type KettlebellIssueCode,
} from '@smelter-editor/types';
import {
  DisplayText,
  KBT,
  KbtButton,
  Label,
  Num,
  Plate,
  PlateTitle,
  kbtMonoFont,
} from '../kbt-kit';

/** One `kbt_rep` as remembered by the phone for the post-heat report. */
export type KbtRepLogEntry = {
  repIndex: number;
  exercise: KettlebellExercise;
  verdict: 'correct' | 'incorrect';
  issues: KettlebellIssueCode[];
  points: number;
};

const EXERCISES: Exclude<KettlebellExercise, 'idle'>[] = [
  'swing',
  'clean',
  'snatch',
];

/**
 * Post-heat debrief on the athlete's phone: the score they just posted, the
 * rep split per exercise and the full judged rep log (verdict + technique
 * faults per rep). Shown after the "TIME!" beat; CONTINUE returns to
 * standing-by. The page bails out of it automatically if the athlete's next
 * heat gets staged while they are still reading.
 */
export function HeatReport({
  repLog,
  points,
  onContinue,
}: {
  repLog: KbtRepLogEntry[];
  points: number;
  onContinue: () => void;
}) {
  const correct = repLog.filter((r) => r.verdict === 'correct').length;
  const incorrect = repLog.length - correct;
  const perExercise = EXERCISES.map((ex) => ({
    ex,
    count: repLog.filter((r) => r.exercise === ex).length,
  }));

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      <Plate
        cutPx={14}
        accentBar
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          padding: '18px 18px 16px',
        }}>
        <Label size={10} tracking={3}>
          HEAT COMPLETE
        </Label>
        <DisplayText size={64} weight={800}>
          {points}
        </DisplayText>
        <Label size={10} tracking={3}>
          POINTS
        </Label>
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 4,
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}>
          <span style={{ color: KBT.good }}>✓ {correct} GOOD</span>
          <span style={{ color: incorrect > 0 ? KBT.bad : KBT.dim }}>
            ✗ {incorrect} FAULTED
          </span>
        </div>
      </Plate>

      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          padding: '14px 16px',
        }}>
        <PlateTitle>REP SPLIT</PlateTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          {perExercise.map(({ ex, count }) => (
            <div
              key={ex}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '10px 4px',
                background: count > 0 ? KBT.fillStrong : KBT.fill,
                border: `1px solid ${KBT.border}`,
              }}>
              <Num size={22} color={count > 0 ? KBT.cream : KBT.dim}>
                {count}
              </Num>
              <Label
                size={9}
                tracking={1.5}
                color={count > 0 ? KBT.cream : KBT.dim}>
                {ex}
              </Label>
            </div>
          ))}
        </div>
      </Plate>

      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '14px 16px',
        }}>
        <PlateTitle
          right={
            <Label size={10} tracking={1.5}>
              {repLog.length} REPS
            </Label>
          }>
          REP LOG
        </PlateTitle>
        {repLog.length === 0 ? (
          <Label size={11} tracking={1}>
            NO REPS COUNTED THIS HEAT
          </Label>
        ) : (
          repLog.map((rep, i) => {
            const bad = rep.verdict === 'incorrect';
            return (
              <div
                key={rep.repIndex}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  paddingBottom: 7,
                  borderBottom: `1px solid ${KBT.border}`,
                }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    fontFamily: kbtMonoFont,
                    fontSize: 12,
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                  }}>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      color: KBT.cream,
                    }}>
                    {/* Row number, not repIndex — that one is monotonic
                        per input across the whole session, not per heat. */}
                    <Num size={11} color={KBT.dim}>
                      {String(i + 1).padStart(2, '0')}
                    </Num>
                    {rep.exercise}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexShrink: 0,
                    }}>
                    <Num size={12} color={rep.points > 0 ? KBT.cream : KBT.dim}>
                      +{rep.points}
                    </Num>
                    <span
                      style={{
                        color: bad ? KBT.bad : KBT.good,
                        fontWeight: 600,
                      }}>
                      {bad ? '✗' : '✓'}
                    </span>
                  </span>
                </div>
                {bad && rep.issues.length > 0 ? (
                  <span
                    style={{
                      fontFamily: kbtMonoFont,
                      fontSize: 10,
                      letterSpacing: 0.5,
                      color: KBT.bad,
                      paddingLeft: 26,
                    }}>
                    {rep.issues
                      .map((code) => KETTLEBELL_ISSUE_LABELS[code] ?? code)
                      .join(' · ')}
                  </span>
                ) : null}
              </div>
            );
          })
        )}
      </Plate>

      <KbtButton block active label='CONTINUE' onClick={onContinue} />
    </div>
  );
}
