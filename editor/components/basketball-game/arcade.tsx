'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BbMatchEvent, BbStateEvent } from '@smelter-editor/types';
import { getBbState, setBbConfig } from '@/app/actions/actions';
import { RESOLUTION_PRESETS } from '@/lib/resolution';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import {
  BB,
  BbButton,
  BbRecChip,
  BbStage,
  Display,
  HazardStrip,
  Mono,
  ProgressBar,
  WarnPlate,
  chainLink,
} from './bb-kit';
import {
  DEFAULT_BB_UI_CONFIG,
  sanitizeBbDetector,
  sanitizeBbPerf,
  serverConfigToUi,
  useBbRoom,
  type BbUiConfig,
} from './use-bb-room';
import { formatClock, remainingNow, useBbFeed } from './use-bb-feed';
import { TitleScreen } from './screens/title-screen';
import { SetupScreen } from './screens/setup-screen';
import { LobbyScreen } from './screens/lobby-screen';
import { LiveScreen } from './screens/live-screen';
import { ResultsScreen } from './screens/results-screen';
import './bb-kit.css';

type Screen = 'title' | 'setup' | 'lobby' | 'live' | 'results';

const CONFIG_KEY = 'bb-config';
/** The final card lands on air ~3 s (hold) + ~2.5 s (score linger) late. */
const ENDED_LINGER_MS = 6000;
const FEED_DOWN_RECHECK_MS = 10_000;

function loadConfig(): BbUiConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_BB_UI_CONFIG;
    const p = JSON.parse(raw) as Partial<BbUiConfig>;
    const d = DEFAULT_BB_UI_CONFIG;
    return {
      teams: {
        A: { ...d.teams.A, ...(p.teams?.A ?? {}) },
        B: { ...d.teams.B, ...(p.teams?.B ?? {}) },
      },
      teamSize: p.teamSize === 1 || p.teamSize === 2 ? p.teamSize : 3,
      targetPoints:
        typeof p.targetPoints === 'number' ? p.targetPoints : d.targetPoints,
      durationSec:
        typeof p.durationSec === 'number' ? p.durationSec : d.durationSec,
      otWinPoints:
        typeof p.otWinPoints === 'number' ? p.otWinPoints : d.otWinPoints,
      arcPoints: p.arcPoints === 1 ? 1 : 2,
      autoAssignMinConf:
        typeof p.autoAssignMinConf === 'number'
          ? p.autoAssignMinConf
          : d.autoAssignMinConf,
      shotFrames:
        typeof p.shotFrames === 'boolean' ? p.shotFrames : d.shotFrames,
      replay: typeof p.replay === 'boolean' ? p.replay : d.replay,
      detector: sanitizeBbDetector(p.detector),
      resolution:
        p.resolution && p.resolution in RESOLUTION_PRESETS
          ? p.resolution
          : d.resolution,
      perf: sanitizeBbPerf(p.perf),
    };
  } catch {
    return DEFAULT_BB_UI_CONFIG;
  }
}

function deriveScreen(state: BbStateEvent, _match: BbMatchEvent): Screen {
  if (state.phase === 'lobby') return 'lobby';
  if (state.phase === 'ended') return 'results';
  return 'live';
}

/** The /basketball-game screen machine. */
export function BasketballGameArcade({
  initialRoomId,
}: {
  initialRoomId?: string;
}) {
  const [screen, setScreen] = useState<Screen | null>(
    initialRoomId ? null : 'title',
  );
  const [config, setConfig] = useState<BbUiConfig>(DEFAULT_BB_UI_CONFIG);
  const [recordingSaved, setRecordingSaved] = useState(false);
  const router = useRouter();

  const room = useBbRoom(initialRoomId);
  const feed = useBbFeed(room.roomId);
  const rec = useKbtRecording(room.roomId, feed.state?.isRecording ?? false);
  const configDirtyRef = useRef(false);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (!initialRoomId || bootedRef.current) return;
    if (room.roomStatus === 'gone') {
      bootedRef.current = true;
      router.replace('/basketball-game');
      return;
    }
    if (room.roomStatus !== 'ok' || screen !== null) return;
    bootedRef.current = true;
    getBbState(initialRoomId)
      .then(({ state, match }) => {
        setConfig(serverConfigToUi(state.config, loadConfig().resolution));
        configDirtyRef.current = false;
        setScreen(deriveScreen(state, match));
      })
      .catch(() => router.replace('/basketball-game'));
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

  // Perf + detector knobs push live while a room exists.
  const liveJson = JSON.stringify({
    perf: config.perf,
    detector: config.detector,
  });
  const pushedLiveRef = useRef(liveJson);
  useEffect(() => {
    if (!room.roomId || pushedLiveRef.current === liveJson) return;
    pushedLiveRef.current = liveJson;
    void setBbConfig(room.roomId, {
      perf: config.perf,
      detector: config.detector,
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId, liveJson]);

  // Follow the server's phase.
  const phase = feed.state?.phase;
  const endedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (screen === null) return;
    if (
      (phase === 'live' || phase === 'paused' || phase === 'overtime') &&
      (screen === 'lobby' || screen === 'results')
    ) {
      setScreen('live');
    }
    if (phase === 'lobby' && (screen === 'live' || screen === 'results')) {
      setScreen('lobby');
    }
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

  // "RECORDING SAVED" on the final card once a stop finalized.
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

  const courtClosed =
    screen !== null &&
    screen !== 'title' &&
    screen !== 'setup' &&
    room.roomStatus === 'gone';

  const teams = feed.state?.teams;
  const remaining = remainingNow(feed.match, feed.matchReceivedAt);

  return (
    <BbStage>
      {room.roomStatus === 'ok' && !feed.connected && screen !== null ? (
        <HazardStrip position='absolute' text='FEED RECONNECTING… · COURT' />
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
          <BbRecChip rec={rec} scale={0.85} />
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
      {courtClosed ? (
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
            background: BB.page,
            backgroundImage: chainLink(0.06, 22),
            overflow: 'hidden',
          }}>
          <div
            aria-hidden
            style={{
              position: 'absolute',
              left: -20,
              right: -20,
              top: '46%',
              height: 26,
              background: `repeating-linear-gradient(90deg, transparent 0 40px, ${BB.page} 40px 42px), ${BB.amber}`,
              transform: 'rotate(-4deg)',
            }}
          />
          <Display
            size={64}
            weight={900}
            tracking={0.06}
            style={{
              position: 'relative',
              background: BB.page,
              padding: '6px 20px',
            }}>
            COURT CLOSED
          </Display>
          <Mono
            size={11}
            tracking={0.06}
            uppercase={false}
            color={BB.dim}
            style={{
              position: 'relative',
              background: BB.page,
              padding: '4px 12px',
              textAlign: 'center',
              maxWidth: 460,
            }}>
            The room no longer exists on the server (restart or idle cleanup).
            Start a fresh court.
          </Mono>
          <BbButton
            variant='outline'
            label='BACK TO TITLE'
            onClick={() => {
              window.history.replaceState(null, '', '/basketball-game');
              setScreen('title');
            }}
            style={{
              position: 'relative',
              background: BB.page,
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
            RESTORING THE COURT…
          </Mono>
          <Mono
            size={12}
            tracking={0.18}
            color={BB.chalk}
            style={{ opacity: 0.5 }}>
            ROOM {initialRoomId ?? '—'}
            {teams
              ? ` · SCORE ${teams.A.score} : ${teams.B.score} · ${formatClock(remaining)}`
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
    </BbStage>
  );
}
