'use client';

import { useEffect, useRef, useState } from 'react';
import { ArcadeStage } from '../duck-hunter/retro-kit';
import {
  DEFAULT_KBT_UI_CONFIG,
  useKbtRoom,
  type KbtUiConfig,
} from './use-kbt-room';
import { useKbtFeed } from './use-kbt-feed';
import { TitleScreen } from './screens/title-screen';
import { SetupScreen } from './screens/setup-screen';
import { RosterScreen } from './screens/roster-screen';
import { HeatScreen } from './screens/heat-screen';
import { ResultsScreen } from './screens/results-screen';
import { PodiumScreen } from './screens/podium-screen';
import '../duck-hunter/retro.css';

type Screen = 'title' | 'setup' | 'roster' | 'heat' | 'results' | 'podium';

const CONFIG_KEY = 'kbt-config';
/**
 * The composited video runs ~3s behind the live clock (WHIP side-channel
 * hold), so the page lingers on the heat screen after 'ended' until the
 * buzzer has actually aired.
 */
const ENDED_LINGER_MS = 3200;

function loadConfig(): KbtUiConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_KBT_UI_CONFIG;
    const p = JSON.parse(raw) as Partial<KbtUiConfig>;
    return {
      scoring: {
        swing: p.scoring?.swing ?? DEFAULT_KBT_UI_CONFIG.scoring.swing,
        clean: p.scoring?.clean ?? DEFAULT_KBT_UI_CONFIG.scoring.clean,
        snatch: p.scoring?.snatch ?? DEFAULT_KBT_UI_CONFIG.scoring.snatch,
      },
      strictTechnique:
        typeof p.strictTechnique === 'boolean' ? p.strictTechnique : false,
      heatDurationSec:
        typeof p.heatDurationSec === 'number' ? p.heatDurationSec : 60,
      heatSize: typeof p.heatSize === 'number' ? p.heatSize : 2,
    };
  } catch {
    return DEFAULT_KBT_UI_CONFIG;
  }
}

/** The /kettlebell-tournament screen machine. */
export function KettlebellTournamentArcade() {
  const [screen, setScreen] = useState<Screen>('title');
  const [config, setConfig] = useState<KbtUiConfig>(DEFAULT_KBT_UI_CONFIG);

  const room = useKbtRoom();
  const feed = useKbtFeed(room.roomId);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }, [config]);

  // The server owns the heat lifecycle — follow its phase. Guards on the
  // current screen keep manual navigation in charge, and the results
  // transition waits for the delayed video to catch up with the buzzer.
  const phase = feed.match?.phase;
  const endedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      (phase === 'intro' || phase === 'countdown' || phase === 'playing') &&
      (screen === 'roster' || screen === 'results')
    ) {
      setScreen('heat');
    }
    if (
      phase === 'ended' &&
      screen === 'heat' &&
      endedTimerRef.current == null
    ) {
      endedTimerRef.current = window.setTimeout(() => {
        endedTimerRef.current = null;
        setScreen((s) => (s === 'heat' ? 'results' : s));
      }, ENDED_LINGER_MS);
    }
    if (phase !== 'ended' && endedTimerRef.current != null) {
      window.clearTimeout(endedTimerRef.current);
      endedTimerRef.current = null;
    }
  }, [phase, screen]);

  const openRoster = async () => {
    setScreen('roster');
    if (!room.roomId) {
      await room.createRoom(config);
    } else {
      await room.pushConfig(config);
      await room.control('roster');
    }
  };

  const exitToTitle = async () => {
    setScreen('title');
    await room.exitAndDelete();
  };

  return (
    <ArcadeStage>
      {screen === 'title' ? (
        <TitleScreen onStart={() => setScreen('setup')} />
      ) : null}
      {screen === 'setup' ? (
        <SetupScreen
          config={config}
          onConfig={setConfig}
          onConfirm={() => void openRoster()}
          onBack={() => setScreen('title')}
        />
      ) : null}
      {screen === 'roster' ? (
        <RosterScreen
          room={room}
          feed={feed}
          onDrawHeats={() => void room.control('assign_heats')}
          onStageHeat={(index) => void room.control('start_heat', index)}
          onBack={() => setScreen('setup')}
        />
      ) : null}
      {screen === 'heat' ? (
        <HeatScreen
          room={room}
          feed={feed}
          onBegin={() => void room.control('begin_heat')}
          onAbort={() => void room.control('stop_heat')}
        />
      ) : null}
      {screen === 'results' ? (
        <ResultsScreen
          feed={feed}
          onNextHeat={async () => {
            // next_heat points currentHeatIndex at the first idle heat;
            // start_heat with no index stages exactly that one.
            await room.control('next_heat');
            await room.control('start_heat');
          }}
          onStartFinal={async () => {
            await room.control('start_final');
            await room.control('start_heat');
          }}
          onPodium={async () => {
            await room.control('podium');
            setScreen('podium');
          }}
        />
      ) : null}
      {screen === 'podium' ? (
        <PodiumScreen
          feed={feed}
          onPlayAgain={async () => {
            await room.control('reset');
            setScreen('roster');
          }}
          onExit={() => void exitToTitle()}
        />
      ) : null}
    </ArcadeStage>
  );
}
