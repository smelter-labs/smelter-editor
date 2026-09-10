import path from 'node:path';
import { sanitizeFolderPath } from '../core/routes/uploadRoutes';

/**
 * Validate a user-supplied clip path for the basketball file cams. The path
 * is relative to data/mp4s; folders are allowed (the upload depth limit
 * applies), traversal / absolute paths / control characters are not, and
 * the file has to be an .mp4. Returns the normalized relative path.
 */
export function sanitizeBbMp4FileName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  if (path.isAbsolute(trimmed) || /^[\\/]/.test(trimmed)) return null;
  // Windows drive letters ("C:...") never make sense for a library path.
  if (/^[a-zA-Z]:/.test(trimmed)) return null;
  const normalized = sanitizeFolderPath(trimmed);
  if (!normalized) return null;
  const base = path.posix.basename(normalized);
  if (!base || !base.toLowerCase().endsWith('.mp4') || base.length <= 4) {
    return null;
  }
  return normalized;
}
