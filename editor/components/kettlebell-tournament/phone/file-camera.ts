/**
 * A "camera" backed by a local video file: plays the file in a detached,
 * muted, looping <video> and captures its frames into a MediaStream that
 * slots into the same WHIP publish path as a getUserMedia stream. Lets a
 * lifter (or a tester at a desktop) use a recorded clip instead of a live
 * camera — the full pipeline (WebRTC → side channel → pose model → scoring)
 * runs on the recording's frames.
 */

export type FileCamera = {
  /** Video-only stream of the looping file. */
  stream: MediaStream;
  /** The underlying looping player — pause/play/seek to control what streams. */
  video: HTMLVideoElement;
  width: number;
  height: number;
  dispose: () => void;
};

type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export async function createFileCamera(file: File): Promise<FileCamera> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video') as CapturableVideo;
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      video.addEventListener(
        'error',
        () => reject(new Error('could not decode video file')),
        { once: true },
      );
    });
    // Called from the file-picker gesture; muted + playsInline, so this plays.
    await video.play();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  let cancelRaf = 0;
  let interval = 0;

  let captured: MediaStream;
  if (video.captureStream) {
    captured = video.captureStream();
  } else if (video.mozCaptureStream) {
    captured = video.mozCaptureStream();
  } else {
    // Safari/iOS: no HTMLMediaElement.captureStream — pump frames through a
    // canvas. rAF throttles in background tabs; the interval keeps a trickle.
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    const draw = () => {
      if (video.readyState >= 2) ctx.drawImage(video, 0, 0, width, height);
    };
    const pump = () => {
      draw();
      cancelRaf = requestAnimationFrame(pump);
    };
    cancelRaf = requestAnimationFrame(pump);
    interval = window.setInterval(draw, 33);
    captured = canvas.captureStream(30);
  }

  // Video-only regardless of the clip's audio tracks.
  const stream = new MediaStream(captured.getVideoTracks());

  return {
    stream,
    video,
    width,
    height,
    dispose: () => {
      stream.getTracks().forEach((t) => t.stop());
      captured.getTracks().forEach((t) => t.stop());
      if (cancelRaf) cancelAnimationFrame(cancelRaf);
      if (interval) window.clearInterval(interval);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}
