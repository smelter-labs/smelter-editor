#!/usr/bin/env node
// Smelterionaire AI contestants end-to-end, deliberately WITHOUT provider
// keys: four mp4 cams named after the models (OPUS/GPT/GEMINI/JEV), the
// smelter question bank, `ask` → canned answer auto-locks → reveal moves the
// money; then AUTO mode plays a whole round hands-free; a second ask is
// refused while one is open. With real keys the same flow runs live answers
// instead of canned ones — this script accepts both.
// Needs the server with OB_SIM=1 and the demo clips in data/mp4s/ob-demo/
// (speaker.mp4, wide.mp4).
//
//   OB_SIM=1 pnpm start            # in one terminal
//   OB_API=http://localhost:3001 node scripts/ob-van-quiz-ai-check.mjs
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
  waitFor,
} from './lib/ob-api.mjs';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

async function waitForQuiz(roomId, label, pred, timeoutMs = 15_000) {
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
      eventName: 'SMELTERIONAIRE · AI',
      presetId: 'quiz',
      audio: { mode: 'mix' },
      autoPilot: true,
      captions: false,
      // `tts: true` with no ELEVENLABS_API_KEY (and no OB_QUIZ_TTS_FAKE) must
      // degrade silently to the text-only show — every check below holds
      // either way.
      quiz: { bank: 'smelter', aiHost: true, auto: false, tts: true },
    });
    await ob.mp4Cam(roomId, {
      role: 'speaker',
      fileName: 'ob-demo/speaker.mp4',
      name: 'Host cam',
      talent: 'Max Smelter',
    });
    const cams = {};
    for (const talent of ['OPUS', 'GPT', 'GEMINI', 'JEV']) {
      cams[talent] = (
        await ob.mp4Cam(roomId, {
          role: 'guest',
          fileName: 'ob-demo/wide.mp4',
          name: `${talent} cam`,
          talent,
        })
      ).camId;
    }
    await ob.sync(roomId, 0);
    await sleep(1000);
    await ob.control(roomId, 'go_live');

    const seated = await waitForQuiz(
      roomId,
      'players seated',
      (q) => q.players.length === 4,
    );
    check(
      seated.quiz.players.map((p) => p.model).join(',') ===
        'opus,gpt,gemini,jev',
      'talent names map to the four models',
      seated.quiz.players.map((p) => p.model).join(','),
    );
    check(
      seated.quiz.questionsLeft >= 25,
      `smelter bank loaded (${seated.quiz.questionsLeft} questions)`,
    );

    log('Q1 → GPT answers for itself…');
    await cmd(roomId, { action: 'assign', camId: cams.GPT });
    await cmd(roomId, { action: 'show_board' });
    await cmd(roomId, { action: 'ask' });
    const pending = await ob.state(roomId);
    if (pending.quiz.current?.answering?.status === 'pending') {
      const again = await cmd(roomId, { action: 'ask' }).then(
        () => true,
        () => false,
      );
      check(again === false, 'a second ask is refused while one is pending');
    }
    const answered = await waitForQuiz(
      roomId,
      'answer landed',
      (q) => q.current?.answering?.status === 'done',
      40_000,
    );
    const ans = answered.quiz.current.answering;
    check(/^[A-D]$/.test(ans.letter ?? ''), `GPT locked ${ans.letter}`);
    check(
      answered.quiz.current.lockedLetter === ans.letter,
      'the answer auto-locked',
    );
    check(
      answered.quiz.phase === 'locked',
      'phase is locked after the answer',
      answered.quiz.phase,
    );
    log(
      ans.canned
        ? `canned answer (no key): "${ans.quip}"`
        : `live answer${ans.quip ? `: "${ans.quip}"` : ''}${
            ans.confidence != null
              ? ` (confidence ${Math.round(ans.confidence * 100)}%)`
              : ''
          }`,
    );

    await cmd(roomId, { action: 'reveal' });
    const revealed = await waitForQuiz(
      roomId,
      'revealed',
      (q) => q.phase === 'revealed',
    );
    const gpt = revealed.quiz.players.find((p) => p.camId === cams.GPT);
    check(
      gpt.amount === (revealed.quiz.current.verdict === 'correct'
        ? 1_500_000
        : 500_000),
      `money moved to ${gpt.amount} on ${revealed.quiz.current.verdict}`,
    );
    await waitForQuiz(roomId, 'back to idle', (q) => q.phase === 'idle');

    log('GEMINI gets a question and cashes out…');
    await cmd(roomId, { action: 'assign', camId: cams.GEMINI });
    await cmd(roomId, { action: 'show_board' });
    const bankBefore = (await ob.state(roomId)).quiz.questionsLeft;
    await cmd(roomId, { action: 'ask' });
    const walked = await waitForQuiz(
      roomId,
      'gemini cashed out',
      (q) => q.players.find((p) => p.camId === cams.GEMINI)?.cashedOut === true,
      20_000,
    );
    check(walked.quiz.phase === 'idle', 'table cleared after the cash out');
    check(
      walked.quiz.questionsLeft === bankBefore + 1,
      'the question went back to the bank',
      `left=${walked.quiz.questionsLeft} before-board=${bankBefore}`,
    );
    check(
      walked.quiz.players.find((p) => p.camId === cams.GEMINI)?.amount ===
        1_000_000,
      'GEMINI walks with the full million tokens',
    );
    const reassign = await cmd(roomId, {
      action: 'assign',
      camId: cams.GEMINI,
    }).then(
      () => true,
      () => false,
    );
    check(reassign === false, 'a cashed-out contestant cannot be assigned');

    log('AUTO mode: one full hands-free round…');
    await ob.operate(roomId, { op: 'quiz_set', auto: true });
    // No `phase === 'idle'` here: auto assigns the next question on the same
    // tick the celebration clears, so the idle window is too short to poll.
    const auto = await waitForQuiz(
      roomId,
      'auto played a question',
      (q) => q.players.reduce((n, p) => n + p.answered, 0) >= 2,
      90_000,
    );
    check(true, 'auto round completed');
    const answeredPlayers = auto.quiz.players.filter((p) => p.answered > 0);
    check(
      answeredPlayers.length >= 2,
      `round-robin reached ${answeredPlayers.length} players`,
    );
    await ob.operate(roomId, { op: 'quiz_set', auto: false });

    await ob.operate(roomId, { op: 'quiz_set', tts: false });
    const afterTts = await ob.state(roomId);
    check(
      afterTts.config.quiz.tts === false,
      'quiz_set toggles the voice flag',
    );

    const state = await ob.state(roomId);
    log('WHY log tail:');
    for (const e of state.log.slice(-10)) log(` · ${e.label} ${e.text}`);
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
