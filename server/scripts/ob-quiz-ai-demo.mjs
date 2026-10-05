#!/usr/bin/env node
/**
 * Build the "SMELTERIONAIRE · AI" QUICK DEMO dataset — four AI models
 * (OPUS / GPT / GEMINI / JEV) as contestants, answering live on Smelter
 * questions; the puppets paint the picture, the carriers are silent.
 *
 *   node scripts/ob-quiz-ai-demo.mjs
 *
 * Unlike ob-quiz-demo.mjs there is no conductor and no TTS: every carrier
 * mp4 is black video + digital silence (same length, so the OB file cams
 * loop together), and there is no mouth.json — the voices are text plates
 * on the HUD for now. cams.json arms the quiz AI itself: bank 'smelter',
 * aiHost, auto round, autoPilot. The contestant↔model mapping is the talent
 * name (obQuizModelFromName), the puppet mapping is `puppet` per cam.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MP4_DIR, ffmpeg } from './lib/ob-media.mjs';

const OUT = path.join(MP4_DIR, 'ob-demo', 'quiz-ai');
/** One shared loop length; nothing is timed to it, so any length works. */
const DUR_S = 180;

const CAMS = [
  { file: 'host.mp4', role: 'speaker', name: 'HOST', talent: 'Max Smelter', subtitle: 'your host', puppet: 'host' },
  { file: 'nova.mp4', role: 'guest', name: 'OPUS', talent: 'OPUS', subtitle: 'Anthropic', puppet: 'nova' },
  { file: 'bit.mp4', role: 'guest', name: 'GPT', talent: 'GPT', subtitle: 'OpenAI', puppet: 'bit' },
  { file: 'prof.mp4', role: 'guest', name: 'GEMINI', talent: 'GEMINI', subtitle: 'Google', puppet: 'prof' },
  { file: 'lux.mp4', role: 'guest', name: 'JEV', talent: 'JEV', subtitle: 'TypeSafe AI', puppet: 'lux' },
  { file: 'wide.mp4', role: 'wide', name: 'STUDIO', talent: null, subtitle: 'the studio', puppet: 'studio' },
];

mkdirSync(OUT, { recursive: true });

// Same encode as ob-quiz-demo.mjs; digital silence so `mix` stacks nothing.
const VIDEO = [
  '-f', 'lavfi', '-i', `color=c=#05070f:s=1920x1080:r=10:d=${DUR_S}`,
];
const SILENCE = [
  '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${DUR_S}`,
];
const ENCODE = [
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
  '-pix_fmt', 'yuv420p', '-g', '60',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  '-t', String(DUR_S),
  '-movflags', '+faststart', '-video_track_timescale', '90000',
];

// One silent carrier, copied per cam name (identical content is fine — the
// clip is only the cam's clock; the puppet renderer paints the picture).
const first = path.join(OUT, CAMS[0].file);
await ffmpeg([...VIDEO, ...SILENCE, ...ENCODE, '-y', first]);
for (const cam of CAMS.slice(1)) {
  await ffmpeg(['-i', first, '-c', 'copy', '-y', path.join(OUT, cam.file)]);
  console.log(`built ${cam.file} (${cam.name})`);
}

writeFileSync(
  path.join(OUT, 'cams.json'),
  JSON.stringify(
    {
      eventName: 'SMELTERIONAIRE · AI',
      presetId: 'quiz',
      captions: false,
      audio: { mode: 'mix' },
      brief: '',
      // The whole show runs itself: AI contestants, AI host, auto round.
      config: {
        subtitles: false,
        autoPilot: true,
        quiz: { bank: 'smelter', aiHost: true, auto: true, tts: true },
      },
      rundown: [
        { title: 'INTRO', note: 'host opens, splash up' },
        { title: 'ROUNDS', note: 'models answer in turn' },
        { title: 'WRAP', note: 'leader announced' },
      ],
      cams: CAMS,
    },
    null,
    2,
  ),
);
console.log(`done → ${OUT} (${CAMS.length} cams, ${DUR_S}s silent loop)`);
