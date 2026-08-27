'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  KbtConfig,
  KbtMatchEvent,
  KbtStateEvent,
} from '@smelter-editor/types';
import { getKbtState } from '@/app/actions/actions';
import { RESOLUTION_PRESETS } from '@/lib/resolution';
import {
  DisplayText,
  KBT,
  KbtButton,
  KbtStatusStrip,
  Label,
  Stage,
  WarnPlate,
  kbtMonoFont,
} from './kbt-kit';
import {
  DEFAULT_KBT_UI_CONFIG,
  useKbtRoom,
  type KbtUiConfig,
} from './use-kbt-room';
import { useKbtFeed } from './use-kbt-feed';
import { useKbtRecording } from './use-kbt-recording';
import { RecChip } from './recording-control';
import { TitleScreen } from './screens/title-screen';
import { SetupScreen } from './screens/setup-screen';
import { RosterScreen } from './screens/roster-screen';
import { HeatScreen } from './screens/heat-screen';
import { ResultsScreen } from './screens/results-screen';
import { PodiumScreen } from './screens/podium-screen';
import './kbt-kit.css';

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
      // Old localStorage blobs lack the key → land on 'front' (back-compat).
      cameraView: p.cameraView === 'side' ? 'side' : 'front',
      repScreenshots:
        typeof p.repScreenshots === 'boolean' ? p.repScreenshots : false,
      // Old localStorage blobs lack the key → celebration on by default.
      milestoneFx: typeof p.milestoneFx === 'boolean' ? p.milestoneFx : true,
      // Old localStorage blobs lack the key → floating rep text on.
      repFloatText: typeof p.repFloatText === 'boolean' ? p.repFloatText : true,
      // Old localStorage blobs lack the key → incorrect reps count.
      countIncorrectReps:
        typeof p.countIncorrectReps === 'boolean' ? p.countIncorrectReps : true,
      // Old localStorage blobs lack the key → HD (back-compat).
      resolution:
        p.resolution && p.resolution in RESOLUTION_PRESETS
          ? p.resolution
          : DEFAULT_KBT_UI_CONFIG.resolution,
    };
  } catch {
    return DEFAULT_KBT_UI_CONFIG;
  }
}

/** Server config (ms) → UI config (seconds). The server is the source of
 * truth after a refresh — localStorage may belong to another session. */
function serverConfigToUi(cfg: KbtConfig): KbtUiConfig {
  return {
    scoring: {
      swing: { ...cfg.scoring.swing },
      clean: { ...cfg.scoring.clean },
      snatch: { ...cfg.scoring.snatch },
    },
    strictTechnique: cfg.strictTechnique,
    heatDurationSec: Math.round(cfg.heatDurationMs / 1000),
    heatSize: cfg.heatSize,
    cameraView: cfg.cameraView === 'side' ? 'side' : 'front',
    repScreenshots: !!cfg.repScreenshots,
    milestoneFx: cfg.milestoneFx !== false,
    repFloatText: cfg.repFloatText !== false,
    countIncorrectReps: cfg.countIncorrectReps !== false,
    // Not part of the server config — resolution is fixed at room creation,
    // so after a refresh keep whatever this browser last picked.
    resolution: loadConfig().resolution,
  };
}

/** How long the live feed may stay down before we ask if the room is gone. */
const FEED_DOWN_RECHECK_MS = 10_000;

/**
 * Reconstruct the host screen from a server snapshot after a refresh on
 * /kettlebell-tournament/[roomId]. 'title'/'setup'/'results' have no server
 * phase; the closest sensible screen is derived from the tournament phase
 * plus the current heat's phase.
 */
function deriveScreen(state: KbtStateEvent, match: KbtMatchEvent): Screen {
  if (state.tournamentPhase === 'roster') return 'roster';
  if (state.tournamentPhase === 'podium') return 'podium';
  // 'heats' | 'final'
  if (
    match.phase === 'intro' ||
    match.phase === 'countdown' ||
    match.phase === 'playing'
  ) {
    return 'heat';
  }
  // 'ended' skips the buzzer linger — the delayed video already aired it.
  if (match.phase === 'ended') return 'results';
  // idle mid-tournament: standings if anything has run, else staging roster.
  return state.heats.some((h) => h.phase === 'ended') ? 'results' : 'roster';
}

/** The /kettlebell-tournament screen machine. */
export function KettlebellTournamentArcade({
  initialRoomId,
}: {
  initialRoomId?: string;
}) {
  // null = booting: rehydrating the screen from the server after a refresh.
  const [screen, setScreen] = useState<Screen | null>(
    initialRoomId ? null : 'title',
  );
  const [config, setConfig] = useState<KbtUiConfig>(DEFAULT_KBT_UI_CONFIG);
  const router = useRouter();

  const room = useKbtRoom(initialRoomId);
  const feed = useKbtFeed(room.roomId);
  const rec = useKbtRecording(room.roomId, feed.state?.isRecording ?? false);

  // Config edited locally since the last push? A refreshed host must not
  // clobber the live server config just by clicking through to the roster.
  const configDirtyRef = useRef(false);

  // Boot on /[roomId]: once the room checks out, pick the screen from a state
  // snapshot (and take the server's config — localStorage may be another
  // browser's stale copy); a dead room bounces back to the plain arcade entry.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (!initialRoomId || bootedRef.current) return;
    if (room.roomStatus === 'gone') {
      bootedRef.current = true;
      router.replace('/kettlebell-tournament');
      return;
    }
    if (room.roomStatus !== 'ok' || screen !== null) return;
    bootedRef.current = true;
    getKbtState(initialRoomId)
      .then(({ state, match }) => {
        setConfig(serverConfigToUi(state.config));
        configDirtyRef.current = false;
        setScreen(deriveScreen(state, match));
      })
      .catch(() => router.replace('/kettlebell-tournament'));
  }, [initialRoomId, room.roomStatus, screen, router]);

  useEffect(() => {
    // With a room in the URL the boot effect hydrates config from the server.
    if (!initialRoomId) setConfig(loadConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Still booting from a snapshot — let the boot effect pick first.
    if (screen === null) return;
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
      configDirtyRef.current = false;
    } else {
      // Only push what the host actually edited this session — a refreshed
      // tab clicking through must not overwrite the live rules.
      if (configDirtyRef.current) {
        await room.pushConfig(config);
        configDirtyRef.current = false;
      }
      await room.control('roster');
    }
  };

  const exitToTitle = async () => {
    // Save the show before the room dies — teardown would silently unregister
    // the recording with no download. The 1.5s download timer survives the
    // screen change (the arcade itself stays mounted).
    if (rec.effectiveIsRecording) await rec.stopAndDownload();
    setScreen('title');
    await room.exitAndDelete();
  };

  // The live feed stayed down for a while: check whether the room is gone
  // (server restart, 30-min idle GC) so the host sees ARENA CLOSED instead
  // of a silently frozen tournament.
  const feedConnected = feed.connected;
  useEffect(() => {
    if (room.roomStatus !== 'ok' || feedConnected) return;
    const timer = window.setInterval(() => {
      void room.recheck();
    }, FEED_DOWN_RECHECK_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomStatus, feedConnected, room.recheck]);

  const arenaClosed =
    screen !== null &&
    screen !== 'title' &&
    screen !== 'setup' &&
    room.roomStatus === 'gone';

  return (
    <Stage>
      {room.roomStatus === 'ok' && !feed.connected && screen !== null ? (
        <KbtStatusStrip position='absolute' text='FEED RECONNECTING…' />
      ) : null}
      {room.roomId && room.roomStatus === 'ok' && screen !== null ? (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 45,
          }}>
          <RecChip rec={rec} />
        </div>
      ) : null}
      {room.lastError ? (
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            maxWidth: '80%',
          }}>
          <WarnPlate>{room.lastError}</WarnPlate>
        </div>
      ) : null}
      {arenaClosed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            background: KBT.overlayHeavy,
          }}>
          <DisplayText size={34} weight={800} tracking={3} color={KBT.bad}>
            ARENA CLOSED
          </DisplayText>
          <span
            style={{
              fontFamily: kbtMonoFont,
              fontSize: 12,
              letterSpacing: 0.5,
              color: KBT.dim,
              textAlign: 'center',
              maxWidth: 460,
            }}>
            The room no longer exists on the server (restart or idle cleanup).
            The tournament state is gone — start a fresh arena.
          </span>
          <KbtButton
            label='BACK TO TITLE'
            onClick={() => {
              window.history.replaceState(null, '', '/kettlebell-tournament');
              setScreen('title');
            }}
          />
        </div>
      ) : null}
      {screen === null ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <DisplayText size={26} weight={700} tracking={3} color={KBT.dim}>
            RESTORING ARENA…
          </DisplayText>
        </div>
      ) : null}
      {screen === 'title' ? (
        <TitleScreen onStart={() => setScreen('setup')} />
      ) : null}
      {screen === 'setup' ? (
        <SetupScreen
          config={config}
          onConfig={(c) => {
            configDirtyRef.current = true;
            setConfig(c);
          }}
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
          onForceBegin={() => void room.control('force_begin')}
          onKick={(clientId) =>
            void room.control('kick_player', undefined, clientId)
          }
          onRestart={() => void room.control('restart_heat')}
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
    </Stage>
  );
}
