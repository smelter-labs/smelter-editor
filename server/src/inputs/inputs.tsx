import type { GameState, GameOverData, InputConfig } from '../app/store';
import type { ShaderParamStructField } from '@swmansion/smelter';
import {
  Text,
  View,
  InputStream,
  Image,
  Rescaler,
  useInputStreams,
  Shader,
} from '@swmansion/smelter';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ShaderConfig, ShaderParamConfig } from '../shaders/shaders';
import shadersController from '../shaders/shaders';
import { config } from '../config';

type Resolution = { width: number; height: number };

/**
 * Converts a hex color string to RGB values (0-1 range)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  
  // Handle 3-digit hex
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(char => char + char).join('')
    : cleanHex;
  
  const r = parseInt(fullHex.substring(0, 2), 16) / 255;
  const g = parseInt(fullHex.substring(2, 4), 16) / 255;
  const b = parseInt(fullHex.substring(4, 6), 16) / 255;
  
  return { r, g, b };
}

/**
 * Converts a color value (hex string or number) to RGB
 * If it's a number, treats it as a packed integer (0xRRGGBB)
 */
function colorToRgb(colorValue: number | string): { r: number; g: number; b: number } {
  if (typeof colorValue === 'string') {
    return hexToRgb(colorValue);
  }
  // Treat as packed integer: 0xRRGGBB
  const r = ((colorValue >> 16) & 0xff) / 255;
  const g = ((colorValue >> 8) & 0xff) / 255;
  const b = (colorValue & 0xff) / 255;
  return { r, g, b };
}

function darkenHexColor(color: string, factor = 0.75): string {
  const cleanHex = color.replace('#', '');
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(char => char + char).join('')
    : cleanHex;
  if (!/^[0-9a-fA-F]{6}$/.test(fullHex)) {
    return color;
  }
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, '0');
  const r = parseInt(fullHex.substring(0, 2), 16);
  const g = parseInt(fullHex.substring(2, 4), 16);
  const b = parseInt(fullHex.substring(4, 6), 16);
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

function normalizeBorderWidth(borderWidth: number | undefined): number {
  if (borderWidth === undefined || Number.isNaN(borderWidth)) {
    return 0;
  }
  return Math.max(0, Math.round(borderWidth));
}

function wrapWithShaders(
  component: ReactElement,
  shaders: ShaderConfig[] | undefined,
  resolution: Resolution,
  index?: number,
): ReactElement {
  if (!shaders || shaders.length === 0) {
    return component;
  }
  const currentIndex = index ?? shaders.length - 1;
  if (currentIndex < 0) {
    return component;
  }
  const shader = shaders[currentIndex];
  const shaderDef = shadersController.getShaderById(shader.shaderId);
  
  const shaderParams: ShaderParamStructField[] = [];
  
  if (shaderDef?.params && Array.isArray(shader.params)) {
    for (const paramDef of shaderDef.params) {
      const param = shader.params.find(p => p.paramName === paramDef.name);
      if (!param) continue;
      
      if (paramDef.type === 'color') {
        const baseName = param.paramName;
        const colorValue = param.paramValue;
        const rgb = colorToRgb(colorValue);
        
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_r`,
          value: rgb.r,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_g`,
          value: rgb.g,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_b`,
          value: rgb.b,
        } as ShaderParamStructField);
      } else {
        const numValue = typeof param.paramValue === 'string' ? Number(param.paramValue) : param.paramValue;
        shaderParams.push({
          type: 'f32',
          fieldName: param.paramName,
          value: numValue,
        } as ShaderParamStructField);
      }
    }
  }
  
  return (
    <Shader
      shaderId={shader.shaderId}
      resolution={resolution}
      shaderParam={
        shaderParams.length > 0
          ? {
              type: 'struct',
              value: shaderParams,
            }
          : undefined
      }>
      {wrapWithShaders(component, shaders, resolution, currentIndex - 1)}
    </Shader>
  );
}

type ScrollingTextProps = {
  text: string;
  maxLines: number;
  scrollSpeed: number;
  scrollLoop: boolean;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  containerWidth: number;
  containerHeight: number;
  scrollNudge?: number;
};

function ScrollingText({
  text,
  maxLines,
  scrollSpeed,
  scrollLoop,
  fontSize,
  color,
  align,
  containerWidth,
  containerHeight,
  scrollNudge = 0,
}: ScrollingTextProps) {
  const lineHeight = fontSize * 1.2;
  const visibleHeight = containerHeight;
  const lines = text.split('\n');
  const totalTextHeight = lines.length * lineHeight;
  
  const shouldAnimate = maxLines > 0;
  const startPosition = visibleHeight;
  
  const [scrollOffset, setScrollOffset] = useState(startPosition);
  const [permanentNudgeOffset, setPermanentNudgeOffset] = useState(0);
  const permanentNudgeRef = useRef(0);
  const [animatingNudge, setAnimatingNudge] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLinesCountRef = useRef(0);
  const initializedRef = useRef(false);
  const prevNudgeRef = useRef(0);

  useEffect(() => {
    if (scrollNudge !== 0 && scrollNudge !== prevNudgeRef.current) {
      prevNudgeRef.current = scrollNudge;
      const nudgeAmount = Math.floor(scrollNudge) * lineHeight;
      const nudgeDuration = 500;
      const intervalMs = 16;
      const steps = nudgeDuration / intervalMs;
      let currentStep = 0;

      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current);
      }

      nudgeTimerRef.current = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const eased = progress < 0.5 
          ? 4 * progress * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        setAnimatingNudge(nudgeAmount * eased);

        if (currentStep >= steps) {
          if (nudgeTimerRef.current) {
            clearInterval(nudgeTimerRef.current);
            nudgeTimerRef.current = null;
          }
          permanentNudgeRef.current += nudgeAmount;
          setPermanentNudgeOffset(permanentNudgeRef.current);
          setAnimatingNudge(0);
        }
      }, intervalMs);
    }
  }, [scrollNudge, lineHeight]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!shouldAnimate) {
      setScrollOffset(0);
      return;
    }

    const currentLinesCount = lines.length;
    const prevLinesCount = prevLinesCountRef.current;
    const isFirstRun = !initializedRef.current;
    
    prevLinesCountRef.current = currentLinesCount;
    initializedRef.current = true;

    if (isFirstRun) {
      setScrollOffset(startPosition);
    }

    const targetPosition = -totalTextHeight;
    const intervalMs = 16;
    const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;

    timerRef.current = setInterval(() => {
      setScrollOffset(prev => {
        const effectivePosition = prev + permanentNudgeRef.current;
        if (effectivePosition <= targetPosition) {
          if (scrollLoop) {
            permanentNudgeRef.current = 0;
            setPermanentNudgeOffset(0);
            return startPosition;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return targetPosition - permanentNudgeRef.current;
        }
        return prev - pixelsPerFrame;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, shouldAnimate, totalTextHeight, startPosition, scrollSpeed, scrollLoop, lines.length]);

  const textTopOffset = shouldAnimate ? scrollOffset + permanentNudgeOffset + animatingNudge : 0;

  return (
    <View style={{ 
      width: containerWidth, 
      height: visibleHeight, 
      overflow: 'hidden',
    }}>
      <View style={{ 
        width: containerWidth,
        height: totalTextHeight,
        top: textTopOffset,
        left: 0,
      }}>
        <Text style={{ 
          fontSize, 
          width: containerWidth,
          color, 
          wrap: 'word',
          align,
          fontFamily: 'Star Jedi',
        }}>
          {text}
        </Text>
      </View>
    </View>
  );
}


function GameOverModal({ data, resolution }: { data: GameOverData; resolution: Resolution }) {
  const w = resolution.width;
  const h = resolution.height;
  const modalW = w * 0.45;
  const modalH = h * 0.75;
  const modalX = (w - modalW) / 2;
  const modalY = (h - modalH) / 2;

  const winnerPlayer = data.players.find(p => p.name === data.winnerName);
  const winnerColor = winnerPlayer?.color ?? '#4ade80';

  const sorted = [...data.players].sort((a, b) => b.score - a.score);
  const p1 = sorted[0];
  const p2 = sorted[1];

  return (
    <View style={{ width: w, height: h, backgroundColor: '#00000099' }}>
      <View style={{
        width: modalW, height: modalH,
        top: modalY, left: modalX,
        backgroundColor: '#1a1a2e',
        borderWidth: 2, borderColor: '#333333',
        borderRadius: 16,
      }}>
        {/* Winner name */}
        <View style={{ width: modalW, height: modalH * 0.15, top: modalH * 0.06, left: 0 }}>
          <Text style={{
            fontSize: modalW * 0.09,
            color: winnerColor,
            fontFamily: 'Star Jedi',
            align: 'center',
            width: modalW,
          }}>
            {data.winnerName} WINS!
          </Text>
        </View>
        {/* Reason */}
        <View style={{ width: modalW, height: modalH * 0.08, top: modalH * 0.2, left: 0 }}>
          <Text style={{
            fontSize: modalW * 0.045,
            color: '#9ca3af',
            align: 'center',
            width: modalW,
          }}>
            {data.reason}
          </Text>
        </View>
        {/* Score */}
        {p1 && p2 && (
          <View style={{ width: modalW, height: modalH * 0.18, top: modalH * 0.3, left: 0 }}>
            <View style={{ width: modalW * 0.4, height: modalH * 0.18, left: modalW * 0.02, top: 0 }}>
              <Text style={{
                fontSize: modalW * 0.14,
                color: p1.color,
                fontFamily: 'Star Jedi',
                align: 'center',
                width: modalW * 0.4,
              }}>
                {String(p1.score)}
              </Text>
            </View>
            <View style={{ width: modalW * 0.16, height: modalH * 0.18, left: modalW * 0.42, top: 0 }}>
              <Text style={{
                fontSize: modalW * 0.08,
                color: '#ffffff',
                fontFamily: 'Star Jedi',
                align: 'center',
                width: modalW * 0.16,
              }}>
                :
              </Text>
            </View>
            <View style={{ width: modalW * 0.4, height: modalH * 0.18, left: modalW * 0.58, top: 0 }}>
              <Text style={{
                fontSize: modalW * 0.14,
                color: p2.color,
                fontFamily: 'Star Jedi',
                align: 'center',
                width: modalW * 0.4,
              }}>
                {String(p2.score)}
              </Text>
            </View>
          </View>
        )}
        {/* Player stats */}
        {sorted.map((player, i) => (
          <View key={i} style={{
            width: modalW * 0.8, height: modalH * 0.07,
            top: modalH * 0.52 + i * modalH * 0.09,
            left: modalW * 0.1,
          }}>
            <Text style={{
              fontSize: modalW * 0.04,
              color: '#9ca3af',
              width: modalW * 0.8,
              align: 'center',
            }}>
              {player.name}: {String(player.eaten)} eaten, {String(player.cuts)} cuts
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function GameBoard({ gameState, resolution, snake1Shaders, snake2Shaders }: { gameState: GameState; resolution: Resolution; snake1Shaders?: ShaderConfig[]; snake2Shaders?: ShaderConfig[] }) {
  const activeEffect = gameState.activeEffects?.[0];

  const [effectProgress, setEffectProgress] = useState(0);
  useEffect(() => {
    if (!activeEffect) {
      setEffectProgress(0);
      return;
    }
    const update = () => {
      const now = Date.now();
      const total = activeEffect.endsAtMs - activeEffect.startedAtMs;
      const elapsed = now - activeEffect.startedAtMs;
      setEffectProgress(Math.min(1, Math.max(0, elapsed / total)));
    };
    update();
    const interval = setInterval(update, 33);
    return () => clearInterval(interval);
  }, [activeEffect?.startedAtMs, activeEffect?.endsAtMs]);

  // --- Smooth client-side interpolation between game state ticks ---
  const lastUpdateRef = useRef(Date.now());
  const tickIntervalRef = useRef(150); // estimated ms between server updates
  const prevCellsRef = useRef<(typeof gameState.cells)>(gameState.cells);
  const interpolationFromCellsRef = useRef<(typeof gameState.cells)>(gameState.cells);
  const [localProgress, setLocalProgress] = useState(1);
  const LOCAL_VISUAL_SPEED_MULTIPLIER = config.snakeVisualSpeedMultiplier;
  const smoothMoveEnabled = gameState.smoothMove === true;
  const smoothMoveSpeed =
    typeof gameState.smoothMoveSpeed === 'number' &&
    Number.isFinite(gameState.smoothMoveSpeed) &&
    gameState.smoothMoveSpeed > 0
      ? gameState.smoothMoveSpeed
      : 1;
  const effectiveSmoothSpeedMultiplier =
    LOCAL_VISUAL_SPEED_MULTIPLIER * smoothMoveSpeed;

  const easeInOutCubic = (t: number) => (
    t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2
  );

  const getSmoothedProgress = (
    rawProgress: number,
    hasBackendProgress: boolean,
  ) => {
    const clampedRaw = Math.max(0, Math.min(1, rawProgress));
    const unboundedLocal = Math.max(0, localProgress);
    const clampedLocal = Math.max(0, Math.min(1, unboundedLocal));
    if (!smoothMoveEnabled) {
      // Hard snap mode: disable local interpolation entirely.
      return 1;
    }
    if (hasBackendProgress) {
      // Backend already drives sub-tick movement; avoid double interpolation.
      return clampedRaw;
    }
    // Blend backend progress with local tick progress to keep motion smooth,
    // with both acceleration and deceleration phases.
    const blended = clampedRaw + (1 - clampedRaw) * easeInOutCubic(clampedLocal);
    return Math.max(0, Math.min(1, blended));
  };

  useLayoutEffect(() => {
    const now = Date.now();
    const delta = now - lastUpdateRef.current;
    // Ticks can jitter slightly; smooth the interval estimate to prevent visible stutter.
    if (delta > 30 && delta < 2000) {
      tickIntervalRef.current = tickIntervalRef.current * 0.75 + delta * 0.25;
    }
    lastUpdateRef.current = now;

    // Freeze interpolation source for the whole tick window,
    // then advance previous snapshot for the next server update.
    interpolationFromCellsRef.current = prevCellsRef.current;
    prevCellsRef.current = gameState.cells;
    if (!smoothMoveEnabled) {
      setLocalProgress(1);
      return;
    }
    setLocalProgress(0);

    // Animate progress continuously inside a single tick window.
    const startTime = now;
    const duration = Math.max(
      80,
      Math.min(900, tickIntervalRef.current / effectiveSmoothSpeedMultiplier),
    );
    let raf: ReturnType<typeof setInterval>;
    raf = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const t = elapsed / duration;
      const clamped = Math.max(0, Math.min(1, t));
      setLocalProgress(clamped);
      if (clamped >= 1) {
        clearInterval(raf);
      }
    }, 16);
    return () => clearInterval(raf);
  }, [gameState.cells, smoothMoveEnabled, effectiveSmoothSpeedMultiplier]);

  // Game over: remove cells one by one, then show modal
  const [removedCount, setRemovedCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const prevGameOverRef = useRef<GameOverData | undefined>(undefined);
  const totalCellsAtGameOver = useRef(0);

  useEffect(() => {
    if (gameState.gameOverData && !prevGameOverRef.current) {
      // Game just ended — start removal animation
      prevGameOverRef.current = gameState.gameOverData;
      totalCellsAtGameOver.current = gameState.cells.length;
      setRemovedCount(0);
      setShowModal(false);

      const total = gameState.cells.length;
      if (total === 0) {
        setShowModal(true);
        return;
      }

      const delayPerCell = Math.min(100, 2000 / total);
      let count = 0;
      const timer = setInterval(() => {
        count++;
        setRemovedCount(count);
        if (count >= total) {
          clearInterval(timer);
          setTimeout(() => setShowModal(true), 300);
        }
      }, delayPerCell);

      return () => clearInterval(timer);
    } else if (!gameState.gameOverData && prevGameOverRef.current) {
      // Game restarted — reset
      prevGameOverRef.current = undefined;
      setRemovedCount(0);
      setShowModal(false);
    }
  }, [!!gameState.gameOverData]);

  // --- Spawn zoom animation for new food cells ---
  const SPAWN_DURATION_MS = 300;
  const prevFoodKeysRef = useRef<Set<string>>(new Set());
  const spawnTimesRef = useRef<Map<string, number>>(new Map());
  const [, forceRender] = useState(0);

  // --- Swallow wave animation (bulge traveling head → tail) ---
  const SWALLOW_DURATION_PER_SEGMENT_MS = 80;
  const SWALLOW_BULGE_MS = 200;
  // Map: snakeColor → swallow start timestamp
  const swallowWavesRef = useRef<Map<string, number>>(new Map());

  // Build set of snake colors (colors that have a head) to reliably distinguish body from food.
  // Body segments may lack `direction` when not actively interpolating, so we can't rely on it.
  const snakeColors = new Set<string>();
  for (const cell of gameState.cells) {
    if (cell.isHead) snakeColors.add(cell.color);
  }

  useEffect(() => {
    const now = Date.now();

    // Build snake colors inside the effect too for food detection
    const headColors = new Set<string>();
    for (const cell of gameState.cells) {
      if (cell.isHead) headColors.add(cell.color);
    }

    // Track food cells for spawn animation & detect eaten food
    // A food cell is one whose color doesn't match any snake head
    const currentFoodKeys = new Set<string>();
    for (const cell of gameState.cells) {
      if (cell.isHead || headColors.has(cell.color)) continue;
      const key = `${cell.x},${cell.y},${cell.color}`;
      currentFoodKeys.add(key);
      if (!prevFoodKeysRef.current.has(key)) {
        spawnTimesRef.current.set(key, now);
      }
    }

    // Detect eaten food → trigger swallow wave on nearest snake
    for (const oldKey of prevFoodKeysRef.current) {
      if (!currentFoodKeys.has(oldKey)) {
        // Food disappeared — find which snake head is closest
        const [fx, fy] = oldKey.split(',').map(Number);
        let closestColor: string | null = null;
        let closestDist = Infinity;
        for (const cell of gameState.cells) {
          if (cell.isHead) {
            const dist = Math.abs(cell.x - fx) + Math.abs(cell.y - fy);
            if (dist < closestDist) {
              closestDist = dist;
              closestColor = cell.color;
            }
          }
        }
        if (closestColor) {
          swallowWavesRef.current.set(closestColor, now);
        }
      }
    }

    // Clean up old spawn times
    for (const key of spawnTimesRef.current.keys()) {
      if (!currentFoodKeys.has(key) || now - spawnTimesRef.current.get(key)! > SPAWN_DURATION_MS) {
        spawnTimesRef.current.delete(key);
      }
    }
    prevFoodKeysRef.current = currentFoodKeys;

    // Clean up finished swallow waves
    const snakeSegmentCount = gameState.cells.filter(c => c.isHead || headColors.has(c.color)).length;
    const maxSwallowMs = snakeSegmentCount * SWALLOW_DURATION_PER_SEGMENT_MS + SWALLOW_BULGE_MS;
    for (const [color, startTime] of swallowWavesRef.current) {
      if (now - startTime > maxSwallowMs) {
        swallowWavesRef.current.delete(color);
      }
    }

    const hasActiveAnimations = spawnTimesRef.current.size > 0 || swallowWavesRef.current.size > 0;
    if (hasActiveAnimations) {
      const interval = setInterval(() => forceRender(n => n + 1), 16);
      const timeout = setTimeout(() => clearInterval(interval), Math.max(SPAWN_DURATION_MS, maxSwallowMs) + 50);
      return () => { clearInterval(interval); clearTimeout(timeout); };
    }
  }, [gameState.cells]);

  const gap = gameState.cellGap ?? 1;
  const totalGapX = gap * (gameState.boardWidth - 1);
  const totalGapY = gap * (gameState.boardHeight - 1);
  const cellPixel = Math.min(
    (resolution.width - totalGapX) / gameState.boardWidth,
    (resolution.height - totalGapY) / gameState.boardHeight,
  );
  const boardW = cellPixel * gameState.boardWidth + totalGapX;
  const boardH = cellPixel * gameState.boardHeight + totalGapY;
  const offsetX = (resolution.width - boardW) / 2;
  const offsetY = (resolution.height - boardH) / 2;

  const borderW = gameState.boardBorderWidth ?? 4;
  const borderC = gameState.boardBorderColor ?? gameState.gridLineColor ?? '#000000';
  const gridColor = hexToRgb(gameState.gridLineColor ?? '#000000');

  const prevCells = interpolationFromCellsRef.current;
  const wrappedDistance = (
    a: (typeof gameState.cells)[number],
    b: (typeof gameState.cells)[number],
  ) => {
    const rawDx = Math.abs(a.x - b.x);
    const rawDy = Math.abs(a.y - b.y);
    const dx = Math.min(rawDx, gameState.boardWidth - rawDx);
    const dy = Math.min(rawDy, gameState.boardHeight - rawDy);
    return dx + dy;
  };
  const orderSnakeIndices = (
    cells: (typeof gameState.cells),
    indices: number[],
  ): { ordered: number[]; connectedCount: number } => {
    if (indices.length <= 1) {
      return { ordered: [...indices], connectedCount: indices.length };
    }

    const headIdx = indices.find(i => cells[i].isHead);
    if (headIdx === undefined) {
      return { ordered: [...indices], connectedCount: 0 };
    }

    const ordered = [headIdx];
    const remaining = new Set(indices.filter(i => i !== headIdx));
    let current = cells[headIdx];

    while (remaining.size > 0) {
      let closest: number | null = null;
      let closestDist = Infinity;
      for (const ri of remaining) {
        const dist = wrappedDistance(current, cells[ri]);
        if (dist < closestDist) {
          closestDist = dist;
          closest = ri;
        }
      }
      // Adjacent segments on toroidal board should still be local neighbors.
      if (closest === null || closestDist > 2) break;
      ordered.push(closest);
      current = cells[closest];
      remaining.delete(closest);
    }

    const connectedCount = ordered.length;

    // Deterministic fallback for disconnected leftovers.
    ordered.push(...[...remaining].sort((a, b) => a - b));
    return { ordered, connectedCount };
  };

  const currentSnakeIndicesByColor = new Map<string, number[]>();
  gameState.cells.forEach((cell, i) => {
    if (!(cell.isHead || snakeColors.has(cell.color))) return;
    const arr = currentSnakeIndicesByColor.get(cell.color) ?? [];
    arr.push(i);
    currentSnakeIndicesByColor.set(cell.color, arr);
  });

  const prevSnakeColors = new Set<string>();
  for (const cell of prevCells) {
    if (cell.isHead) prevSnakeColors.add(cell.color);
  }
  const prevSnakeIndicesByColor = new Map<string, number[]>();
  prevCells.forEach((cell, i) => {
    if (!(cell.isHead || prevSnakeColors.has(cell.color))) return;
    const arr = prevSnakeIndicesByColor.get(cell.color) ?? [];
    arr.push(i);
    prevSnakeIndicesByColor.set(cell.color, arr);
  });

  const orderedCurrentByColor = new Map<string, number[]>();
  const detachedTailIndices = new Set<number>();
  for (const [color, indices] of currentSnakeIndicesByColor) {
    const orderedResult = orderSnakeIndices(gameState.cells, indices);
    orderedCurrentByColor.set(color, orderedResult.ordered);
    for (let i = orderedResult.connectedCount; i < orderedResult.ordered.length; i++) {
      detachedTailIndices.add(orderedResult.ordered[i]);
    }
  }
  const orderedPrevByColor = new Map<string, number[]>();
  for (const [color, indices] of prevSnakeIndicesByColor) {
    orderedPrevByColor.set(color, orderSnakeIndices(prevCells, indices).ordered);
  }

  // Build segment index from head for swallow wave (head=0, next body=1, ...)
  const segmentIndexMap = new Map<number, number>(); // cellArrayIndex → segmentIndex
  for (const ordered of orderedCurrentByColor.values()) {
    ordered.forEach((cellIdx, segIdx) => segmentIndexMap.set(cellIdx, segIdx));
  }

  // During game-over removal animation, slice cells from the end
  const isRemoving = !!gameState.gameOverData && removedCount > 0;
  const cellsAfterRemoval = isRemoving
    ? gameState.cells.slice(0, Math.max(0, gameState.cells.length - removedCount))
    : gameState.cells;

  // Smelter engine has a hard limit of 100 layout nodes.
  // Budget: ~15 for Input wrappers + 3 fixed GameBoard nodes (wrapper, border, grid).
  // Each head = 1 View + 6 eye Views rendered separately (2×border+eye+pupil). Normal cell = 1.
    const MAX_LAYOUT_NODES = showModal ? 20 : 80;
    let nodesBudget = MAX_LAYOUT_NODES;
    const visibleCells: { cell: (typeof gameState.cells)[number]; origIdx: number }[] = [];
    for (let ci = 0; ci < cellsAfterRemoval.length; ci++) {
      const cell = cellsAfterRemoval[ci];
      const cost = cell.isHead ? 7 : 1;
    if (nodesBudget - cost < 0) break;
    nodesBudget -= cost;
    visibleCells.push({ cell, origIdx: ci });
  }

  const activeSnake1Shaders = (snake1Shaders ?? []).filter(s => s.enabled);
  const activeSnake2Shaders = (snake2Shaders ?? []).filter(s => s.enabled);

  // Ordered list of snake colors (by first head appearance)
  const snakeColorOrder: string[] = [];
  for (const cell of gameState.cells) {
    if (cell.isHead && !snakeColorOrder.includes(cell.color)) {
      snakeColorOrder.push(cell.color);
    }
  }

  // Map snake color → its active shaders
  const snakeShaderMap = new Map<string, ShaderConfig[]>();
  if (activeSnake1Shaders.length > 0 && snakeColorOrder[0]) {
    snakeShaderMap.set(snakeColorOrder[0], activeSnake1Shaders);
  }
  if (activeSnake2Shaders.length > 0 && snakeColorOrder[1]) {
    snakeShaderMap.set(snakeColorOrder[1], activeSnake2Shaders);
  }

  const prevCellByCurrentIndex = new Map<number, (typeof gameState.cells)[number]>();
  for (const [color, orderedCurrent] of orderedCurrentByColor) {
    const orderedPrev = orderedPrevByColor.get(color) ?? [];
    const pairsCount = Math.min(orderedCurrent.length, orderedPrev.length);
    for (let i = 0; i < pairsCount; i++) {
      const currentIdx = orderedCurrent[i];
      const prevIdx = orderedPrev[i];
      const prevCell = prevCells[prevIdx];
      if (prevCell) {
        prevCellByCurrentIndex.set(currentIdx, prevCell);
      }
    }
  }

  const shortestWrappedDelta = (from: number, to: number, boardSize: number) => {
    let delta = to - from;
    if (Math.abs(delta) > boardSize / 2) {
      delta -= Math.sign(delta) * boardSize;
    }
    return delta;
  };

  const wrapCoord = (value: number, boardSize: number) => {
    if (boardSize <= 0) return value;
    return ((value % boardSize) + boardSize) % boardSize;
  };

  const getRawProgress = (
    cell: (typeof gameState.cells)[number],
    prevCell?: (typeof gameState.cells)[number],
  ) => {
    if (typeof cell.progress === 'number') return cell.progress;

    if (prevCell) {
      const movedX = shortestWrappedDelta(prevCell.x, cell.x, gameState.boardWidth) !== 0;
      const movedY = shortestWrappedDelta(prevCell.y, cell.y, gameState.boardHeight) !== 0;
      return movedX || movedY ? 0 : 1;
    }

    // Fallback for sparse backend payloads.
    return cell.direction ? 0 : 1;
  };

  // Helper: compute cell position & scale for a visible cell
  const computeCellGeometry = (cell: (typeof gameState.cells)[number], origIdx: number) => {
    const size = cell.size ?? gameState.cellSize;
    const w = cellPixel * size;
    const h = cellPixel * size;
    // Use local interpolation: blend from cell's raw progress toward 1
    const prevCell = prevCellByCurrentIndex.get(origIdx);
    const rawProgress = getRawProgress(cell, prevCell);
    const progress = getSmoothedProgress(rawProgress, typeof cell.progress === 'number');
    const step = cellPixel + gap;
    let boardX = cell.x;
    let boardY = cell.y;
    if (prevCell) {
      const dx = shortestWrappedDelta(prevCell.x, cell.x, gameState.boardWidth);
      const dy = shortestWrappedDelta(prevCell.y, cell.y, gameState.boardHeight);
      boardX = prevCell.x + dx * progress;
      boardY = prevCell.y + dy * progress;
    } else if (progress < 1 && cell.direction) {
      switch (cell.direction) {
        case 'right': boardX = cell.x - (1 - progress); break;
        case 'left':  boardX = cell.x + (1 - progress); break;
        case 'down':  boardY = cell.y - (1 - progress); break;
        case 'up':    boardY = cell.y + (1 - progress); break;
      }
    }
    const wrappedBoardX = wrapCoord(boardX, gameState.boardWidth);
    const wrappedBoardY = wrapCoord(boardY, gameState.boardHeight);
    const x = offsetX + wrappedBoardX * step;
    const y = offsetY + wrappedBoardY * step;

    const cellKey = `${cell.x},${cell.y},${cell.color}`;
    const isFood = !cell.isHead && !snakeColors.has(cell.color);
    const spawnTime = isFood ? spawnTimesRef.current.get(cellKey) : undefined;
    let scale = 1;
    if (spawnTime !== undefined) {
      const elapsed = Date.now() - spawnTime;
      const t = Math.min(1, elapsed / SPAWN_DURATION_MS);
      if (t < 0.5) {
        scale = 1.25 * (t / 0.5);
      } else {
        scale = 1.25 - 0.25 * ((t - 0.5) / 0.5);
      }
    }

    if ((cell.isHead || snakeColors.has(cell.color)) && swallowWavesRef.current.has(cell.color)) {
      const waveStart = swallowWavesRef.current.get(cell.color)!;
      const segIdx = segmentIndexMap.get(origIdx) ?? 0;
      const segDelay = segIdx * SWALLOW_DURATION_PER_SEGMENT_MS;
      const elapsed = Date.now() - waveStart - segDelay;
      if (elapsed > 0 && elapsed < SWALLOW_BULGE_MS) {
        const t = elapsed / SWALLOW_BULGE_MS;
        const bump = Math.sin(t * Math.PI);
        scale = 1 + 0.3 * bump;
      }
    }
    const sw = w * scale;
    const sh = h * scale;
    const sx = x - (sw - w) / 2;
    const sy = y - (sh - h) / 2;
    return { w, h, x, y, sw, sh, sx, sy };
  };

  // Helper: render eyes for a head cell
  const renderEyes = (cell: (typeof gameState.cells)[number], keyPrefix: string) => {
    const size = cell.size ?? gameState.cellSize;
    const w = cellPixel * size;
    const h = cellPixel * size;
    const headIndex = gameState.cells.findIndex(c => c === cell);
    const prevCell = headIndex >= 0 ? prevCellByCurrentIndex.get(headIndex) : undefined;
    const rawProgress = getRawProgress(cell, prevCell);
    const progress = getSmoothedProgress(rawProgress, typeof cell.progress === 'number');
    const step = cellPixel + gap;
    let boardX = cell.x;
    let boardY = cell.y;
    if (prevCell) {
      const dx = shortestWrappedDelta(prevCell.x, cell.x, gameState.boardWidth);
      const dy = shortestWrappedDelta(prevCell.y, cell.y, gameState.boardHeight);
      boardX = prevCell.x + dx * progress;
      boardY = prevCell.y + dy * progress;
    } else if (progress < 1 && cell.direction) {
      switch (cell.direction) {
        case 'right': boardX = cell.x - (1 - progress); break;
        case 'left':  boardX = cell.x + (1 - progress); break;
        case 'down':  boardY = cell.y - (1 - progress); break;
        case 'up':    boardY = cell.y + (1 - progress); break;
      }
    }
    const wrappedBoardX = wrapCoord(boardX, gameState.boardWidth);
    const wrappedBoardY = wrapCoord(boardY, gameState.boardHeight);
    const headX = offsetX + wrappedBoardX * step;
    const headY = offsetY + wrappedBoardY * step;

    let dir: 'up' | 'down' | 'left' | 'right' = 'right';
    let closestBody: (typeof gameState.cells)[number] | undefined;
    let closestDist = Infinity;
    for (const c of gameState.cells) {
      if (c.isHead || c.color !== cell.color) continue;
      const dist = Math.abs(c.x - cell.x) + Math.abs(c.y - cell.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestBody = c;
      }
    }
    if (closestBody) {
      let bdx = cell.x - closestBody.x;
      let bdy = cell.y - closestBody.y;
      if (Math.abs(bdx) > 1) bdx = -Math.sign(bdx);
      if (Math.abs(bdy) > 1) bdy = -Math.sign(bdy);
      if (Math.abs(bdx) >= Math.abs(bdy)) {
        dir = bdx > 0 ? 'right' : 'left';
      } else {
        dir = bdy > 0 ? 'down' : 'up';
      }
    } else if (cell.direction) {
      dir = cell.direction;
    }

    const eSize = w * 0.38;
    const eBorder = Math.max(1, w * 0.04);
    const pSize = w * 0.18;
    const pupilOffset = w * 0.05;
    const outerSize = eSize + eBorder * 2;

    let eye1Top: number, eye1Left: number, eye2Top: number, eye2Left: number;
    let p1Top: number, p1Left: number, p2Top: number, p2Left: number;
    if (dir === 'right') {
      eye1Top = h * 0.08; eye1Left = w * 0.55;
      eye2Top = h * 0.54; eye2Left = w * 0.55;
      p1Top = pupilOffset; p1Left = eSize - pSize - pupilOffset;
      p2Top = pupilOffset; p2Left = eSize - pSize - pupilOffset;
    } else if (dir === 'left') {
      eye1Top = h * 0.08; eye1Left = w * 0.07;
      eye2Top = h * 0.54; eye2Left = w * 0.07;
      p1Top = pupilOffset; p1Left = pupilOffset;
      p2Top = pupilOffset; p2Left = pupilOffset;
    } else if (dir === 'up') {
      eye1Top = h * 0.07; eye1Left = w * 0.08;
      eye2Top = h * 0.07; eye2Left = w * 0.54;
      p1Top = pupilOffset; p1Left = pupilOffset;
      p2Top = pupilOffset; p2Left = pupilOffset;
    } else {
      eye1Top = h * 0.55; eye1Left = w * 0.08;
      eye2Top = h * 0.55; eye2Left = w * 0.54;
      p1Top = eSize - pSize - pupilOffset; p1Left = pupilOffset;
      p2Top = eSize - pSize - pupilOffset; p2Left = pupilOffset;
    }

    return (
      <React.Fragment key={`eyes-${keyPrefix}`}>
        <View style={{
          width: outerSize, height: outerSize,
          top: headY + eye1Top - eBorder, left: headX + eye1Left - eBorder,
          backgroundColor: '#000000', borderRadius: outerSize / 2,
        }}>
          <View style={{
            width: eSize, height: eSize,
            top: eBorder, left: eBorder,
            backgroundColor: '#ffffff', borderRadius: eSize / 2,
          }}>
            <View style={{
              width: pSize, height: pSize,
              top: p1Top, left: p1Left,
              backgroundColor: '#000000', borderRadius: pSize / 2,
            }} />
          </View>
        </View>
        <View style={{
          width: outerSize, height: outerSize,
          top: headY + eye2Top - eBorder, left: headX + eye2Left - eBorder,
          backgroundColor: '#000000', borderRadius: outerSize / 2,
        }}>
          <View style={{
            width: eSize, height: eSize,
            top: eBorder, left: eBorder,
            backgroundColor: '#ffffff', borderRadius: eSize / 2,
          }}>
            <View style={{
              width: pSize, height: pSize,
              top: p2Top, left: p2Left,
              backgroundColor: '#000000', borderRadius: pSize / 2,
            }} />
          </View>
        </View>
      </React.Fragment>
    );
  };

  const boardContent = (
    <View style={{ width: resolution.width, height: resolution.height, backgroundColor: gameState.backgroundColor }}>
      {/* Board border */}
      {borderW > 0 && (
        <View style={{
          width: boardW + borderW * 2,
          height: boardH + borderW * 2,
          top: offsetY - borderW,
          left: offsetX - borderW,
          borderWidth: borderW,
          borderColor: borderC,
        }} />
      )}
      {/* All cells — per-snake shaders applied to individual cells */}
      {visibleCells.map(({ cell, origIdx }, i) => {
        const { sw, sh, sx, sy } = computeCellGeometry(cell, origIdx);
        const renderedColor = detachedTailIndices.has(origIdx) ? darkenHexColor(cell.color) : cell.color;
        const cellShaders = snakeShaderMap.get(cell.color);
        const cellView = (
          <View style={{ width: sw, height: sh, backgroundColor: renderedColor }} />
        );
        if (cellShaders && cellShaders.length > 0) {
          const pad = sw;
          const outerW = sw + pad * 2;
          const outerH = sh + pad * 2;
          const innerCell = (
            <View style={{ width: outerW, height: outerH }}>
              <View style={{ width: sw, height: sh, top: pad, left: pad, backgroundColor: renderedColor }} />
            </View>
          );
          return (
            <View key={`cell-${i}`} style={{ width: outerW, height: outerH, top: sy - pad, left: sx - pad }}>
              {wrapWithShaders(innerCell, cellShaders, { width: Math.round(outerW), height: Math.round(outerH) })}
            </View>
          );
        }
        return (
          <View key={`cell-${i}`} style={{ width: sw, height: sh, top: sy, left: sx, backgroundColor: renderedColor }} />
        );
      })}
      {/* Grid overlay */}
      <View style={{ width: boardW, height: boardH, top: offsetY, left: offsetX }}>
        <Shader
          shaderId="grid-overlay"
          resolution={{ width: Math.round(boardW), height: Math.round(boardH) }}
          shaderParam={{
            type: 'struct',
            value: [
              { type: 'f32', fieldName: 'cells_x', value: gameState.boardWidth },
              { type: 'f32', fieldName: 'cells_y', value: gameState.boardHeight },
              { type: 'f32', fieldName: 'gap', value: gap },
              { type: 'f32', fieldName: 'line_r', value: gridColor.r },
              { type: 'f32', fieldName: 'line_g', value: gridColor.g },
              { type: 'f32', fieldName: 'line_b', value: gridColor.b },
              { type: 'f32', fieldName: 'line_a', value: gameState.gridLineAlpha ?? 1.0 },
            ],
          }}
        />
      </View>
      {/* Eyes on top of all cells */}
      {visibleCells.filter(({ cell }) => cell.isHead).map(({ cell }, i) => renderEyes(cell, `top-${i}`))}
    </View>
  );

  let rendered = boardContent;

  if (activeEffect && effectProgress < 1) {
    const shaderParams: ShaderParamStructField[] = [];

    if (activeEffect.params) {
      for (const param of activeEffect.params) {
        if (typeof param.paramValue === 'string' && param.paramValue.startsWith('#')) {
          const rgb = hexToRgb(param.paramValue);
          shaderParams.push({ type: 'f32', fieldName: `${param.paramName}_r`, value: rgb.r } as ShaderParamStructField);
          shaderParams.push({ type: 'f32', fieldName: `${param.paramName}_g`, value: rgb.g } as ShaderParamStructField);
          shaderParams.push({ type: 'f32', fieldName: `${param.paramName}_b`, value: rgb.b } as ShaderParamStructField);
        } else {
          const numValue = typeof param.paramValue === 'string' ? Number(param.paramValue) : param.paramValue;
          shaderParams.push({ type: 'f32', fieldName: param.paramName, value: numValue } as ShaderParamStructField);
        }
      }
    }

    const shaderDef = shadersController.getShaderById(activeEffect.shaderId);
    const shaderDefinesProgress = shaderDef?.params?.some(p => p.name === 'progress');
    if (shaderDefinesProgress) {
      const hasProgress = shaderParams.findIndex(p => p.fieldName === 'progress');
      if (hasProgress >= 0) {
        shaderParams[hasProgress] = { type: 'f32', fieldName: 'progress', value: effectProgress } as ShaderParamStructField;
      } else {
        shaderParams.push({ type: 'f32', fieldName: 'progress', value: effectProgress } as ShaderParamStructField);
      }
    }

    rendered = (
      <Shader
        shaderId={activeEffect.shaderId}
        resolution={resolution}
        shaderParam={shaderParams.length > 0 ? { type: 'struct', value: shaderParams } : undefined}
      >
        {boardContent}
      </Shader>
    );
  }

  if (showModal && (gameState.gameOverData || prevGameOverRef.current)) {
    const modalData = gameState.gameOverData ?? prevGameOverRef.current!;
    return (
      <View style={{ width: resolution.width, height: resolution.height }}>
        {rendered}
        <GameOverModal data={modalData} resolution={resolution} />
      </View>
    );
  }

  return rendered;
}

export function Input({ input }: { input: InputConfig }) {
  const streams = useInputStreams();
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.gameState;
  const streamState = isImage || isTextInput || isGame ? 'playing' : (streams[input.inputId]?.videoState ?? 'finished');
  const isVerticalInput = input.orientation === 'vertical';
  const resolution = isVerticalInput ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? (isTextInput ? 8 : 0),
  );
  const borderColor = input.borderColor ?? '#ff0000';
  const contentWidth = Math.max(1, resolution.width - borderWidth * 2);
  const contentHeight = Math.max(1, resolution.height - borderWidth * 2);

  const inputComponent = (
    <Rescaler style={resolution}>
      <View style={{ ...resolution, direction: 'column' }}>
        {streamState === 'playing' ? (
          <View
            style={{
              width: contentWidth,
              height: contentHeight,
              borderWidth,
              borderColor,
              backgroundColor: isTextInput ? '#1a1a2e' : undefined,
            }}>
            {isGame ? (
              <GameBoard gameState={input.gameState!} resolution={{ width: contentWidth, height: contentHeight }} snake1Shaders={input.snake1Shaders} snake2Shaders={input.snake2Shaders} />
            ) : isImage ? (
              <Rescaler style={{ rescaleMode: 'fit' }}>
                <Image imageId={input.imageId!} />
              </Rescaler>
            ) : isTextInput ? (
              <ScrollingText
                text={input.text!}
                maxLines={input.textMaxLines ?? 10}
                scrollSpeed={input.textScrollSpeed ?? 40}
                scrollLoop={input.textScrollLoop ?? true}
                fontSize={input.textFontSize ?? 80}
                color={input.textColor ?? 'white'}
                align={input.textAlign ?? 'left'}
                containerWidth={contentWidth}
                containerHeight={contentHeight}
                scrollNudge={input.textScrollNudge}
              />
            ) : (
              <Rescaler style={{ rescaleMode: 'fill' }}>
                <InputStream inputId={input.inputId} volume={input.volume} />
              </Rescaler>
            )}
          </View>
        ) : streamState === 'ready' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Image imageId="spinner" />
            </Rescaler>
          </View>
        ) : streamState === 'finished' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Text style={{ fontSize: 600, fontFamily: 'Star Jedi' }}>Stream offline</Text>
            </Rescaler>
          </View>
        ) : (
          <View />
        )}
        {input.showTitle !== false && (
          <View
            style={{
              backgroundColor: '#493880',
              height: 90,
              padding: 20,
              borderRadius: 0,
              direction: 'column',
              overflow: 'visible',
              bottom: 0,
              left: 0,
            }}>
            <Text style={{ fontSize: 40, color: 'white', fontFamily: 'Star Jedi' }}>{input?.title}</Text>
            <View style={{ height: 10 }} />

            <Text style={{ fontSize: 25, color: 'white', fontFamily: 'Star Jedi' }}>{input?.description}</Text>
          </View>
        )}
      </View>
    </Rescaler>
  );

  const activeShaders = input.shaders.filter(shader => shader.enabled);

  const mainRendered = wrapWithShaders(inputComponent, activeShaders, resolution);

  if (input.attachedInputs && input.attachedInputs.length > 0) {
    return (
      <View style={{ ...resolution, direction: 'column', overflow: 'visible' }}>
        {input.attachedInputs.map(attached => (
          <Rescaler key={attached.inputId} style={{ ...resolution, top: 0, left: 0 }}>
            <Input input={attached} />
          </Rescaler>
        ))}
        <Rescaler style={{ ...resolution, top: 0, left: 0 }}>
          {mainRendered}
        </Rescaler>
      </View>
    );
  }

  return mainRendered;
}

export function SmallInput({
  input,
  resolution = { width: 640, height: 360 },
}: {
  input: InputConfig;
  resolution?: Resolution;
}) {
  const activeShaders = input.shaders.filter(shader => shader.enabled);
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.gameState;
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? (isTextInput ? 4 : 0),
  );
  const borderColor = input.borderColor ?? '#ff0000';
  const contentWidth = Math.max(1, resolution.width - borderWidth * 2);
  const contentHeight = Math.max(1, resolution.height - borderWidth * 2);
  const smallInputComponent = (
    <View
      style={{
        width: resolution.width,
        height: resolution.height,
        direction: 'column',
        overflow: 'visible',
      }}>
      <View
        style={{
          width: contentWidth,
          height: contentHeight,
          borderWidth,
          borderColor,
          backgroundColor: isTextInput ? '#1a1a2e' : undefined,
        }}>
        {isGame ? (
          <GameBoard gameState={input.gameState!} resolution={{ width: contentWidth, height: contentHeight }} />
        ) : isImage ? (
          <Rescaler style={{ rescaleMode: 'fit' }}>
            <Image imageId={input.imageId!} />
          </Rescaler>
        ) : isTextInput ? (
          <ScrollingText
            text={input.text!}
            maxLines={input.textMaxLines ?? 10}
            scrollSpeed={input.textScrollSpeed ?? 40}
            scrollLoop={input.textScrollLoop ?? true}
            fontSize={30}
            color={input.textColor ?? 'white'}
            align={input.textAlign ?? 'left'}
            containerWidth={contentWidth}
            containerHeight={contentHeight}
            scrollNudge={input.textScrollNudge}
          />
        ) : (
          <Rescaler style={{ rescaleMode: 'fill' }}>
            <InputStream inputId={input.inputId} volume={input.volume} />
          </Rescaler>
        )}
      </View>
      {input.showTitle !== false && (
        <View
          style={{
            backgroundColor: '#493880',
            height: 40,
            padding: 20,
            borderRadius: 0,
            direction: 'column',
            overflow: 'visible',
            bottom: 0,
            left: 0,
          }}>
          <Text style={{ fontSize: 30, color: 'white', fontFamily: 'Star Jedi' }}>{input.title}</Text>
        </View>
      )}
    </View>
  );

  const mainRendered = activeShaders.length
    ? wrapWithShaders(smallInputComponent, activeShaders, resolution)
    : smallInputComponent;

  if (input.attachedInputs && input.attachedInputs.length > 0) {
    return (
      <Rescaler>
        <View style={{ ...resolution, direction: 'column', overflow: 'visible' }}>
          {input.attachedInputs.map(attached => (
            <Rescaler key={attached.inputId} style={{ ...resolution, top: 0, left: 0 }}>
              <SmallInput input={attached} resolution={resolution} />
            </Rescaler>
          ))}
          <Rescaler style={{ ...resolution, top: 0, left: 0 }}>
            {mainRendered}
          </Rescaler>
        </View>
      </Rescaler>
    );
  }

  return <Rescaler>{mainRendered}</Rescaler>;
}
