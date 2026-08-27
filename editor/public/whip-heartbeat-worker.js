// WHIP ack heartbeat off the main thread — timers here keep firing while the
// page is backgrounded/occluded (main-thread setInterval gets throttled and a
// missed 12s/45s server TTL hides or reaps the input). Protocol (see
// use-whip-heartbeat.ts): {type:'start', url, intervalMs} / {type:'stop'};
// every beat POSTs `url` (roomId/inputId ride in its query string, matching
// /api/whip-ack-worker) and reports {type:'ack-result', ok, status}.
let timer = null;

self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type === 'start') {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    const url = msg.url;
    const intervalMs = msg.intervalMs > 0 ? msg.intervalMs : 5000;
    const beat = () => {
      fetch(url, { method: 'POST' })
        .then((res) => {
          self.postMessage({
            type: 'ack-result',
            ok: res.ok,
            status: res.status,
          });
        })
        .catch((err) => {
          self.postMessage({
            type: 'ack-result',
            ok: false,
            error: String(err),
          });
        });
    };
    beat();
    timer = setInterval(beat, intervalMs);
  } else if (msg.type === 'stop') {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
};
