#!/usr/bin/env node
// OB Van demo footage — conductor track for a one-person, multi-take shoot.
//
// One actor plays every panelist: each persona is a separate take, recorded
// while the actor hears a shared "conductor" in one earbud — the other
// personas' lines as TTS, a pip before each of their own lines, and a
// count-in to a CLAP beat that every take claps on (the sync point
// ob-prep-takes.mjs looks for). Every take has the same timing, so the
// prepped clips play back through OB Van file cams as one live panel.
//
//   node scripts/ob-conductor.mjs scripts/ob-demo/panel.conductor.txt [--out <dir>] [--mock]
//
// Writes into --out (default data/ob-demo-raw/<name>/):
//   <name>.full.wav         everyone's lines (rehearsal, timing check)
//   <name>.<persona>.wav    per persona: the others' lines + a pip before yours
//   <name>.onair.*.wav      stand-in room audio (clap + own lines; wide = clap only —
//                           mix mode would double every voice) — the soundtrack of
//                           ob-fake-takes.mjs renders
//   <name>.prompter.html    teleprompter playing a persona track (keep it next to the wavs)
//   <name>.cue.md           cue sheet
//   <name>.timing.json      timeline for ob-prep-takes.mjs / ob-demo-run.mjs
//   <name>.slides.mp4       when the script has SLIDE events (already aligned to show time)
//   mock/                   with --mock: synthetic raw takes (close + wide per persona,
//                           random lead-in, clap, TTS as the actor) to dry-run the pipeline
//
// Script format — one event per line, ` #` starts a comment:
//   @title   Should AI direct live TV?
//   @persona HOST voice="Daniel" role=speaker talent="Piotr · the host" subtitle="THE ANCHOR" color=#F2B134
//   @rate 175       TTS words per minute
//   @stretch 1.15   a line's slot = TTS length × stretch (people speak slower than `say`)
//   @clap 10        track time of the CLAP beat ("one, two, three" ticks before it)
//   @start 2        prepped clips start this long after the clap (the clap never airs)
//   @tail 12        silence after the last line. Keep ≥ side-channel delay + 1 s (8 s with
//                   captions): the last `delay` seconds of a looping file cam never air
//   @gap 0.35       default gap before a relative line
//   @slides <dir>   base dir of SLIDE images, relative to server/ (default: the script's dir)
//
//   [time] WHO [~dur] text   time = `mm:ss.s` (show time) or `+gap` after the previous line
//                            ends (`+` = @gap, `+-0.4` overlaps it; no time = `+`).
//                            WHO = a persona or ALL (everyone performs it). `(…)` / `[…]`
//                            are stage directions (shown, not spoken); `~dur` fixes the slot.
//   [time] SLIDE file.png    slide change (no time = when the next line starts)
//   [time] SEGMENT Title     rundown segment for the title bug (no time = next line)
//
// Show time 0 = the first frame of every prepped clip = clap + @start.
// TTS renders are cached in <out>/.tts: re-running after a script edit only
// moves what the edit moved. Record every take against one render.
// The last stdout line is a JSON summary.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  FONTS_DIR,
  RAW_DIR,
  SERVER_DIR,
  SR,
  ffmpeg,
  fmtTime,
  mixInto,
  parseTime,
  peakOf,
  pool,
  resolveCli,
  sayPcm,
  sayVoices,
  tone,
  writeWav,
} from './lib/ob-media.mjs';

const PALETTE = [
  '#F2B134',
  '#38BDF8',
  '#F472B6',
  '#22C55E',
  '#A78BFA',
  '#FB923C',
];
const FALLBACK_VOICES = ['Daniel', 'Karen', 'Rishi', 'Moira', 'Fred', 'Kathy'];
const PIP_LEAD_S = 0.35;

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    mock: { type: 'boolean', default: false },
    'keep-work': { type: 'boolean', default: false },
  },
});

function fail(msg) {
  console.error(`ob-conductor: ${msg}`);
  process.exit(1);
}

// ── Script parsing ─────────────────────────────────────────────────────────

const EVENT_RE =
  /^(?:(\d+:\d{1,2}(?:\.\d+)?)|(\+)(-?\d*\.?\d+)?)?\s*([A-Za-z][\w-]*)\s*(?:~(\d*\.?\d+)\s*)?(.*)$/;

function parseScript(text) {
  const cfg = {
    title: '',
    rate: 175,
    stretch: 1.15,
    clap: 10,
    start: 2,
    tail: 12,
    gap: 0.35,
    slides: null,
  };
  const personas = new Map();
  const events = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) return;
    const dir = /^@(\w+)\s*(.*)$/.exec(line);
    if (dir) {
      const [, key, rest] = dir;
      if (key === 'persona') {
        const m = /^(\S+)\s*(.*)$/.exec(rest);
        if (!m) return errors.push(`line ${lineNo}: @persona needs a name`);
        const p = {
          key: m[1].toUpperCase(),
          voice: null,
          role: null,
          talent: null,
          subtitle: null,
          color: null,
        };
        for (const kv of m[2].matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
          const k = kv[1];
          if (k in p && k !== 'key') p[k] = kv[2] ?? kv[3];
          else errors.push(`line ${lineNo}: unknown @persona field ${k}`);
        }
        if (['ALL', 'SLIDE', 'SEGMENT'].includes(p.key))
          errors.push(`line ${lineNo}: ${p.key} is reserved`);
        personas.set(p.key, p);
      } else if (key === 'title' || key === 'slides') {
        cfg[key] = rest.trim();
      } else if (key in cfg) {
        const v = Number(rest);
        if (!Number.isFinite(v))
          errors.push(`line ${lineNo}: @${key} needs a number`);
        else cfg[key] = v;
      } else errors.push(`line ${lineNo}: unknown directive @${key}`);
      return;
    }
    const m = EVENT_RE.exec(line);
    if (!m) return errors.push(`line ${lineNo}: cannot parse "${line}"`);
    const [, abs, plus, gap, whoRaw, dur, rest] = m;
    const who = whoRaw.toUpperCase();
    const ev = {
      lineNo,
      who,
      kind:
        who === 'SLIDE'
          ? 'slide'
          : who === 'SEGMENT'
            ? 'segment'
            : who === 'ALL'
              ? 'all'
              : 'line',
      text: rest.trim(),
      abs: abs ? parseTime(abs) : null,
      plus: Boolean(plus),
      gap: gap !== undefined ? Number(gap) : null,
      dur: dur !== undefined ? Number(dur) : null,
    };
    if (ev.kind === 'line' && !personas.has(who))
      errors.push(
        `line ${lineNo}: unknown persona ${whoRaw} (declare it with @persona first)`,
      );
    if ((ev.kind === 'slide' || ev.kind === 'segment') && !ev.text)
      errors.push(
        `line ${lineNo}: ${who} needs ${who === 'SLIDE' ? 'a file' : 'a title'}`,
      );
    events.push(ev);
  });
  if (personas.size === 0) errors.push('no @persona declared');
  if (cfg.clap < 6.5)
    errors.push('@clap must be ≥ 6.5 s (room for the count-in)');
  if (cfg.start < 0) errors.push('@start must be ≥ 0');
  return { cfg, personas: [...personas.values()], events, errors };
}

/** Spoken part of a line: stage directions `(…)` / `[…]` removed. */
const spokenOf = (text) =>
  text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Timeline in show time; needs each line's TTS length (`ttsS`). */
function layout(cfg, events) {
  const warnings = [];
  let cursor = 0;
  const pending = [];
  const lastEnd = new Map();
  for (const ev of events) {
    if (ev.kind === 'slide' || ev.kind === 'segment') {
      if (ev.abs != null) ev.startS = ev.abs;
      else if (ev.plus) ev.startS = cursor + (ev.gap ?? cfg.gap);
      else pending.push(ev);
      continue;
    }
    const start = ev.abs != null ? ev.abs : cursor + (ev.gap ?? cfg.gap);
    const tts = ev.ttsS ?? 0;
    const slot =
      ev.dur ?? (tts > 0 ? Math.max(tts * cfg.stretch, tts + 0.3) : 1.5);
    ev.startS = round3(Math.max(0, start));
    ev.endS = round3(ev.startS + slot);
    for (const mk of pending.splice(0)) mk.startS = ev.startS;
    const performers = ev.kind === 'all' ? ['ALL'] : [ev.who];
    for (const who of performers) {
      const prev = lastEnd.get(who);
      if (prev != null && ev.startS < prev - 0.05)
        warnings.push(
          `line ${ev.lineNo}: ${who} starts at ${fmtTime(ev.startS)} before their previous line ends (${fmtTime(prev)})`,
        );
      lastEnd.set(who, ev.endS);
    }
    if (start < 0)
      warnings.push(`line ${ev.lineNo}: starts before show time 0 — clamped`);
    cursor = ev.endS;
  }
  for (const mk of pending) mk.startS = round3(cursor);
  const lastS = Math.max(0, ...events.map((e) => e.endS ?? e.startS ?? 0));
  return { durationS: round3(lastS + cfg.tail), warnings };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

// ── Rendering ──────────────────────────────────────────────────────────────

function normalise(pcm, peak = 0.6) {
  const p = peakOf(pcm);
  if (p > 0) for (let i = 0; i < pcm.length; i++) pcm[i] *= peak / p;
  return pcm;
}

function whiteNoise(n, amp, seed = 1) {
  const out = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = amp * ((s >>> 0) / 0xffffffff - 0.5) * 2;
  }
  return out;
}

/** A hand clap: 25 ms of decaying noise. */
function clapSound(seed) {
  const n = Math.round(0.025 * SR);
  const out = whiteNoise(n, 0.9, seed);
  for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / (0.006 * SR));
  return out;
}

/** A thud like pressing record on a phone: short low sine burst. */
function thud() {
  const n = Math.round(0.08 * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++)
    out[i] =
      0.35 * Math.exp(-i / (0.02 * SR)) * Math.sin((2 * Math.PI * 70 * i) / SR);
  return out;
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function cueSheet(name, cfg, personas, events, durationS) {
  const rows = events
    .filter((e) => e.kind !== 'slide')
    .map((e) => {
      if (e.kind === 'segment')
        return `| ${fmtTime(e.startS)} | | **— ${e.text} —** | | |`;
      const track = cfg.clap + cfg.start + e.startS;
      return `| ${fmtTime(e.startS)} | ${fmtTime(track)} | ${e.who} | ${e.text.replace(/\|/g, '\\|')} | ${(e.endS - e.startS).toFixed(1)} s |`;
    });
  const slides = events
    .filter((e) => e.kind === 'slide')
    .map((e) => `- ${fmtTime(e.startS)} → ${e.text}`)
    .join('\n');
  const who = personas
    .map((p) => {
      const lines = events.filter((e) => e.who === p.key);
      const talk = lines.reduce((s, e) => s + (e.endS - e.startS), 0);
      return `- **${p.key}** — ${p.talent ?? '(no talent)'}, role \`${p.role ?? '?'}\`, voice ${p.voice}: ${lines.length} lines, ~${talk.toFixed(0)} s`;
    })
    .join('\n');
  return `# ${cfg.title || name} — cue sheet

Show length **${fmtTime(durationS)}** (tail ${cfg.tail} s). Clap on the 4th beat at track ${fmtTime(cfg.clap)};
show time 0 = clap + ${cfg.start} s = track ${fmtTime(cfg.clap + cfg.start)}.

${who}

**Every take:** lock exposure / focus / white balance, start the phones, then play your
persona's track (\`${name}.<persona>.wav\`, or the prompter). Clap on "four". Be seated and
silent by show time 0. Say only your own lines — you hear the others in the earbud and react
silently. \`ALL\` rows are for everyone. Stay still until "cut" (the tail must be quiet).
With the fake wide: keep your hands inside your seat's column.

| show | track | who | line | slot |
|---|---|---|---|---|
${rows.join('\n')}
${slides ? `\n**Slides**\n\n${slides}\n` : ''}`;
}

function prompterHtml(name, cfg, personas, events, files) {
  const data = {
    title: cfg.title || name,
    clapTrackS: cfg.clap,
    showStartTrackS: cfg.clap + cfg.start,
    personas: personas.map((p) => ({
      key: p.key,
      color: p.color,
      talent: p.talent,
    })),
    files,
    events: events
      .filter(
        (e) => e.kind === 'line' || e.kind === 'all' || e.kind === 'segment',
      )
      .map((e) => ({
        kind: e.kind,
        who: e.who,
        text: e.text,
        startS: e.startS,
        endS: e.endS ?? e.startS,
      })),
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(data.title)} — prompter</title>
<style>
:root{--bg:#0A0C10;--ink:#F2F4F8;--dim:rgba(242,244,248,.45);--rule:rgba(242,244,248,.14);--red:#FF2D2D}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:16px/1.3 ui-monospace,Menlo,monospace}
body{display:flex;flex-direction:column}
header{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--rule);flex-wrap:wrap}
header button{background:transparent;color:var(--ink);border:1px solid var(--rule);padding:6px 12px;font:inherit;cursor:pointer;border-radius:4px}
header button.on{border-color:var(--c,#fff);box-shadow:inset 0 0 0 1px var(--c,#fff);color:var(--c,#fff)}
#clock{margin-left:auto;font-size:28px;font-weight:600;letter-spacing:.04em}
#seg{color:var(--dim)}
main{flex:1;display:flex;flex-direction:column;justify-content:center;gap:4vh;padding:4vh 5vw}
.who{font-size:2.2vh;letter-spacing:.2em;color:var(--dim);text-transform:uppercase}
#now{font-size:5.4vh;line-height:1.2;min-height:14vh}
#now.mine{color:var(--c)}
#now.cue{font-size:12vh;text-align:center;color:var(--red)}
.bar{height:6px;background:var(--rule);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--c,#fff)}
#next{font-size:4vh;line-height:1.25;color:var(--c);opacity:.85;min-height:12vh}
i.sd{color:var(--dim);font-style:italic}
footer{padding:8px 14px;color:var(--dim);border-top:1px solid var(--rule);font-size:13px}
</style></head><body>
<header><strong>${escapeHtml(data.title)}</strong><span id="who"></span><button id="play">▶ PLAY</button><span id="seg"></span><span id="clock">--:--.-</span></header>
<main>
  <div><div class="who" id="nowWho"></div><div id="now">Pick your persona, start the phones, press PLAY (space).</div><div class="bar"><i id="nowBar"></i></div></div>
  <div><div class="who" id="nextWho"></div><div id="next"></div><div class="bar"><i id="nextBar"></i></div></div>
</main>
<footer>space play/pause · ← → seek 5 s · home restart · 1–9 persona · 0 full mix. Keep this file next to the .wav files.</footer>
<script>
const D=${JSON.stringify(data)};
const $=(id)=>document.getElementById(id);
const audio=new Audio();audio.preload='auto';
const lines=D.events.filter(e=>e.kind!=='segment');
let persona=new URLSearchParams(location.search).get('p')||D.personas[0].key;
const colorOf=(k)=>(D.personas.find(p=>p.key===k)||{}).color||'#F2F4F8';
function esc(s){return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[c])}
function fmt(t){const s=t<0?'-':'';t=Math.abs(t);const m=Math.floor(t/60);return s+String(m).padStart(2,'0')+':'+(t-m*60).toFixed(1).padStart(4,'0')}
function rich(t){return esc(t).replace(/(\\([^)]*\\)|\\[[^\\]]*\\])/g,'<i class="sd">$1</i>')}
function pick(k){persona=k;const at=audio.currentTime||0,was=!audio.paused;audio.src=D.files[k];
  audio.addEventListener('loadedmetadata',()=>{audio.currentTime=at;if(was)audio.play()},{once:true});
  document.querySelectorAll('header button[data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===k));
  document.body.style.setProperty('--c',k==='FULL'?'#F2F4F8':colorOf(k));}
const who=$('who');
[...D.personas.map(p=>p.key),'FULL'].forEach((k,i)=>{const b=document.createElement('button');b.textContent=(k==='FULL'?'0':i+1)+' '+k;b.dataset.k=k;b.style.setProperty('--c',colorOf(k));b.onclick=()=>pick(k);who.appendChild(b)});
const mine=(e)=>persona==='FULL'||e.who===persona||e.who==='ALL';
function toggle(){if(audio.paused){audio.play();$('play').textContent='❚❚ PAUSE'}else{audio.pause();$('play').textContent='▶ PLAY'}}
$('play').onclick=toggle;
addEventListener('keydown',(e)=>{if(e.key===' '){e.preventDefault();toggle()}else if(e.key==='ArrowLeft')audio.currentTime=Math.max(0,audio.currentTime-5);else if(e.key==='ArrowRight')audio.currentTime+=5;else if(e.key==='Home')audio.currentTime=0;else if(e.key==='0')pick('FULL');else if(/^[1-9]$/.test(e.key)&&D.personas[e.key-1])pick(D.personas[e.key-1].key)});
function frame(){
  const tr=audio.currentTime||0,show=tr-D.showStartTrackS;$('clock').textContent=fmt(show);
  const seg=D.events.filter(e=>e.kind==='segment'&&e.startS<=show).pop();$('seg').textContent=seg?seg.text:'';
  const now=$('now');let cur=null;
  if(tr<D.clapTrackS+0.4){const left=D.clapTrackS-tr;now.className='cue';$('nowWho').textContent='count-in';
    now.textContent=audio.paused&&tr===0?'READY?':left>3.2?'GET READY':left>0?String(4-Math.ceil(left)):'CLAP';$('nowBar').style.width='0'}
  else if(show<0){now.className='cue';$('nowWho').textContent='settle';now.textContent=Math.ceil(-show)+'…';$('nowBar').style.width='0'}
  else{for(const e of lines)if(show>=e.startS&&show<e.endS)cur=e;
    if(cur){now.className=mine(cur)?'mine':'';$('nowWho').textContent=(mine(cur)&&persona!=='FULL'?'YOU · ':'')+cur.who;now.innerHTML=rich(cur.text);
      $('nowBar').style.width=(100*(show-cur.startS)/(cur.endS-cur.startS))+'%';$('nowBar').style.background=colorOf(cur.who)}
    else{now.className='';$('nowWho').textContent='';now.textContent='';$('nowBar').style.width='0'}}
  const nx=lines.find(e=>mine(e)&&e.startS>show);
  if(nx&&persona!=='FULL'){const inS=nx.startS-show;$('nextWho').textContent='your next line · in '+Math.max(0,inS).toFixed(1)+' s'+(nx.who==='ALL'?' · ALL':'');$('next').innerHTML=rich(nx.text);$('nextBar').style.width=inS<5?(100*(1-inS/5))+'%':'0'}
  else{$('nextWho').textContent='';$('next').textContent='';$('nextBar').style.width='0'}
  requestAnimationFrame(frame)}
pick(persona);requestAnimationFrame(frame);
</script></body></html>
`;
}

async function renderSlides(
  slides,
  cfg,
  scriptDir,
  outFile,
  durationS,
  workDir,
) {
  const base = cfg.slides ? path.resolve(SERVER_DIR, cfg.slides) : scriptDir;
  const sorted = [...slides].sort((a, b) => a.startS - b.startS);
  const missing = [];
  for (const s of sorted) {
    s.file = path.resolve(base, s.text);
    if (!existsSync(s.file)) missing.push(s.file);
  }
  if (missing.length)
    throw new Error(
      `missing slide image(s):\n  ${missing.join('\n  ')}\n(render the demo deck with scripts/ob-demo-slides.mjs, or point @slides at your exported PNGs)`,
    );
  const q = (p) => `'${p.replace(/'/g, "'\\''")}'`;
  const lines = ['ffconcat version 1.0'];
  sorted.forEach((s, i) => {
    const from = i === 0 ? 0 : s.startS;
    const to = i + 1 < sorted.length ? sorted[i + 1].startS : durationS;
    lines.push(
      `file ${q(s.file)}`,
      `duration ${Math.max(0.04, to - from).toFixed(3)}`,
    );
  });
  lines.push(`file ${q(sorted[sorted.length - 1].file)}`);
  const list = path.join(workDir, 'slides.ffconcat');
  writeFileSync(list, `${lines.join('\n')}\n`);
  await ffmpeg([
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    '-f',
    'lavfi',
    '-i',
    `anullsrc=r=${SR}:cl=stereo`,
    '-filter_complex',
    '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p[v]',
    '-map',
    '[v]',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-tune',
    'stillimage',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    String(SR),
    '-t',
    durationS.toFixed(3),
    '-movflags',
    '+faststart',
    outFile,
  ]);
}

/** Synthetic raw takes: what two phones per persona would have recorded. */
async function renderMocks({
  cfg,
  personas,
  events,
  trackS,
  pcmOf,
  outDir,
  workDir,
}) {
  const mockDir = path.join(outDir, 'mock');
  mkdirSync(mockDir, { recursive: true });
  const fontArg = path.join(
    FONTS_DIR,
    'ibm-plex-mono',
    'IBMPlexMono-SemiBold.ttf',
  );
  if (/[':\\]/.test(fontArg))
    throw new Error(`font path unusable in a filtergraph: ${fontArg}`);
  const showStart = cfg.clap + cfg.start;
  const files = [];
  await pool(personas, 2, async (p, i) => {
    for (const shot of ['close', 'wide']) {
      // Each phone started a different time before the conductor.
      const lead = 2.2 + 1.37 * i + (shot === 'wide' ? 0.83 : 0);
      const lenS = lead + trackS + 2.5 + 0.6 * i;
      const buf = whiteNoise(
        Math.ceil(lenS * SR),
        0.004,
        17 + i * 7 + (shot === 'wide' ? 3 : 0),
      );
      mixInto(buf, thud(), 0.25);
      mixInto(
        buf,
        clapSound(5 + i),
        lead + cfg.clap,
        shot === 'wide' ? 0.6 : 1,
      );
      for (const e of events) {
        if (e.who !== p.key || !pcmOf.get(e)) continue;
        mixInto(
          buf,
          pcmOf.get(e),
          lead + showStart + e.startS,
          shot === 'wide' ? 0.45 : 1,
        );
      }
      const wav = path.join(workDir, `mock-${shot}-${p.key.toLowerCase()}.wav`);
      writeWav(wav, buf);
      const out = path.join(mockDir, `${shot}-${p.key.toLowerCase()}.mov`);
      const color = (p.color ?? '#888888').replace('#', '0x');
      const clock = `drawtext=fontfile='${fontArg}':fontsize=40:fontcolor=white:x=40:y=h-80:text='show %{pts\\:hms\\:${(-(lead + showStart)).toFixed(3)}}'`;
      const vf =
        shot === 'close'
          ? `drawtext=fontfile='${fontArg}':fontsize=160:fontcolor=black:x=(w-tw)/2:y=(h-th)/2:text='${p.key}',${clock}`
          : `drawbox=x=${140 + i * 380}:y=220:w=240:h=420:color=${color}:t=fill,drawtext=fontfile='${fontArg}':fontsize=36:fontcolor=white:x=${150 + i * 380}:y=660:text='${p.key}',${clock}`;
      const bg = shot === 'close' ? color : '0x3A3F47';
      // The first persona's close-up carries a second audio track, like some
      // phone apps write — ob-prep-takes must keep only the first.
      const extra = shot === 'close' && i === 0 ? ['-map', '1:a'] : [];
      await ffmpeg([
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=${bg}:s=1280x720:r=30:d=${lenS.toFixed(3)}`,
        '-i',
        wav,
        '-vf',
        vf,
        '-map',
        '0:v',
        '-map',
        '1:a',
        ...extra,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '30',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        out,
      ]);
      files.push({
        file: out,
        persona: p.key,
        shot,
        leadS: lead,
        clapAtS: lead + cfg.clap,
      });
    }
  });
  return files;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const scriptPath = positionals[0] ? resolveCli(positionals[0]) : null;
  if (!scriptPath || !existsSync(scriptPath))
    fail(
      'usage: node scripts/ob-conductor.mjs <script.conductor.txt> [--out <dir>] [--mock]',
    );
  const name = path.basename(scriptPath).replace(/(\.conductor)?\.txt$/i, '');
  const outDir = opt.out ? resolveCli(opt.out) : path.join(RAW_DIR, name);
  const workDir = path.join(outDir, '.work');
  const ttsCache = path.join(outDir, '.tts');
  mkdirSync(workDir, { recursive: true });

  const { cfg, personas, events, errors } = parseScript(
    readFileSync(scriptPath, 'utf8'),
  );
  if (errors.length) fail(`script errors:\n  ${errors.join('\n  ')}`);

  const voices = await sayVoices();
  personas.forEach((p, i) => {
    p.voice ??=
      FALLBACK_VOICES.find(
        (v) => voices.has(v) && !personas.some((q) => q.voice === v),
      ) ?? 'Daniel';
    p.color ??= PALETTE[i % PALETTE.length];
    if (!voices.has(p.voice))
      fail(
        `voice "${p.voice}" (${p.key}) is not installed — see \`say -v '?'\``,
      );
  });
  const persona = new Map(personas.map((p) => [p.key, p]));
  const narrator = personas[0].voice;

  // TTS for every spoken line (+ the count-in words).
  const spoken = events.filter(
    (e) => (e.kind === 'line' || e.kind === 'all') && spokenOf(e.text),
  );
  const pcmOf = new Map();
  console.log(`rendering ${spoken.length} lines with say…`);
  await pool(spoken, 4, async (e, i) => {
    const voice = e.kind === 'all' ? narrator : persona.get(e.who).voice;
    const pcm = normalise(
      await sayPcm(spokenOf(e.text), voice, cfg.rate, ttsCache),
    );
    pcmOf.set(e, pcm);
    e.ttsS = pcm.length / SR;
  });
  const words = {};
  for (const [k, text] of Object.entries({
    ready: 'Get ready. Clap on four.',
    one: 'one',
    two: 'two',
    three: 'three',
    cut: 'cut',
  }))
    words[k] = normalise(
      await sayPcm(text, narrator, cfg.rate, ttsCache),
      0.55,
    );

  const { durationS, warnings } = layout(cfg, events);
  const showStart = cfg.clap + cfg.start;
  const trackS = round3(showStart + durationS);

  // Audio tracks: FULL + one per persona.
  const tick = tone(1000, 0.06, 0.5);
  const clapBeep = tone(1500, 0.15, 0.8);
  const pip = tone(1320, 0.07, 0.3);
  const build = (forKey) => {
    const buf = new Float32Array(Math.ceil(trackS * SR));
    mixInto(buf, words.ready, cfg.clap - 6);
    ['one', 'two', 'three'].forEach((w, k) => {
      mixInto(buf, tick, cfg.clap - 3 + k);
      mixInto(buf, words[w], cfg.clap - 3 + k + 0.07);
    });
    mixInto(buf, clapBeep, cfg.clap);
    for (const e of events) {
      if (e.kind !== 'line' && e.kind !== 'all') continue;
      const at = showStart + e.startS;
      const own = forKey !== 'FULL' && (e.who === forKey || e.kind === 'all');
      if (own || (e.kind === 'all' && forKey === 'FULL'))
        mixInto(buf, pip, at - PIP_LEAD_S);
      if (!own && pcmOf.get(e)) mixInto(buf, pcmOf.get(e), at);
    }
    mixInto(buf, words.cut, trackS - 1.2);
    mixInto(buf, pip, trackS - 0.5);
    return buf;
  };
  const files = { FULL: `${name}.full.wav` };
  writeWav(path.join(outDir, files.FULL), build('FULL'));
  for (const p of personas) {
    files[p.key] = `${name}.${p.key.toLowerCase()}.wav`;
    writeWav(path.join(outDir, files[p.key]), build(p.key));
  }

  // On-air stand-in audio (what each phone would record in the room): room
  // tone + the clap + the persona's own lines. `WIDE` is the clap ALONE over
  // digital silence: the demos run audio mode `mix` (every close cam is always
  // live), so any voice in the wide plays twice and input start/loop jitter
  // turns that into a slapback echo on air. Silence after the clap also makes
  // ob-prep-takes skip loudnorm for the wide (nothing to measure in the
  // trimmed window), so it cannot boost room tone into hiss. Consumed by
  // ob-fake-takes.mjs.
  const buildOnair = (forKey, seed) => {
    if (forKey === 'WIDE') {
      const buf = new Float32Array(Math.ceil(trackS * SR));
      mixInto(buf, clapSound(3 + seed), cfg.clap, 0.6);
      return buf;
    }
    const buf = whiteNoise(Math.ceil(trackS * SR), 0.004, 41 + seed);
    mixInto(buf, clapSound(3 + seed), cfg.clap);
    for (const e of events) {
      if (e.kind !== 'line' || !pcmOf.get(e)) continue;
      if (e.who === forKey) mixInto(buf, pcmOf.get(e), showStart + e.startS);
    }
    return buf;
  };
  const onairFiles = {};
  personas.forEach((p, i) => {
    onairFiles[p.key] = `${name}.onair.${p.key.toLowerCase()}.wav`;
    writeWav(path.join(outDir, onairFiles[p.key]), buildOnair(p.key, i));
  });
  onairFiles.WIDE = `${name}.onair.wide.wav`;
  writeWav(
    path.join(outDir, onairFiles.WIDE),
    buildOnair('WIDE', personas.length),
  );

  const slides = events.filter((e) => e.kind === 'slide');
  let slidesFile = null;
  if (slides.length) {
    slidesFile = path.join(outDir, `${name}.slides.mp4`);
    console.log(
      `rendering ${slides.length} slides → ${path.relative(process.cwd(), slidesFile)}`,
    );
    await renderSlides(
      slides,
      cfg,
      path.dirname(scriptPath),
      slidesFile,
      durationS,
      workDir,
    );
  }

  const timing = {
    version: 1,
    title: cfg.title || name,
    name,
    script: path.relative(SERVER_DIR, scriptPath),
    clapTrackS: cfg.clap,
    startOffsetS: cfg.start,
    showStartTrackS: showStart,
    durationS,
    trackDurationS: trackS,
    tailS: cfg.tail,
    personas: personas.map(({ key, voice, role, talent, subtitle, color }) => ({
      key,
      voice,
      role,
      talent,
      subtitle,
      color,
    })),
    files,
    onairFiles,
    slidesFile: slidesFile ? path.basename(slidesFile) : null,
    rundown: events
      .filter((e) => e.kind === 'segment')
      .map((e, i) => ({
        id: `${String(i + 1).padStart(2, '0')}-${e.text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}`.slice(0, 40),
        title: e.text.slice(0, 60),
        atS: e.startS,
      })),
    events: events.map((e) => ({
      kind: e.kind,
      who: e.who,
      text: e.text,
      startS: e.startS,
      ...(e.endS != null ? { endS: e.endS } : {}),
      ...(e.ttsS != null ? { ttsS: round3(e.ttsS) } : {}),
    })),
  };
  writeFileSync(
    path.join(outDir, `${name}.timing.json`),
    `${JSON.stringify(timing, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outDir, `${name}.cue.md`),
    cueSheet(name, cfg, personas, events, durationS),
  );
  writeFileSync(
    path.join(outDir, `${name}.prompter.html`),
    prompterHtml(name, cfg, personas, events, files),
  );

  let mocks = [];
  if (opt.mock) {
    console.log('rendering mock takes…');
    mocks = await renderMocks({
      cfg,
      personas,
      events,
      trackS,
      pcmOf,
      outDir,
      workDir,
    });
  }
  if (!opt['keep-work']) rmSync(workDir, { recursive: true, force: true });

  for (const w of warnings) console.warn(`warning: ${w}`);
  console.log(
    `\n${timing.title}: show ${fmtTime(durationS)}, track ${fmtTime(trackS)}, ${spoken.length} spoken lines`,
  );
  for (const p of personas) {
    const n = events.filter((e) => e.who === p.key).length;
    console.log(
      `  ${p.key.padEnd(10)} ${String(n).padStart(2)} lines  voice ${p.voice}  → ${files[p.key]}`,
    );
  }
  console.log(
    `  prompter  → ${path.join(path.relative(process.cwd(), outDir), `${name}.prompter.html`)}`,
  );
  console.log(
    JSON.stringify({
      outDir,
      durationS,
      trackDurationS: trackS,
      files,
      slidesFile,
      warnings,
      mocks: mocks.map((m) => ({
        ...m,
        file: path.relative(process.cwd(), m.file),
      })),
    }),
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
