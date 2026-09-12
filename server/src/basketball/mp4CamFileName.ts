import path from 'node:path';
import { sanitizeFolderPath } from '../core/routes/uploadRoutes';

/**
 * Validate a user-supplied library path (relative to data/mp4s). Folders are
 * allowed (the upload depth limit applies), traversal / absolute paths /
 * control characters are not, and the file has to carry one of `exts`
 * (lower-case, with the dot). Returns the normalized relative path.
 */
export function sanitizeBbLibraryPath(
  raw: string,
  exts: readonly string[],
): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('\0')) return null;
  if (path.isAbsolute(trimmed) || /^[\\/]/.test(trimmed)) return null;
  // Windows drive letters ("C:...") never make sense for a library path.
  if (/^[a-zA-Z]:/.test(trimmed)) return null;
  const normalized = sanitizeFolderPath(trimmed);
  if (!normalized) return null;
  const base = path.posix.basename(normalized);
  if (!base) return null;
  const lower = base.toLowerCase();
  const ext = exts.find((e) => lower.endsWith(e));
  if (!ext || base.length <= ext.length) return null;
  return normalized;
}

/** Clip path for the basketball file cams: an .mp4 under data/mp4s. */
export function sanitizeBbMp4FileName(raw: string): string | null {
  return sanitizeBbLibraryPath(raw, ['.mp4']);
}

/** Ground-truth events file for the replay mode: a .json under data/mp4s. */
export function sanitizeBbEventsFileName(raw: string): string | null {
  return sanitizeBbLibraryPath(raw, ['.json']);
}
