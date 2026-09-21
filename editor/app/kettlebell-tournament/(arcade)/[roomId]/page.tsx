/**
 * /kettlebell-tournament/[roomId] — the arcade bound to a live room:
 * /kettlebell-tournament rewrites its URL here after creating the room, so a
 * refresh rehydrates the tournament from the server instead of dropping back
 * to the title screen. The arcade is rendered by ../layout.tsx, which reads
 * the room id from the route params; this page only exists so the route
 * matches.
 */
export default function KettlebellTournamentRoomPage() {
  return null;
}
