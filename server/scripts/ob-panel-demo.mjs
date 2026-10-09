#!/usr/bin/env node
/**
 * Build the "AI PANEL" QUICK DEMO dataset — a live human host (WHIP phone,
 * role `speaker`, joins AFTER the demo loads) plus two AI panelists (OPUS /
 * GPT) as puppet cams on silent carriers. The host asks questions out loud;
 * Whisper closes the turn, both models answer via TTS, and the `panel`
 * preset keeps everyone on screen with the speaker in the big tile.
 *
 *   node scripts/ob-panel-demo.mjs
 *
 * cams.json arms everything up front: preset `panel`, `captions: true`
 * (applied BEFORE any cam attaches, so the phone that joins later gets the
 * 8 s transcription side channel at register time — publish the phone only
 * after loading the demo), audio mix (featured strips are silent in
 * `follow` mode), autoPilot, panel.tts + panel.auto. No mouth.json — the
 * puppets lip-sync the live TTS clips.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MP4_DIR, ffmpeg } from './lib/ob-media.mjs';

// NOT `ob-demo/panel` — that directory is the Workshop #5 "panel with
// myself" TALK demo (conductor takes + timing.json).
const OUT = path.join(MP4_DIR, 'ob-demo', 'ai-panel');
/** One shared loop length; nothing is timed to it, so any length works. */
const DUR_S = 180;

const CAMS = [
  { file: 'nova.mp4', role: 'guest', name: 'OPUS', talent: 'OPUS', subtitle: 'Anthropic', puppet: 'nova' },
  { file: 'bit.mp4', role: 'guest', name: 'GPT', talent: 'GPT', subtitle: 'OpenAI', puppet: 'bit' },
];

mkdirSync(OUT, { recursive: true });

// Same encode as ob-quiz-ai-demo.mjs; digital silence so `mix` stacks nothing.
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
      eventName: 'AI PANEL',
      presetId: 'panel',
      // Applied before cams attach — the live host's phone (joining later as
      // role `speaker`) registers straight onto the 8 s captions channel.
      captions: true,
      audio: { mode: 'mix' },
      brief: '',
      config: {
        subtitles: true,
        autoPilot: true,
        panel: { tts: true, auto: true },
      },
      rundown: [
        { title: 'INTRO', note: 'host joins by phone, opens the panel' },
        { title: 'QUESTIONS', note: 'host asks, OPUS and GPT answer in turn' },
        { title: 'WRAP', note: 'host closes' },
      ],
      cams: CAMS,
    },
    null,
    2,
  ),
);
console.log(
  `done → ${OUT} (${CAMS.length} puppet cams, ${DUR_S}s silent loop; the host joins live by phone as SPEAKER)`,
);
