// Shared REST/WS helpers for the OB Van scripts (e2e, live check).
// Talks to the server API (default http://localhost:3001, override with OB_API).

export const API = process.env.OB_API ?? 'http://localhost:3001';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** REST call; resolves `{status, body}` (never throws on HTTP errors). */
export async function call(method, path, body) {
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
  return { status: res.status, body: json };
}

/** REST call that throws on a non-2xx answer. */
export async function api(method, path, body) {
  const r = await call(method, path, body);
  if (r.status >= 300)
    throw new Error(
      `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`,
    );
  return r.body;
}

export async function createRoom(resolution = { width: 1280, height: 720 }) {
  return api('POST', '/room', {
    initInputs: [],
    skipDefaultInputs: true,
    resolution,
  });
}

export const deleteRoom = (roomId) =>
  api('DELETE', `/room/${roomId}`).catch(() => {});

export const ob = {
  state: async (roomId) =>
    (await api('GET', `/room/${roomId}/ob-van/state`)).state,
  config: (roomId, patch) =>
    api('POST', `/room/${roomId}/ob-van/config`, patch),
  control: (roomId, action, camId) =>
    api(
      'POST',
      `/room/${roomId}/ob-van/control`,
      camId ? { action, camId } : { action },
    ),
  operate: (roomId, cmd) =>
    api('POST', `/room/${roomId}/ob-van/operate`, { cmd }),
  tryOperate: (roomId, cmd) =>
    call('POST', `/room/${roomId}/ob-van/operate`, { cmd }),
  mp4Cam: (roomId, body) => api('POST', `/room/${roomId}/ob-van/mp4-cam`, body),
  sync: (roomId, playFromMs = 0) =>
    api('POST', `/room/${roomId}/ob-van/mp4-cam/sync`, { playFromMs }),
  simulate: (roomId, camId, sample) =>
    api('POST', `/room/${roomId}/ob-van/simulate-signal`, { camId, sample }),
};

/** Open the room socket; `onEvent` gets every parsed event. */
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

/** Two demo file cams (copy them into data/mp4s/ob-demo/ first). */
export const DEMO_CAMS = [
  {
    role: 'speaker',
    fileName: 'ob-demo/speaker.mp4',
    name: 'Stage cam',
    talent: 'Jamie Birch',
  },
  {
    role: 'wide',
    fileName: 'ob-demo/wide.mp4',
    name: 'Park cam',
    talent: null,
  },
];

/** Speech on `camId` (the worker's audio hop shape). */
export const speech = (on) => ({
  kind: 'audio',
  rms: on ? -18 : -60,
  speechProb: on ? 0.95 : 0.02,
  speech: on,
  onset: on,
});

let failures = 0;
export function check(ok, label, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}
export const failureCount = () => failures;
