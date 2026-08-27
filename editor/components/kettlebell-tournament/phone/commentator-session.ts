/**
 * Per-room commentator resume session (localStorage), shared by the phone
 * commentate page and the desktop panel. Carrying the same playerKey lets
 * any reconnect — and a phone ↔ desktop handoff — adopt the server slot
 * outright instead of matching by name (which fails against a half-open old
 * socket and retires a live camera).
 */
export type CommentatorSession = {
  playerKey?: string;
  name?: string;
  facing?: 'user' | 'environment';
  wantsCam?: boolean;
};

export const sessionStorageKey = (roomId: string) =>
  `kbt-commentator-${roomId}`;

export function readCommentatorSession(roomId: string): CommentatorSession {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object'
      ? (parsed as CommentatorSession)
      : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored session; returns the merged session. */
export function writeCommentatorSession(
  roomId: string,
  patch: Partial<CommentatorSession>,
): CommentatorSession {
  const merged = { ...readCommentatorSession(roomId), ...patch };
  try {
    window.localStorage.setItem(
      sessionStorageKey(roomId),
      JSON.stringify(merged),
    );
  } catch {
    // Storage blocked — resume just won't survive the next refresh.
  }
  return merged;
}
