'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObConfigPatch,
  ObPhase,
  ObRuleset,
  ObState,
} from '@smelter-editor/types';
import { getObState, setObConfig } from '@/app/actions/actions';
import { useKbtRecording } from '@/components/kettlebell-tournament/use-kbt-recording';
import { changedSections } from '@/components/football-game/live-config-diff';
import { useJoinLinkPush, useJoinLinks } from '@/lib/arcade/use-join-link';
import {
  DEFAULT_OB_UI_CONFIG,
  sanitizeObUiConfig,
  serverConfigToUi,
  uiConfigToPatch,
  type ObUiConfig,
} from '@/lib/ob-van/ui-config';
import {
  Display,
  HazardStrip,
  Meta,
  Mono,
  OB,
  ObButton,
  ObRecChip,
  ObStage,
  ProgressBar,
  WarnPlate,
  deskGrid,
} from './ob-kit';
import { useObRoom } from './use-ob-room';
import { useObFeed } from './use-ob-feed';
import { TitleScreen } from './screens/title-screen';
import { SetupScreen } from './screens/setup-screen';
import { OnAirScreen } from './screens/on-air-screen';
import { WrapScreen } from './screens/wrap-screen';
import './ob-kit.css';

type Screen = 'title' | 'setup' | 'on-air' | 'wrap';

const CONFIG_KEY = 'ob-config';
const FEED_DOWN_RECHECK_MS = 10_000;
/** Text fields push once typing settles. */
const PUSH_DEBOUNCE_MS = 350;

function loadConfig(): ObUiConfig {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    return raw ? sanitizeObUiConfig(JSON.parse(raw)) : DEFAULT_OB_UI_CONFIG;
  } catch {
    return DEFAULT_OB_UI_CONFIG;
  }
}

export function deriveScreen(phase: ObPhase): Screen {
  return phase;
}

/** Links the host shows (and pushes) for a room: phone cams + the panel. */
export type ObJoinLinks = {
  cam: string;
  panel: string;
  label: string;
};

/** The /ob-van screen machine: title → setup → on air → wrap. */
export function ObVanArcade({ initialRoomId }: { initialRoomId?: string }) {
  const [screen, setScreen] = useState<Screen | null>(
    initialRoomId ? null : 'title',
  );
  const [config, setConfig] = useState<ObUiConfig>(DEFAULT_OB_UI_CONFIG);
  const [recordingSaved, setRecordingSaved] = useState(false);

  // The room hook hands REST replies to the feed (no wait for the echo).
  const ingestRef = useRef<((state: ObState) => void) | null>(null);
  const room = useObRoom(initialRoomId, (s) => ingestRef.current?.(s));
  const feed = useObFeed(room.roomId);
  ingestRef.current = feed.ingestState;
  const rec = useKbtRecording(room.roomId, feed.state?.isRecording ?? false);

  // ── join links (phones + panel), the cam link pushed for the on-air QR ──
  const joinPaths = room.roomId
    ? {
        cam: `/ob-van/cam?room=${encodeURIComponent(room.roomId)}`,
        panel: `/ob-van/panel/${encodeURIComponent(room.roomId)}`,
      }
    : { cam: '', panel: '' };
  const join = useJoinLinks(room.roomId, joinPaths);
  const joinLinks: ObJoinLinks = {
    cam: join.links.cam,
    panel: join.links.panel,
    label: join.label,
  };
  const pushJoinUrl = useCallback(
    (roomId: string, url: string) =>
      setObConfig(roomId, { joinUrls: { cam: url } }),
    [],
  );
  useJoinLinkPush({
    roomId: room.roomId,
    url: join.links.cam,
    label: join.label,
    push: pushJoinUrl,
  });

  // ── config: localStorage + live push of the changed sections ──
  const pushedRef = useRef<ObConfigPatch | null>(null);
  const markSynced = useCallback((cfg: ObUiConfig) => {
    pushedRef.current = uiConfigToPatch(cfg);
  }, []);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (!initialRoomId || bootedRef.current) return;
    if (room.roomStatus === 'gone') {
      bootedRef.current = true;
      window.location.replace('/ob-van');
      return;
    }
    if (room.roomStatus !== 'ok' || screen !== null) return;
    bootedRef.current = true;
    const local = loadConfig();
    getObState(initialRoomId)
      .then((state) => {
        const cfg = serverConfigToUi(state.config, local);
        setConfig(cfg);
        markSynced(cfg);
        feed.ingestState(state);
        setScreen(deriveScreen(state.phase));
      })
      .catch(() => window.location.replace('/ob-van'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRoomId, room.roomStatus, screen, markSynced]);

  useEffect(() => {
    if (!initialRoomId) setConfig(loadConfig());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch {
      /* storage blocked */
    }
  }, [config]);

  const patch = uiConfigToPatch(config);
  const patchJson = JSON.stringify(patch);
  useEffect(() => {
    if (!room.roomId || screen === null || screen === 'title') return;
    const timer = window.setTimeout(() => {
      // Read the baseline at fire time: a ruleset the server just accepted
      // may have moved it since this push was scheduled.
      const base = pushedRef.current;
      if (!base) return;
      const diff = changedSections(base, patch);
      if (Object.keys(diff).length === 0) return;
      pushedRef.current = patch;
      void room.pushPatch(diff);
    }, PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId, patchJson, screen]);

  /** A ruleset the server accepted (rules cards, RAW JSON, the LLM). */
  const onRulesetApplied = useCallback(
    (ruleset: ObRuleset | null, origin: 'llm' | 'custom') => {
      setConfig((c) => {
        const next = { ...c, ruleset, rulesOrigin: origin };
        if (pushedRef.current)
          pushedRef.current = { ...pushedRef.current, ruleset };
        return next;
      });
    },
    [],
  );

  // ── follow the server's phase ──
  const phase = feed.state?.phase;
  const prevPhaseRef = useRef<ObPhase | undefined>(phase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase;
    if (screen === null || screen === 'title' || !phase) return;
    // Back to SETUP after a wrap (NEW EVENT): the panel may have changed
    // things during the show — start from what the server has.
    if (phase === 'setup' && prev && prev !== 'setup' && feed.state) {
      const cfg = serverConfigToUi(feed.state.config, config);
      setConfig(cfg);
      markSynced(cfg);
    }
    const target = deriveScreen(phase);
    if (target !== screen) setScreen(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, screen]);

  // ── recording ──
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

  // ── actions ──
  const newEvent = async () => {
    if (room.creating || room.roomId) {
      if (room.roomId) setScreen('setup');
      return;
    }
    const created = await room.createRoom(config);
    if (created) {
      markSynced(config);
      setScreen('setup');
    }
  };

  const goLive = async () => {
    const state = await room.control('go_live');
    if (state && config.record && !rec.effectiveIsRecording) void rec.toggle();
  };

  const wrap = async () => {
    await room.control('wrap');
    if (rec.effectiveIsRecording) await rec.stopAndDownload();
  };

  const exitToTitle = async () => {
    if (rec.effectiveIsRecording) await rec.stopAndDownload();
    setScreen('title');
    pushedRef.current = null;
    await room.exitAndDelete();
  };

  const feedConnected = feed.connected;
  // The strip waits a moment: the first connect (and a quick blip) is not
  // worth a hazard bar over the whole screen.
  const [feedDownLong, setFeedDownLong] = useState(false);
  useEffect(() => {
    if (feedConnected || !room.roomId) {
      setFeedDownLong(false);
      return;
    }
    const timer = window.setTimeout(() => setFeedDownLong(true), 2500);
    return () => window.clearTimeout(timer);
  }, [feedConnected, room.roomId]);
  useEffect(() => {
    if (room.roomStatus !== 'ok' || feedConnected) return;
    const timer = window.setInterval(() => {
      void room.recheck();
    }, FEED_DOWN_RECHECK_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomStatus, feedConnected, room.recheck]);

  const eventClosed =
    screen !== null &&
    screen !== 'title' &&
    (room.roomStatus === 'gone' || feed.roomGone);

  return (
    <ObStage>
      {room.roomStatus === 'ok' &&
      feedDownLong &&
      screen !== null &&
      screen !== 'title' ? (
        <HazardStrip position='absolute' text='FEED RECONNECTING…' />
      ) : null}
      {room.roomId &&
      room.roomStatus === 'ok' &&
      screen !== null &&
      screen !== 'title' ? (
        <div
          style={{
            position: 'absolute',
            top: 11,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 45,
          }}>
          <ObRecChip rec={rec} />
        </div>
      ) : null}
      {room.lastError || room.error ? (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            width: 520,
            maxWidth: '80%',
          }}>
          <WarnPlate tone='bad' title='REFUSED'>
            {room.lastError ?? room.error}
          </WarnPlate>
        </div>
      ) : null}
      {eventClosed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            background: OB.page,
            backgroundImage: deskGrid(),
            backgroundSize: '40px 40px',
          }}>
          <Display size={56} weight={800} tracking={0.06}>
            EVENT CLOSED
          </Display>
          <Mono
            size={11}
            tracking={0.04}
            uppercase={false}
            color={OB.dim}
            style={{ textAlign: 'center', maxWidth: 440 }}>
            The room no longer exists on the server (restart or idle cleanup).
            Start a fresh event.
          </Mono>
          <ObButton
            label='BACK TO TITLE'
            onClick={() => {
              window.history.replaceState(null, '', '/ob-van');
              pushedRef.current = null;
              setScreen('title');
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
            gap: 16,
          }}>
          <ProgressBar width={260} height={4} indeterminate />
          <Mono size={13} weight={600} tracking={0.22}>
            RESTORING THE EVENT…
          </Mono>
          <Meta>ROOM {initialRoomId ?? '—'}</Meta>
        </div>
      ) : null}
      {screen === 'title' ? (
        <TitleScreen
          creating={room.creating}
          resolution={config.resolution}
          onResolution={(resolution) =>
            setConfig((c) => ({ ...c, resolution }))
          }
          eventName={config.eventName}
          onNewEvent={() => void newEvent()}
        />
      ) : null}
      {screen === 'setup' ? (
        <SetupScreen
          room={room}
          feed={feed}
          config={config}
          onConfig={setConfig}
          onRulesetApplied={onRulesetApplied}
          joinLinks={joinLinks}
          onGoLive={() => void goLive()}
          onExit={() => void exitToTitle()}
        />
      ) : null}
      {screen === 'on-air' ? (
        <OnAirScreen
          room={room}
          feed={feed}
          config={config}
          onConfig={setConfig}
          joinLinks={joinLinks}
          onWrap={() => void wrap()}
        />
      ) : null}
      {screen === 'wrap' ? (
        <WrapScreen
          room={room}
          feed={feed}
          rec={rec}
          recordingSaved={recordingSaved}
          onNewEvent={() => void room.control('reset')}
          onExit={() => void exitToTitle()}
        />
      ) : null}
    </ObStage>
  );
}
