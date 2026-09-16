'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ShooterMatchConfig,
  ShooterMatchMode,
} from '@smelter-editor/types';
import { ArcadeStage, R5, monoFont } from './retro-kit';
import {
  stageKey,
  stageMatchesInput,
  useDuckHunterRoom,
  type DuckHunterSliderConfig,
  type StageRef,
} from './use-duck-hunter-room';
import { useShooterFeed } from './use-shooter-feed';
import { TitleScreen } from './screens/title-screen';
import { ModeSelect } from './screens/mode-select';
import { Lobby, lobbyReady } from './screens/lobby';
import { RulesScreen, type RulesIntent } from './screens/rules';
import { PipelineScreen } from './screens/pipeline';
import { GameScreen } from './screens/game-screen';
import { Results } from './screens/results';
import './retro.css';

// Characters are picked per player on the phones, so the host flow goes
// straight from the title to the match config. 'rules' (HOW TO PLAY) and
// 'pipeline' (HOW IT WORKS) are lobby side-screens: the rules also run as the
// briefing between START and the server's countdown.
type Screen =
  | 'title'
  | 'config'
  | 'lobby'
  | 'rules'
  | 'pipeline'
  | 'game'
  | 'results';

export type MatchSetup = {
  mode: ShooterMatchMode;
  durationMs: number;
  targetScore: number;
};

const AMMO_CFG_KEY = 'duck-hunter-ammo';
export const DEFAULT_STAGE: StageRef = {
  kind: 'mp4',
  file: 'DucksCompilation.mp4',
};

const DEFAULT_SLIDERS: DuckHunterSliderConfig = {
  maxAmmo: 6,
  reloadSec: 1.5,
  duckScale: 0.6,
  auraLeadSec: 0.2,
  fleeSec: 0.7,
  flySpeed: 0.15,
  crosshairBadges: true,
  duckRespawn: true,
};

/** Same localStorage shape as the dashboard DuckHunterPanel, so tuning done
 * in either place carries over. */
function loadSliders(): DuckHunterSliderConfig {
  try {
    const raw = window.localStorage.getItem(AMMO_CFG_KEY);
    if (!raw) return DEFAULT_SLIDERS;
    const p = JSON.parse(raw) as Partial<DuckHunterSliderConfig>;
    return {
      maxAmmo:
        typeof p.maxAmmo === 'number' ? p.maxAmmo : DEFAULT_SLIDERS.maxAmmo,
      reloadSec:
        typeof p.reloadSec === 'number'
          ? p.reloadSec
          : DEFAULT_SLIDERS.reloadSec,
      duckScale:
        typeof p.duckScale === 'number'
          ? p.duckScale
          : DEFAULT_SLIDERS.duckScale,
      auraLeadSec:
        typeof p.auraLeadSec === 'number'
          ? p.auraLeadSec
          : DEFAULT_SLIDERS.auraLeadSec,
      fleeSec:
        typeof p.fleeSec === 'number' ? p.fleeSec : DEFAULT_SLIDERS.fleeSec,
      flySpeed:
        typeof p.flySpeed === 'number' ? p.flySpeed : DEFAULT_SLIDERS.flySpeed,
      crosshairBadges:
        typeof p.crosshairBadges === 'boolean'
          ? p.crosshairBadges
          : DEFAULT_SLIDERS.crosshairBadges,
      duckRespawn:
        typeof p.duckRespawn === 'boolean'
          ? p.duckRespawn
          : DEFAULT_SLIDERS.duckRespawn,
    };
  } catch {
    return DEFAULT_SLIDERS;
  }
}

/**
 * The /duck-hunter screen machine. Mounted once from the /duck-hunter layout
 * (see arcade-host.tsx) so the URL rewrite after room creation cannot remount
 * it — everything here is in-memory state that has to outlive that rewrite.
 */
export function DuckHunterArcade({
  initialRoomId,
}: {
  /** Room from the URL (/duck-hunter/[roomId]): rehydrate instead of title. */
  initialRoomId?: string;
} = {}) {
  // null = booting: a URL-bound room is being checked, and the screen is
  // picked from the match phase once the feed's snapshot lands — no title
  // flash in between.
  const [screen, setScreen] = useState<Screen | null>(
    initialRoomId ? null : 'title',
  );
  const [setup, setSetup] = useState<MatchSetup>({
    mode: 'time',
    durationMs: 60_000,
    targetScore: 10,
  });
  const [sliders, setSliders] =
    useState<DuckHunterSliderConfig>(DEFAULT_SLIDERS);
  const [stage, setStage] = useState<StageRef>(DEFAULT_STAGE);

  const [roomGone, setRoomGone] = useState(false);

  const room = useDuckHunterRoom(initialRoomId);
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
    if (
      (phase === 'countdown' || phase === 'playing') &&
      (screen === 'lobby' || screen === 'rules' || screen === 'pipeline')
    ) {
      // The round is on — whether this host confirmed it on the briefing or
      // another tab pressed START while the side-screens were up.
      setScreen('game');
    } else if (phase === 'ended' && screen === 'game') {
      setScreen('results');
    } else if (phase === 'lobby' && screen === 'game') {
      // The round vanished under the game screen (a second host tab or the
      // dashboard panel re-armed the lobby): follow the server instead of
      // sitting on a WHEP view of the opening screen where END ROUND has no
      // match to end.
      setScreen('lobby');
    }
  }, [phase, screen]);

  // Track whether the room's stage input matches the chosen stage (by
  // stageKey), so coming back from the results screen with a different pick
  // swaps the video.
  const roomStageKeyRef = useRef<string | null>(null);

  // After a refresh re-attached to a running room, land on the screen the
  // match phase dictates (once — EXIT TO TITLE must not be fought over).
  const restoreHandledRef = useRef(false);
  useEffect(() => {
    if (restoreHandledRef.current || !room.restored) return;
    if (!phase) return; // wait for the spectate snapshot
    restoreHandledRef.current = true;
    // A restored page has no memory of the stage it picked; if the room's
    // stage is the one it would pick anyway, say so, or the next PLAY AGAIN
    // swaps the stage for an identical file — re-warming the bird model and
    // stretching the lobby chain the START button now waits for.
    if (stageMatchesInput(stage, room.restoredStage)) {
      roomStageKeyRef.current = stageKey(stage);
    }
    if (phase === 'lobby') setScreen('lobby');
    else if (phase === 'countdown' || phase === 'playing') setScreen('game');
    else if (phase === 'ended') setScreen('results');
    // 'idle' = nothing to rejoin (e.g. a dashboard-panel reset): the title,
    // explicitly, so a URL-mounted arcade leaves its blank boot screen.
    else setScreen('title');
  }, [room.restored, room.restoredStage, phase, stage]);

  // A URL-bound room that cannot be joined must not leave the blank boot
  // screen up. Gone → back to the plain arcade entry (its stash may still
  // know a live room); server unreachable, or the feed lost the room before
  // a snapshot arrived → the title, with the banner saying why.
  useEffect(() => {
    if (!initialRoomId) return;
    if (room.roomStatus === 'gone') {
      // A full reload, not a router navigation: the arcade lives in the
      // layout and would survive a soft navigation with this dead room id
      // still frozen in — the plain entry has to boot from scratch.
      window.location.replace('/duck-hunter');
    } else if (screen === null && (room.roomStatus === 'error' || roomGone)) {
      setScreen('title');
    }
  }, [initialRoomId, room.roomStatus, roomGone, screen]);

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

  // True while openLobby's chain (stage swap → config push → arm) is in
  // flight. The lobby screen mounts before the chain runs, so without this
  // its START button would go by the previous round's stale feed state.
  const [lobbyBusy, setLobbyBusy] = useState(false);
  const openLobby = async () => {
    setScreen('lobby');
    setLobbyBusy(true);
    try {
      if (!room.roomId) {
        // createRoom arms the 'lobby' phase itself (the fresh roomId hasn't
        // committed to state yet).
        await room.createRoom(stage, sliders, matchConfig);
        roomStageKeyRef.current = stageKey(stage);
      } else {
        if (roomStageKeyRef.current !== stageKey(stage)) {
          await room.changeStage(stage);
          roomStageKeyRef.current = stageKey(stage);
        }
        await room.pushConfig(sliders);
        // Clears a finished match and tells waiting phones to keep holding on
        // the briefing (attract-mode ducks are not open range).
        await room.armLobby(matchConfig);
      }
    } finally {
      setLobbyBusy(false);
    }
  };

  // HOW TO PLAY doubles as the pre-round briefing: START on the lobby opens
  // it with intent 'start', and its confirm is what actually fires the
  // server's 'start'. Opened from the RULES button it is just a read.
  const [rulesIntent, setRulesIntent] = useState<RulesIntent>('browse');
  const [starting, setStarting] = useState(false);
  // Same readiness the lobby's START button uses, re-evaluated live so the
  // briefing cannot start a round the lobby would have refused (the arm
  // dropped, the room vanished, another tab already started it).
  const startable = lobbyReady(feed, room, lobbyBusy) && !roomGone;
  const openRules = (intent: RulesIntent) => {
    setRulesIntent(intent);
    setScreen('rules');
  };
  const startFromRules = async () => {
    if (!startable || starting) return;
    setStarting(true);
    try {
      // Stay on the briefing: the feed's 'countdown' moves us to the game
      // (see the phase effect). Setting 'lobby' here could clobber that, as
      // the WS event may land before this action resolves.
      await room.startMatch(matchConfig);
    } finally {
      setStarting(false);
    }
  };

  const exitToTitle = async () => {
    roomStageKeyRef.current = null;
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
          stage={stage}
          onStage={setStage}
          onConfirm={() => void openLobby()}
          onBack={() => setScreen('title')}
        />
      ) : null}
      {screen === 'lobby' ? (
        <Lobby
          setup={setup}
          sliders={sliders}
          stage={stage}
          room={room}
          feed={feed}
          busy={lobbyBusy}
          onStart={() => openRules('start')}
          onRules={() => openRules('browse')}
          onPipeline={() => setScreen('pipeline')}
          onBack={() => setScreen('config')}
        />
      ) : null}
      {screen === 'rules' ? (
        <RulesScreen
          intent={rulesIntent}
          setup={setup}
          sliders={sliders}
          canStart={startable}
          starting={starting}
          onConfirm={
            rulesIntent === 'start'
              ? () => void startFromRules()
              : () => setScreen('lobby')
          }
          onBack={() => setScreen('lobby')}
        />
      ) : null}
      {screen === 'pipeline' ? (
        <PipelineScreen onBack={() => setScreen('lobby')} />
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
