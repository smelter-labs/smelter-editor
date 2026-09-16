/**
 * /duck-hunter/[roomId] — the arcade bound to a live room: /duck-hunter
 * rewrites its URL here after creating the room, so a refresh (or the landing
 * page's "open game" button) rehydrates the running game instead of dropping
 * back to the title screen. The arcade is rendered by ../layout.tsx, which
 * reads the room id from the route params; this page only exists so the
 * route matches.
 */
export default function DuckHunterRoomPage() {
  return null;
}
