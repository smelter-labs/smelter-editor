'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import {
  OB_QUIZ_LETTERS,
  quizBarModel,
  type QuizBarModel,
} from '@/lib/ob-van/quiz-panel';
import { Chip, Meta, Mono, OB, TagChip } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * The Smelterionaire desk (preset `quiz` only). Two rows:
 *  1. contestants — click one to assign the next question (money + lifeline
 *     dot live on each card), plus BOARD / SKIP / ASK AI;
 *  2. the operator-only question card: the question, the four answers with a
 *     gold dot on the correct one (the desk sees it, the program does not),
 *     A–D lock buttons, REVEAL and the ✓/✗ verdict overrides.
 */
export function QuizBar({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  const model = quizBarModel(state);
  if (!model) return null;
  return (
    <div
      role='group'
      aria-label='quiz desk'
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
      }}>
      <PlayersRow model={model} pending={pending} />
      {model.question ? <QuestionCard model={model} pending={pending} /> : null}
    </div>
  );
}

function PlayersRow({
  model,
  pending,
}: {
  model: QuizBarModel;
  pending: ObPending;
}) {
  const boardCmd: ObOperatorCommand = {
    op: 'quiz',
    action: model.boardShown ? 'hide_board' : 'show_board',
  };
  const lifelineCmd: ObOperatorCommand = { op: 'quiz', action: 'lifeline' };
  const skipCmd: ObOperatorCommand = { op: 'quiz', action: 'skip' };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
      }}>
      <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
        QUIZ
      </Meta>
      {model.players.length === 0 ? (
        <Meta size={9} color={OB.dim2}>
          no contestants — add cameras with the GUEST role
        </Meta>
      ) : null}
      {model.players.map((p) => {
        const cmd: ObOperatorCommand = {
          op: 'quiz',
          action: 'assign',
          camId: p.camId,
        };
        return (
          <Chip
            key={p.camId}
            dense
            tone={p.active ? 'amber' : 'default'}
            active={p.active}
            disabled={!p.assignable && !p.active}
            pending={pending.isPending(cmd)}
            onClick={p.assignable ? () => pending.send(cmd) : undefined}
            title={
              p.assignable
                ? `Ask ${p.name} the next question`
                : p.active
                  ? `${p.name} is answering`
                  : p.live
                    ? 'Finish the current question first'
                    : `${p.name} is not live`
            }
            label={
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <span>{p.name.toUpperCase()}</span>
                <span style={{ color: p.active ? undefined : OB.amber }}>
                  {p.money}
                </span>
                {p.lifelineUsed ? null : (
                  <span style={{ color: OB.accent }}>◆</span>
                )}
              </span>
            }
            style={{ maxWidth: 280 }}
          />
        );
      })}
      <Chip
        dense
        label={model.boardShown ? 'BOARD ▾' : 'BOARD ▴'}
        active={model.boardShown}
        disabled={!model.canShowBoard && !model.canHideBoard}
        pending={pending.isPending(boardCmd)}
        onClick={() => pending.send(boardCmd)}
        title={
          model.boardShown ? 'Hide the ABCD board' : 'Put the board on air'
        }
      />
      <Chip
        dense
        tone='accent'
        label={model.lifelinePending ? 'AI THINKING…' : 'ASK AI'}
        disabled={!model.canLifeline}
        pending={model.lifelinePending || pending.isPending(lifelineCmd)}
        onClick={() => pending.send(lifelineCmd)}
        title="Burn the contestant's lifeline: the AI answers blind on air"
      />
      <Chip
        dense
        label='SKIP'
        disabled={!model.canSkip}
        pending={pending.isPending(skipCmd)}
        onClick={() => pending.send(skipCmd)}
        title='Abandon the question (back into the bank, no money change)'
      />
      <Meta size={9} color={OB.dim2} style={{ marginLeft: 'auto' }}>
        {model.questionsLeft} QUESTION{model.questionsLeft === 1 ? '' : 'S'}{' '}
        LEFT
      </Meta>
    </div>
  );
}

function QuestionCard({
  model,
  pending,
}: {
  model: QuizBarModel;
  pending: ObPending;
}) {
  const q = model.question!;
  const revealCmd: ObOperatorCommand = { op: 'quiz', action: 'reveal' };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        background: OB.well,
        border: `1px solid ${OB.rule2}`,
        borderRadius: 3,
        minWidth: 0,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          flexWrap: 'wrap',
        }}>
        <TagChip tone='amber'>
          Q{q.number} · {q.forName.toUpperCase()}
        </TagChip>
        <Mono size={12} weight={600} style={{ minWidth: 0 }}>
          {q.q}
        </Mono>
        {q.verdict ? (
          <TagChip tone={q.verdict === 'correct' ? 'preview' : 'program'}>
            {q.verdict.toUpperCase()}
          </TagChip>
        ) : null}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 6,
        }}>
        {q.answers.map((a) => {
          const cmd: ObOperatorCommand = {
            op: 'quiz',
            action: 'lock',
            letter: a.letter,
          };
          const locked = q.locked === a.letter;
          return (
            <Chip
              key={a.letter}
              dense
              tone={locked ? 'amber' : 'default'}
              active={locked}
              disabled={!model.canLock}
              pending={pending.isPending(cmd)}
              onClick={() => pending.send(cmd)}
              title={
                model.canLock
                  ? `Lock ${a.letter} as ${q.forName}'s final answer`
                  : 'Show the board first'
              }
              label={
                <span
                  style={{
                    display: 'inline-flex',
                    gap: 8,
                    alignItems: 'center',
                    minWidth: 0,
                  }}>
                  <span style={{ color: locked ? undefined : OB.amber }}>
                    {a.letter}
                  </span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                    {a.text}
                  </span>
                  {a.correct ? (
                    <span
                      title='Correct answer (desk only)'
                      style={{ color: OB.amber }}>
                      ●
                    </span>
                  ) : null}
                </span>
              }
              style={{ justifyContent: 'flex-start' }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}>
        <Chip
          dense
          tone='program'
          label='REVEAL'
          disabled={!model.canReveal}
          pending={pending.isPending(revealCmd)}
          onClick={() => pending.send(revealCmd)}
          title='Reveal the verdict: the bank decides, money moves'
        />
        <Meta size={9} color={OB.dim2}>
          OVERRIDE
        </Meta>
        {(['correct', 'wrong'] as const).map((verdict) => {
          const cmd: ObOperatorCommand = {
            op: 'quiz',
            action: 'reveal',
            verdict,
          };
          return (
            <Chip
              key={verdict}
              dense
              tone={verdict === 'correct' ? 'preview' : 'danger'}
              label={verdict === 'correct' ? '✓ CORRECT' : '✗ WRONG'}
              disabled={!model.canOverride}
              pending={pending.isPending(cmd)}
              onClick={() => pending.send(cmd)}
              title={`Judgment call: reveal as ${verdict} regardless of the lock`}
            />
          );
        })}
      </div>
    </div>
  );
}
