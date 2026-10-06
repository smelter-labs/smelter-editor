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
// Usage: node scripts/smelterionaire-show.mjs [--fake] [--only 03-q1]
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
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FONTS_DIR, SERVER_DIR, ffmpeg, probe, writeWav } from './lib/ob-media.mjs';

const PKG_DIR = path.resolve(SERVER_DIR, '..', 'packages', 'smelterionaire-fake-v2');
const OUT_DIR = path.join(SERVER_DIR, 'data', 'smelterionaire-show');
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
  joanna: 'g7LVvkPWALzPxOQbF6OE', // Jade
};

// Host lines verbatim from server/src/obVan/llm/quizHost.ts pools, so the
// fake sounds like the live show (rules intro, Jev jokes and the quips are
// custom). Two rounds: Q1-Q4 then Q5-Q7 (Joanna leaves on her Q3).
const LINES = {
  'host-intro': ['host', 'Welcome to Smelterionaire — four minds, a million tokens each, zero mercy.'],
  'host-rules': ['host', 'The rules: every right answer multiplies your pot by one and a half. Every wrong one — half of it goes up the chimney. Two rounds, four contestants, and you can cash out and walk whenever you like. Let’s meet them.'],
  'host-meet-opus': ['host', 'At desk one — OPUS. Writes poetry about monorepos, favors long walks through the documentation.'],
  'host-meet-gpt': ['host', 'Desk two — GPT. The enthusiasm of a golden retriever, the confidence of… well, a GPT.'],
  'host-meet-joanna': ['host', 'Desk three — Joanna. Our first human contestant. Says she is, quote, just here to look around.'],
  'host-meet-jev': ['host', 'And desk four — JEV. Zero words so far, and somehow the crowd favorite.'],
  'host-board': ['host', 'Four answers on the board. Only one pays.'],
  'host-filler': ['host', 'Take your time — the clock is only a metaphor.'],
  'host-jev-joke1': ['host', 'Don’t wait for a quip. JEV doesn’t talk — JEV computes.'],
  'host-jev-joke2': ['host', 'Still not a single word from JEV all evening. Honestly? I respect it.'],
  'host-assign1': ['host', 'Question 1 — OPUS, the spotlight is yours.'],
  'host-reveal1': ['host', 'Correct! OPUS climbs to 1,500,000 TOK.'],
  'host-assign2': ['host', 'GPT, step up. Question 2, for the money.'],
  'host-reveal2': ['host', 'Wrong! GPT, that answer just cost you. 500,000 TOK left.'],
  'host-assign3': ['host', 'Question 3 — Joanna, the spotlight is yours.'],
  'host-cashout': ['host', 'And Joanna cashes out 1,000,000 TOK without answering a single question. Security!'],
  'host-assign4': ['host', 'JEV, step up. Question 4, for the money.'],
  'host-reveal4': ['host', 'That’s the one — JEV is sitting on 1,500,000 TOK.'],
  'host-assign5': ['host', 'Round two! Question 5 — OPUS, the spotlight is yours.'],
  'host-reveal5': ['host', 'Correct! OPUS climbs to 2,250,000 TOK.'],
  'host-assign6': ['host', 'GPT, step up. Question 6, redemption time.'],
  'host-reveal6': ['host', 'That’s the one — GPT is sitting on 750,000 TOK.'],
  'host-assign7': ['host', 'Question 7 — JEV, the spotlight is yours.'],
  'host-reveal7': ['host', 'Oh no. The pot shrinks — JEV is down to 750,000 TOK.'],
  'host-wrap': ['host', 'That’s the game — OPUS leads with 2,250,000 TOK. Smelterionaire, out.'],
  'opus-murmur': ['opus', 'Hmm. Let me compose myself.'],
  'opus-quip': ['opus', 'Software Mansion. I practically live in their monorepo.'],
  'opus-murmur2': ['opus', 'Fascinating. Give me a moment.'],
  'opus-quip2': ['opus', 'Web wasm. The whole compositor in a browser tab — my kind of party trick.'],
  'gpt-murmur': ['gpt', 'Okay okay okay — thinking!'],
  'gpt-quip': ['gpt', 'GLSL, obviously. Shaders have been GLSL since before I was trained. Final answer!'],
  'gpt-murmur2': ['gpt', 'Love it. Running the numbers!'],
  'gpt-quip2': ['gpt', 'Fit! The default is fit — I actually read the docs this time!'],
  'joanna-farewell': ['joanna', 'I know nothing about Smelter. But I’m taking the million tokens — I have my own app to build. Goodbye!'],
};

// Questions verbatim from server/src/obVan/quizQuestionsSmelter.ts.
// The host reads each question + all four answers after the board lands
// (that reading time is, theoretically, when the agents think).
const QUESTIONS = {
  s01: {
    q: 'Who builds Smelter?',
    answers: ['Software Mansion', 'Smelting Industries', 'The WebRTC WG', 'A Twitch mod team'],
    correct: 'A',
  },
  s02: {
    q: 'How do you describe a Smelter scene in the TypeScript SDK?',
    answers: ['YAML manifests', 'React components', 'SQL queries', 'Hand-written H.264'],
    correct: 'B',
  },
  s03: {
    q: 'What language are Smelter shaders written in?',
    answers: ['GLSL', 'HLSL', 'WGSL', 'CUDA'],
    correct: 'C',
  },
  s07: {
    q: 'Which runtime package runs Smelter with no server at all, in the browser?',
    answers: ['@swmansion/smelter-node', '@swmansion/smelter-web-client', '@swmansion/smelter-web-wasm', '@swmansion/smelter-edge'],
    correct: 'C',
  },
  s08: {
    q: "What is Rescaler's default rescaleMode?",
    answers: ['fill', 'stretch', 'crop', 'fit'],
    correct: 'D',
  },
  s09: {
    q: 'In live processing, Smelter keeps the pipeline synchronized to…',
    answers: ['The wall clock', 'The GPU clock', 'The fastest input', 'NTP only'],
    correct: 'A',
  },
  s29: {
    q: 'Which output serves one composed program to MANY WebRTC viewers?',
    answers: ['whip_client', 'rtp_stream', 'whep_server', 'canvas'],
    correct: 'C',
  },
};

// Joanna (a human walk-in, not a model) takes lux — the pink-haired puppet —
// and JEV moves to prof; no shared studio view, so no host puppet at all.
// Board read-outs, synthesized per question (underscores spoken as spaces,
// npm scopes dropped so the host does not read "at swmansion slash").
for (const [qid, question] of Object.entries(QUESTIONS)) {
  const answers = question.answers
    .map((a, i) => `${'ABCD'[i]} — ${a.replace(/@swmansion\//g, '').replace(/_/g, ' ')}.`)
    .join(' ');
  LINES[`host-read-${qid}`] = ['host', `${question.q} ${answers}`];
}

const PLAYER_ORDER = ['OPUS', 'GPT', 'Joanna', 'JEV'];
const PLAYER_CHARACTER = { OPUS: 'nova', GPT: 'bit', Joanna: 'lux', JEV: 'prof' };

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
  // v2 draws the puppets as inline SVG — no sprite PNGs to copy.
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

// Per-voice ElevenLabs voice_settings (host tuned to the user's dashboard:
// speed ~1.09, stability 0.5, similarity 0.75, style 0.45, speaker boost).
const VOICE_SETTINGS = {
  host: {
    speed: 1.09,
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.45,
    use_speaker_boost: true,
  },
};

async function synthLine(apiKey, voiceKey, text) {
  const voice = opt.fake ? 'fake' : VOICES[voiceKey];
  const settings = VOICE_SETTINGS[voiceKey] ?? null;
  // Settings are part of the cache key — retuned voices re-synth cleanly.
  const hash = sha1(`${voice}|${settings ? JSON.stringify(settings) : ''}|${text}`);
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
        body: JSON.stringify({
          text,
          model_id: 'eleven_flash_v2_5',
          ...(settings ? { voice_settings: settings } : {}),
        }),
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

/** Multiviewer cam list in rail order; `dimmed` = cashed-out tiles. */
const camsFor = (dimmedNames = []) =>
  PLAYER_ORDER.map((name) => ({
    character: PLAYER_CHARACTER[name],
    name,
    dimmed: dimmedNames.includes(name) || undefined,
    // Joanna is a real person: her cam is a live-footage placeholder.
    placeholder: name === 'Joanna' || undefined,
  }));

/** The host's own cam — always a live-footage placeholder. */
const HOST_CAM = { character: 'host', name: 'HOST', placeholder: true };

const PUNCH_S = 0.7; // keep in sync with PUNCH_S in src/puppet.tsx

/**
 * Shared opening of every beat: the 2×2 grid with the assign line over it,
 * punch-in to the contestant, board sting + fade, host reads the question.
 * Returns the cue times the rest of the beat continues from.
 */
function beatOpening(tts, { assignKey, qid, hostPlates, guides, audio }) {
  const dur = (k) => tts[k].durS;
  const assignAtS = 0.8; // grid tiles stagger in first
  const assignUntil = assignAtS + dur(assignKey) + 0.6;
  hostPlates.push({ text: LINES[assignKey][1], atS: assignAtS, untilS: assignUntil });
  guides.push({ key: assignKey, atS: assignAtS });
  const punchAtS = round1(assignUntil - 0.2);
  const boardAtS = round1(punchAtS + PUNCH_S + 0.5);
  audio.push({ wav: stingWav('board'), atS: boardAtS - 0.15 });
  // The host reads the question and all four answers (guide on A2) — the
  // agents' "thinking time". The plate shows just the question; the board
  // already carries the answers.
  const readKey = `host-read-${qid}`;
  const readAtS = boardAtS + 0.8;
  const readEndS = readAtS + dur(readKey);
  hostPlates.push({ text: QUESTIONS[qid].q, atS: readAtS, untilS: readEndS + 0.4 });
  guides.push({ key: readKey, atS: readAtS });
  return { punchAtS, boardAtS, readEndS };
}

function questionBeat(tts, cfg) {
  const { number, name, qid, pick, verdict, confidence, assignKey, revealKey, murmurKey, quipKey, withBoardLine, fillerKey, amounts, cashed } = cfg;
  const character = PLAYER_CHARACTER[name];
  const question = QUESTIONS[qid];
  const dur = (k) => tts[k].durS;
  const hostPlates = [];
  const guides = [];
  const speech = [];
  const audio = [];

  const { punchAtS, boardAtS, readEndS } = beatOpening(tts, { assignKey, qid, hostPlates, guides, audio });
  let cursor = readEndS;
  if (withBoardLine) {
    const atS = readEndS + 0.5;
    hostPlates.push({ text: LINES['host-board'][1], atS, untilS: atS + dur('host-board') + 0.5 });
    guides.push({ key: 'host-board', atS });
    cursor = atS + dur('host-board');
  }
  const thinkingFromS = round1(cursor + 0.4);
  let murmurEnd = thinkingFromS + 1.2;
  if (murmurKey) {
    const startS = thinkingFromS + 0.4;
    speech.push({ character, startS, durS: dur(murmurKey), mouth: tts[murmurKey].mouth });
    audio.push({ wav: tts[murmurKey].wav, atS: startS });
    murmurEnd = startS + dur(murmurKey);
  }
  let fillerUntil = murmurEnd;
  if (fillerKey) {
    const atS = murmurEnd + 1.0;
    fillerUntil = atS + dur(fillerKey) + 0.8;
    hostPlates.push({ text: LINES[fillerKey][1], atS, untilS: fillerUntil });
    guides.push({ key: fillerKey, atS });
  }
  const lockAtS = round1(Math.max(thinkingFromS + 3.5, fillerUntil + 0.6, murmurEnd + 1.6));
  let revealAtS;
  if (quipKey) {
    const startS = lockAtS + 0.25;
    speech.push({ character, startS, durS: dur(quipKey), mouth: tts[quipKey].mouth });
    audio.push({ wav: tts[quipKey].wav, atS: startS });
    revealAtS = round1(startS + dur(quipKey) + 0.9);
  } else {
    revealAtS = round1(lockAtS + 3.2); // Jev: time to read the typed-decision plate
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
    cams: camsFor(Object.keys(cashed)),
    hostPlates,
    speech,
    punchAtS,
    boardAtS,
    thinkingFromS,
    lockAtS,
    revealAtS,
  };
  return { props, audio, guides, amountAfter };
}

/** Joanna's beat: assigned, board read, and instead of an answer — goodbye. */
function cashOutBeat(tts, cfg) {
  const { number, name, qid, assignKey, farewellKey, amounts } = cfg;
  const character = PLAYER_CHARACTER[name];
  const question = QUESTIONS[qid];
  const dur = (k) => tts[k].durS;
  const hostPlates = [];
  const guides = [];
  const speech = [];
  const audio = [];

  const { punchAtS, boardAtS, readEndS } = beatOpening(tts, { assignKey, qid, hostPlates, guides, audio });
  const farewellAtS = round1(readEndS + 0.9);
  // Joanna gets replaced by the real person, so — like the host — her line is
  // a guide on A2, not baked into the clip; the puppet stays as a stand-in
  // (mouth still animates so the preview reads right).
  speech.push({ character, startS: farewellAtS, durS: dur(farewellKey), mouth: tts[farewellKey].mouth });
  guides.push({ key: farewellKey, atS: farewellAtS });
  const walkAtS = round1(farewellAtS + dur(farewellKey) + 0.7);
  audio.push({ wav: stingWav('lose'), atS: walkAtS });
  const cashPlateAtS = walkAtS + 0.5;
  hostPlates.push({
    text: LINES['host-cashout'][1],
    atS: cashPlateAtS,
    untilS: cashPlateAtS + dur('host-cashout') + 1.4,
  });
  guides.push({ key: 'host-cashout', atS: cashPlateAtS });
  const durationS = round1(Math.max(walkAtS + 5.0, cashPlateAtS + dur('host-cashout') + 1.8));

  const props = {
    durationS,
    character,
    playerName: name,
    number,
    q: question.q,
    answers: question.answers,
    players: railPlayers(amounts, { active: name, cashed: { [name]: walkAtS } }),
    cams: camsFor(),
    hostPlates,
    speech,
    punchAtS,
    boardAtS,
    walkAtS,
    standInFromS: round1(punchAtS + PUNCH_S),
    placeholderSolo: true,
  };
  return { props, audio, guides };
}

const round1 = (v) => Math.round(v * 10) / 10;
const stingWav = (kind) => path.join(AUDIO_DIR, 'stings', `${kind}.wav`);

function buildEpisode(tts) {
  const amounts = { OPUS: 1_000_000, GPT: 1_000_000, Joanna: 1_000_000, JEV: 1_000_000 };
  const segments = [];
  const dur = (k) => tts[k].durS;

  // 01 — intro: sting + logo splash (title card, no studio wide).
  segments.push({
    name: '01-intro',
    comp: 'Intro',
    props: {
      durationS: 7.5,
      players: railPlayers(amounts),
      railAtS: 2.8,
    },
    audio: [{ wav: stingWav('intro'), atS: 0.3 }],
    guides: [],
  });

  // 02 — host cold open + the rules (slate; both lines on the A2 guide).
  segments.push({
    name: '02-host-intro',
    comp: 'HostSlate',
    props: {
      durationS: round1(dur('host-intro') + dur('host-rules') + 3.0),
      beat: 'Cold open + rules',
      lines: [LINES['host-intro'][1], LINES['host-rules'][1]],
      note: 'BEAT 02 · INTRO',
    },
    audio: [],
    guides: [
      { key: 'host-intro', atS: 0.8 },
      { key: 'host-rules', atS: round1(0.8 + dur('host-intro') + 0.6) },
    ],
  });

  // 03 — meet the cast: the tally walks the multiviewer as the host
  // introduces each contestant (guide lines on A2).
  const meetIntros = [];
  const meetPlates = [];
  const meetGuides = [];
  let meetCursor = 1.0;
  for (const [name, key] of [
    ['OPUS', 'host-meet-opus'],
    ['GPT', 'host-meet-gpt'],
    ['Joanna', 'host-meet-joanna'],
    ['JEV', 'host-meet-jev'],
  ]) {
    const untilS = round1(meetCursor + dur(key) + 0.7);
    meetIntros.push({ name, atS: meetCursor, untilS });
    meetPlates.push({ text: LINES[key][1], atS: meetCursor, untilS });
    meetGuides.push({ key, atS: meetCursor });
    meetCursor = round1(untilS + 0.3);
  }
  segments.push({
    name: '03-meet-cast',
    comp: 'MeetCast',
    props: {
      durationS: round1(meetCursor + 0.6),
      players: railPlayers(amounts),
      cams: camsFor(),
      intros: meetIntros,
      hostPlates: meetPlates,
      hostCam: HOST_CAM,
    },
    audio: [{ wav: stingWav('board'), atS: 0.3 }],
    guides: meetGuides,
  });

  // Round 1 ────────────────────────────────────────────────────────────────
  const q1 = questionBeat(tts, {
    number: 1, name: 'OPUS', qid: 's01', pick: 'A', verdict: 'correct',
    confidence: null, assignKey: 'host-assign1', revealKey: 'host-reveal1',
    murmurKey: 'opus-murmur', quipKey: 'opus-quip',
    withBoardLine: true, fillerKey: 'host-filler', amounts: { ...amounts }, cashed: {},
  });
  segments.push({ name: '04-q1-opus', comp: 'QuestionBeat', ...q1 });
  amounts.OPUS = q1.amountAfter;

  const q2 = questionBeat(tts, {
    number: 2, name: 'GPT', qid: 's03', pick: 'A', verdict: 'wrong',
    confidence: null, assignKey: 'host-assign2', revealKey: 'host-reveal2',
    murmurKey: 'gpt-murmur', quipKey: 'gpt-quip',
    withBoardLine: false, fillerKey: null, amounts: { ...amounts }, cashed: {},
  });
  segments.push({ name: '05-q2-gpt', comp: 'QuestionBeat', ...q2 });
  amounts.GPT = q2.amountAfter;

  // Q3 — Joanna gets her question, and answers with a goodbye.
  const q3 = cashOutBeat(tts, {
    number: 3, name: 'Joanna', qid: 's02',
    assignKey: 'host-assign3', farewellKey: 'joanna-farewell',
    amounts: { ...amounts },
  });
  segments.push({ name: '06-q3-joanna', comp: 'CashOutCameo', ...q3 });

  const q4 = questionBeat(tts, {
    number: 4, name: 'JEV', qid: 's29', pick: 'C', verdict: 'correct',
    confidence: 0.87, assignKey: 'host-assign4', revealKey: 'host-reveal4',
    murmurKey: null, quipKey: null,
    withBoardLine: false, fillerKey: 'host-jev-joke1', amounts: { ...amounts },
    cashed: { Joanna: 0 },
  });
  segments.push({ name: '07-q4-jev', comp: 'QuestionBeat', ...q4 });
  amounts.JEV = q4.amountAfter;

  // Round 2 ────────────────────────────────────────────────────────────────
  const q5 = questionBeat(tts, {
    number: 5, name: 'OPUS', qid: 's07', pick: 'C', verdict: 'correct',
    confidence: null, assignKey: 'host-assign5', revealKey: 'host-reveal5',
    murmurKey: 'opus-murmur2', quipKey: 'opus-quip2',
    withBoardLine: false, fillerKey: null, amounts: { ...amounts },
    cashed: { Joanna: 0 },
  });
  segments.push({ name: '08-q5-opus', comp: 'QuestionBeat', ...q5 });
  amounts.OPUS = q5.amountAfter;

  const q6 = questionBeat(tts, {
    number: 6, name: 'GPT', qid: 's08', pick: 'D', verdict: 'correct',
    confidence: null, assignKey: 'host-assign6', revealKey: 'host-reveal6',
    murmurKey: 'gpt-murmur2', quipKey: 'gpt-quip2',
    withBoardLine: false, fillerKey: null, amounts: { ...amounts },
    cashed: { Joanna: 0 },
  });
  segments.push({ name: '09-q6-gpt', comp: 'QuestionBeat', ...q6 });
  amounts.GPT = q6.amountAfter;

  // Q7 — JEV, 96% sure. Wrong. Still silent.
  const q7 = questionBeat(tts, {
    number: 7, name: 'JEV', qid: 's09', pick: 'B', verdict: 'wrong',
    confidence: 0.96, assignKey: 'host-assign7', revealKey: 'host-reveal7',
    murmurKey: null, quipKey: null,
    withBoardLine: false, fillerKey: 'host-jev-joke2', amounts: { ...amounts },
    cashed: { Joanna: 0 },
  });
  segments.push({ name: '10-q7-jev', comp: 'QuestionBeat', ...q7 });
  amounts.JEV = q7.amountAfter;

  // 10 — host wrap (slate).
  segments.push({
    name: '11-host-wrap',
    comp: 'HostSlate',
    props: {
      durationS: round1(dur('host-wrap') + 2.2),
      beat: 'Wrap',
      lines: [LINES['host-wrap'][1]],
      note: 'BEAT 11 · WRAP',
    },
    audio: [],
    guides: [{ key: 'host-wrap', atS: 0.8 }],
  });

  // 11 — wrap: the multiviewer with the final state + logo and confetti.
  segments.push({
    name: '12-wrap',
    comp: 'Wrap',
    props: {
      durationS: 9,
      players: railPlayers(amounts, { cashed: { Joanna: 0 } }),
      cams: camsFor(['Joanna']).map((c) => ({ ...c, cheer: c.name === 'OPUS' })),
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

/** Standalone placeholder clips for the live people — separate files on
 * their own Premiere tracks, swapped via "replace footage". */
const PLACEHOLDER_S = 36;

async function renderPlaceholderCam(name, file) {
  if (opt['skip-render'] && existsSync(file)) return;
  const propsFile = path.join(AUDIO_DIR, `placeholder-${path.basename(file)}.json`);
  writeFileSync(propsFile, JSON.stringify({ durationS: PLACEHOLDER_S, name }));
  await runRender(['render', 'src/index.ts', 'PlaceholderCam', file, `--props=${propsFile}`, '--codec=h264', '--muted']);
}

/** Transparent label clip (ProRes 4444) that rides above the real footage. */
async function renderNameOverlay(name, variant, file) {
  if (opt['skip-render'] && existsSync(file)) return;
  const propsFile = path.join(AUDIO_DIR, `overlay-${variant}-${path.basename(file)}.json`);
  writeFileSync(propsFile, JSON.stringify({ durationS: PLACEHOLDER_S, name, variant }));
  await runRender([
    'render', 'src/index.ts', 'NameOverlay', file, `--props=${propsFile}`,
    '--codec=prores', '--prores-profile=4444', '--pixel-format=yuva444p10le', '--image-format=png', '--muted',
  ]);
}

// ── Premiere project (FCP7 XML / xmeml v4) ────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pathUrl = (p) => `file://localhost${encodeURI(p).replace(/#/g, '%23')}`;
const RATE = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;

function fileXml(id, filePath, frames, { video, audio = true }) {
  return `<file id="${id}">
  <name>${esc(path.basename(filePath))}</name>
  <pathurl>${esc(pathUrl(filePath))}</pathurl>
  ${RATE}
  <duration>${frames}</duration>
  <media>
    ${video ? `<video><samplecharacteristics>${RATE}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>` : ''}
    ${audio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : ''}
  </media>
</file>`;
}

/** Basic Motion (scale % + centre in FCP7 canvas units, ±0.5 = frame edge). */
function motionFilter(scalePct, cH, cV) {
  return `<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>
  <parameter><parameterid>scale</parameterid><name>Scale</name><valuemin>0</valuemin><valuemax>1000</valuemax><value>${scalePct}</value></parameter>
  <parameter><parameterid>center</parameterid><name>Center</name><value><horiz>${cH}</horiz><vert>${cV}</vert></value></parameter>
</effect></filter>`;
}

function clipXml({ id, name, fileRef, fileFull, start, frames, mediatype, filterXml = '' }) {
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
  ${filterXml}
</clipitem>`;
}

function premiereXml(placed, guidePlacements, overlays) {
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
  const overlayTracks = [2, 3, 4].map((track) => {
    const seen = new Map();
    return overlays
      .filter((o) => o.track === track)
      .map((o, i) => {
        const frames = toF(o.durS);
        let fileFull = null;
        let fileRef = null;
        if (seen.has(o.file)) fileRef = seen.get(o.file);
        else {
          fileRef = `ofile-${track}-${seen.size + 1}`;
          seen.set(o.file, fileRef);
          fileFull = fileXml(fileRef, o.file, toF(36), { video: true, audio: false });
        }
        return clipXml({
          id: `clipitem-o${track}-${i + 1}`,
          name: o.name,
          fileRef: fileFull ? undefined : fileRef,
          fileFull,
          start: toF(o.atS),
          frames,
          mediatype: 'video',
          filterXml: o.scalePct === 100 ? '' : motionFilter(o.scalePct, o.cH, o.cV),
        });
      })
      .join('\n');
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
      <track>
${overlayTracks[0]}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
      <track>
${overlayTracks[1]}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
      <track>
${overlayTracks[2]}
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
  // The guide numbering shifts whenever the episode changes — rebuild the
  // folder from scratch so stale copies never ride along to the XML/Desktop.
  rmSync(GUIDE_DIR, { recursive: true, force: true });
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

  console.log('— placeholder cams');
  const hostCamFile = path.join(CLIPS_DIR, 'cam-host-placeholder.mp4');
  const joannaCamFile = path.join(CLIPS_DIR, 'cam-joanna-placeholder.mp4');
  await renderPlaceholderCam('HOST', hostCamFile);
  await renderPlaceholderCam('Joanna', joannaCamFile);
  const joannaTileLabel = path.join(CLIPS_DIR, 'overlay-joanna-tile.mov');
  const joannaSoloLabel = path.join(CLIPS_DIR, 'overlay-joanna-solo.mov');
  await renderNameOverlay('Joanna', 'tile', joannaTileLabel);
  await renderNameOverlay('Joanna', 'solo', joannaSoloLabel);

  // Overlay placements: Joanna on V2, the host on V3, pre-scaled into the
  // multiviewer tile rects with Basic Motion (Joanna = bottom-left quadrant).
  const QUAD = { scalePct: 48.5, cH: -0.25, cV: 0.25 };
  const overlays = [];
  for (const p of placed) {
    const t0 = p.startS;
    const FULL = { scalePct: 100, cH: 0, cV: 0 };
    if (p.comp === 'QuestionBeat' || p.comp === 'CashOutCameo') {
      const win = { atS: round1(t0 + 0.75), durS: round1(p.props.punchAtS - 0.75) };
      overlays.push({ track: 2, name: 'JOANNA cam', file: joannaCamFile, ...win, ...QUAD });
      // The name chip rides above her footage (the label is pre-positioned
      // for the bottom-left quadrant inside the transparent clip).
      overlays.push({ track: 4, name: 'JOANNA label', file: joannaTileLabel, ...win, ...FULL });
    }
    if (p.comp === 'CashOutCameo') {
      const win = {
        atS: round1(t0 + p.props.punchAtS + PUNCH_S),
        durS: round1(p.props.walkAtS - p.props.punchAtS - PUNCH_S),
      };
      overlays.push({ track: 2, name: 'JOANNA solo', file: joannaCamFile, ...win, ...FULL });
      overlays.push({ track: 4, name: 'JOANNA nameplate', file: joannaSoloLabel, ...win, ...FULL });
    }
    if (p.comp === 'MeetCast') {
      const win = { atS: round1(t0 + 0.75), durS: round1(p.durationS - 1.0) };
      overlays.push({ track: 2, name: 'JOANNA cam', file: joannaCamFile, ...win, ...QUAD });
      overlays.push({ track: 4, name: 'JOANNA label', file: joannaTileLabel, ...win, ...FULL });
      overlays.push({
        track: 3, name: 'HOST cam', file: hostCamFile,
        atS: round1(t0 + 1.0), durS: round1(p.durationS - 1.3),
        scalePct: 29, cH: 0, cV: 0,
      });
    }
    // Wrap: no overlay — Joanna's CASHED OUT tile is part of the gag.
  }

  console.log('— premiere xml');
  const xml = premiereXml(placed, guidePlacements, overlays);
  writeFileSync(path.join(OUT_DIR, 'smelterionaire.xml'), xml);

  console.log('— preview');
  await renderPreview(placed, guidePlacements);

  writeFileSync(
    path.join(OUT_DIR, 'README.txt'),
    [
      'SMELTERIONAIRE — fake episode (workshop)',
      '',
      'Premiere: File → Import → smelterionaire.xml (sekwencja 1080p30).',
      'V1/A1 = segmenty show; A2 = glosy-przewodniki (host + Joanna, ElevenLabs).',
      'Slate\'y "HOST SHOT" podmien na wlasne nagrania; kwestie hosta',
      'w srodku beatow (plansze MAX SMELTER) nagraj wg A2 i poloz na A1/A3.',
      'Ty i Joanna jestescie na OSOBNYCH plikach: V2 = cam-joanna-placeholder',
      '(kafelek gridu + jej solo w Q3), V3 = cam-host-placeholder (srodek',
      'meet-the-cast). Prawy klik na klipie -> Replace Footage / podmiana',
      'pliku w clips/ — transformy (skala/pozycja kafelka) zostaja.',
      'V4 = przezroczyste overlaye z imieniem JOANNA (chip kafelka + plakietka',
      'przy solo, ProRes 4444) — leza NAD jej materialem, wiec podpis zostaje',
      'po podmianie. Farewell Joanny na A2; tile CASHED OUT we wrapie w V1.',
      'Po przeniesieniu folderu Premiere zrobi relink do clips/.',
      '',
      `Total: ${Math.round(cursorS)}s, ${placed.length} segmentow.`,
      ...placed.map((p) => `  ${fmt(p.startS)}  ${p.name} (${Math.round(p.durationS)}s)`),
    ].join('\n'),
  );

  if (!opt['skip-desktop']) {
    const desktop = path.join(process.env.HOME ?? '~', 'Desktop', 'smelterionaire-show');
    console.log(`— copying to ${desktop}`);
    cpSync(OUT_DIR, desktop, { recursive: true });
  }
  console.log(`DONE ${OUT_DIR} (total ${fmt(cursorS)})`);
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

main().catch((err) => fail(err.stack ?? String(err)));
