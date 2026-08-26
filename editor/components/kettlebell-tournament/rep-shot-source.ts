import type { KbtRepShot, KbtStateEvent } from '@smelter-editor/types';

/**
 * The shot list the on-air REP CAM overlay steps through, resolved from the
 * panel's `kbt_state` snapshot. MUST mirror the server's resolution order
 * (KettlebellTournamentController.repShotsFor): the running heat's shots
 * first, else the newest heat this player has shots in, else the rolled-up
 * `player.repShots`. The server clamps indices anyway, so a drift between
 * the two lists degrades to showing a neighboring shot, never an error.
 */
export function repShotsForPlayer(
  state: KbtStateEvent | null,
  clientId: string,
): KbtRepShot[] {
  if (!state) return [];
  const active =
    state.currentHeatIndex != null ? state.heats[state.currentHeatIndex] : null;
  if (active && active.phase !== 'idle') {
    const shots = active.scores[clientId]?.repShots;
    if (shots?.length) return shots;
  }
  for (let h = state.heats.length - 1; h >= 0; h--) {
    const shots = state.heats[h].scores[clientId]?.repShots;
    if (shots?.length) return shots;
  }
  return state.players.find((p) => p.clientId === clientId)?.repShots ?? [];
}
