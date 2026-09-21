#!/usr/bin/env node
/**
 * Download the Alfheim (Simula) soccer dataset subsets the football game
 * ("Touchline") is built on. Mirrors the remote layout under --out:
 *
 *   2013-11-28/panorama/NNNN_2013-11-28 19:03:54.469509000.h264   (767 × 3 s, 4450×2000 @25)
 *   2013-11-28/ball/Balltrack.zip + ball/track/<segment>_track.txt (ball px per frame)
 *   2013-11-28/zxy/*.csv                                            (ZXY 20 Hz / raw / 1 Hz)
 *   2013-11-03/First Half/{0,1,2}/NNNN_2013-11-03 18:01:14.248366000.h264 (943 × 3 s, 1280×960 @30)
 *   2013-11-03/zxy/*_first.csv
 *   2013-11-07/Second Half/panorama/NNNN_2013-11-07 22:53:28.432311000.h264 (the goal: only a window, see below)
 *   2013-11-07/zxy/*_second.csv
 *
 * Usage:
 *   node scripts/alfheim-fetch.mjs --set pano-2013-11-28 | tricam-2013-11-03 | pano-2013-11-07 | all
 *        [--out <dir>] [--parallel 4] [--limit N] [--from HH:MM:SS --to HH:MM:SS] [--verify] [--dry-run]
 *
 * --from/--to (local wall clock of the segment names) keep only the segments
 * overlapping that window. pano-2013-11-07 carries a default window (the last
 * minutes of the half, around the 90+3' goal) because the whole half is
 * 9.5 GB; "all" does not include it.
 *
 * --out defaults to $ALFHEIM_DIR, else ~/workspace/streaming/workshops/workshop_5/pzpn/alfheim.
 * Resumable: files whose local size matches the server are skipped, partial
 * files continue with a Range request. --limit N takes the first N segments
 * of every camera (a quick partial set for building the prep pipeline).
 *
 * The dataset is for non-commercial research only (no player re-identification).
 * Cite: Pettersen et al., "Soccer video and player position dataset", ACM MMSys 2014.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseSegmentName, parseWhen } from './lib/alfheim.mjs';

const BASE = 'https://datasets.simula.no/downloads/alfheim/';
const DEFAULT_OUT = path.join(
  os.homedir(),
  'workspace/streaming/workshops/workshop_5/pzpn/alfheim',
);

const SETS = {
  'pano-2013-11-28': {
    match: '2013-11-28',
    segmentDirs: ['2013-11-28/panorama/'],
    files: [
      '2013-11-28/panorama/manifest.txt',
      '2013-11-28/ball/Balltrack.zip',
      '2013-11-28/ball/README.txt',
      '2013-11-28/zxy/2013-11-28_tromso_tottenham.csv',
      '2013-11-28/zxy/2013-11-28_tromso_tottenham_raw.csv',
      '2013-11-28/zxy/2013-11-28_tromso_tottenham_agg.csv',
    ],
    expectedSegments: 767,
    unzip: { file: '2013-11-28/ball/Balltrack.zip', into: '2013-11-28/ball/' },
  },
  'tricam-2013-11-03': {
    match: '2013-11-03',
    segmentDirs: [
      '2013-11-03/First Half/0/',
      '2013-11-03/First Half/1/',
      '2013-11-03/First Half/2/',
    ],
    files: [
      '2013-11-03/zxy/2013-11-03_tromso_stromsgodset_first.csv',
      '2013-11-03/zxy/2013-11-03_tromso_stromsgodset_raw_first.csv',
      '2013-11-03/zxy/2013-11-03_tromso_stromsgodset_agg_first.csv',
    ],
    expectedSegments: 943,
    unzip: null,
  },
  'pano-2013-11-07': {
    match: '2013-11-07',
    segmentDirs: ['2013-11-07/Second Half/panorama/'],
    files: [
      '2013-11-07/zxy/2013-11-07_tromso_anji_second.csv',
      '2013-11-07/zxy/2013-11-07_tromso_anji_raw_second.csv',
      '2013-11-07/zxy/2013-11-07_tromso_anji_agg_second.csv',
    ],
    expectedSegments: 978,
    unzip: null,
    window: { from: '22:51:00', to: '22:54:30' },
    optIn: true,
  },
};

const SEGMENT_MS = 3000;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const setArg = String(args.set ?? 'all');
const outDir = path.resolve(
  String(args.out ?? process.env.ALFHEIM_DIR ?? DEFAULT_OUT),
);
const parallel = Math.max(1, Number(args.parallel ?? 4));
const limit = args.limit != null ? Number(args.limit) : null;
const dryRun = args['dry-run'] === true;
const verifyOnly = args.verify === true;

const setNames =
  setArg === 'all'
    ? Object.keys(SETS).filter((s) => !SETS[s].optIn)
    : setArg.split(',').map((s) => s.trim());
for (const s of setNames) {
  if (!SETS[s]) {
    console.error(
      `unknown set "${s}" — one of ${Object.keys(SETS).join(', ')}, all`,
    );
    process.exit(2);
  }
}

/** [fromMs, toMs] of a set's segment window (flags win over the set default), or null. */
function windowOf(set) {
  const from = args.from ?? set.window?.from;
  const to = args.to ?? set.window?.to;
  if (from == null && to == null) return null;
  return [
    from != null ? parseWhen(String(from), set.match) : -Infinity,
    to != null ? parseWhen(String(to), set.match) : Infinity,
  ];
}

function inWindow(name, win) {
  const seg = parseSegmentName(name);
  return !!seg && seg.wallMs + SEGMENT_MS > win[0] && seg.wallMs < win[1];
}

// The site's certificate chain does not verify on this machine (missing
// intermediate); the data is public, so skip verification like `curl -k`.
const agent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: parallel + 2,
});

function remoteUrl(relPath) {
  return BASE + relPath.split('/').map(encodeURIComponent).join('/');
}

function request(method, url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, agent, headers }, (res) =>
      resolve(res),
    );
    req.on('error', reject);
    req.end();
  });
}

async function fetchText(relPath) {
  const res = await request('GET', remoteUrl(relPath));
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GET ${relPath} → HTTP ${res.statusCode}`);
  }
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function remoteSize(relPath) {
  const res = await request('HEAD', remoteUrl(relPath));
  res.resume();
  if (res.statusCode !== 200)
    throw new Error(`HEAD ${relPath} → HTTP ${res.statusCode}`);
  const len = Number(res.headers['content-length']);
  return Number.isFinite(len) ? len : null;
}

/** Segment names of a remote directory (Apache index → hrefs ending in .h264). */
async function listSegments(dirRel) {
  const html = await fetchText(dirRel);
  const names = [];
  for (const m of html.matchAll(/href="([^"]+\.h264)"/g)) {
    let href = m[1];
    if (href.startsWith('./')) href = href.slice(2);
    if (href.includes('/')) continue;
    names.push(decodeURIComponent(href));
  }
  names.sort();
  return names;
}

async function localSize(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return -1;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Download one file with resume + retries. Returns 'skipped' | 'done'. */
async function download(relPath, dest, attempt = 0) {
  const have = await localSize(dest);
  let want;
  try {
    want = await remoteSize(relPath);
  } catch (err) {
    if (attempt < 5) {
      await sleep(1000 * 2 ** attempt);
      return download(relPath, dest, attempt + 1);
    }
    throw err;
  }
  if (want != null && have === want) return 'skipped';
  if (dryRun) return 'dry';
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const resume = want != null && have > 0 && have < want;
  const headers = resume ? { Range: `bytes=${have}-` } : {};
  try {
    const res = await request('GET', remoteUrl(relPath), headers);
    const ok = resume ? res.statusCode === 206 : res.statusCode === 200;
    if (!ok) {
      res.resume();
      if (resume && res.statusCode === 200) {
        // Server ignored the range: start over.
        await fsp.rm(dest, { force: true });
        return download(relPath, dest, attempt);
      }
      throw new Error(`GET ${relPath} → HTTP ${res.statusCode}`);
    }
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(dest, { flags: resume ? 'a' : 'w' });
      res.pipe(ws);
      res.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
    });
    const now = await localSize(dest);
    if (want != null && now !== want)
      throw new Error(`size mismatch ${now} != ${want}`);
    return 'done';
  } catch (err) {
    if (attempt < 5) {
      await sleep(1000 * 2 ** attempt);
      return download(relPath, dest, attempt + 1);
    }
    throw err;
  }
}

async function pool(items, worker, n) {
  let i = 0;
  const results = [];
  const run = async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  return results;
}

function fmtBytes(b) {
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${b} B`;
}

async function fetchSet(name) {
  const set = SETS[name];
  console.log(`\n== ${name} → ${outDir}`);
  /** @type {{rel:string}[]} */
  const jobs = set.files.map((rel) => ({ rel }));
  const segmentsByDir = {};
  for (const dir of set.segmentDirs) {
    const names = await listSegments(dir);
    const win = windowOf(set);
    const windowed = win ? names.filter((n) => inWindow(n, win)) : names;
    const picked = limit != null ? windowed.slice(0, limit) : windowed;
    segmentsByDir[dir] = { total: names.length, picked: picked.length };
    console.log(
      `   ${dir}: ${names.length} segments on the server, taking ${picked.length}`,
    );
    for (const n of picked) jobs.push({ rel: dir + n });
  }
  const t0 = Date.now();
  let done = 0;
  let skipped = 0;
  let bytes = 0;
  const failures = [];
  await pool(
    jobs,
    async (job, idx) => {
      const dest = path.join(outDir, job.rel);
      try {
        const r = await download(job.rel, dest);
        if (r === 'skipped') skipped++;
        else done++;
        const sz = await localSize(dest);
        if (sz > 0) bytes += sz;
      } catch (err) {
        failures.push({ rel: job.rel, error: String(err?.message ?? err) });
        console.warn(`   FAIL ${job.rel}: ${err?.message ?? err}`);
      }
      const n = idx + 1;
      if (n % 50 === 0 || n === jobs.length) {
        const el = (Date.now() - t0) / 1000;
        console.log(
          `   ${n}/${jobs.length} files · ${fmtBytes(bytes)} · ${el.toFixed(0)} s · ${done} new, ${skipped} kept, ${failures.length} failed`,
        );
      }
    },
    parallel,
  );
  if (set.unzip && !dryRun && failures.every((f) => f.rel !== set.unzip.file)) {
    const zip = path.join(outDir, set.unzip.file);
    const into = path.join(outDir, set.unzip.into);
    const r = spawnSync('unzip', ['-o', '-q', zip, '-d', into], {
      stdio: 'inherit',
    });
    if (r.status !== 0)
      console.warn(`   unzip failed for ${zip} (exit ${r.status})`);
    else console.log(`   unzipped ${set.unzip.file} → ${set.unzip.into}`);
  }
  const manifest = {
    set: name,
    fetchedAt: new Date().toISOString(),
    outDir,
    segments: segmentsByDir,
    files: jobs.length,
    downloaded: done,
    kept: skipped,
    failures,
    limit,
  };
  if (!dryRun) {
    await fsp.mkdir(path.join(outDir, set.match), { recursive: true });
    await fsp.writeFile(
      path.join(outDir, set.match, `fetch-${name}.json`),
      JSON.stringify(manifest, null, 2),
    );
  }
  return manifest;
}

async function verifySet(name) {
  const set = SETS[name];
  let ok = true;
  for (const dir of set.segmentDirs) {
    const local = path.join(outDir, dir);
    const win = windowOf(set);
    let n = 0;
    let lo = Infinity;
    let hi = -Infinity;
    try {
      for (const f of await fsp.readdir(local)) {
        if (!f.endsWith('.h264') || (win && !inWindow(f, win))) continue;
        n++;
        const wallMs = parseSegmentName(f)?.wallMs;
        if (wallMs != null) {
          lo = Math.min(lo, wallMs);
          hi = Math.max(hi, wallMs);
        }
      }
    } catch {
      /* missing */
    }
    // A window is complete when the local segments in it are contiguous
    // (the recording may end before --to, so there is no fixed count).
    const full = win
      ? Math.max(1, Math.round((hi - lo) / SEGMENT_MS) + 1)
      : set.expectedSegments;
    const expected = limit != null ? Math.min(limit, full) : full;
    console.log(
      `   ${dir}: ${n}/${expected} segments${n >= expected ? '' : '  ← incomplete'}`,
    );
    if (n < expected) ok = false;
  }
  for (const rel of set.files) {
    const sz = await localSize(path.join(outDir, rel));
    console.log(`   ${rel}: ${sz >= 0 ? fmtBytes(sz) : 'missing'}`);
    if (sz < 0) ok = false;
  }
  if (set.unzip) {
    const trackDir = path.join(outDir, set.unzip.into, 'track');
    let n = 0;
    try {
      n = (await fsp.readdir(trackDir)).filter((f) =>
        f.endsWith('_track.txt'),
      ).length;
    } catch {
      /* missing */
    }
    console.log(`   ball tracks: ${n}`);
    if (n === 0) ok = false;
  }
  return ok;
}

(async () => {
  let allOk = true;
  for (const name of setNames) {
    if (!verifyOnly) await fetchSet(name);
    console.log(`\n== verify ${name}`);
    const ok = await verifySet(name);
    allOk = allOk && ok;
  }
  agent.destroy();
  console.log(allOk ? '\nOK' : '\nINCOMPLETE');
  process.exit(allOk ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
