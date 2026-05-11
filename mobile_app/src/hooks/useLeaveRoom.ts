import { useCallback } from "react";
import { useConnectionStore } from "../store";
import { wsService } from "../services/websocketService";
import { navigationRef } from "../navigation/navigationRef";
import { SCREEN_NAMES } from "../navigation/navigationTypes";

/**
 * Returns a stable `leaveRoom` callback that disconnects the WebSocket,
 * clears all session state, and navigates back to the Join Room screen.
 *
 * This mirrors the automatic disconnect handler in App.tsx but is
 * user-initiated (e.g. from a "Leave room" button).
 */
export function useLeaveRoom() {
  const reset = useConnectionStore((s) => s.reset);

  const leaveRoom = useCallback(() => {
    wsService.disconnect();
    reset();
    if (navigationRef.isReady()) {
      navigationRef.reset({
        index: 0,
        routes: [{ name: SCREEN_NAMES.JOIN_SERVER }],
      });
    }
  }, [reset]);

  return leaveRoom;
}
