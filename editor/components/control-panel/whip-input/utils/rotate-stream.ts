/**
 * Creates a new MediaStream whose video track is the original rotated 90° clockwise.
 * Audio tracks are passed through unchanged.
 * Returns a cleanup function that stops the rendering loop and releases the canvas.
 */
export function createRotated90Stream(
  source: MediaStream,
  fps = 30,
): { stream: MediaStream; cleanup: () => void } {
  const videoTrack = source.getVideoTracks()[0];
  if (!videoTrack) {
    return { stream: source, cleanup: () => {} };
  }

  const settings = videoTrack.getSettings();
  const srcW = settings.width || 640;
  const srcH = settings.height || 480;

  // After 90° CW rotation: output dimensions are swapped
  const canvas = document.createElement('canvas');
  canvas.width = srcH;
  canvas.height = srcW;

  const ctx = canvas.getContext('2d')!;

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
    // Rotate 90° CW: translate to (canvasW, 0), then rotate 90°
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(video, 0, 0, srcW, srcH);
    ctx.restore();
    rafId = requestAnimationFrame(draw);
  };
  draw();

  const canvasStream = canvas.captureStream(fps);

  // Combine rotated video with original audio tracks
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
