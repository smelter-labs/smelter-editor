#!/usr/bin/env node
// AI PANEL voice + captions live check: a simulated host question (OB_SIM
// raw-transcript) makes the panelists answer; the program is a SILENT cam
// (wide.mp4, −91 dB), so any sound in the recording is the ElevenLabs TTS
// mixed in through the HUD audio keeper. Captions are verified on frames:
// the subtitle bar darkens the bottom strip of the solo tile and paints
// white text. Needs ELEVENLABS_API_KEY in the server env.
//
//   OB_API=http://localhost:3121 node scripts/ob-van-panel-voice-check.mjs

import { execFileSync } from 'node:child_process';
import {
  API,
  api,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  sleep,
} from './lib/ob-api.mjs';

const W = 1280;
const H = 720;
// Subtitle text rows on a full-frame tile (the panel desk is dark, so the
// caption reads as a jump in near-white pixels, not as a darkened strip).
const STRIP = { x: 80, y: 585, w: 1120, h: 70 };
const QUESTION =
  'What is the most exciting thing about artificial intelligence on live television?';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

function frameStats(file, t) {
  const buf = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (buf.length < W * H * 3) return null;
  let luma = 0;
  let bright = 0;
  let n = 0;
  for (let y = STRIP.y; y < STRIP.y + STRIP.h; y++) {
    for (let x = STRIP.x; x < STRIP.x + STRIP.w; x++) {
      const i = (y * W + x) * 3;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      luma += 0.3 * r + 0.59 * g + 0.11 * b;
      if (r > 225 && g > 225 && b > 225) bright++;
      n++;
    }
  }
  return { luma: luma / n, bright };
}

/** mean/max volume (dB) of a time window — ffmpeg volumedetect on stderr. */
function volumeOf(file, fromS, durS) {
  const text = String(
    execFileSync(
      'sh',
      [
        '-c',
        `ffmpeg -ss ${fromS} -t ${durS} -i '${file}' -af volumedetect -f null - 2>&1`,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  const mean = text.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const max = text.match(/max_volume:\s*(-?[\d.]+) dB/);
  return {
    mean: mean ? Number(mean[1]) : null,
    max: max ? Number(max[1]) : null,
  };
}

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: W, height: H });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'Panel Voice Check',
      presetId: 'panel',
      transition: { type: 'cut', durationMs: 0 },
      panel: { tts: true, auto: true },
      subtitles: true,
    });
    const host = await ob.mp4Cam(roomId, {
      role: 'speaker',
      fileName: 'ob-demo/speaker.mp4',
      name: 'Host',
      talent: 'Host',
    });
    const opus = await ob.mp4Cam(roomId, {
      role: 'guest',
      fileName: 'ob-demo/wide.mp4',
      name: 'OPUS',
      talent: 'OPUS',
    });
    await ob.mp4Cam(roomId, {
      role: 'guest',
      fileName: 'ob-demo/wide.mp4',
      name: 'GPT',
      talent: 'GPT',
    });
    await ob.sync(roomId, 60_000);
    await ob.control(roomId, 'go_live');
    await ob.operate(roomId, { op: 'auto', enabled: false });
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: opus.camId },
      mode: 'cut',
    });
    await sleep(3_000);

    await api('POST', `/room/${roomId}/record/start`, {});
    const t0 = Date.now();
    const rel = () => (Date.now() - t0) / 1000;

    // Poll the panel state while the answers play out.
    const phases = [];
    const spoke = new Map(); // model -> {from, to, lastText}
    let polling = true;
    const poller = (async () => {
      while (polling) {
        const s = await ob.state(roomId).catch(() => null);
        const p = s?.panel;
        if (p) {
          if (phases.at(-1)?.phase !== p.phase)
            phases.push({ phase: p.phase, t: rel() });
          for (const sp of p.speakers ?? []) {
            const rec = spoke.get(sp.model) ?? {
              from: null,
              to: null,
              lastText: null,
            };
            if (sp.status === 'speaking') {
              rec.from = rec.from ?? rel();
              rec.to = rel();
            }
            if (sp.lastText) rec.lastText = sp.lastText;
            spoke.set(sp.model, rec);
          }
        }
        await sleep(400);
      }
    })();

    await sleep(1_000);
    await ob.simulate(roomId, host.camId, {
      kind: 'raw-transcript',
      text: QUESTION,
      airInMs: 2_000,
      durationMs: 1_500,
    });
    log('question injected');

    // Wait for the discussion to finish (idle after having been busy).
    const deadline = t0 + 75_000;
    let busySeen = false;
    for (;;) {
      const s = await ob.state(roomId).catch(() => null);
      const phase = s?.panel?.phase ?? 'idle';
      if (phase !== 'idle') busySeen = true;
      if (busySeen && phase === 'idle') break;
      if (Date.now() > deadline) break;
      await sleep(500);
    }
    await sleep(2_500); // caption clear + audio tail
    polling = false;
    await poller;
    const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
    const file = `data/recordings/${stopped.fileName}`;
    log('recording', file, 'phases', JSON.stringify(phases));

    check(busySeen, 'panel left idle (answers ran)');
    const opusSpoke = spoke.get('opus');
    const gptSpoke = spoke.get('gpt');
    check(
      !!opusSpoke?.lastText,
      'OPUS produced a line',
      opusSpoke?.lastText ?? '',
    );
    check(
      opusSpoke?.from != null || gptSpoke?.from != null,
      'a panelist reached speaking',
    );

    // Audio: the program cam is silent, so voice = TTS reaching the mix.
    const base = volumeOf(file, 0, 2.5);
    const windows = [opusSpoke, gptSpoke].filter((s) => s?.from != null);
    let voiced = { mean: null, max: -99 };
    for (const [i, w] of windows.entries()) {
      const v = volumeOf(
        file,
        Math.max(0, w.from - 0.5),
        Math.max(1.5, w.to - w.from + 1),
      );
      log(
        `speech window ${w.from?.toFixed(1)}–${w.to?.toFixed(1)}s`,
        JSON.stringify(v),
      );
      if (v.max != null && v.max > voiced.max) voiced = v;
      // A single-slot HUD keeper used to cut the FIRST clip when the second
      // registered mid-play: the voice then covered only part of its window
      // (mean ≈ −43 dB vs ≈ −27 dB healthy). Every line must fill its own.
      check(
        v.mean != null && v.mean > -38,
        `line ${i + 1} voice spans its whole window`,
        `mean ${v.mean} dB`,
      );
    }
    log('baseline 0–2.5s', JSON.stringify(base));
    check(
      base.max == null || base.max < -50,
      'program is silent before the answers',
      `max ${base.max}`,
    );
    check(
      voiced.max != null && voiced.max > -30,
      'TTS voice is audible in the mix',
      `max ${voiced.max} dB`,
    );

    // Captions: white caption text on the on-air tile is a clear jump in
    // bright pixels over the desk's own labels. Only the ON-AIR speaker's
    // caption is visible (the program is pinned to the OPUS cam here).
    const baseline = frameStats(file, 2.0);
    let captioned = null;
    const dur = Math.min(70, (Date.now() - t0) / 1000);
    for (let t = 4; t < dur - 1; t += 1) {
      const s = frameStats(file, t);
      if (!s || !baseline) continue;
      if (s.bright > baseline.bright + 800) {
        captioned = { t, ...s };
        break;
      }
    }
    const last = frameStats(file, dur - 0.8);
    log(
      'caption baseline',
      JSON.stringify(baseline),
      'hit',
      JSON.stringify(captioned),
      'final',
      JSON.stringify(last),
    );
    check(!!captioned, 'caption text appears on the on-air tile');
    check(
      !!last && !!baseline && last.bright < baseline.bright + 800,
      'caption clears after the line',
    );
    console.log(JSON.stringify({ file, phases, captioned }));
  } finally {
    await deleteRoom(roomId);
  }
  if (failureCount() > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
