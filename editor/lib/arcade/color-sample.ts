'use client';

import { medianRgb, toHex, type Rgb } from './color';

/**
 * Sample the colour under a normalized point (0..1 × 0..1, in the video's
 * pixel space) of a playing <video>: draws the current frame to an offscreen
 * canvas and takes the per-channel median of a (2·radius+1)² patch. Used to
 * calibrate team colours from a jersey on the hoop camera preview / program
 * monitor. WebRTC and camera MediaStreams do not taint the canvas.
 * Returns null when the frame is not readable yet.
 */
export function sampleVideoColorAt(
  video: HTMLVideoElement,
  nx: number,
  ny: number,
  radius = 6,
): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  const side = radius * 2 + 1;
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const cx = Math.round(Math.max(0, Math.min(1, nx)) * (w - 1));
  const cy = Math.round(Math.max(0, Math.min(1, ny)) * (h - 1));
  try {
    ctx.drawImage(
      video,
      cx - radius,
      cy - radius,
      side,
      side,
      0,
      0,
      side,
      side,
    );
    const data = ctx.getImageData(0, 0, side, side).data;
    const samples: Rgb[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    const med = medianRgb(samples);
    return med ? toHex(med) : null;
  } catch {
    return null;
  }
}

/**
 * Map a pointer event on an element showing a video with `object-fit:
 * contain` to normalized video coordinates; null when the tap landed in the
 * letterbox bars.
 */
export function pointToVideoNorm(
  el: HTMLElement,
  video: { videoWidth: number; videoHeight: number },
  clientX: number,
  clientY: number,
): { nx: number; ny: number } | null {
  const rect = el.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || rect.width === 0 || rect.height === 0) return null;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = rect.left + (rect.width - dw) / 2;
  const oy = rect.top + (rect.height - dh) / 2;
  const nx = (clientX - ox) / dw;
  const ny = (clientY - oy) / dh;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return { nx, ny };
}
