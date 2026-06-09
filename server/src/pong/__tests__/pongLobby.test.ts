import { describe, expect, it } from 'vitest';
import { PongLobby } from '../pongLobby.js';

describe('PongLobby', () => {
  it('assigns first joiner as host', () => {
    const lobby = new PongLobby();
    expect(lobby.join('host', 'left')).toEqual({ ok: true });
    expect(lobby.getHostClientId()).toBe('host');
  });

  it('starts game when both players are ready', () => {
    const lobby = new PongLobby();
    lobby.join('host', 'left');
    lobby.join('guest', 'right');
    expect(lobby.ready('host')).toBe(false);
    expect(lobby.ready('guest')).toBe(true);
    expect(lobby.isGameStarted()).toBe(true);
  });

  it('rejects joining a taken side', () => {
    const lobby = new PongLobby();
    lobby.join('p1', 'left');
    expect(lobby.join('p2', 'left')).toEqual({
      ok: false,
      error: 'Side already taken',
    });
  });

  it('promotes remaining player to host when host leaves', () => {
    const lobby = new PongLobby();
    lobby.join('host', 'left');
    lobby.join('guest', 'right');
    lobby.ready('host');
    lobby.ready('guest');
    lobby.leave('host');
    expect(lobby.getHostClientId()).toBe('guest');
    expect(lobby.isGameStarted()).toBe(false);
  });
});
