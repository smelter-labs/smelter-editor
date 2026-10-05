#!/usr/bin/env node
// Smelterionaire — offline FAKE episode for the workshop.
//
// Renders the whole show as Remotion clips (packages/smelterionaire-fake),
// with real ElevenLabs voices for the contestants and HOST SLATE placeholder
// segments (plus a host guide-voice track) the presenter replaces with their
// own footage in Premiere. Emits:
//   server/data/smelterionaire-fake/clips/NN-name.mp4   — the show segments
//   server/data/smelterionaire-fake/audio/host-guide/   — guide WAVs (A2)
//   server/data/smelterionaire-fake/smelterionaire.xml  — Premiere (FCP7 XML)
//   server/data/smelterionaire-fake/preview.mp4         — watch without Premiere
//
// Usage: node scripts/smelterionaire-fake.mjs [--fake] [--only 03-q1]
//        [--skip-render] [--skip-desktop]
//   --fake         keyless run: syllable-tone TTS stand-ins (layout checks)
//   --only NAME    re-render just one segment (cache makes TTS free)
//   --skip-render  rebuild audio/XML/preview from existing clips
//   --skip-desktop don't copy the result folder to ~/Desktop
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FONTS_DIR, SERVER_DIR, ffmpeg, probe, writeWav } from './lib/ob-media.mjs';

const PKG_DIR = path.resolve(SERVER_DIR, '..', 'packages', 'smelterionaire-fake');
const OUT_DIR = path.join(SERVER_DIR, 'data', 'smelterionaire-fake');
const TTS_DIR = path.join(OUT_DIR, 'tts');
const CLIPS_DIR = path.join(OUT_DIR, 'clips');
const AUDIO_DIR = path.join(OUT_DIR, 'audio');
const GUIDE_DIR = path.join(AUDIO_DIR, 'host-guide');
const IMGS_DIR = path.join(SERVER_DIR, 'imgs', 'ob');
const SFX_DIR = path.join(SERVER_DIR, 'sfx');

const FPS = 30;
const TTS_SR = 24_000;
const MOUTH_RATE_HZ = 50;

const { values: opt } = parseArgs({
  options: {
    fake: { type: 'boolean', default: false },
    only: { type: 'string' },
    'skip-render': { type: 'boolean', default: false },
    'skip-desktop': { type: 'boolean', default: false },
  },
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ── Voices + episode script ───────────────────────────────────────────────

const VOICES = {
  host: process.env.OB_QUIZ_TTS_HOST_VOICE ?? '2E3fywgOSbUgLXqjR29C',
  opus: 'WQP7cQUF5aAS6Axh5yaa', // Elara
  gpt: 'FrS6cKLB1wg4WYgPa9GW', // Wyatt
  gemini: 'g7LVvkPWALzPxOQbF6OE', // Jade
};

// Host lines verbatim from server/src/obVan/llm/quizHost.ts pools, so the
// fake sounds like the live show. The wrap line is custom (tie).
const LINES = {
  'host-intro': ['host', 'Welcome to Smelterionaire — four minds, a million tokens each, zero mercy.'],
  'host-assign1': ['host', 'Question 1 — OPUS, the spotlight is yours.'],
  'host-board': ['host', 'Four answers on the board. Only one pays.'],
  'host-filler': ['host', 'Take your time — the clock is only a metaphor.'],
  'host-reveal1': ['host', 'Correct! OPUS climbs to 1,500,000 TOK.'],
  'host-assign2': ['host', 'GPT, step up. Question 2, for the money.'],
  'host-reveal2': ['host', 'Wrong! GPT, that answer just cost you. 500,000 TOK left.'],
  'host-cashout': ['host', 'And GEMINI cashes out 1,000,000 TOK without answering a thing. Security!'],
  'host-assign3': ['host', 'Question 3 — JEV, the spotlight is yours.'],
  'host-reveal3': ['host', 'That’s the one — JEV is sitting on 1,500,000 TOK.'],
  'host-wrap': ['host', 'That’s the game — OPUS and JEV share the lead at 1,500,000 TOK. Smelterionaire, out.'],
  'opus-murmur': ['opus', 'Hmm. Let me compose myself.'],
  'opus-quip': ['opus', 'Software Mansion. I practically live in their monorepo.'],
  'gpt-murmur': ['gpt', 'Okay okay okay — thinking!'],
  'gpt-quip': ['gpt', 'GLSL, obviously. Shaders have been GLSL since before I was trained. Final answer!'],
  'gemini-farewell': ['gemini', 'I have seen enough. I’m taking the million. Goodbye.'],
};

// Questions verbatim from server/src/obVan/quizQuestionsSmelter.ts.
const QUESTIONS = {
  s01: {
    q: 'Who builds Smelter?',
    answers: ['Software Mansion', 'Smelting Industries', 'The WebRTC WG', 'A Twitch mod team'],
    correct: 'A',
  },
  s03: {
    q: 'What language are Smelter shaders written in?',
    answers: ['GLSL', 'HLSL', 'WGSL', 'CUDA'],
    correct: 'C',
  },
  s29: {
    q: 'Which output serves one composed program to MANY WebRTC viewers?',
    answers: ['whip_client', 'rtp_stream', 'whep_server', 'canvas'],
    correct: 'C',
  },
};

const CAST = [
  { character: 'host', name: 'Max Smelter' },
  { character: 'nova', name: 'OPUS' },
  { character: 'bit', name: 'GPT' },
  { character: 'prof', name: 'GEMINI' },
  { character: 'lux', name: 'JEV' },
];
const PLAYER_ORDER = ['OPUS', 'GPT', 'GEMINI', 'JEV'];
const PLAYER_CHARACTER = { OPUS: 'nova', GPT: 'bit', GEMINI: 'prof', JEV: 'lux' };

// Voiced lengths of the stingers (the mp4s carry a 3 s silent pad after).
const STING_DUR = { intro: 2.4, board: 1.4, win: 1.8, lose: 1.8 };

// ── Asset prep (Remotion serves from the package's public/) ──────────────

const FONT_FILES = [
  ['big-shoulders', 'BigShouldersDisplay-Black.ttf'],
  ['big-shoulders', 'BigShouldersDisplay-ExtraBold.ttf'],
  ['big-shoulders', 'BigShouldersDisplay-Bold.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-Regular.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-Medium.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-SemiBold.ttf'],
];
const PLATE_FILES = [
  'ob-quiz-answer-idle', 'ob-quiz-answer-locked', 'ob-quiz-answer-correct',
  'ob-quiz-answer-wrong', 'ob-quiz-question-plate', 'ob-quiz-logo',
  'ob-quiz-logo-chip', 'ob-quiz-money-chip', 'ob-quiz-money-chip-active',
  'ob-quiz-hint-plate', 'ob-quiz-host-plate', 'ob-quiz-flash-win',
  'ob-quiz-flash-lose',
];

function prepAssets() {
  mkdirSync(path.join(PKG_DIR, 'public', 'fonts'), { recursive: true });
  for (const [dir, file] of FONT_FILES)
    copyFileSync(path.join(FONTS_DIR, dir, file), path.join(PKG_DIR, 'public', 'fonts', file));
  mkdirSync(path.join(PKG_DIR, 'public', 'plates'), { recursive: true });
  for (const name of PLATE_FILES) {
    // Live image ids are `ob-quiz-*`; the PNGs on disk are `quiz-*.png`.
    const src = path.join(IMGS_DIR, `${name.replace(/^ob-/, '')}.png`);
    copyFileSync(src, path.join(PKG_DIR, 'public', 'plates', `${name}.png`));
  }
  mkdirSync(path.join(PKG_DIR, 'public', 'puppets'), { recursive: true });
  for (const file of readdirSync(IMGS_DIR))
    if (file.startsWith('puppet-'))
      copyFileSync(path.join(IMGS_DIR, file), path.join(PKG_DIR, 'public', 'puppets', file));
}

// ── TTS (ElevenLabs flash, pcm_24000 → wav + 50 Hz mouth track) ───────────

function loadElevenKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = path.join(SERVER_DIR, '.env.local');
  if (!existsSync(envFile)) return null;
  const m = readFileSync(envFile, 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
  return m ? m[1].trim() : null;
}

/** 50 Hz RMS envelope, p95-of-voiced normalized (port of llm/tts.ts). */
function mouthTrack(pcm) {
  const win = Math.round(TTS_SR / MOUTH_RATE_HZ);
  const n = Math.floor(pcm.length / win);
  const rms = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * win; j < (i + 1) * win; j++) {
      const s = pcm[j] / 32768;
      sum += s * s;
    }
    rms[i] = Math.sqrt(sum / win);
  }
  let max = 0;
  for (const v of rms) if (v > max) max = v;
  if (max < 1e-3) return { rateHz: MOUTH_RATE_HZ, v: rms.map(() => 0) };
  const voiced = rms.filter((v) => v > max * 0.1).sort((a, b) => a - b);
  const norm = voiced[Math.floor(voiced.length * 0.95)] || max;
  return {
    rateHz: MOUTH_RATE_HZ,
    v: rms.map((v) => Math.round(Math.min(1, v / norm) * 1000) / 1000),
  };
}

function fakePcm(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const freq = 160 + (Math.abs(hash) % 120);
  const durS = Math.min(7, Math.max(1.2, 0.9 + text.length * 0.052));
  const pcm = new Int16Array(Math.round(TTS_SR * durS));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / TTS_SR;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * syllable * 12_000);
  }
  return pcm;
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

async function synthLine(apiKey, voiceKey, text) {
  const voice = opt.fake ? 'fake' : VOICES[voiceKey];
  const hash = sha1(`${voice}|${text}`);
  const wav = path.join(TTS_DIR, `${hash}.wav`);
  const sidecar = path.join(TTS_DIR, `${hash}.json`);
  if (existsSync(wav) && existsSync(sidecar)) {
    const meta = JSON.parse(readFileSync(sidecar, 'utf8'));
    return { wav, durS: meta.durationMs / 1000, mouth: meta.mouth };
  }
  let pcm;
  if (opt.fake) {
    pcm = fakePcm(text);
  } else {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voiceKey]}?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
      },
    );
    if (!res.ok) fail(`ElevenLabs ${res.status} for "${text.slice(0, 40)}…": ${(await res.text()).slice(0, 300)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  }
  const mouth = mouthTrack(pcm);
  const durationMs = Math.round((pcm.length / TTS_SR) * 1000);
  const floats = Float32Array.from(pcm, (v) => v / 32768);
  writeWav(wav, floats, TTS_SR);
  writeFileSync(sidecar, JSON.stringify({ durationMs, mouth, text, voiceKey }));
  console.log(`  tts ${voiceKey.padEnd(6)} ${(durationMs / 1000).toFixed(1)}s  "${text.slice(0, 56)}"`);
  return { wav, durS: durationMs / 1000, mouth };
}

async function synthAll() {
  mkdirSync(TTS_DIR, { recursive: true });
  const apiKey = opt.fake ? null : loadElevenKey();
  if (!opt.fake && !apiKey)
    fail('No ELEVENLABS_API_KEY in env or server/.env.local (or pass --fake).');
  const tts = {};
  for (const [key, [voiceKey, text]] of Object.entries(LINES))
    tts[key] = await synthLine(apiKey, voiceKey, text);
  return tts;
}

// ── Episode timeline ──────────────────────────────────────────────────────

const railPlayers = (amounts, { active = null, change = null, cashed = {} } = {}) =>
  PLAYER_ORDER.map((name) => ({
    name,
    amount: change?.name === name ? change.amount : amounts[name],
    amountFrom: amounts[name],
    changeAtS: change?.name === name ? change.atS : null,
    verdict: change?.name === name ? change.verdict : null,
    active: active === name,
    cashedOut: name in cashed,
    cashOutAtS: cashed[name],
  }));

function questionBeat(tts, cfg) {
  const { number, name, qid, pick, verdict, confidence, assignKey, revealKey, murmurKey, quipKey, withBoardLine, withFiller, amounts, cashed } = cfg;
  const character = PLAYER_CHARACTER[name];
  const question = QUESTIONS[qid];
  const dur = (k) => tts[k].durS;
  const hostPlates = [];
  const guides = [];
  const speech = [];
  const audio = [];

  const assignAtS = 0.6;
  const assignUntil = assignAtS + dur(assignKey) + 0.8;
  hostPlates.push({ text: LINES[assignKey][1], atS: assignAtS, untilS: assignUntil });
  guides.push({ key: assignKey, atS: assignAtS });

  const boardAtS = assignUntil + 0.4;
  audio.push({ wav: stingWav('board'), atS: boardAtS - 0.15 });
  let cursor = boardAtS;
  if (withBoardLine) {
    const atS = boardAtS + 0.4;
    hostPlates.push({ text: LINES['host-board'][1], atS, untilS: atS + dur('host-board') + 0.6 });
    guides.push({ key: 'host-board', atS });
    cursor = atS + dur('host-board');
  }
  const thinkingFromS = boardAtS + 1.0;
  let murmurEnd = thinkingFromS + 1.2;
  if (murmurKey) {
    const startS = Math.max(thinkingFromS + 0.3, cursor + 0.3);
    speech.push({ character, startS, durS: dur(murmurKey), mouth: tts[murmurKey].mouth });
    audio.push({ wav: tts[murmurKey].wav, atS: startS });
    murmurEnd = startS + dur(murmurKey);
  }
  let fillerUntil = murmurEnd;
  if (withFiller) {
    const atS = murmurEnd + 1.0;
    fillerUntil = atS + dur('host-filler') + 0.8;
    hostPlates.push({ text: LINES['host-filler'][1], atS, untilS: fillerUntil });
    guides.push({ key: 'host-filler', atS });
  }
  const lockAtS = Math.max(thinkingFromS + 5.0, fillerUntil + 0.6, murmurEnd + 1.6);
  let revealAtS;
  if (quipKey) {
    const startS = lockAtS + 0.25;
    speech.push({ character, startS, durS: dur(quipKey), mouth: tts[quipKey].mouth });
    audio.push({ wav: tts[quipKey].wav, atS: startS });
    revealAtS = startS + dur(quipKey) + 0.9;
  } else {
    revealAtS = lockAtS + 3.2; // Jev: time to read the typed-decision plate
  }
  audio.push({ wav: stingWav(verdict === 'correct' ? 'win' : 'lose'), atS: revealAtS - 0.05 });
  const revealPlateAtS = revealAtS + 0.6;
  hostPlates.push({ text: LINES[revealKey][1], atS: revealPlateAtS, untilS: revealPlateAtS + dur(revealKey) + 1.2 });
  guides.push({ key: revealKey, atS: revealPlateAtS });
  const durationS = round1(revealAtS + (verdict === 'correct' ? 6.5 : 5.0));

  const amountAfter = Math.round(amounts[name] * (verdict === 'correct' ? 1.5 : 0.5));
  const props = {
    durationS,
    character,
    playerName: name,
    model: name.toLowerCase(),
    number,
    q: question.q,
    answers: question.answers,
    correct: question.correct,
    pick,
    verdict,
    confidence,
    quip: quipKey ? LINES[quipKey][1] : null,
    players: railPlayers(amounts, {
      active: name,
      change: { name, amount: amountAfter, atS: revealAtS, verdict },
      cashed,
    }),
    hostPlates,
    speech,
    boardAtS,
    thinkingFromS,
    lockAtS,
    revealAtS,
  };
  return { props, audio, guides, amountAfter };
}

const round1 = (v) => Math.round(v * 10) / 10;
const stingWav = (kind) => path.join(AUDIO_DIR, 'stings', `${kind}.wav`);

function buildEpisode(tts) {
  const amounts = { OPUS: 1_000_000, GPT: 1_000_000, GEMINI: 1_000_000, JEV: 1_000_000 };
  const segments = [];
  const dur = (k) => tts[k].durS;

  // 01 — intro: sting + logo splash over the studio wide.
  segments.push({
    name: '01-intro',
    comp: 'Intro',
    props: {
      durationS: 7.5,
      cast: CAST,
      players: railPlayers(amounts),
      railAtS: 2.8,
    },
    audio: [{ wav: stingWav('intro'), atS: 0.3 }],
    guides: [],
  });

  // 02 — host cold open (slate; guide voice on A2).
  segments.push({
    name: '02-host-intro',
    comp: 'HostSlate',
    props: {
      durationS: round1(dur('host-intro') + 2.2),
      beat: 'Cold open',
      line: LINES['host-intro'][1],
      note: 'BEAT 02 · INTRO',
    },
    audio: [],
    guides: [{ key: 'host-intro', atS: 0.8 }],
  });

  // 03 — Q1: OPUS, correct.
  const q1 = questionBeat(tts, {
    number: 1, name: 'OPUS', qid: 's01', pick: 'A', verdict: 'correct',
    confidence: null, assignKey: 'host-assign1', revealKey: 'host-reveal1',
    murmurKey: 'opus-murmur', quipKey: 'opus-quip',
    withBoardLine: true, withFiller: true, amounts: { ...amounts }, cashed: {},
  });
  segments.push({ name: '03-q1-opus', comp: 'QuestionBeat', ...q1 });
  amounts.OPUS = q1.amountAfter;

  // 04 — Q2: GPT, wrong (GLSL with full confidence).
  const q2 = questionBeat(tts, {
    number: 2, name: 'GPT', qid: 's03', pick: 'A', verdict: 'wrong',
    confidence: null, assignKey: 'host-assign2', revealKey: 'host-reveal2',
    murmurKey: 'gpt-murmur', quipKey: 'gpt-quip',
    withBoardLine: false, withFiller: false, amounts: { ...amounts }, cashed: {},
  });
  segments.push({ name: '04-q2-gpt', comp: 'QuestionBeat', ...q2 });
  amounts.GPT = q2.amountAfter;

  // 05 — the GEMINI cameo: farewell, walks with the million.
  const farewellAtS = 1.2;
  const walkAtS = farewellAtS + dur('gemini-farewell') + 0.7;
  const cashPlateAtS = walkAtS + 0.5;
  segments.push({
    name: '05-cashout-gemini',
    comp: 'CashOutCameo',
    props: {
      durationS: round1(Math.max(walkAtS + 5.2, cashPlateAtS + dur('host-cashout') + 1.6)),
      character: 'prof',
      playerName: 'GEMINI',
      players: railPlayers(amounts, { active: 'GEMINI', cashed: { GEMINI: walkAtS } }),
      hostPlates: [{
        text: LINES['host-cashout'][1],
        atS: cashPlateAtS,
        untilS: cashPlateAtS + dur('host-cashout') + 1.4,
      }],
      speech: [{ character: 'prof', startS: farewellAtS, durS: dur('gemini-farewell'), mouth: tts['gemini-farewell'].mouth }],
      walkAtS,
    },
    audio: [
      { wav: tts['gemini-farewell'].wav, atS: farewellAtS },
      { wav: stingWav('lose'), atS: walkAtS },
    ],
    guides: [{ key: 'host-cashout', atS: cashPlateAtS }],
  });

  // 06 — Q3: JEV, correct, 87% sure, never says a word.
  const q3 = questionBeat(tts, {
    number: 3, name: 'JEV', qid: 's29', pick: 'C', verdict: 'correct',
    confidence: 0.87, assignKey: 'host-assign3', revealKey: 'host-reveal3',
    murmurKey: null, quipKey: null,
    withBoardLine: false, withFiller: false, amounts: { ...amounts },
    cashed: { GEMINI: 0 },
  });
  segments.push({ name: '06-q3-jev', comp: 'QuestionBeat', ...q3 });
  amounts.JEV = q3.amountAfter;

  // 07 — host wrap (slate).
  segments.push({
    name: '07-host-wrap',
    comp: 'HostSlate',
    props: {
      durationS: round1(dur('host-wrap') + 2.2),
      beat: 'Wrap',
      line: LINES['host-wrap'][1],
      note: 'BEAT 07 · WRAP',
    },
    audio: [],
    guides: [{ key: 'host-wrap', atS: 0.8 }],
  });

  // 08 — wrap: final rail, winners cheer, logo.
  segments.push({
    name: '08-wrap',
    comp: 'Wrap',
    props: {
      durationS: 9,
      cast: CAST,
      players: railPlayers(amounts, { cashed: { GEMINI: 0 } }),
      cheerNames: ['OPUS', 'JEV'],
    },
    audio: [{ wav: stingWav('intro'), atS: 0.3 }],
    guides: [],
  });

  return segments;
}

// ── Audio: stings, per-segment mixes, guide WAVs ──────────────────────────

async function extractStings() {
  mkdirSync(path.join(AUDIO_DIR, 'stings'), { recursive: true });
  for (const [kind, durS] of Object.entries(STING_DUR)) {
    await ffmpeg([
      '-i', path.join(SFX_DIR, `quiz-sting-${kind}.mp4`),
      '-t', String(durS + 0.4), '-ac', '2', '-ar', '48000',
      stingWav(kind),
    ]);
  }
}

async function mixSegmentAudio(seg) {
  const out = path.join(AUDIO_DIR, `${seg.name}.wav`);
  if (seg.audio.length === 0) {
    await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(seg.props.durationS), out]);
    return out;
  }
  const args = [];
  const chains = [];
  seg.audio.forEach((cue, i) => {
    args.push('-i', cue.wav);
    const ms = Math.max(0, Math.round(cue.atS * 1000));
    chains.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[a${i}]`);
  });
  const amix = `${seg.audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${seg.audio.length}:normalize=0,apad[mix]`;
  await ffmpeg([
    ...args,
    '-filter_complex', `${chains.join(';')};${amix}`,
    '-map', '[mix]', '-t', String(seg.props.durationS), '-ar', '48000', '-ac', '2',
    out,
  ]);
  return out;
}

// ── Remotion render + mux ─────────────────────────────────────────────────

function runRender(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'remotion', ...args], {
      cwd: PKG_DIR,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`remotion exited ${code}`)),
    );
  });
}

async function renderSegment(seg, audioWav) {
  const propsFile = path.join(AUDIO_DIR, `${seg.name}.props.json`);
  writeFileSync(propsFile, JSON.stringify(seg.props));
  const silent = path.join(AUDIO_DIR, `${seg.name}.silent.mp4`);
  await runRender(['render', 'src/index.ts', seg.comp, silent, `--props=${propsFile}`, '--codec=h264', '--muted']);
  const out = path.join(CLIPS_DIR, `${seg.name}.mp4`);
  await ffmpeg([
    '-i', silent, '-i', audioWav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', out,
  ]);
  return out;
}

// ── Premiere project (FCP7 XML / xmeml v4) ────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pathUrl = (p) => `file://localhost${encodeURI(p).replace(/#/g, '%23')}`;
const RATE = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;

function fileXml(id, filePath, frames, { video }) {
  return `<file id="${id}">
  <name>${esc(path.basename(filePath))}</name>
  <pathurl>${esc(pathUrl(filePath))}</pathurl>
  ${RATE}
  <duration>${frames}</duration>
  <media>
    ${video ? `<video><samplecharacteristics>${RATE}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>` : ''}
    <audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>
  </media>
</file>`;
}

function clipXml({ id, name, fileRef, fileFull, start, frames, mediatype }) {
  return `<clipitem id="${id}">
  <name>${esc(name)}</name>
  <enabled>TRUE</enabled>
  <duration>${frames}</duration>
  ${RATE}
  <start>${start}</start>
  <end>${start + frames}</end>
  <in>0</in>
  <out>${frames}</out>
  ${fileFull ?? `<file id="${fileRef}"/>`}
  <sourcetrack><mediatype>${mediatype}</mediatype><trackindex>1</trackindex></sourcetrack>
</clipitem>`;
}

function premiereXml(placed, guidePlacements) {
  const toF = (s) => Math.round(s * FPS);
  let total = 0;
  const videoClips = [];
  const audioClips = [];
  const markers = [];
  const files = new Map();
  placed.forEach((p, i) => {
    const frames = toF(p.durationS);
    const fid = `file-${i + 1}`;
    files.set(fid, fileXml(fid, p.clip, frames, { video: true }));
    videoClips.push(clipXml({ id: `clipitem-v${i + 1}`, name: p.name, fileFull: files.get(fid), start: toF(p.startS), frames, mediatype: 'video' }));
    audioClips.push(clipXml({ id: `clipitem-a${i + 1}`, name: p.name, fileRef: fid, start: toF(p.startS), frames, mediatype: 'audio' }));
    markers.push(`<marker><comment>${esc(p.comp)}</comment><name>${esc(p.name)}</name><in>${toF(p.startS)}</in><out>-1</out></marker>`);
    total = Math.max(total, toF(p.startS) + frames);
  });
  const guideClips = guidePlacements.map((g, i) => {
    const frames = toF(g.durS);
    const fid = `gfile-${i + 1}`;
    return clipXml({
      id: `clipitem-g${i + 1}`,
      name: g.name,
      fileFull: fileXml(fid, g.wav, frames, { video: false }),
      start: toF(g.atS),
      frames,
      mediatype: 'audio',
    });
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
  <name>SMELTERIONAIRE FAKE</name>
  <duration>${total}</duration>
  ${RATE}
  <media>
    <video>
      <format><samplecharacteristics>${RATE}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
      <track>
${videoClips.join('\n')}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
    </video>
    <audio>
      <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
      <track>
${audioClips.join('\n')}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
      <track>
${guideClips.join('\n')}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
    </audio>
  </media>
  <timecode>${RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
${markers.join('\n')}
</sequence>
</xmeml>
`;
}

// ── Preview (concat + quiet guide mix) ────────────────────────────────────

async function renderPreview(placed, guidePlacements) {
  const listFile = path.join(AUDIO_DIR, 'concat.txt');
  writeFileSync(listFile, placed.map((p) => `file '${p.clip}'`).join('\n'));
  const noGuide = path.join(AUDIO_DIR, 'preview-noguide.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', noGuide]);
  const out = path.join(OUT_DIR, 'preview.mp4');
  if (guidePlacements.length === 0) {
    copyFileSync(noGuide, out);
    return out;
  }
  const args = ['-i', noGuide];
  const chains = [];
  guidePlacements.forEach((g, i) => {
    args.push('-i', g.wav);
    const ms = Math.round(g.atS * 1000);
    chains.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.25,adelay=${ms}|${ms}[g${i}]`);
  });
  const amix = `[0:a]${guidePlacements.map((_, i) => `[g${i}]`).join('')}amix=inputs=${guidePlacements.length + 1}:normalize=0[mix]`;
  await ffmpeg([
    ...args,
    '-filter_complex', `${chains.join(';')};${amix}`,
    '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    out,
  ]);
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(path.join(PKG_DIR, 'node_modules')))
    fail('packages/smelterionaire-fake has no node_modules — run `pnpm install --ignore-workspace` there first.');
  for (const dir of [OUT_DIR, TTS_DIR, CLIPS_DIR, AUDIO_DIR, GUIDE_DIR]) mkdirSync(dir, { recursive: true });

  console.log('— assets');
  prepAssets();
  await extractStings();

  console.log('— tts');
  const tts = await synthAll();

  const segments = buildEpisode(tts);

  console.log('— segments');
  const placed = [];
  let cursorS = 0;
  const guidePlacements = [];
  for (const seg of segments) {
    const clip = path.join(CLIPS_DIR, `${seg.name}.mp4`);
    const skip = opt['skip-render'] || (opt.only && seg.name !== opt.only && existsSync(clip));
    if (!skip) {
      const audioWav = await mixSegmentAudio(seg);
      console.log(`  render ${seg.name} (${seg.props.durationS}s)`);
      await renderSegment(seg, audioWav);
    }
    if (!existsSync(clip)) fail(`missing clip ${clip}`);
    const info = await probe(clip);
    const durationS = Number(info.format.duration);
    placed.push({ ...seg, clip, startS: cursorS, durationS });
    for (const g of seg.guides) {
      const idx = guidePlacements.length + 1;
      const wav = path.join(GUIDE_DIR, `${String(idx).padStart(2, '0')}-${g.key}.wav`);
      copyFileSync(tts[g.key].wav, wav);
      guidePlacements.push({ name: g.key, wav, atS: cursorS + g.atS, durS: tts[g.key].durS });
    }
    cursorS += durationS;
  }

  console.log('— premiere xml');
  const xml = premiereXml(placed, guidePlacements);
  writeFileSync(path.join(OUT_DIR, 'smelterionaire.xml'), xml);

  console.log('— preview');
  await renderPreview(placed, guidePlacements);

  writeFileSync(
    path.join(OUT_DIR, 'README.txt'),
    [
      'SMELTERIONAIRE — fake episode (workshop)',
      '',
      'Premiere: File → Import → smelterionaire.xml (sekwencja 1080p30).',
      'V1/A1 = segmenty show; A2 = glos-przewodnik hosta (ElevenLabs).',
      'Slate\'y "HOST SHOT" (02, 07) podmien na wlasne nagrania; kwestie',
      'hosta w srodku beatow (plansze MAX SMELTER) nagraj wg A2 i poloz',
      'na A1/A3. Po przeniesieniu folderu Premiere zrobi relink do clips/.',
      '',
      `Total: ${Math.round(cursorS)}s, ${placed.length} segmentow.`,
      ...placed.map((p) => `  ${fmt(p.startS)}  ${p.name} (${Math.round(p.durationS)}s)`),
    ].join('\n'),
  );

  if (!opt['skip-desktop']) {
    const desktop = path.join(process.env.HOME ?? '~', 'Desktop', 'smelterionaire-fake');
    console.log(`— copying to ${desktop}`);
    cpSync(OUT_DIR, desktop, { recursive: true });
  }
  console.log(`DONE ${OUT_DIR} (total ${fmt(cursorS)})`);
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

main().catch((err) => fail(err.stack ?? String(err)));
