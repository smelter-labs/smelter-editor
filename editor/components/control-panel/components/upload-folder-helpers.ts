/**
 * Pure helpers of the ADD VIDEO modal's folder uploads (drop a folder /
 * UPLOAD FOLDER): kept DOM-free so the node vitest config covers them.
 */

/** `base/rel` without doubled or dangling slashes; '' when both are empty. */
export function joinFolder(base: string, rel?: string): string {
  return [base, rel ?? '']
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** Folder part of a `webkitRelativePath` (`set/sub/cam7.mp4` → `set/sub`). */
export function relDirOfPath(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i > 0 ? relPath.slice(0, i) : '';
}

/** `.DS_Store`, `._x` and friends never upload. */
export const isHiddenName = (name: string): boolean => name.startsWith('.');
