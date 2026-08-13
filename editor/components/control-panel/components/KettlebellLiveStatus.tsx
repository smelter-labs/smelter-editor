'use client';

import { KETTLEBELL_ISSUE_LABELS } from '@smelter-editor/types';
import { useKettlebellResults } from '@/hooks/use-kettlebell-results';

const EXERCISE_LABELS: Record<string, string> = {
  swing: 'Swing',
  clean: 'Clean',
  snatch: 'Snatch',
  idle: 'Idle',
};

/**
 * Live feedback block for the Kettlebell Coach card in AIModelsPanel: rep
 * counter, current exercise, last-rep verdict with its technique faults, and
 * a dot per recent rep (green/red). Mount only while the model is enabled —
 * the hook keeps an SSE stream open for as long as it is rendered.
 */
export function KettlebellLiveStatus({
  roomId,
  inputId,
}: {
  roomId: string;
  inputId: string;
}) {
  const live = useKettlebellResults(roomId, inputId);
  const verdict = live.lastRep?.verdict ?? null;
  const issues = verdict === 'incorrect' ? (live.lastRep?.issues ?? []) : [];

  return (
    <div className='space-y-2 rounded-md bg-neutral-800/60 p-2'>
      <div className='flex items-center gap-3'>
        <span className='font-mono text-2xl leading-none text-neutral-100'>
          {live.repCount}
        </span>
        <span className='text-[11px] uppercase tracking-wide text-neutral-500'>
          reps
        </span>
        <span className='rounded bg-neutral-700/70 px-1.5 py-0.5 text-[11px] font-medium text-neutral-200'>
          {EXERCISE_LABELS[live.exercise] ?? live.exercise}
        </span>
        {verdict && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              verdict === 'correct'
                ? 'bg-emerald-900/70 text-emerald-300'
                : 'bg-red-900/70 text-red-300'
            }`}>
            {verdict === 'correct' ? 'Good rep' : 'Check form'}
          </span>
        )}
      </div>

      {issues.length > 0 && (
        <ul className='space-y-0.5'>
          {issues.map((code) => (
            <li key={code} className='text-[11px] text-red-300/90'>
              • {KETTLEBELL_ISSUE_LABELS[code] ?? code}
            </li>
          ))}
        </ul>
      )}

      {live.recentReps.length > 0 && (
        <div className='flex items-center gap-1'>
          <span className='mr-1 text-[10px] text-neutral-500'>last reps</span>
          {live.recentReps.map((rep) => (
            <span
              key={rep.index}
              title={
                rep.issues.length
                  ? rep.issues
                      .map((c) => KETTLEBELL_ISSUE_LABELS[c] ?? c)
                      .join(', ')
                  : 'Good rep'
              }
              className={`h-2 w-2 rounded-full ${
                rep.verdict === 'correct' ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
