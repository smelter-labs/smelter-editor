import type {
  PongLobbyState,
  PongSide,
} from '@smelter-editor/types';

type PlayerRecord = {
  side: PongSide;
  ready: boolean;
};

export type PongJoinResult =
  | { ok: true }
  | { ok: false; error: string };

export class PongLobby {
  private readonly players = new Map<string, PlayerRecord>();
  private hostClientId: string | null = null;
  private gameStarted = false;

  join(clientId: string, side: PongSide): PongJoinResult {
    const existing = this.players.get(clientId);
    if (existing) {
      if (existing.side === side) {
        return { ok: true };
      }
      const sideTaken = [...this.players.entries()].some(
        ([id, p]) => id !== clientId && p.side === side,
      );
      if (sideTaken) {
        return { ok: false, error: 'Side already taken' };
      }
      existing.side = side;
      existing.ready = false;
      this.gameStarted = false;
      return { ok: true };
    }

    if (this.players.size >= 2) {
      return { ok: false, error: 'Lobby is full' };
    }

    const sideTaken = [...this.players.values()].some((p) => p.side === side);
    if (sideTaken) {
      return { ok: false, error: 'Side already taken' };
    }

    this.players.set(clientId, { side, ready: false });
    if (!this.hostClientId) {
      this.hostClientId = clientId;
    }
    this.gameStarted = false;
    return { ok: true };
  }

  ready(clientId: string): boolean {
    const player = this.players.get(clientId);
    if (!player) return false;
    player.ready = true;
    if (this.players.size < 2) return false;
    for (const p of this.players.values()) {
      if (!p.ready) return false;
    }
    this.gameStarted = true;
    return true;
  }

  leave(clientId: string): { wasHost: boolean; wasInGame: boolean } {
    const wasHost = this.hostClientId === clientId;
    const wasInGame = this.gameStarted;
    this.players.delete(clientId);

    if (wasHost) {
      const next = this.players.keys().next().value as string | undefined;
      this.hostClientId = next ?? null;
    } else if (this.hostClientId === clientId) {
      this.hostClientId = null;
    }

    if (this.players.size === 0) {
      this.hostClientId = null;
      this.gameStarted = false;
    } else {
      this.gameStarted = false;
      for (const p of this.players.values()) {
        p.ready = false;
      }
    }

    return { wasHost, wasInGame };
  }

  reset(): void {
    this.gameStarted = false;
    for (const p of this.players.values()) {
      p.ready = false;
    }
  }

  getHostClientId(): string | null {
    return this.hostClientId;
  }

  isGameStarted(): boolean {
    return this.gameStarted;
  }

  getPlayerSide(clientId: string): PongSide | null {
    return this.players.get(clientId)?.side ?? null;
  }

  getLobbyState(
    resolveName: (clientId: string) => string | null,
  ): PongLobbyState {
    const players = [...this.players.entries()].map(([clientId, p]) => ({
      clientId,
      side: p.side,
      ready: p.ready,
      name: resolveName(clientId),
    }));
    players.sort((a, b) => {
      if (a.side === b.side) return 0;
      return a.side === 'left' ? -1 : 1;
    });
    return {
      players,
      hostClientId: this.hostClientId,
      gameStarted: this.gameStarted,
    };
  }
}

class PongLobbyManager {
  private readonly lobbies = new Map<string, PongLobby>();

  getOrCreate(roomId: string): PongLobby {
    let lobby = this.lobbies.get(roomId);
    if (!lobby) {
      lobby = new PongLobby();
      this.lobbies.set(roomId, lobby);
    }
    return lobby;
  }

  get(roomId: string): PongLobby | undefined {
    return this.lobbies.get(roomId);
  }

  removeIfEmpty(roomId: string, lobby: PongLobby): void {
    const state = lobby.getLobbyState(() => null);
    if (state.players.length === 0) {
      this.lobbies.delete(roomId);
    }
  }
}

export const pongLobbyManager = new PongLobbyManager();
