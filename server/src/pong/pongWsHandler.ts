import type {
  PongClientMessage,
  PongGameResetReason,
  PongNetGameState,
  RoomEvent,
} from '@smelter-editor/types';
import { roomEventBus } from '../core/roomEventBus.js';
import { pongLobbyManager } from './pongLobby.js';

function resolvePeerName(roomId: string, clientId: string): string | null {
  const peer = roomEventBus
    .getConnectedPeers(roomId)
    .find((p) => p.clientId === clientId);
  return peer?.name ?? null;
}

function broadcastLobbyUpdated(roomId: string): void {
  const lobby = pongLobbyManager.get(roomId);
  if (!lobby) return;
  roomEventBus.broadcast(roomId, {
    type: 'pong_lobby_updated',
    roomId,
    lobby: lobby.getLobbyState((clientId) => resolvePeerName(roomId, clientId)),
  });
}

function broadcastGameReset(roomId: string, reason: PongGameResetReason): void {
  roomEventBus.broadcast(roomId, {
    type: 'pong_game_reset',
    roomId,
    reason,
  });
}

function isValidSide(value: unknown): value is 'left' | 'right' {
  return value === 'left' || value === 'right';
}

function isValidGameState(value: unknown): value is PongNetGameState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (!s.ball || typeof s.ball !== 'object') return false;
  if (!s.paddles || typeof s.paddles !== 'object') return false;
  if (!s.score || typeof s.score !== 'object') return false;
  if (typeof s.phase !== 'string') return false;
  return true;
}

export function handlePongClientMessage(
  roomId: string,
  clientId: string,
  raw: unknown,
): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || !type.startsWith('pong_')) return false;
  if (type === 'pong_shader_partial_update') return false;

  const lobby = pongLobbyManager.getOrCreate(roomId);

  switch (type) {
    case 'pong_join': {
      const side = (raw as PongClientMessage & { side?: unknown }).side;
      if (!isValidSide(side)) return true;
      const result = lobby.join(clientId, side);
      if (!result.ok) return true;
      broadcastLobbyUpdated(roomId);
      return true;
    }

    case 'pong_ready': {
      if (!lobby.getPlayerSide(clientId)) return true;
      const shouldStart = lobby.ready(clientId);
      broadcastLobbyUpdated(roomId);
      if (shouldStart) {
        roomEventBus.broadcast(roomId, {
          type: 'pong_game_started',
          roomId,
        });
      }
      return true;
    }

    case 'pong_leave': {
      const { wasHost, wasInGame } = lobby.leave(clientId);
      pongLobbyManager.removeIfEmpty(roomId, lobby);
      if (wasInGame) {
        roomEventBus.broadcast(roomId, {
          type: 'pong_player_disconnected',
          roomId,
          clientId,
          wasHost,
        });
        broadcastGameReset(roomId, wasHost ? 'host_left' : 'player_left');
      }
      broadcastLobbyUpdated(roomId);
      return true;
    }

    case 'pong_paddle_input': {
      if (!lobby.isGameStarted()) return true;
      const hostClientId = lobby.getHostClientId();
      if (clientId === hostClientId) return true;
      const y = (raw as PongClientMessage & { y?: unknown }).y;
      if (typeof y !== 'number' || !Number.isFinite(y)) return true;
      if (!hostClientId) return true;
      roomEventBus.sendTo(roomId, hostClientId, {
        type: 'pong_paddle_input',
        roomId,
        clientId,
        y,
      });
      return true;
    }

    case 'pong_game_state': {
      if (!lobby.isGameStarted()) return true;
      const hostClientId = lobby.getHostClientId();
      if (clientId !== hostClientId) return true;
      const state = (raw as PongClientMessage & { state?: unknown }).state;
      if (!isValidGameState(state)) return true;
      roomEventBus.broadcastExcept(roomId, clientId, {
        type: 'pong_game_state',
        roomId,
        state,
      });
      return true;
    }

    case 'pong_reset': {
      lobby.reset();
      broadcastGameReset(roomId, 'manual');
      broadcastLobbyUpdated(roomId);
      return true;
    }

    default:
      return true;
  }
}

export function handlePongClientDisconnect(
  roomId: string,
  clientId: string,
): void {
  const lobby = pongLobbyManager.get(roomId);
  if (!lobby) return;
  if (!lobby.getPlayerSide(clientId)) return;

  const { wasHost, wasInGame } = lobby.leave(clientId);
  pongLobbyManager.removeIfEmpty(roomId, lobby);

  if (wasInGame) {
    roomEventBus.broadcast(roomId, {
      type: 'pong_player_disconnected',
      roomId,
      clientId,
      wasHost,
    });
    broadcastGameReset(roomId, wasHost ? 'host_left' : 'player_left');
  }
  broadcastLobbyUpdated(roomId);
}

export function broadcastPongEvent(roomId: string, event: RoomEvent): void {
  roomEventBus.broadcast(roomId, event);
}
