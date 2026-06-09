'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PongLobbyPlayer, PongSide } from '@smelter-editor/types';
import type { Input } from '@/lib/types';
import {
  AiController,
  applyIntent,
  createInitialState,
  DEFAULT_MATCH_CONFIG,
  DIFFICULTY,
  fromNetGameState,
  KeyboardController,
  MouseController,
  RemotePaddleController,
  resetMatch,
  startMatch,
  tick,
  toNetGameState,
  type Difficulty,
  type GamePhase,
  type GameState,
  type MatchConfig,
  type PaddleController,
  type Score,
} from '@/lib/pong';
import { drawGameState } from '@/lib/pong/render-canvas';
import { useKeyboardInput } from '@/lib/pong/hooks/useKeyboardInput';
import { useMouseInput } from '@/lib/pong/hooks/useMouseInput';
import { usePongMultiplayer } from '@/lib/pong/hooks/usePongMultiplayer';
import { useShaderPushSocket } from '@/lib/pong/hooks/useShaderPushSocket';
import {
  buildPongParamUpdates,
  hasPongShader,
  PONG_SHADER_ID,
} from '@/lib/pong/shader-push';

type ControllerType = 'keyboard' | 'mouse' | 'ai';

const FIRST_TO_OPTIONS = [3, 5, 7, 11] as const;

const LEFT_BINDINGS = { up: 'w', down: 's' };
const RIGHT_BINDINGS = { up: 'ArrowUp', down: 'ArrowDown' };

const SHADER_PUSH_INTERVAL_MS = 33;

type Props = {
  roomId: string;
  inputs: Input[];
};

function buildController(
  type: ControllerType,
  side: 'left' | 'right',
  difficulty: Difficulty,
): PaddleController {
  if (type === 'keyboard') return new KeyboardController();
  if (type === 'mouse') return new MouseController();
  return new AiController(DIFFICULTY[difficulty], side === 'left' ? 0xa1 : 0xb2);
}

function sideLabel(side: PongSide): string {
  return side === 'left' ? 'Left' : 'Right';
}

export function PongPanel({ roomId, inputs }: Props) {
  const pushSocket = useShaderPushSocket(roomId);
  const multiplayer = usePongMultiplayer(roomId);

  const [leftType, setLeftType] = useState<ControllerType>('keyboard');
  const [rightType, setRightType] = useState<ControllerType>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [firstTo, setFirstTo] = useState<number>(7);
  const [score, setScore] = useState<Score>({ left: 0, right: 0 });
  const [phase, setPhase] = useState<GamePhase>('idle');

  const isInLobby = multiplayer.mySide !== null && multiplayer.status === 'in_lobby';
  const isMultiplayerPlaying = multiplayer.status === 'playing' && multiplayer.mySide !== null;
  const isMultiplayerHost = isMultiplayerPlaying && multiplayer.isHost;
  const isMultiplayerGuest = isMultiplayerPlaying && !multiplayer.isHost;
  const isLocalPlay = !isInLobby && !isMultiplayerPlaying;

  const pongInputs = useMemo(
    () => inputs.filter((i) => hasPongShader(i.shaders)),
    [inputs],
  );
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedInputId && !pongInputs.find((i) => i.inputId === selectedInputId)) {
      setSelectedInputId(pongInputs[0]?.inputId ?? null);
    } else if (!selectedInputId && pongInputs.length > 0) {
      setSelectedInputId(pongInputs[0]!.inputId);
    }
  }, [pongInputs, selectedInputId]);

  const inputsRef = useRef(inputs);
  const selectedInputIdRef = useRef<string | null>(selectedInputId);
  const lastPushAt = useRef(0);
  const lastNetPushAt = useRef(0);
  const lastPaddlePushAt = useRef(0);
  useEffect(() => {
    inputsRef.current = inputs;
  }, [inputs]);
  useEffect(() => {
    selectedInputIdRef.current = selectedInputId;
  }, [selectedInputId]);

  const matchConfig = useMemo<MatchConfig>(
    () => ({ ...DEFAULT_MATCH_CONFIG, firstTo }),
    [firstTo],
  );

  const stateRef = useRef<GameState>(createInitialState());
  const guestPaddleYRef = useRef(0.5);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const courtRef = useRef<HTMLDivElement | null>(null);
  const lastScoreRef = useRef<Score>({ left: 0, right: 0 });
  const lastPhaseRef = useRef<GamePhase>('idle');

  const leftController = useMemo(
    () => buildController(leftType, 'left', difficulty),
    [leftType, difficulty],
  );
  const rightController = useMemo(
    () => buildController(rightType, 'right', difficulty),
    [rightType, difficulty],
  );
  const remoteController = useMemo(() => new RemotePaddleController(), []);
  const networkKeyboardController = useMemo(() => new KeyboardController(), []);

  const mySide = multiplayer.mySide;
  const hostUsesLeft = isMultiplayerHost && mySide === 'left';
  const hostUsesRight = isMultiplayerHost && mySide === 'right';
  const guestUsesLeft = isMultiplayerGuest && mySide === 'left';
  const guestUsesRight = isMultiplayerGuest && mySide === 'right';

  const leftMouse = isLocalPlay
    ? leftType === 'mouse'
    : hostUsesLeft || guestUsesLeft;
  const rightMouse = isLocalPlay
    ? rightType === 'mouse'
    : hostUsesRight || guestUsesRight;
  const leftKeyboard = isLocalPlay
    ? leftType === 'keyboard'
    : hostUsesLeft || guestUsesLeft;
  const rightKeyboard = isLocalPlay
    ? rightType === 'keyboard'
    : hostUsesRight || guestUsesRight;

  const leftKb = useKeyboardInput(LEFT_BINDINGS, leftKeyboard);
  const rightKb = useKeyboardInput(RIGHT_BINDINGS, rightKeyboard);
  const mouseInput = useMouseInput(courtRef, leftMouse || rightMouse);

  const remotePaddleYRef = useRef<number | null>(null);
  useEffect(() => {
    remotePaddleYRef.current = multiplayer.remotePaddleY;
  }, [multiplayer.remotePaddleY]);

  const remoteGameStateRef = useRef(multiplayer.remoteGameState);
  useEffect(() => {
    remoteGameStateRef.current = multiplayer.remoteGameState;
  }, [multiplayer.remoteGameState]);

  const resetLocalGame = () => {
    stateRef.current = resetMatch();
    lastScoreRef.current = { left: 0, right: 0 };
    lastPhaseRef.current = 'idle';
    guestPaddleYRef.current = 0.5;
    leftController.reset?.();
    rightController.reset?.();
    remoteController.reset();
    setScore({ left: 0, right: 0 });
    setPhase('idle');
  };

  const pushShaderAutoMode = () => {
    const inputId = selectedInputIdRef.current;
    if (!inputId) return;
    const target = inputsRef.current.find((i) => i.inputId === inputId);
    if (!target) return;
    const params = buildPongParamUpdates(stateRef.current, 0, matchConfig);
    pushSocket.send(inputId, params);
  };

  useEffect(() => {
    if (isLocalPlay) {
      resetLocalGame();
    }
  }, [leftController, rightController, matchConfig, isLocalPlay]);

  useEffect(() => {
    if (!isMultiplayerHost) return;
    stateRef.current = startMatch(stateRef.current);
    lastPhaseRef.current = stateRef.current.phase;
    lastScoreRef.current = stateRef.current.score;
    setPhase(stateRef.current.phase);
    setScore(stateRef.current.score);
    leftController.reset?.();
    rightController.reset?.();
    remoteController.reset();
  }, [isMultiplayerHost, multiplayer.status]);

  useEffect(() => {
    if (multiplayer.status !== 'in_lobby') return;
    if (lastPhaseRef.current === 'idle') return;
    resetLocalGame();
    pushShaderAutoMode();
  }, [multiplayer.status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = courtRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const finalW = Math.max(64, Math.floor(rect.width));
      const finalH = Math.max(36, Math.floor((finalW * 9) / 16));
      canvas.width = Math.floor(finalW * dpr);
      canvas.height = Math.floor(finalH * dpr);
      canvas.style.width = `${finalW}px`;
      canvas.style.height = `${finalH}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isMultiplayerGuest || !mySide || !multiplayer.remoteGameState) return;
    guestPaddleYRef.current = multiplayer.remoteGameState.paddles[mySide].y;
  }, [multiplayer.remoteGameState, isMultiplayerGuest, mySide]);

  useEffect(() => {
    if (isMultiplayerGuest || isInLobby) return;
    if (!isLocalPlay && !isMultiplayerHost) return;

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;

      const inputsLeft = {
        keyboard: leftKb.current,
        mouse: leftMouse ? mouseInput.current : { y: null },
      };
      const inputsRight = {
        keyboard: rightKb.current,
        mouse: rightMouse ? mouseInput.current : { y: null },
      };

      let leftIntent = leftController.update(dt, stateRef.current, 'left', inputsLeft);
      let rightIntent = rightController.update(dt, stateRef.current, 'right', inputsRight);

      if (isMultiplayerHost && mySide) {
        const remoteY = remotePaddleYRef.current;
        if (remoteY != null) {
          remoteController.setTargetY(remoteY);
        }
        const localIntent = networkKeyboardController.update(
          dt,
          stateRef.current,
          mySide,
          mySide === 'left' ? inputsLeft : inputsRight,
        );
        const remoteSide = mySide === 'left' ? 'right' : 'left';
        const remoteIntent = remoteController.update(
          dt,
          stateRef.current,
          remoteSide,
          { keyboard: { upHeld: false, downHeld: false }, mouse: { y: null } },
        );
        if (mySide === 'left') {
          leftIntent = localIntent;
          rightIntent = remoteIntent;
        } else {
          leftIntent = remoteIntent;
          rightIntent = localIntent;
        }
      }

      const next = tick(
        stateRef.current,
        dt,
        { left: leftIntent, right: rightIntent },
        matchConfig,
      );
      stateRef.current = next;

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          drawGameState(ctx, next, canvas.width / dpr, canvas.height / dpr);
        }
      }

      if (
        next.score.left !== lastScoreRef.current.left ||
        next.score.right !== lastScoreRef.current.right
      ) {
        lastScoreRef.current = next.score;
        setScore(next.score);
      }
      if (next.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = next.phase;
        setPhase(next.phase);
      }

      const inputId = selectedInputIdRef.current;
      if (
        inputId &&
        next.phase !== 'idle' &&
        now - lastPushAt.current >= SHADER_PUSH_INTERVAL_MS
      ) {
        const target = inputsRef.current.find((i) => i.inputId === inputId);
        if (target) {
          const params = buildPongParamUpdates(next, 1, matchConfig);
          if (pushSocket.send(inputId, params)) {
            lastPushAt.current = now;
          }
        }
      }

      if (
        isMultiplayerHost &&
        next.phase !== 'idle' &&
        now - lastNetPushAt.current >= SHADER_PUSH_INTERVAL_MS
      ) {
        if (multiplayer.sendGameState(toNetGameState(next))) {
          lastNetPushAt.current = now;
        }
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    leftController,
    rightController,
    remoteController,
    networkKeyboardController,
    matchConfig,
    leftKb,
    rightKb,
    mouseInput,
    leftMouse,
    rightMouse,
    pushSocket,
    isMultiplayerGuest,
    isMultiplayerHost,
    isInLobby,
    isLocalPlay,
    mySide,
    multiplayer,
  ]);

  useEffect(() => {
    if (!isMultiplayerGuest || !mySide) return;

    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;

      const inputsLeft = {
        keyboard: leftKb.current,
        mouse: leftMouse ? mouseInput.current : { y: null },
      };
      const inputsRight = {
        keyboard: rightKb.current,
        mouse: rightMouse ? mouseInput.current : { y: null },
      };

      const remote = remoteGameStateRef.current;
      const sideInputs = mySide === 'left' ? inputsLeft : inputsRight;
      const intent = networkKeyboardController.update(
        dt,
        stateRef.current,
        mySide,
        sideInputs,
      );
      const paddle = { y: guestPaddleYRef.current };
      const nextPaddle = applyIntent(paddle, intent, dt);
      guestPaddleYRef.current = nextPaddle.y;

      if (now - lastPaddlePushAt.current >= SHADER_PUSH_INTERVAL_MS) {
        if (multiplayer.sendPaddleInput(guestPaddleYRef.current)) {
          lastPaddlePushAt.current = now;
        }
      }

      const renderState = remote
        ? {
            ...fromNetGameState(remote),
            paddles: {
              ...fromNetGameState(remote).paddles,
              [mySide]: { y: guestPaddleYRef.current },
            },
          }
        : {
            ...createInitialState(),
            paddles: {
              left: { y: mySide === 'left' ? guestPaddleYRef.current : 0.5 },
              right: { y: mySide === 'right' ? guestPaddleYRef.current : 0.5 },
            },
          };

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = window.devicePixelRatio || 1;
          drawGameState(
            ctx,
            renderState,
            canvas.width / dpr,
            canvas.height / dpr,
          );
        }
      }

      if (
        renderState.score.left !== lastScoreRef.current.left ||
        renderState.score.right !== lastScoreRef.current.right
      ) {
        lastScoreRef.current = renderState.score;
        setScore(renderState.score);
      }
      if (renderState.phase !== lastPhaseRef.current) {
        lastPhaseRef.current = renderState.phase;
        setPhase(renderState.phase);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    isMultiplayerGuest,
    mySide,
    networkKeyboardController,
    leftKb,
    rightKb,
    mouseInput,
    leftMouse,
    rightMouse,
    multiplayer,
  ]);

  const handleStart = () => {
    stateRef.current = startMatch(stateRef.current);
    lastPhaseRef.current = stateRef.current.phase;
    setPhase(stateRef.current.phase);
    leftController.reset?.();
    rightController.reset?.();
  };

  const handleReset = () => {
    resetLocalGame();
    if (isMultiplayerPlaying || isInLobby) {
      multiplayer.reset();
    }
    pushShaderAutoMode();
  };

  const handleLeaveLobby = () => {
    resetLocalGame();
    multiplayer.leave();
    pushShaderAutoMode();
  };

  const showsDifficulty =
    isLocalPlay && (leftType === 'ai' || rightType === 'ai');
  const startLabel = phase === 'matchOver' ? 'Play Again' : 'Start';
  const startDisabled =
    phase === 'countdown' || phase === 'playing' || phase === 'pointScored';

  const myLobbyPlayer: PongLobbyPlayer | undefined = multiplayer.lobby?.players.find(
    (p: PongLobbyPlayer) => p.clientId === multiplayer.clientId,
  );
  const opponent: PongLobbyPlayer | undefined = multiplayer.lobby?.players.find(
    (p: PongLobbyPlayer) => p.clientId !== multiplayer.clientId,
  );
  const canReady = Boolean(myLobbyPlayer && opponent && !myLobbyPlayer.ready);
  const waitingForOpponent = Boolean(myLobbyPlayer && !opponent);
  const waitingForReady = Boolean(
    myLobbyPlayer && opponent && (!myLobbyPlayer.ready || !opponent.ready),
  );

  const sideTaken = (side: PongSide) =>
    multiplayer.lobby?.players.some(
      (p: PongLobbyPlayer) =>
        p.side === side && p.clientId !== multiplayer.clientId,
    ) ?? false;

  return (
    <div className='h-full overflow-y-auto p-3'>
      <div className='grid grid-cols-2 gap-3'>
        <div className='space-y-2'>
          <div
            ref={courtRef}
            className='relative w-full bg-black rounded'
            style={{ aspectRatio: '16 / 9' }}>
            <canvas
              ref={canvasRef}
              className='absolute inset-0 w-full h-full block rounded'
            />
          </div>

          <div className='flex items-center justify-between gap-2'>
            <div className='text-sm font-mono'>
              <span>{score.left}</span>
              <span className='mx-2 text-neutral-500'>:</span>
              <span>{score.right}</span>
            </div>
            <div className='flex gap-1'>
              {isLocalPlay && (
                <Button
                  onClick={handleStart}
                  disabled={startDisabled}
                  size='lg'
                  className={startDisabled ? undefined : 'animate-pulse-cyan'}>
                  {startLabel}
                </Button>
              )}
              <Button onClick={handleReset} variant='outline' size='lg'>
                Reset
              </Button>
            </div>
          </div>

          {multiplayer.disconnectMessage && (
            <div className='text-xs text-amber-400 border border-amber-900/50 rounded px-2 py-1.5 flex items-center justify-between gap-2'>
              <span>{multiplayer.disconnectMessage}</span>
              <Button
                variant='ghost'
                size='sm'
                className='h-6 px-2'
                onClick={multiplayer.clearDisconnectMessage}>
                Dismiss
              </Button>
            </div>
          )}
        </div>

        <div className='space-y-2'>
          <div className='space-y-1 border border-neutral-800 rounded p-2'>
            <Label className='text-xs'>Network multiplayer</Label>
            <div className='text-[11px] text-neutral-500'>
              Two editors in the same room can play over the network.
            </div>

            {!myLobbyPlayer ? (
              <div className='flex gap-1 pt-1'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={sideTaken('left') || multiplayer.status === 'connecting'}
                  onClick={() => multiplayer.join('left')}>
                  Join Left
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={sideTaken('right') || multiplayer.status === 'connecting'}
                  onClick={() => multiplayer.join('right')}>
                  Join Right
                </Button>
              </div>
            ) : (
              <div className='space-y-2 pt-1'>
                <div className='space-y-1'>
                  {multiplayer.lobby?.players.map((player: PongLobbyPlayer) => (
                    <div
                      key={player.clientId}
                      className='text-xs flex items-center justify-between gap-2 border border-neutral-900 rounded px-2 py-1'>
                      <span>
                        {player.name ?? 'Player'} · {sideLabel(player.side)}
                        {player.clientId === multiplayer.lobby?.hostClientId
                          ? ' · host'
                          : ''}
                      </span>
                      <span className={player.ready ? 'text-emerald-400' : 'text-neutral-500'}>
                        {player.ready ? 'Ready' : 'Not ready'}
                      </span>
                    </div>
                  ))}
                </div>

                {isInLobby && (
                  <div className='flex gap-1'>
                    <Button
                      size='sm'
                      disabled={!canReady}
                      onClick={multiplayer.ready}
                      className={canReady ? 'animate-pulse-cyan' : undefined}>
                      Ready
                    </Button>
                    <Button size='sm' variant='outline' onClick={handleLeaveLobby}>
                      Leave
                    </Button>
                  </div>
                )}

                {isInLobby && waitingForOpponent && (
                  <div className='text-xs text-neutral-500'>
                    Waiting for opponent to join...
                  </div>
                )}
                {isInLobby && waitingForReady && opponent && (
                  <div className='text-xs text-neutral-500'>
                    Waiting for both players to ready up...
                  </div>
                )}
                {isMultiplayerPlaying && mySide && (
                  <div className='text-xs text-emerald-400'>
                    Playing as {sideLabel(mySide)}
                    {multiplayer.isHost ? ' (host)' : ' (guest)'}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className='space-y-1'>
            <Label className='text-xs'>Stream output</Label>
            {pongInputs.length === 0 ? (
              <div className='text-xs text-neutral-500 border border-neutral-800 rounded px-2 py-1.5'>
                Attach <span className='font-mono'>{PONG_SHADER_ID}</span> shader
                to an input.
              </div>
            ) : (
              <Select
                value={selectedInputId ?? ''}
                onValueChange={(v) => setSelectedInputId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder='— none —' />
                </SelectTrigger>
                <SelectContent>
                  {pongInputs.map((i) => (
                    <SelectItem key={i.inputId} value={i.inputId}>
                      {i.title || i.inputId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {isLocalPlay && (
            <>
              <div className='space-y-1'>
                <Label className='text-xs'>Left paddle</Label>
                <Select
                  value={leftType}
                  onValueChange={(v) => setLeftType(v as ControllerType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='keyboard'>Keyboard (W/S)</SelectItem>
                    <SelectItem value='mouse'>Mouse</SelectItem>
                    <SelectItem value='ai'>AI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className='space-y-1'>
                <Label className='text-xs'>Right paddle</Label>
                <Select
                  value={rightType}
                  onValueChange={(v) => setRightType(v as ControllerType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='keyboard'>Keyboard (↑/↓)</SelectItem>
                    <SelectItem value='mouse'>Mouse</SelectItem>
                    <SelectItem value='ai'>AI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {isMultiplayerPlaying && mySide && (
            <div className='text-xs text-neutral-500 border border-neutral-800 rounded px-2 py-1.5'>
              Controls: {mySide === 'left' ? 'W/S or mouse' : 'Arrow keys or mouse'}
            </div>
          )}

          {showsDifficulty && (
            <div className='space-y-1'>
              <Label className='text-xs'>AI difficulty</Label>
              <Select
                value={difficulty}
                onValueChange={(v) => setDifficulty(v as Difficulty)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='easy'>Easy</SelectItem>
                  <SelectItem value='medium'>Medium</SelectItem>
                  <SelectItem value='hard'>Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className='space-y-1'>
            <Label className='text-xs'>First to</Label>
            <Select
              value={String(firstTo)}
              onValueChange={(v) => setFirstTo(Number(v))}
              disabled={!isLocalPlay && !isInLobby}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIRST_TO_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
