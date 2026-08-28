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
