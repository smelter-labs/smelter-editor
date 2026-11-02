#!/usr/bin/env node
// AI PANEL preset end-to-end, without a phone, Whisper or API keys: the host
// rests in the featured big tile, simulated raw-transcript segments close
// into a question, both models answer (canned — no keys) and their fake-TTS
// clips move the big tile OPUS → GPT → back to the host, with everyone on
// screen the whole time (no solo ever airs). A question asked while answers
// play parks as `pendingQuestion` and fires after. Needs the server started
// with OB_SIM=1 and OB_QUIZ_TTS_FAKE=1, plus the demo clips in
// data/mp4s/ob-demo/ (speaker.mp4, wide.mp4 — see scripts/lib/ob-api.mjs).
//
//   OB_SIM=1 OB_QUIZ_TTS_FAKE=1 pnpm start      # in one terminal
//   OB_API=http://localhost:3001 node scripts/ob-van-panel-check.mjs
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

const shotOf = (state) => state.program.shot;
const kindOf = (state) => shotOf(state)?.kind ?? 'none';

/** Shots seen while polling; a `solo` anywhere fails the run at the end. */
let sawSolo = null;

async function waitForShot(roomId, label, pred, timeoutMs = 25_000) {
  return waitFor(
    async () => {
      const state = await ob.state(roomId);
      const shot = shotOf(state);
      if (shot?.kind === 'solo' && !sawSolo)
        sawSolo = `${label}: ${JSON.stringify(shot)}`;
      return pred(shot, state) ? state : null;
    },
    { timeoutMs, label },
  );
}

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: 1280, height: 720 });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'AI PANEL CHECK',
      presetId: 'panel',
      audio: { mode: 'mix' },
      autoPilot: true,
      panel: { tts: true, auto: true },
    });
    const host = (
      await ob.mp4Cam(roomId, {
        role: 'speaker',
        fileName: 'ob-demo/speaker.mp4',
        name: 'HOST',
        talent: 'Piotr',
      })
    ).camId;
    const opus = (
      await ob.mp4Cam(roomId, {
        role: 'guest',
        fileName: 'ob-demo/wide.mp4',
        name: 'OPUS',
        talent: 'OPUS',
      })
    ).camId;
    const gpt = (
      await ob.mp4Cam(roomId, {
        role: 'guest',
        fileName: 'ob-demo/wide.mp4',
        name: 'GPT',
        talent: 'GPT',
      })
    ).camId;
    await ob.sync(roomId, 0);
    await sleep(1000);
    await ob.control(roomId, 'go_live');
    log('on air, waiting for the host-rest featured…');

    const rest = await waitForShot(
      roomId,
      'host featured at rest',
      (s) => s?.kind === 'featured' && s.main === host,
    );
    check(true, `host rests in the big tile (${JSON.stringify(shotOf(rest))})`);
    const panel0 = rest.panel;
    check(panel0 !== null && panel0 !== undefined, 'panel state is exposed');
    check(
      panel0?.speakers.length === 2,
      'both AI panelists seated',
      JSON.stringify(panel0?.speakers.map((s) => s.model)),
    );

    log('host asks (two raw segments)…');
    await ob.simulate(roomId, host, {
      kind: 'raw-transcript',
      text: 'What do you two think',
      airInMs: 2500,
      durationMs: 1500,
    });
    await ob.simulate(roomId, host, {
      kind: 'raw-transcript',
      text: 'about the future of live television?',
      airInMs: 4000,
      durationMs: 1500,
    });

    const thinking = await waitFor(
      async () => {
        const state = await ob.state(roomId);
        return state.panel?.phase !== 'idle' ? state : null;
      },
      { timeoutMs: 10_000, label: 'panel leaves idle' },
    );
    check(true, `turn closed (phase ${thinking.panel.phase})`);
    check(
      thinking.panel.question?.includes('future of live television'),
      'segments joined into one question',
      thinking.panel.question ?? '(none)',
    );

    const opusUp = await waitForShot(
      roomId,
      'OPUS featured',
      (s) => s?.kind === 'featured' && s.main === opus,
      30_000,
    );
    check(true, 'first answer moves the big tile to OPUS');
    check(
      opusUp.panel?.speakers.find((s) => s.model === 'opus')?.status ===
        'speaking',
      'OPUS marked speaking',
    );

    log('second question while OPUS talks…');
    await ob.simulate(roomId, host, {
      kind: 'raw-transcript',
      text: 'And a follow-up: will AI replace camera operators?',
      durationMs: 1500,
    });
    const parked = await waitFor(
      async () => {
        const state = await ob.state(roomId);
        return state.panel?.pendingQuestion ? state : null;
      },
      { timeoutMs: 10_000, label: 'pending question parked' },
    );
    check(
      parked.panel.pendingQuestion.includes('camera operators'),
      'mid-answer question parked as pending',
    );

    await waitForShot(
      roomId,
      'GPT featured',
      (s) => s?.kind === 'featured' && s.main === gpt,
      40_000,
    );
    check(true, 'second answer moves the big tile to GPT');

    const followUp = await waitFor(
      async () => {
        const state = await ob.state(roomId);
        return state.panel?.question?.includes('camera operators')
          ? state
          : null;
      },
      { timeoutMs: 40_000, label: 'pending question asked' },
    );
    check(true, `pending question fired (phase ${followUp.panel.phase})`);

    // The follow-up runs its own two answers; ride it out back to the host.
    await waitForShot(
      roomId,
      'host featured again',
      (s, state) =>
        s?.kind === 'featured' &&
        s.main === host &&
        state.panel?.phase === 'idle',
      90_000,
    );
    check(true, 'panel idle, host back in the big tile');

    check(sawSolo === null, 'no solo ever aired', sawSolo ?? '');
    const state = await ob.state(roomId);
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
