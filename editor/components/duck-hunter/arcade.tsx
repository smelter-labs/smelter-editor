'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShooterMatchMode } from '@smelter-editor/types';
import { ArcadeStage } from './retro-kit';
import { CHARACTERS, type ArcadeCharacter } from './characters';
import { useDuckHunterRoom, type DuckHunterSliderConfig } from './use-duck-hunter-room';
import { useShooterFeed } from './use-shooter-feed';
import { TitleScreen } from './screens/title-screen';
import { CharacterSelect } from './screens/character-select';
import { ModeSelect } from './screens/mode-select';
import { Lobby } from './screens/lobby';
import { GameScreen } from './screens/game-screen';
import { Results } from './screens/results';
import './retro.css';

type Screen = 'title' | 'select' | 'config' | 'lobby' | 'game' | 'results';

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
  const [character, setCharacter] = useState<ArcadeCharacter>(CHARACTERS[0]);
  const [setup, setSetup] = useState<MatchSetup>({
    mode: 'time',
    durationMs: 60_000,
    targetScore: 10,
  });
  const [sliders, setSliders] = useState<DuckHunterSliderConfig>(DEFAULT_SLIDERS);
  const [stageFile, setStageFile] = useState<string>(DEFAULT_STAGE_FILE);

  const room = useDuckHunterRoom();
  const feed = useShooterFeed(room.roomId);

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

  // Track whether the room's stage input matches the chosen file, so coming
  // back from the results screen with a different pick swaps the video.
  const roomStageFileRef = useRef<string | null>(null);

  const openLobby = async () => {
    setScreen('lobby');
    if (!room.roomId) {
      await room.createRoom(stageFile, sliders);
      roomStageFileRef.current = stageFile;
    } else {
      if (roomStageFileRef.current !== stageFile) {
        await room.changeStage(stageFile);
        roomStageFileRef.current = stageFile;
      }
      await room.pushConfig(sliders);
    }
  };

  const exitToTitle = async () => {
    roomStageFileRef.current = null;
    setScreen('title');
    await room.exitAndDelete();
  };

  return (
    <ArcadeStage>
      {screen === 'title' ? (
        <TitleScreen onStart={() => setScreen('select')} />
      ) : null}
      {screen === 'select' ? (
        <CharacterSelect
          selected={character}
          onPick={(c) => {
            setCharacter(c);
            setScreen('config');
          }}
          onBack={() => setScreen('title')}
        />
      ) : null}
      {screen === 'config' ? (
        <ModeSelect
          character={character}
          setup={setup}
          onSetup={setSetup}
          sliders={sliders}
          onSliders={setSliders}
          stageFile={stageFile}
          onStageFile={setStageFile}
          onConfirm={() => void openLobby()}
          onBack={() => setScreen('select')}
        />
      ) : null}
      {screen === 'lobby' ? (
        <Lobby
          character={character}
          setup={setup}
          room={room}
          feed={feed}
          onStart={() =>
            void room.startMatch({
              mode: setup.mode,
              durationMs: setup.mode === 'time' ? setup.durationMs : undefined,
              targetScore:
                setup.mode === 'points' ? setup.targetScore : undefined,
              character: {
                id: character.id,
                name: character.name,
                color: character.color,
              },
            })
          }
          onBack={() => setScreen('config')}
        />
      ) : null}
      {screen === 'game' ? (
        <GameScreen
          character={character}
          setup={setup}
          room={room}
          feed={feed}
          onAbort={() => void room.stopMatch()}
        />
      ) : null}
      {screen === 'results' ? (
        <Results
          character={character}
          feed={feed}
          onPlayAgain={() => {
            void room.resetMatch();
            setScreen('config');
          }}
          onExit={() => void exitToTitle()}
        />
      ) : null}
    </ArcadeStage>
  );
}
