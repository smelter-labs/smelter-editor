import type { SnakeGameState, SnakeGameOverData } from './types';
import type { ShaderParamStructField, Transition } from '@swmansion/smelter';
import {
  Text,
  View,
  Shader,
} from '@swmansion/smelter';

import React, { useEffect, useRef, useState } from 'react';
import type { ShaderConfig } from '../types';
import shadersController from '../shaders/shaders';
import { hexToRgb, darkenHexColor, wrapWithShaders } from '../utils/shaderUtils';

type Resolution = { width: number; height: number };

function SnakeGameOverModal({ data, resolution }: { data: SnakeGameOverData; resolution: Resolution }) {
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

export function SnakeGameBoard({ snakeGameState, resolution, snake1Shaders, snake2Shaders }: { snakeGameState: SnakeGameState; resolution: Resolution; snake1Shaders?: ShaderConfig[]; snake2Shaders?: ShaderConfig[] }) {
  const gameState = snakeGameState;
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

  // Adaptive tick interval estimation for Smelter transition duration
  const lastUpdateRef = useRef(Date.now());
  const tickIntervalRef = useRef(150);
  const prevCellsRef = useRef<(typeof gameState.cells)>(gameState.cells);

  useEffect(() => {
    const now = Date.now();
    const delta = now - lastUpdateRef.current;
    if (delta > 30 && delta < 2000) {
      const current = tickIntervalRef.current;
      const alpha = delta > current ? 0.45 : 0.2;
      tickIntervalRef.current = current * (1 - alpha) + delta * alpha;
    }
    lastUpdateRef.current = now;
    prevCellsRef.current = gameState.cells;
  }, [gameState.cells]);

  // Game over: remove cells one by one, then show modal
  const [removedCount, setRemovedCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const prevGameOverRef = useRef<SnakeGameOverData | undefined>(undefined);
  const totalCellsAtGameOver = useRef(0);

  useEffect(() => {
    if (gameState.gameOverData && !prevGameOverRef.current) {
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

  // --- Swallow wave animation (bulge traveling head -> tail) ---
  const SWALLOW_DURATION_PER_SEGMENT_MS = 80;
  const SWALLOW_BULGE_MS = 200;
  const swallowWavesRef = useRef<Map<string, number>>(new Map());

  const snakeColors = new Set<string>();
  for (const cell of gameState.cells) {
    if (cell.isHead) snakeColors.add(cell.color);
  }

  useEffect(() => {
    const now = Date.now();

    const headColors = new Set<string>();
    for (const cell of gameState.cells) {
      if (cell.isHead) headColors.add(cell.color);
    }

    const currentFoodKeys = new Set<string>();
    for (const cell of gameState.cells) {
      if (cell.isHead || headColors.has(cell.color)) continue;
      const key = `${cell.x},${cell.y},${cell.color}`;
      currentFoodKeys.add(key);
      if (!prevFoodKeysRef.current.has(key)) {
        spawnTimesRef.current.set(key, now);
      }
    }

    for (const oldKey of prevFoodKeysRef.current) {
      if (!currentFoodKeys.has(oldKey)) {
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

    for (const key of spawnTimesRef.current.keys()) {
      if (!currentFoodKeys.has(key) || now - spawnTimesRef.current.get(key)! > SPAWN_DURATION_MS) {
        spawnTimesRef.current.delete(key);
      }
    }
    prevFoodKeysRef.current = currentFoodKeys;

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

  const prevCells = prevCellsRef.current;
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
      if (closest === null || closestDist > 2) break;
      ordered.push(closest);
      current = cells[closest];
      remaining.delete(closest);
    }

    const connectedCount = ordered.length;
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

  const segmentIndexMap = new Map<number, number>();
  for (const ordered of orderedCurrentByColor.values()) {
    ordered.forEach((cellIdx, segIdx) => segmentIndexMap.set(cellIdx, segIdx));
  }

  const isRemoving = !!gameState.gameOverData && removedCount > 0;
  const cellsAfterRemoval = isRemoving
    ? gameState.cells.slice(0, Math.max(0, gameState.cells.length - removedCount))
    : gameState.cells;

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

  const snakeColorOrder: string[] = [];
  for (const cell of gameState.cells) {
    if (cell.isHead && !snakeColorOrder.includes(cell.color)) {
      snakeColorOrder.push(cell.color);
    }
  }

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

  // Build stable id for each cell (snake: color index + segment index, food: position)
  const cellIdMap = new Map<number, string>();
  for (const [color, orderedIndices] of orderedCurrentByColor) {
    const colorIdx = snakeColorOrder.indexOf(color);
    orderedIndices.forEach((cellIdx, segIdx) => {
      cellIdMap.set(cellIdx, `s${colorIdx}-${segIdx}`);
    });
  }
  gameState.cells.forEach((cell, i) => {
    if (!cellIdMap.has(i)) {
      cellIdMap.set(i, `f-${cell.x}-${cell.y}`);
    }
  });

  const isCellWrapping = (
    cell: (typeof gameState.cells)[number],
    prev: (typeof gameState.cells)[number],
  ) => {
    const rawDx = Math.abs(cell.x - prev.x);
    const rawDy = Math.abs(cell.y - prev.y);
    const wrappedDx = Math.min(rawDx, gameState.boardWidth - rawDx);
    const wrappedDy = Math.min(rawDy, gameState.boardHeight - rawDy);
    return wrappedDx !== rawDx || wrappedDy !== rawDy;
  };

  const buildCellTransition = (origIdx: number): Transition | undefined => {
    const prevCell = prevCellByCurrentIndex.get(origIdx);
    if (!prevCell) return undefined;
    const cell = gameState.cells[origIdx];
    if (!cell) return undefined;
    if (isCellWrapping(cell, prevCell)) return undefined;
    return {
      durationMs: tickIntervalRef.current,
      easingFunction: 'linear',
      shouldInterrupt: true,
    };
  };

  const step = cellPixel + gap;

  const computeCellGeometry = (cell: (typeof gameState.cells)[number], origIdx: number) => {
    const size = cell.size ?? gameState.cellSize;
    const w = cellPixel * size;
    const h = cellPixel * size;
    const x = offsetX + cell.x * step;
    const y = offsetY + cell.y * step;

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

  const renderEyes = (cell: (typeof gameState.cells)[number], keyPrefix: string, headColorIdx: number) => {
    const size = cell.size ?? gameState.cellSize;
    const w = cellPixel * size;
    const h = cellPixel * size;
    const headX = offsetX + cell.x * step;
    const headY = offsetY + cell.y * step;

    const headIndex = gameState.cells.findIndex(c => c === cell);
    const prevCell = headIndex >= 0 ? prevCellByCurrentIndex.get(headIndex) : undefined;
    const isWrapping = prevCell ? isCellWrapping(cell, prevCell) : false;
    const eyeTransition: Transition | undefined = isWrapping ? undefined : {
      durationMs: tickIntervalRef.current,
      easingFunction: 'linear',
      shouldInterrupt: true,
    };

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

    const eyeIdPrefix = `eye-${headColorIdx}`;
    return (
      <React.Fragment key={`eyes-${keyPrefix}`}>
        <View
          id={`${eyeIdPrefix}-1o`}
          transition={eyeTransition}
          style={{
            width: outerSize, height: outerSize,
            top: headY + eye1Top - eBorder, left: headX + eye1Left - eBorder,
            backgroundColor: '#000000', borderRadius: outerSize / 2,
          }}
        >
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
        <View
          id={`${eyeIdPrefix}-2o`}
          transition={eyeTransition}
          style={{
            width: outerSize, height: outerSize,
            top: headY + eye2Top - eBorder, left: headX + eye2Left - eBorder,
            backgroundColor: '#000000', borderRadius: outerSize / 2,
          }}
        >
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
      {visibleCells.map(({ cell, origIdx }) => {
        const { sw, sh, sx, sy } = computeCellGeometry(cell, origIdx);
        const renderedColor = detachedTailIndices.has(origIdx) ? darkenHexColor(cell.color) : cell.color;
        const cellShaders = snakeShaderMap.get(cell.color);
        const cellId = cellIdMap.get(origIdx) ?? `cell-${origIdx}`;
        const cellTransition = buildCellTransition(origIdx);
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
            <View key={cellId} id={cellId} transition={cellTransition} style={{ width: outerW, height: outerH, top: sy - pad, left: sx - pad }}>
              {wrapWithShaders(innerCell, cellShaders, { width: Math.round(outerW), height: Math.round(outerH) })}
            </View>
          );
        }
        return (
          <View key={cellId} id={cellId} transition={cellTransition} style={{ width: sw, height: sh, top: sy, left: sx, backgroundColor: renderedColor }} />
        );
      })}
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
      {visibleCells.filter(({ cell }) => cell.isHead).map(({ cell }, i) => {
        const colorIdx = snakeColorOrder.indexOf(cell.color);
        return renderEyes(cell, `top-${i}`, colorIdx);
      })}
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
        <SnakeGameOverModal data={modalData} resolution={resolution} />
      </View>
    );
  }

  return rendered;
}
