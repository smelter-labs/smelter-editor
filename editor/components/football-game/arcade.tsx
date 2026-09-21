'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { changedSections } from './live-config-diff';
import type { FbMatchEvent, FbStateEvent } from '@smelter-editor/types';
import { getFbState, setFbConfig } from '@/app/actions/actions';
import { RESOLUTION_PRESETS } from '@/lib/resolution';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import {
  FB,
  FbButton,
  FbRecChip,
  FbStage,
  Display,
  HazardStrip,
  Mono,
  ProgressBar,
  WarnPlate,
  chainLink,
} from './fb-kit';
import {
  DEFAULT_FB_UI_CONFIG,
  sanitizeFbAi,
  sanitizeFbDirector,
  sanitizeFbMinimapSize,
  sanitizeReplayDelay,
  sanitizeFbPerf,
  serverConfigToUi,
  useFbRoom,
  type FbUiConfig,
} from './use-fb-room';
import { matchClock, useFbFeed } from './use-fb-feed';
import { TitleScreen } from './screens/title-screen';
import { SetupScreen } from './screens/setup-screen';
import { LobbyScreen } from './screens/lobby-screen';
import { LiveScreen } from './screens/live-screen';
import { ResultsScreen } from './screens/results-screen';
import './fb-kit.css';

type Screen = 'title' | 'setup' | 'lobby' | 'live' | 'results';

const CONFIG_KEY = 'fb-config';
/** The final card lands on air a few seconds after FULL TIME. */
const ENDED_LINGER_MS = 5000;
const FEED_DOWN_RECHECK_MS = 10_000;

function loadConfig(): FbUiConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_FB_UI_CONFIG;
    const p = JSON.parse(raw) as Partial<FbUiConfig>;
    const d = DEFAULT_FB_UI_CONFIG;
    return {
      teams: {
        A: { ...d.teams.A, ...(p.teams?.A ?? {}) },
        B: { ...d.teams.B, ...(p.teams?.B ?? {}) },
      },
      halfMin: typeof p.halfMin === 'number' ? p.halfMin : d.halfMin,
      clockFromClip:
        typeof p.clockFromClip === 'boolean'
          ? p.clockFromClip
          : d.clockFromClip,
      attacksLeft:
        p.attacksLeft === 'A' || p.attacksLeft === 'B' ? p.attacksLeft : null,
      autoFlow: p.autoFlow === true,
      replayDelayMs: sanitizeReplayDelay(p.replayDelayMs),
      director: sanitizeFbDirector(p.director),
      ai: sanitizeFbAi(p.ai),
      replay: typeof p.replay === 'boolean' ? p.replay : d.replay,
      minimap: typeof p.minimap === 'boolean' ? p.minimap : d.minimap,
      minimapSize: sanitizeFbMinimapSize(p.minimapSize),
      resolution:
        p.resolution && p.resolution in RESOLUTION_PRESETS
          ? p.resolution
          : d.resolution,
      perf: sanitizeFbPerf(p.perf),
    };
  } catch {
    return DEFAULT_FB_UI_CONFIG;
  }
}

function deriveScreen(state: FbStateEvent): Screen {
  if (state.phase === 'lobby') return 'lobby';
  if (state.phase === 'ended') return 'results';
  return 'live';
}

/** The /football-game screen machine. */
export function FootballGameArcade({
  initialRoomId,
}: {
  initialRoomId?: string;
}) {
  const [screen, setScreen] = useState<Screen | null>(
    initialRoomId ? null : 'title',
  );
  const [config, setConfig] = useState<FbUiConfig>(DEFAULT_FB_UI_CONFIG);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const router = useRouter();

  const room = useFbRoom(initialRoomId);
  const feed = useFbFeed(room.roomId);
  const rec = useKbtRecording(room.roomId, feed.state?.isRecording ?? false);
  const configDirtyRef = useRef(false);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (!initialRoomId || bootedRef.current) return;
    if (room.roomStatus === 'gone') {
      bootedRef.current = true;
      router.replace('/football-game');
      return;
    }
    if (room.roomStatus !== 'ok' || screen !== null) return;
    bootedRef.current = true;
    getFbState(initialRoomId)
      .then(({ state, match }) => {
        setConfig(serverConfigToUi(state.config, loadConfig().resolution));
        configDirtyRef.current = false;
        setScreen(deriveScreen(state));
      })
      .catch(() => router.replace('/football-game'));
  }, [initialRoomId, room.roomStatus, screen, router]);

  useEffect(() => {
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

  // Perf + director + AI knobs push live while a room exists — only the
  // sections that changed, so the panel's REPLAY / MINIMAP toggles survive.
  const live = {
    perf: config.perf,
    director: config.director,
    ai: config.ai,
    minimap: config.minimap,
    minimapSize: config.minimapSize,
    replay: config.replay,
    replayDelayMs: config.replayDelayMs,
    autoFlow: config.autoFlow,
  };
  const liveJson = JSON.stringify(live);
  const pushedLiveRef = useRef(live);
  useEffect(() => {
    if (!room.roomId) return;
    const patch = changedSections(pushedLiveRef.current, live);
    pushedLiveRef.current = live;
    if (Object.keys(patch).length === 0) return;
    void setFbConfig(room.roomId, patch).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId, liveJson]);

  const phase = feed.state?.phase;
  const endedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (screen === null) return;
    if (
      (phase === 'live' || phase === 'paused' || phase === 'halftime') &&
      (screen === 'lobby' || screen === 'results')
    )
      setScreen('live');
    if (phase === 'lobby' && (screen === 'live' || screen === 'results'))
      setScreen('lobby');
    if (
      phase === 'ended' &&
      screen === 'live' &&
      endedTimerRef.current == null
    ) {
      endedTimerRef.current = window.setTimeout(() => {
        endedTimerRef.current = null;
        setScreen((s) => (s === 'live' ? 'results' : s));
      }, ENDED_LINGER_MS);
    }
    if (phase !== 'ended' && endedTimerRef.current != null) {
      window.clearTimeout(endedTimerRef.current);
      endedTimerRef.current = null;
    }
  }, [phase, screen]);

  const wasRecordingRef = useRef(false);
  useEffect(() => {
    if (rec.effectiveIsRecording) {
      wasRecordingRef.current = true;
      setRecordingSaved(false);
    } else if (wasRecordingRef.current && !rec.isWaitingForDownload) {
      wasRecordingRef.current = false;
      setRecordingSaved(true);
    }
  }, [rec.effectiveIsRecording, rec.isWaitingForDownload]);

  const openLobby = async () => {
    setScreen('lobby');
    if (!room.roomId) {
      await room.createRoom(config);
      configDirtyRef.current = false;
    } else {
      if (configDirtyRef.current) {
        await room.pushConfig(config);
        configDirtyRef.current = false;
      }
      if (feed.state?.phase === 'ended') await room.control('lobby');
    }
  };

  const exitToTitle = async () => {
    if (rec.effectiveIsRecording) await rec.stopAndDownload();
    setScreen('title');
    await room.exitAndDelete();
  };

  const feedConnected = feed.connected;
  useEffect(() => {
    if (room.roomStatus !== 'ok' || feedConnected) return;
    const timer = window.setInterval(() => {
      void room.recheck();
    }, FEED_DOWN_RECHECK_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomStatus, feedConnected, room.recheck]);

  const pitchClosed =
    screen !== null &&
    screen !== 'title' &&
    screen !== 'setup' &&
    room.roomStatus === 'gone';
  const teams = feed.state?.teams;

  return (
    <FbStage>
      {room.roomStatus === 'ok' && !feed.connected && screen !== null ? (
        <HazardStrip position='absolute' text='FEED RECONNECTING… · PITCH' />
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
          <FbRecChip rec={rec} scale={0.85} />
        </div>
      ) : null}
      {room.lastError || room.error ? (
        <div
          style={{
            position: 'absolute',
            bottom: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            width: 560,
            maxWidth: '80%',
          }}>
          <WarnPlate tone='bad' title='SOMETHING BROKE'>
            {room.lastError ?? room.error}
          </WarnPlate>
        </div>
      ) : null}
      {pitchClosed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: FB.page,
            backgroundImage: chainLink(0.06, 22),
            overflow: 'hidden',
          }}>
          <Display
            size={64}
            weight={900}
            tracking={0.06}
            style={{
              position: 'relative',
              background: FB.page,
              padding: '6px 20px',
            }}>
            PITCH CLOSED
          </Display>
          <Mono
            size={11}
            tracking={0.06}
            uppercase={false}
            color={FB.dim}
            style={{
              position: 'relative',
              background: FB.page,
              padding: '4px 12px',
              textAlign: 'center',
              maxWidth: 460,
            }}>
            The room no longer exists on the server (restart or idle cleanup).
            Start a fresh match.
          </Mono>
          <FbButton
            variant='outline'
            label='BACK TO TITLE'
            onClick={() => {
              window.history.replaceState(null, '', '/football-game');
              setScreen('title');
            }}
            style={{
              position: 'relative',
              background: FB.page,
              height: 48,
              fontSize: 22,
            }}
          />
        </div>
      ) : null}
      {screen === null ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
          }}>
          <ProgressBar width={280} height={6} indeterminate />
          <Mono size={14} weight={600} tracking={0.24}>
            RESTORING THE MATCH…
          </Mono>
          <Mono
            size={12}
            tracking={0.18}
            color={FB.chalk}
            style={{ opacity: 0.5 }}>
            ROOM {initialRoomId ?? '—'}
            {teams
              ? ` · ${teams.A.score} : ${teams.B.score} · ${matchClock(feed.match, feed.matchReceivedAt)}`
              : ''}
          </Mono>
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
          onConfirm={() => void openLobby()}
          onBack={() => setScreen('title')}
        />
      ) : null}
      {screen === 'lobby' ? (
        <LobbyScreen
          room={room}
          feed={feed}
          onStart={() => void room.control('start')}
          onBack={() => setScreen('setup')}
        />
      ) : null}
      {screen === 'live' ? <LiveScreen room={room} feed={feed} /> : null}
      {screen === 'results' ? (
        <ResultsScreen
          feed={feed}
          roomId={room.roomId}
          recordingSaved={recordingSaved}
          onNewMatch={async () => {
            await room.control('reset');
            setScreen('lobby');
          }}
          onExit={() => void exitToTitle()}
        />
      ) : null}
    </FbStage>
  );
}
