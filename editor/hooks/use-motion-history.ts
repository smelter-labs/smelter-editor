import { useRef, useEffect, useMemo, useState } from 'react';
import type { Input } from '@/lib/types';

const MAX_HISTORY = 60;

export type MotionHistory = {
  current: number;
  history: number[];
  peak: number;
};

export function useMotionHistory(
  inputs: Input[],
  motionScores: Record<string, number>,
): Map<string, MotionHistory> {
  const historyRef = useRef<Map<string, number[]>>(new Map());
  const [revision, setRevision] = useState(0);

  const inputIds = useMemo(
    () => new Set(inputs.map((i) => i.inputId)),
    [inputs],
  );

  useEffect(() => {
    for (const key of historyRef.current.keys()) {
      if (!inputIds.has(key)) {
        historyRef.current.delete(key);
      }
    }
  }, [inputIds]);

  useEffect(() => {
    let changed = false;
    for (const [inputId, score] of Object.entries(motionScores)) {
      if (!inputIds.has(inputId)) continue;

      let history = historyRef.current.get(inputId);
      if (!history) {
        history = [];
        historyRef.current.set(inputId, history);
      }
      history.push(score);
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
      changed = true;
    }
    if (changed) {
      setRevision((r) => r + 1);
    }
  }, [motionScores, inputIds]);

  return useMemo(() => {
    void revision;
    const result = new Map<string, MotionHistory>();
    for (const inputId of inputIds) {
      const history = historyRef.current.get(inputId) ?? [];
      const current = motionScores[inputId] ?? 0;
      const peak = history.length > 0 ? Math.max(...history) : current;
      result.set(inputId, { current, history: [...history], peak });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, inputIds, motionScores]);
}
