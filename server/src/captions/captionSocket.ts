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
 * Our ids look like `{roomUuid}::local::{inputUuid}` (81 chars), and Smelter
 * appends `video_{inputId}.sock` — with the macOS SUN_LEN budget of 103 the
 * dir itself must stay within 10 characters. `/tmp/s{pid}` blows that by one
 * whenever the PID has 5 digits, so encode the PID in base36 (≤4 chars for
 * any macOS PID) instead.
 */
export function createCaptionSocketDir(): string {
  const dir = `/tmp/s${process.pid.toString(36)}`;
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
  // Worst-case id: `::local::` is the longest input-kind infix we generate.
  const sampleId =
    inputId ??
    '00000000-0000-0000-0000-000000000000::local::00000000-0000-0000-0000-000000000000';
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
