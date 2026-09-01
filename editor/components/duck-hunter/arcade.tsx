'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ShooterMatchConfig,
  ShooterMatchMode,
} from '@smelter-editor/types';
import { ArcadeStage, R5, monoFont } from './retro-kit';
import {
  useDuckHunterRoom,
  type DuckHunterSliderConfig,
} from './use-duck-hunter-room';
import { useShooterFeed } from './use-shooter-feed';
import { TitleScreen } from './screens/title-screen';
import { ModeSelect } from './screens/mode-select';
import { Lobby } from './screens/lobby';
import { GameScreen } from './screens/game-screen';
import { Results } from './screens/results';
import './retro.css';

// Characters are picked per player on the phones, so the host flow goes
// straight from the title to the match config.
type Screen = 'title' | 'config' | 'lobby' | 'game' | 'results';

export type MatchSetup = {
  mode: ShooterMatchMode;
  durationMs: number;
  targetScore: number;
};

const AMMO_CFG_KEY = 'duck-hunter-ammo';
export const DEFAULT_STAGE_FILE = 'DucksCompilation.mp4';

const DEFAULT_SLIDERS: DuckHunterSliderConfig = {
  maxAmmo: 6,
  reloadSec: 3,
  duckScale: 1,
  fleeSec: 0.7,
  flySpeed: 0.35,
};

/** Same localStorage shape as the dashboard DuckHunterPanel, so tuning done
 * in either place carries over. */
function loadSliders(): DuckHunterSliderConfig {
  try {
    const raw = window.localStorage.getItem(AMMO_CFG_KEY);
    if (!raw) return DEFAULT_SLIDERS;
    const p = JSON.parse(raw) as Partial<DuckHunterSliderConfig>;
    return {
      maxAmmo: typeof p.maxAmmo === 'number' ? p.maxAmmo : 6,
      reloadSec: typeof p.reloadSec === 'number' ? p.reloadSec : 3,
      duckScale: typeof p.duckScale === 'number' ? p.duckScale : 1,
      fleeSec: typeof p.fleeSec === 'number' ? p.fleeSec : 0.7,
      flySpeed: typeof p.flySpeed === 'number' ? p.flySpeed : 0.35,
    };
  } catch {
    return DEFAULT_SLIDERS;
  }
}

/** The /duck-hunter screen machine. */
export function DuckHunterArcade() {
  const [screen, setScreen] = useState<Screen>('title');
  const [setup, setSetup] = useState<MatchSetup>({
    mode: 'time',
    durationMs: 60_000,
    targetScore: 10,
  });
  const [sliders, setSliders] =
    useState<DuckHunterSliderConfig>(DEFAULT_SLIDERS);
  const [stageFile, setStageFile] = useState<string>(DEFAULT_STAGE_FILE);

  const [roomGone, setRoomGone] = useState(false);

  const room = useDuckHunterRoom();
  // The room vanished under us (deleted/GC'd): the feed stops retrying, so
  // show the operator what happened instead of a silently frozen lobby.
  const onRoomGone = useCallback(() => setRoomGone(true), []);
  const feed = useShooterFeed(room.roomId, onRoomGone);

  // Load persisted slider tuning once on mount.
  useEffect(() => {
    setSliders(loadSliders());
  }, []);

  // Persist slider tuning (shared key with the dashboard panel).
  useEffect(() => {
    try {
      window.localStorage.setItem(AMMO_CFG_KEY, JSON.stringify(sliders));
    } catch {
      /* ignore */
    }
  }, [sliders]);

  // The server owns the match lifecycle — follow its phase. The guard on the
  // current screen keeps manual navigation (PLAY AGAIN → config) in charge.
  const phase = feed.match?.phase;
  useEffect(() => {
    if ((phase === 'countdown' || phase === 'playing') && screen === 'lobby') {
      setScreen('game');
    } else if (phase === 'ended' && screen === 'game') {
      setScreen('results');
    }
  }, [phase, screen]);

  // After a refresh re-attached to a running room, land on the screen the
  // match phase dictates (once — EXIT TO TITLE must not be fought over).
  const restoreHandledRef = useRef(false);
  useEffect(() => {
    if (restoreHandledRef.current || !room.restored) return;
    if (!phase) return; // wait for the spectate snapshot
    restoreHandledRef.current = true;
    if (phase === 'lobby') setScreen('lobby');
    else if (phase === 'countdown' || phase === 'playing') setScreen('game');
    else if (phase === 'ended') setScreen('results');
    // 'idle' stays on the title — nothing to rejoin.
  }, [room.restored, phase]);

  // Track whether the room's stage input matches the chosen file, so coming
  // back from the results screen with a different pick swaps the video.
  const roomStageFileRef = useRef<string | null>(null);

  // The staged round, in wire shape. Sent on the lobby arm as well as the
  // start: the broadcast's opening screen announces it before a match exists.
  const matchConfig = useMemo<ShooterMatchConfig>(
    () => ({
      mode: setup.mode,
      durationMs: setup.mode === 'time' ? setup.durationMs : undefined,
      targetScore: setup.mode === 'points' ? setup.targetScore : undefined,
    }),
    [setup],
  );

  const openLobby = async () => {
    setScreen('lobby');
    if (!room.roomId) {
      // createRoom arms the 'lobby' phase itself (the fresh roomId hasn't
      // committed to state yet).
      await room.createRoom(stageFile, sliders, matchConfig);
      roomStageFileRef.current = stageFile;
    } else {
      if (roomStageFileRef.current !== stageFile) {
        await room.changeStage(stageFile);
        roomStageFileRef.current = stageFile;
      }
      await room.pushConfig(sliders);
      // Clears a finished match and tells waiting phones to keep holding on
      // the briefing (attract-mode ducks are not open range).
      await room.armLobby(matchConfig);
    }
  };

  const exitToTitle = async () => {
    roomStageFileRef.current = null;
    restoreHandledRef.current = true; // a later snapshot must not re-route us
    setRoomGone(false);
    setScreen('title');
    await room.exitAndDelete();
  };

  const banner = roomGone
    ? 'ROOM LOST — THE SERVER CLOSED IT. EXIT TO TITLE AND START OVER.'
    : room.error;

  return (
    <ArcadeStage>
      {banner ? (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 50,
            padding: '8px 12px',
            background: 'rgba(40, 8, 8, 0.92)',
            border: `2px solid ${R5.red}`,
            color: R5.ink,
            fontFamily: monoFont,
            fontSize: 13,
            letterSpacing: 1,
          }}>
          {banner}
        </div>
      ) : null}
      {screen === 'title' ? (
        <TitleScreen onStart={() => setScreen('config')} />
      ) : null}
      {screen === 'config' ? (
        <ModeSelect
          setup={setup}
          onSetup={setSetup}
          sliders={sliders}
          onSliders={setSliders}
          stageFile={stageFile}
          onStageFile={setStageFile}
          onConfirm={() => void openLobby()}
          onBack={() => setScreen('title')}
        />
      ) : null}
      {screen === 'lobby' ? (
        <Lobby
          setup={setup}
          room={room}
          feed={feed}
          onStart={() => void room.startMatch(matchConfig)}
          onBack={() => setScreen('config')}
        />
      ) : null}
      {screen === 'game' ? (
        <GameScreen room={room} onAbort={() => void room.stopMatch()} />
      ) : null}
      {screen === 'results' ? (
        <Results
          feed={feed}
          onPlayAgain={() => {
            // No resetMatch here: the match stays 'ended' until openLobby arms
            // 'lobby'. A reset would broadcast a transient 'idle' that waiting
            // phones read as open range and enter the game early.
            setScreen('config');
          }}
          onExit={() => void exitToTitle()}
        />
      ) : null}
    </ArcadeStage>
  );
}
