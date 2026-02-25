/** @type {number | null} */
let timerId = null;

self.onmessage = (e) => {
  const { type, url, intervalMs } = e.data;

  if (type === 'start') {
    if (timerId !== null) clearInterval(timerId);

    const sendAck = async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        self.postMessage({
          type: 'ack-result',
          ok: res.ok,
          status: res.status,
        });
      } catch (err) {
        self.postMessage({
          type: 'ack-result',
          ok: false,
          error: err?.message ?? 'fetch failed',
        });
      }
    };

    // Send immediately, then on interval
    sendAck();
    timerId = setInterval(sendAck, intervalMs);
  }

  if (type === 'stop') {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};
