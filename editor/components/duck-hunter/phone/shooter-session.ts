/**
 * Per-room shooter resume session (localStorage). Carrying the playerKey lets
 * any reconnect — WS blip, page refresh, fast tab swap — adopt the server-side
 * player entry (score, color, camera) outright instead of matching by name,
 * which fails against a half-open old socket.
 */
export type ShooterSession = {
  playerKey?: string;
  name?: string;
  /** Hunter character picked on this phone (survives refresh/reconnect). */
  characterId?: string;
};

export const shooterSessionKey = (roomId: string) => `duck-hunter-${roomId}`;

export function readShooterSession(roomId: string): ShooterSession {
  try {
    const raw = window.localStorage.getItem(shooterSessionKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as ShooterSession)
      : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored session; returns the merged session. */
export function writeShooterSession(
  roomId: string,
  patch: Partial<ShooterSession>,
): ShooterSession {
  const merged = { ...readShooterSession(roomId), ...patch };
  try {
    window.localStorage.setItem(
      shooterSessionKey(roomId),
      JSON.stringify(merged),
    );
  } catch {
    // Storage blocked — resume just won't survive the next refresh.
  }
  return merged;
}

/**
 * Drop specific fields from the stored session; returns what is left.
 *
 * Deliberately not `writeShooterSession(roomId, { playerKey: undefined })`:
 * that only works because JSON.stringify happens to skip undefined values, and
 * a reader who did not know that would "fix" it into a no-op. The two callers
 * are both un-resume cases — the host kicked this phone (forget `playerKey`,
 * or the next reconnect silently rejoins) and the picked hunter was taken by
 * someone else (forget `characterId`, or the next join re-sends a doomed id).
 */
export function forgetShooterSession(
  roomId: string,
  keys: readonly (keyof ShooterSession)[],
): ShooterSession {
  const next = { ...readShooterSession(roomId) };
  for (const k of keys) delete next[k];
  try {
    window.localStorage.setItem(
      shooterSessionKey(roomId),
      JSON.stringify(next),
    );
  } catch {
    // Storage blocked — nothing was persisted to forget in the first place.
  }
  return next;
}
