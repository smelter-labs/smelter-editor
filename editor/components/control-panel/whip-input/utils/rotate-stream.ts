/**
 * Creates a new MediaStream whose video track is the original rotated by the given angle.
 * Supported angles: 0, 90, 180, 270 (clockwise).
 * Audio tracks are passed through unchanged.
 * Returns a cleanup function that stops the rendering loop and releases the canvas.
 */
export function createRotatedStream(
  source: MediaStream,
  angleDeg: 0 | 90 | 180 | 270,
  fps = 30,
): { stream: MediaStream; cleanup: () => void } {
  const videoTrack = source.getVideoTracks()[0];
  if (!videoTrack || angleDeg === 0) {
    return { stream: source, cleanup: () => {} };
  }

  const settings = videoTrack.getSettings();
  const srcW = settings.width || 640;
  const srcH = settings.height || 480;

  const swapped = angleDeg === 90 || angleDeg === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swapped ? srcH : srcW;
  canvas.height = swapped ? srcW : srcH;

  const ctx = canvas.getContext('2d')!;
  const rad = (angleDeg * Math.PI) / 180;

  const video = document.createElement('video');
  video.srcObject = new MediaStream([videoTrack]);
  video.muted = true;
  video.playsInline = true;
  video.play().catch(() => {});

  let stopped = false;
  let rafId: number | null = null;

  const draw = () => {
    if (stopped) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rad);
    ctx.drawImage(video, -srcW / 2, -srcH / 2, srcW, srcH);
    ctx.restore();
    rafId = requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(fps);

  const output = new MediaStream();
  for (const track of canvasStream.getVideoTracks()) {
    output.addTrack(track);
  }
  for (const track of source.getAudioTracks()) {
    output.addTrack(track);
  }

  const cleanup = () => {
    stopped = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    video.pause();
    video.srcObject = null;
    for (const t of canvasStream.getTracks()) {
      try {
        t.stop();
      } catch {}
    }
  };

  return { stream: output, cleanup };
}

/** @deprecated Use createRotatedStream(source, 90) instead */
export function createRotated90Stream(
  source: MediaStream,
  fps = 30,
): { stream: MediaStream; cleanup: () => void } {
  return createRotatedStream(source, 90, fps);
}
