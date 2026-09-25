#!/usr/bin/env node
// OB Van LLM smoke test against a running server (real API calls — costs a
// few cents). Creates a room, attaches two file cams, asks Claude for a
// ruleset from a panel brief, runs the analyst briefly, prints the status and
// wrap notes, then deletes the room.
//
//   ANTHROPIC_API_KEY must be set in the SERVER's environment, not here.
//   OB_API=http://localhost:3111 node scripts/ob-van-llm-smoke.mjs \
//     [--wide <mp4>] [--speaker <mp4>] [--analyst-s 25] [--no-wrap] [--keep]
//
// Exits 0 with a notice when the server reports `llm_unavailable`.

const API = process.env.OB_API ?? 'http://localhost:3111';
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')
    ? args[i + 1]
    : def;
};
const flag = (name) => args.includes(`--${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BRIEF = `Tech panel "Latency is a feature", 40 minutes. Anna Kowalska moderates from the speaker camera; the wide shot shows the whole stage.
Keep it calm and readable: no cut faster than 3 seconds, dissolves between people, cut on the person who talks.
Show Anna's name when she first speaks. If someone mentions slides or a demo, go to the wide shot for a while.
During audience questions stay on the wide shot.`;

class HttpError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} -> ${status} ${JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new HttpError(method, path, res.status, json);
  return json;
}

function printStatus(label, s) {
  console.log(
    `${label}: model=${s.model} analyst=${s.analyst} busy=${s.busy} runs=${s.runs} ` +
      `tokens in/out=${s.tokensIn}/${s.tokensOut} cost=$${s.estCostUsd.toFixed(4)} ` +
      `lastNote=${JSON.stringify(s.lastNote)} error=${JSON.stringify(s.error)}`,
  );
}

function describeRule(r) {
  const when = JSON.stringify(r.when);
  const then = JSON.stringify(r.then);
  return `  [${String(r.priority).padStart(3)}] ${r.id} — ${r.name}\n        when ${when}\n        then ${then}`;
}

async function pickFiles() {
  const { mp4s = [] } = await api('GET', '/suggestions/mp4s');
  const speech = mp4s.find((f) => /AppJSConfSpeech/i.test(f)) ?? mp4s[0];
  const other = mp4s.find((f) => f !== speech) ?? speech;
  return { wide: opt('wide', other), speaker: opt('speaker', speech) };
}

async function main() {
  console.log(`[ob-van-llm-smoke] API ${API}`);
  const files = await pickFiles();
  if (!files.wide || !files.speaker)
    throw new Error('no mp4 files on the server (data/mp4s)');

  const { roomId } = await api('POST', '/room', {
    initInputs: [],
    skipDefaultInputs: true,
    resolution: { width: 1280, height: 720 },
  });
  console.log(`room ${roomId}`);
  try {
    await api('POST', `/room/${roomId}/ob-van/config`, {
      eventName: 'LATENCY PANEL',
      presetId: 'talk',
      brief: BRIEF,
      autoPilot: true,
    });
    await api('POST', `/room/${roomId}/ob-van/control`, { action: 'setup' });
    const wide = await api('POST', `/room/${roomId}/ob-van/mp4-cam`, {
      role: 'wide',
      fileName: files.wide,
      name: 'WIDE',
    });
    const speaker = await api('POST', `/room/${roomId}/ob-van/mp4-cam`, {
      role: 'speaker',
      fileName: files.speaker,
      name: 'MODERATOR',
      talent: 'Anna Kowalska',
    });
    console.log(
      `cams: wide ${wide.camId} (${files.wide}), speaker ${speaker.camId} (${files.speaker})`,
    );

    const { status: before } = await api(
      'GET',
      `/room/${roomId}/ob-van/llm/status`,
    );
    if (!before.available) {
      console.log(
        'NOTICE: the server has no ANTHROPIC_API_KEY (llm status available=false) — nothing to test.',
      );
      return;
    }

    let brief;
    const t0 = Date.now();
    try {
      brief = await api('POST', `/room/${roomId}/ob-van/llm/brief`, {
        brief: BRIEF,
      });
    } catch (e) {
      if (e instanceof HttpError && e.body?.code === 'llm_unavailable') {
        console.log(
          'NOTICE: server reports llm_unavailable — set ANTHROPIC_API_KEY for the server.',
        );
        return;
      }
      throw e;
    }
    console.log(
      `\nbrief → ruleset in ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
    console.log(
      `name: ${brief.ruleset.name}  preset: ${brief.ruleset.preset}  id: ${brief.ruleset.id}`,
    );
    console.log(`pacing: ${JSON.stringify(brief.ruleset.pacing)}`);
    console.log(`weights: ${JSON.stringify(brief.ruleset.weights)}`);
    if (brief.ruleset.keywords)
      console.log(`keywords: ${JSON.stringify(brief.ruleset.keywords)}`);
    console.log(
      `rules (${brief.ruleset.rules.length}):\n${brief.ruleset.rules.map(describeRule).join('\n')}`,
    );
    console.log(`rationale: ${brief.rationale}`);
    console.log(
      `warnings: ${brief.warnings.length ? brief.warnings.join(' | ') : '(none)'}`,
    );

    // Apply it and go on air so the analyst has something to look at.
    await api('POST', `/room/${roomId}/ob-van/ruleset`, {
      ruleset: brief.ruleset,
    });
    await api('POST', `/room/${roomId}/ob-van/control`, { action: 'go_live' });
    const analystS = Number(opt('analyst-s', '25'));
    const { status: on } = await api(
      'POST',
      `/room/${roomId}/ob-van/llm/analyst`,
      {
        enabled: true,
        intervalS: 10,
      },
    );
    printStatus('\nanalyst on', on);
    const until = Date.now() + analystS * 1000;
    while (Date.now() < until) {
      await sleep(5000);
      const { status } = await api('GET', `/room/${roomId}/ob-van/llm/status`);
      printStatus(
        `t+${Math.round((analystS * 1000 - (until - Date.now())) / 1000)}s`,
        status,
      );
    }
    const { status: killed } = await api(
      'POST',
      `/room/${roomId}/ob-van/llm/kill`,
    );
    printStatus('killed', killed);

    const { state } = await api('GET', `/room/${roomId}/ob-van/state`);
    const llmLog = state.log.filter((e) => e.source === 'llm');
    console.log(`\nLLM log entries (${llmLog.length}):`);
    for (const e of llmLog)
      console.log(
        `  ${e.kind} ${e.label}: ${e.text}${e.reasons ? ` [${e.reasons.join('; ')}]` : ''}`,
      );

    if (!flag('no-wrap')) {
      await api('POST', `/room/${roomId}/ob-van/control`, { action: 'wrap' });
      const { notes } = await api('POST', `/room/${roomId}/ob-van/llm/wrap`);
      console.log(`\nwrap notes:\n${notes}`);
    }
    const { status: after } = await api(
      'GET',
      `/room/${roomId}/ob-van/llm/status`,
    );
    printStatus('\nfinal', after);
  } finally {
    if (flag('keep')) console.log(`kept room ${roomId}`);
    else await api('DELETE', `/room/${roomId}`).catch(() => undefined);
  }
}

main().catch((e) => {
  console.error(
    `[ob-van-llm-smoke] FAILED: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
});
