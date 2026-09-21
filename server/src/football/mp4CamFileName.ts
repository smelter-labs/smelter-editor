import { sanitizeBbLibraryPath } from '../basketball/mp4CamFileName';

/**
 * Clip path for the football file cams: an .mp4 under data/mp4s (folders
 * allowed up to the library depth limit — `fb/demo/x/y.mp4` is one segment
 * too deep; no traversal, no absolute paths).
 */
export function sanitizeFbMp4FileName(raw: string): string | null {
  return sanitizeBbLibraryPath(raw, ['.mp4']);
}
