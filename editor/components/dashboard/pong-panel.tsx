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
import type { Input } from '@/lib/types';
import {
  AiController,
  createInitialState,
  DEFAULT_MATCH_CONFIG,
  DIFFICULTY,
  KeyboardController,
  MouseController,
  resetMatch,
  startMatch,
  tick,
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

// Bypasses the slider 200ms debounce by streaming over the room WebSocket.
// Cap at ~30Hz to bound bandwidth — Smelter consumes at its own frame rate.
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
  // Distinct seed per side keeps left vs right AI uncorrelated.
  return new AiController(DIFFICULTY[difficulty], side === 'left' ? 0xa1 : 0xb2);
}

export function PongPanel({ roomId, inputs }: Props) {
  const pushSocket = useShaderPushSocket(roomId);
  const [leftType, setLeftType] = useState<ControllerType>('keyboard');
  const [rightType, setRightType] = useState<ControllerType>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [firstTo, setFirstTo] = useState<number>(7);
  const [score, setScore] = useState<Score>({ left: 0, right: 0 });
  const [phase, setPhase] = useState<GamePhase>('idle');

  const pongInputs = useMemo(
    () => inputs.filter((i) => hasPongShader(i.shaders)),
    [inputs],
  );
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);

  // Auto-pick first eligible input; drop selection when it disappears.
  useEffect(() => {
    if (selectedInputId && !pongInputs.find((i) => i.inputId === selectedInputId)) {
      setSelectedInputId(pongInputs[0]?.inputId ?? null);
    } else if (!selectedInputId && pongInputs.length > 0) {
      setSelectedInputId(pongInputs[0]!.inputId);
    }
  }, [pongInputs, selectedInputId]);

  // Live refs read by the RAF loop so prop/selection changes don't require restart.
  const inputsRef = useRef(inputs);
  const selectedInputIdRef = useRef<string | null>(selectedInputId);
  const lastPushAt = useRef(0);
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

  const leftMouse = leftType === 'mouse';
  const rightMouse = rightType === 'mouse';
  const leftKeyboard = leftType === 'keyboard';
  const rightKeyboard = rightType === 'keyboard';

  // Window-level keyboard listeners (refs only, no re-renders).
  const leftKb = useKeyboardInput(LEFT_BINDINGS, leftKeyboard);
  const rightKb = useKeyboardInput(RIGHT_BINDINGS, rightKeyboard);
  const mouseInput = useMouseInput(courtRef, leftMouse || rightMouse);

  // Reset state and controllers whenever the match configuration changes.
  useEffect(() => {
    stateRef.current = createInitialState();
    lastScoreRef.current = { left: 0, right: 0 };
    lastPhaseRef.current = 'idle';
    leftController.reset?.();
    rightController.reset?.();
    setScore({ left: 0, right: 0 });
    setPhase('idle');
  }, [leftController, rightController, matchConfig]);

  // Canvas auto-resize to its container with devicePixelRatio scaling.
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

  // RAF game loop. State lives in ref; React state only updates on
  // score/phase changes to keep re-renders cheap.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;

      // Each controller sees ONLY its own keyboard side and mouse (if assigned).
      const inputsLeft = {
        keyboard: leftKb.current,
        mouse: leftMouse ? mouseInput.current : { y: null },
      };
      const inputsRight = {
        keyboard: rightKb.current,
        mouse: rightMouse ? mouseInput.current : { y: null },
      };

      const leftIntent = leftController.update(dt, stateRef.current, 'left', inputsLeft);
      const rightIntent = rightController.update(dt, stateRef.current, 'right', inputsRight);

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

      // WebSocket push (bypasses the slider 200ms HTTP debounce). Capped at
      // SHADER_PUSH_INTERVAL_MS for bandwidth; sends are fire-and-forget.
      // Idle phase = panel dormant; the shader keeps its slider-driven auto-mode.
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

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    leftController,
    rightController,
    matchConfig,
    leftKb,
    rightKb,
    mouseInput,
    leftMouse,
    rightMouse,
    pushSocket,
  ]);

  const handleStart = () => {
    stateRef.current = startMatch(stateRef.current);
    lastPhaseRef.current = stateRef.current.phase;
    setPhase(stateRef.current.phase);
    leftController.reset?.();
    rightController.reset?.();
  };
  const handleReset = () => {
    stateRef.current = resetMatch();
    lastScoreRef.current = { left: 0, right: 0 };
    lastPhaseRef.current = 'idle';
    leftController.reset?.();
    rightController.reset?.();
    setScore({ left: 0, right: 0 });
    setPhase('idle');

    // Hand the shader back to auto-mode so the streamed output isn't stuck on
    // the last frozen frame after the user resets.
    const inputId = selectedInputIdRef.current;
    if (inputId) {
      const target = inputsRef.current.find((i) => i.inputId === inputId);
      if (target) {
        const params = buildPongParamUpdates(stateRef.current, 0, matchConfig);
        pushSocket.send(inputId, params);
      }
    }
  };

  const showsDifficulty = leftType === 'ai' || rightType === 'ai';
  const startLabel = phase === 'matchOver' ? 'Play Again' : 'Start';
  const startDisabled = phase === 'countdown' || phase === 'playing' || phase === 'pointScored';

  return (
    <div className='h-full overflow-y-auto p-3'>
      <div className='grid grid-cols-2 gap-3'>
        {/* Left column: preview + score + actions */}
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
              <Button onClick={handleStart} disabled={startDisabled} size='sm'>
                {startLabel}
              </Button>
              <Button onClick={handleReset} variant='outline' size='sm'>
                Reset
              </Button>
            </div>
          </div>
        </div>

        {/* Right column: configuration */}
        <div className='space-y-2'>
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

          <div className='space-y-1'>
            <Label className='text-xs'>Left paddle</Label>
            <Select value={leftType} onValueChange={(v) => setLeftType(v as ControllerType)}>
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
            <Select value={rightType} onValueChange={(v) => setRightType(v as ControllerType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='keyboard'>Keyboard (↑/↓)</SelectItem>
                <SelectItem value='mouse'>Mouse</SelectItem>
                <SelectItem value='ai'>AI</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showsDifficulty && (
            <div className='space-y-1'>
              <Label className='text-xs'>AI difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as Difficulty)}>
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
            <Select value={String(firstTo)} onValueChange={(v) => setFirstTo(Number(v))}>
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
