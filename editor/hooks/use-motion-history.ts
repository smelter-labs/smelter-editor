import { useRef, useEffect, useMemo } from 'react';
import type { Input } from '@/lib/types';

const MAX_HISTORY = 60;

type MotionHistory = {
  current: number;
  history: number[];
  peak: number;
};

export function useMotionHistory(inputs: Input[]): Map<string, MotionHistory> {
  const historyRef = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    for (const input of inputs) {
      if (input.motionScore === undefined || input.motionScore === null)
        continue;

      let history = historyRef.current.get(input.inputId);
      if (!history) {
        history = [];
        historyRef.current.set(input.inputId, history);
      }
      history.push(input.motionScore);
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
    }

    for (const key of historyRef.current.keys()) {
      if (!inputs.find((i) => i.inputId === key)) {
        historyRef.current.delete(key);
      }
    }
  }, [inputs]);

  return useMemo(() => {
    const result = new Map<string, MotionHistory>();
    for (const input of inputs) {
      const history = historyRef.current.get(input.inputId) ?? [];
      const current = input.motionScore ?? 0;
      const peak = history.length > 0 ? Math.max(...history) : current;
      result.set(input.inputId, { current, history, peak });
    }
    return result;
  }, [inputs]);
}
