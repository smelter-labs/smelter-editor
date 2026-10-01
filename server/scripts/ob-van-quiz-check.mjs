#!/usr/bin/env node
// Smelterionaire (QUIZ preset) end-to-end, without a worker: host + three
// contestants on mp4 cams, the default grid, the question split, the
// think-solo on simulated speech, a correct and a wrong reveal with exact
// money, the canned Ask-the-AI lifeline and the no-lock verdict override.
// Needs the server started with OB_SIM=1 and the two demo clips in
// data/mp4s/ob-demo/ (speaker.mp4, wide.mp4).
//
//   OB_SIM=1 pnpm start            # in one terminal
//   OB_API=http://localhost:3001 node scripts/ob-van-quiz-check.mjs
//
// Exits non-zero when a check fails.

import {
  API,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  sleep,
  speech,
  waitFor,
} from './lib/ob-api.mjs';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

const shotOf = (state) => state.program.shot;
const kindOf = (state) => shotOf(state)?.kind ?? 'none';

async function waitForShot(roomId, label, pred, timeoutMs = 20_000) {
  return waitFor(
    async () => {
      const state = await ob.state(roomId);
      return pred(shotOf(state)) ? state : null;
    },
    { timeoutMs, label },
  );
}

async function waitForQuiz(roomId, label, pred, timeoutMs = 10_000) {
  return waitFor(
    async () => {
      const state = await ob.state(roomId);
      return state.quiz && pred(state.quiz) ? state : null;
    },
    { timeoutMs, label },
  );
}

const cmd = (roomId, c) => ob.operate(roomId, { op: 'quiz', ...c });

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: 1280, height: 720 });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'SMELTERIONAIRE',
      presetId: 'quiz',
      audio: { mode: 'mix' },
      autoPilot: true,
      captions: false,
    });
    const host = (
      await ob.mp4Cam(roomId, {
        role: 'speaker',
        fileName: 'ob-demo/speaker.mp4',
        name: 'Host cam',
        talent: 'Max',
      })
    ).camId;
    const guests = [];
    for (const talent of ['Alice', 'Bob', 'Cleo']) {
      guests.push(
        (
          await ob.mp4Cam(roomId, {
            role: 'guest',
            fileName: 'ob-demo/wide.mp4',
            name: `${talent} cam`,
            talent,
          })
        ).camId,
      );
    }
    const [g1, g2, g3] = guests;
    await ob.sync(roomId, 0);
    await sleep(1000);
    await ob.control(roomId, 'go_live');
    log('on air, waiting for the studio grid…');

    await waitForShot(roomId, 'default grid', (s) => s?.kind === 'grid');
    const seated = await waitForQuiz(
      roomId,
      'players seated',
      (q) => q.players.length === 3,
    );
    check(
      seated.quiz.players.every((p) => p.amount === 1_000_000),
      'three contestants seated at $1,000,000',
    );

    log('Q1 → Alice…');
    await cmd(roomId, { action: 'assign', camId: g1 });
    const split = await waitForShot(
      roomId,
      'question split',
      (s) =>
        s?.kind === 'split' && s.cams.includes(host) && s.cams.includes(g1),
    );
    check(true, `split host+contestant (${JSON.stringify(shotOf(split))})`);
    check(split.quiz.phase === 'assigned', 'quiz phase assigned');
    check(split.lowerThird?.camId === g1, 'lower third on the contestant');

    await cmd(roomId, { action: 'show_board' });
    const board = await waitForQuiz(roomId, 'board', (q) => q.phase === 'board');
    check(board.quiz.current.shownAtMs != null, 'board on program');

    log('Alice thinks out loud…');
    for (let i = 0; i < 20; i++) {
      await ob.simulate(roomId, g1, speech(true));
      await sleep(120);
    }
    const thinkSolo = await waitForShot(
      roomId,
      'think solo',
      (s) => s?.kind === 'solo' && s.cam === g1,
      15_000,
    ).catch(() => null);
    check(
      thinkSolo !== null,
      'speech on the contestant pulls a solo',
      thinkSolo ? '' : `still ${kindOf(await ob.state(roomId))}`,
    );

    const correct = board.quiz.current.correct;
    await cmd(roomId, { action: 'lock', letter: correct });
    await cmd(roomId, { action: 'reveal' });
    const won = await waitForQuiz(
      roomId,
      'reveal correct',
      (q) => q.phase === 'revealed',
    );
    check(won.quiz.current.verdict === 'correct', 'bank verdict: correct');
    check(
      won.quiz.players.find((p) => p.camId === g1)?.amount === 1_500_000,
      'Alice at exactly $1,500,000',
    );
    const celebrating = await ob.state(roomId);
    check(
      kindOf(celebrating) === 'solo' && shotOf(celebrating).cam === g1,
      'celebration solo on the winner',
      kindOf(celebrating),
    );

    log('waiting for the studio grid between rounds…');
    await waitForQuiz(roomId, 'back to idle', (q) => q.phase === 'idle');
    await waitForShot(roomId, 'grid back', (s) => s?.kind === 'grid');
    check(true, 'grid returns after the celebration');

    log('Q2 → Bob, wrong on purpose…');
    await cmd(roomId, { action: 'assign', camId: g2 });
    await waitForQuiz(roomId, 'Q2 assigned', (q) => q.phase === 'assigned');
    await cmd(roomId, { action: 'show_board' });
    const b2 = await waitForQuiz(roomId, 'Q2 board', (q) => q.phase === 'board');
    const wrong = ['A', 'B', 'C', 'D'].find(
      (l) => l !== b2.quiz.current.correct,
    );
    await cmd(roomId, { action: 'lock', letter: wrong });
    await cmd(roomId, { action: 'reveal' });
    const lost = await waitForQuiz(
      roomId,
      'reveal wrong',
      (q) => q.phase === 'revealed',
    );
    check(lost.quiz.current.verdict === 'wrong', 'bank verdict: wrong');
    check(
      lost.quiz.players.find((p) => p.camId === g2)?.amount === 500_000,
      'Bob at exactly $500,000',
    );
    await waitForQuiz(roomId, 'idle again', (q) => q.phase === 'idle');

    log('Q3 → Cleo asks the AI, then a no-lock override…');
    await cmd(roomId, { action: 'assign', camId: g3 });
    await cmd(roomId, { action: 'lifeline' });
    const hinted = await waitForQuiz(
      roomId,
      'hint resolved',
      (q) => q.hint?.status === 'done',
      15_000,
    );
    const hint = hinted.quiz.hint;
    check(Boolean(hint.text), `the AI said something ("${hint.text}")`);
    if (hint.canned)
      check(hint.letter === null, 'canned hint names no letter (no API key)');
    else check(hint.letter != null, `live hint picked ${hint.letter}`);
    check(
      hinted.quiz.players.find((p) => p.camId === g3)?.lifelineUsed === true,
      'lifeline burned',
    );
    await cmd(roomId, { action: 'show_board' });
    await cmd(roomId, { action: 'reveal', verdict: 'wrong' });
    const overridden = await waitForQuiz(
      roomId,
      'override reveal',
      (q) => q.phase === 'revealed',
    );
    check(
      overridden.quiz.players.find((p) => p.camId === g3)?.amount === 500_000,
      'override verdict moved the money without a lock',
    );

    const state = await ob.state(roomId);
    check(state.quiz.questionsLeft >= 1, 'questions left in the bank');
    log('WHY log tail:');
    for (const e of state.log.slice(-8)) log(` · ${e.label} ${e.text}`);
  } finally {
    await deleteRoom(roomId);
  }
  const failures = failureCount();
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
