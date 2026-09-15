// Shared REST/WS helpers for the football scripts (e2e, checks).
// Talks to the editor API (default http://localhost:3001, override with FB_API).

export const API = process.env.FB_API ?? 'http://localhost:3001';

export function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) positional.push(a);
    else if (args[i + 1] != null && !args[i + 1].startsWith('--')) i++;
  }
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] != null && !args[i + 1].startsWith('--')
      ? args[i + 1]
      : def;
  };
  const flag = (name) => args.includes(`--${name}`);
  return { positional, opt, flag };
}

export async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createRoom(resolution = { width: 1280, height: 720 }) {
  const created = await api('POST', '/room', {
    initInputs: [],
    skipDefaultInputs: true,
    resolution,
  });
  return created;
}

export const deleteRoom = (roomId) =>
  api('DELETE', `/room/${roomId}`).catch(() => {});

export const getState = async (roomId) =>
  api('GET', `/room/${roomId}/football-game/state`);

/**
 * Open the room socket as a football client. `onEvent` gets every parsed
 * event; the returned socket has `.send(obj)` and `.close()`.
 */
export async function openSocket(roomId, onEvent) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/room/${roomId}/ws`);
  ws.addEventListener('message', (m) => {
    let ev;
    try {
      ev = JSON.parse(String(m.data));
    } catch {
      return;
    }
    onEvent(ev);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    ws,
    send: (obj) => ws.send(JSON.stringify(obj)),
    close: () => ws.close(),
  };
}

/** Poll `fn` until it returns a truthy value (or throw after `timeoutMs`). */
export async function waitFor(
  fn,
  { timeoutMs = 30_000, pollMs = 250, label = 'condition' } = {},
) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs)
      throw new Error(`timeout waiting for ${label}`);
    await sleep(pollMs);
  }
}

export const fmtEvent = (e) =>
  `  ${e.kind.padEnd(8)} #${e.index} media=${e.mediaMs != null ? (e.mediaMs / 1000).toFixed(2) + 's' : '?'} clock=${Math.floor(e.clockMs / 1000)}s team=${e.team ?? '-'} ${e.source}@${e.aiConfidence} ${e.status}${e.detail ? ' · ' + e.detail : ''}`;
