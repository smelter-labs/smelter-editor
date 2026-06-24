import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

/** macOS/BSD `SUN_LEN` minus the null terminator. */
export const UNIX_SOCKET_PATH_MAX = 103;

/** Smelter names side-channel sockets `audio_{inputId}.sock`. */
export function sideChannelSocketPath(
  socketDir: string,
  inputId: string,
): string {
  return path.join(socketDir, `audio_${inputId}.sock`);
}

export function sideChannelSocketPathLen(
  socketDir: string,
  inputId: string,
): number {
  return sideChannelSocketPath(socketDir, inputId).length;
}

/**
 * Pick a socket directory short enough for the longest expected input id.
 * Our ids look like `{roomUuid}::whip::{inputUuid}` (~80 chars) → the dir
 * itself must stay under ~11 characters on macOS.
 */
export function createCaptionSocketDir(): string {
  const dir = `/tmp/s${process.pid}`;
  mkdirSync(dir, { recursive: true });
  // Smelter expects a clean socket dir; drop stale sockets after a crash.
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.sock')) {
      unlinkSync(path.join(dir, name));
    }
  }
  return dir;
}

export function logSocketPathBudget(
  socketDir: string,
  inputId?: string,
): void {
  const sampleId =
    inputId ??
    '00000000-0000-0000-0000-000000000000::whip::00000000-0000-0000-0000-000000000000';
  const samplePath = sideChannelSocketPath(socketDir, sampleId);
  const len = samplePath.length;
  const ok = len <= UNIX_SOCKET_PATH_MAX;
  console.log(
    `[captions] socket dir=${socketDir} samplePathLen=${len}/${UNIX_SOCKET_PATH_MAX} ${ok ? 'OK' : 'TOO LONG'}`,
  );
  if (!ok) {
    console.error(
      `[captions] side-channel socket path exceeds SUN_LEN — captions will not work for inputId=${inputId ?? sampleId}`,
    );
  }
}
