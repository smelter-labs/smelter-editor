/**
 * /ob-van/[roomId] — the arcade bound to a live room: /ob-van rewrites its
 * URL here after creating the room, so a refresh (or the landing page's
 * "open" button) rehydrates the running show. The arcade is rendered by
 * ../layout.tsx, which reads the room id from the route params; this page
 * only exists so the route matches.
 */
export default function ObVanRoomPage() {
  return null;
}
