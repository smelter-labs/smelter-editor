'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { KETTLEBELL_ISSUE_LABELS } from '@smelter-editor/types';
import { useKettlebellResults } from '@/hooks/use-kettlebell-results';
import type { KettlebellRep } from '@/hooks/use-kettlebell-results';

const EXERCISE_LABELS: Record<string, string> = {
  swing: 'Swing',
  clean: 'Clean',
  snatch: 'Snatch',
  idle: 'Idle',
};

/** How many reps the collapsed dot row shows; the list shows the full history. */
const DOTS_MAX = 10;

function issueText(rep: KettlebellRep): string {
  return rep.issues.length
    ? rep.issues.map((c) => KETTLEBELL_ISSUE_LABELS[c] ?? c).join(', ')
    : 'Good rep';
}

/**
 * Live feedback block for the Kettlebell Coach card in AIModelsPanel: rep
 * counter, current exercise, last-rep verdict with its technique faults, and
 * a dot per recent rep (green/red) that expands into a per-rep comment list.
 * Mount only while the model is enabled — the hook keeps an SSE stream open
 * for as long as it is rendered.
 */
export function KettlebellLiveStatus({
  roomId,
  inputId,
}: {
  roomId: string;
  inputId: string;
}) {
  const live = useKettlebellResults(roomId, inputId);
  const [expanded, setExpanded] = useState(false);
  const verdict = live.lastRep?.verdict ?? null;
  const issues = verdict === 'incorrect' ? (live.lastRep?.issues ?? []) : [];
  const Chevron = expanded ? ChevronDown : ChevronRight;

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
        <div className='space-y-1'>
          <button
            type='button'
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className='flex w-full items-center gap-1 rounded px-0.5 py-0.5 text-left hover:bg-neutral-700/40'>
            <Chevron className='h-3 w-3 shrink-0 text-neutral-500' />
            <span className='mr-1 text-[10px] text-neutral-500'>last reps</span>
            {live.recentReps.slice(-DOTS_MAX).map((rep) => (
              <span
                key={rep.index}
                title={issueText(rep)}
                className={`h-2 w-2 rounded-full ${
                  rep.verdict === 'correct' ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
            ))}
          </button>

          {expanded && (
            <ul className='max-h-40 space-y-0.5 overflow-y-auto rounded bg-neutral-900/60 p-1'>
              {[...live.recentReps].reverse().map((rep) => (
                <li
                  key={rep.index}
                  className='flex items-baseline gap-1.5 text-[11px] leading-tight'>
                  <span className='w-7 shrink-0 text-right font-mono text-neutral-500'>
                    #{rep.index}
                  </span>
                  <span className='w-11 shrink-0 text-neutral-400'>
                    {EXERCISE_LABELS[rep.exercise] ?? rep.exercise}
                  </span>
                  <span
                    className={
                      rep.verdict === 'correct'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }>
                    {rep.verdict === 'correct' ? '✓' : '✗'}
                  </span>
                  <span
                    className={
                      rep.verdict === 'correct'
                        ? 'text-neutral-500'
                        : 'text-red-300/90'
                    }>
                    {issueText(rep)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
