/**
 * Room-level WebSocket errors shared by every game riding the room socket.
 *
 * Sent once by the server before it closes the socket with code 4404 when a
 * client connects to a room that does not exist (deleted, GC'd, or a typo'd
 * URL). Without this the socket would connect fine, show a green "connected"
 * indicator, and silently swallow every message — the worst failure mode for
 * a booth. Clients should stop auto-reconnecting on 4404 / `room_not_found`
 * and surface a "room not found" state instead.
 */
export type RoomSocketErrorEvent = {
  type: "room_error";
  roomId: string;
  code: "room_not_found";
  message: string;
};

/** WebSocket close code paired with `room_error`: the room does not exist. */
export const WS_CLOSE_ROOM_NOT_FOUND = 4404;
