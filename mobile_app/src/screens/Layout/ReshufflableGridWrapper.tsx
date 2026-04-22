import React, { useState, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, LayoutAnimation } from "react-native";
import { ReshufflableGrid, type Cell } from "react-native-reshuffled";
import { useNitroHealth } from "../../hooks/useNitroHealth";

export type ItemData<T> = {
  initial: {
    width: number;
    height: number;
    col: number;
    row: number;
  };
  props: T;
};

type GridItem<T> = Omit<Cell, "color"> & {
  id: string;
  itemProps: T;
  color?: string;
};

const HIGH_GRID_OPTIMIZATION_THRESHOLD = 50 * 50;
const MIN_TILE_WIDTH_CELLS = 16;
const MIN_TILE_HEIGHT_CELLS = 9;

const shallowEqualObject = (first: unknown, second: unknown): boolean => {
  if (first === second) return true;
  if (!first || !second) return false;
  if (typeof first !== "object" || typeof second !== "object") return false;

  const firstObj = first as Record<string, unknown>;
  const secondObj = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstObj);
  const secondKeys = Object.keys(secondObj);
  if (firstKeys.length !== secondKeys.length) return false;

  for (const key of firstKeys) {
    if (!(key in secondObj)) return false;
    if (firstObj[key] !== secondObj[key]) return false;
  }
  return true;
};

const areGridItemsEquivalent = <T,>(
  first: GridItem<T>[],
  second: GridItem<T>[],
): boolean =>
  first.length === second.length &&
  first.every(
    (item, index) =>
      item.id === second[index]?.id &&
      item.startColumn === second[index]?.startColumn &&
      item.startRow === second[index]?.startRow &&
      item.width === second[index]?.width &&
      item.height === second[index]?.height &&
      shallowEqualObject(item.itemProps, second[index]?.itemProps),
  );

const summarizeGridDiff = <T,>(
  previous: GridItem<T>[],
  next: GridItem<T>[],
) => {
  const prevById = new Map(previous.map((item) => [item.id, item]));
  const nextById = new Map(next.map((item) => [item.id, item]));

  let movedCount = 0;
  let resizedCount = 0;
  for (const [id, prevItem] of prevById) {
    const nextItem = nextById.get(id);
    if (!nextItem) continue;
    if (
      prevItem.startColumn !== nextItem.startColumn ||
      prevItem.startRow !== nextItem.startRow
    ) {
      movedCount += 1;
    }
    if (
      prevItem.width !== nextItem.width ||
      prevItem.height !== nextItem.height
    ) {
      resizedCount += 1;
    }
  }

  const removedCount = previous.filter((item) => !nextById.has(item.id)).length;
  const addedCount = next.filter((item) => !prevById.has(item.id)).length;
  const orderChanged =
    previous.length !== next.length ||
    previous.some((item, index) => item.id !== next[index]?.id);

  return {
    movedCount,
    resizedCount,
    removedCount,
    addedCount,
    orderChanged,
  };
};

const isOverlapping = <T,>(first: GridItem<T>, second: GridItem<T>) => {
  const firstEndCol = first.startColumn + first.width;
  const firstEndRow = first.startRow + first.height;
  const secondEndCol = second.startColumn + second.width;
  const secondEndRow = second.startRow + second.height;

  return (
    first.startColumn < secondEndCol &&
    firstEndCol > second.startColumn &&
    first.startRow < secondEndRow &&
    firstEndRow > second.startRow
  );
};

const isVerticallyOverlapping = <T,>(
  first: GridItem<T>,
  second: GridItem<T>,
) => {
  const firstEndRow = first.startRow + first.height;
  const secondEndRow = second.startRow + second.height;

  return first.startRow < secondEndRow && firstEndRow > second.startRow;
};

const splitByVerticalOverlap = <T,>(items: GridItem<T>[]) => {
  const groups: GridItem<T>[][] = [];
  const visited = new Set<string>();

  for (const item of items) {
    if (visited.has(item.id)) {
      continue;
    }

    const stack = [item];
    const group: GridItem<T>[] = [];
    visited.add(item.id);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      group.push(current);

      for (const candidate of items) {
        if (visited.has(candidate.id)) {
          continue;
        }

        if (isVerticallyOverlapping(current, candidate)) {
          visited.add(candidate.id);
          stack.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};

const isHorizontallyOverlapping = <T,>(
  first: GridItem<T>,
  second: GridItem<T>,
) => {
  const firstEndCol = first.startColumn + first.width;
  const secondEndCol = second.startColumn + second.width;

  return first.startColumn < secondEndCol && firstEndCol > second.startColumn;
};

const splitByHorizontalOverlap = <T,>(items: GridItem<T>[]) => {
  const groups: GridItem<T>[][] = [];
  const visited = new Set<string>();

  for (const item of items) {
    if (visited.has(item.id)) {
      continue;
    }

    const stack = [item];
    const group: GridItem<T>[] = [];
    visited.add(item.id);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      group.push(current);

      for (const candidate of items) {
        if (visited.has(candidate.id)) {
          continue;
        }

        if (isHorizontallyOverlapping(current, candidate)) {
          visited.add(candidate.id);
          stack.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups;
};

const distributeEqualShrink = (widths: number[], deficit: number) => {
  const next = [...widths];
  let remaining = deficit;

  while (remaining > 0) {
    const shrinkable = next
      .map((width, index) => ({ width, index }))
      .filter(({ width }) => width > 1)
      .map(({ index }) => index);

    if (shrinkable.length === 0) {
      break;
    }

    const roundShare = Math.max(1, Math.floor(remaining / shrinkable.length));
    let changedInRound = false;

    for (const index of shrinkable) {
      if (remaining <= 0) {
        break;
      }

      const allowed = next[index] - 1;
      if (allowed <= 0) {
        continue;
      }

      const shrinkBy = Math.min(roundShare, allowed, remaining);
      if (shrinkBy <= 0) {
        continue;
      }

      next[index] -= shrinkBy;
      remaining -= shrinkBy;
      changedInRound = true;
    }

    if (!changedInRound) {
      break;
    }
  }

  return next;
};

const allocateProportionalSizes = (
  sizes: number[],
  totalAvailable: number,
): number[] => {
  const count = sizes.length;
  if (count === 0) return [];

  const safeSizes = sizes.map((size) => Math.max(1, size));
  if (totalAvailable <= count) {
    return Array(count).fill(1);
  }

  const base = Array(count).fill(1);
  const remaining = totalAvailable - count;
  const weights = safeSizes.map((size) => size - 1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    const equalShare = Math.floor(remaining / count);
    let leftover = remaining - equalShare * count;
    for (let index = 0; index < count; index += 1) {
      base[index] += equalShare;
      if (leftover > 0) {
        base[index] += 1;
        leftover -= 1;
      }
    }
    return base;
  }

  const floors: number[] = Array(count).fill(0);
  const remainders: Array<{ index: number; value: number }> = [];
  let used = 0;

  for (let index = 0; index < count; index += 1) {
    const raw = (weights[index] / totalWeight) * remaining;
    const floorValue = Math.floor(raw);
    floors[index] = floorValue;
    used += floorValue;
    remainders.push({ index, value: raw - floorValue });
  }

  let leftover = remaining - used;
  remainders.sort((first, second) => second.value - first.value);
  for (let index = 0; index < remainders.length && leftover > 0; index += 1) {
    floors[remainders[index].index] += 1;
    leftover -= 1;
  }

  return base.map((value, index) => value + floors[index]);
};

const clampWithinGrid = <T,>(
  item: GridItem<T>,
  rows: number,
  columns: number,
  minWidth: number = 1,
  minHeight: number = 1,
): GridItem<T> => {
  const minW = Math.max(1, Math.min(minWidth, columns));
  const minH = Math.max(1, Math.min(minHeight, rows));
  const width = Math.max(minW, Math.min(item.width, columns));
  const height = Math.max(minH, Math.min(item.height, rows));

  return {
    ...item,
    width,
    height,
    startColumn: Math.max(0, Math.min(item.startColumn, columns - width)),
    startRow: Math.max(0, Math.min(item.startRow, rows - height)),
  };
};

const overlapsAny = <T,>(item: GridItem<T>, obstacles: GridItem<T>[]) => {
  return obstacles.some((other) => isOverlapping(item, other));
};

const flushCandidatesForObstacle = <T,>(
  moved: GridItem<T>,
  obstacle: GridItem<T>,
): Array<{ startRow: number; startColumn: number }> => {
  const movedEndCol = moved.startColumn + moved.width;
  const movedEndRow = moved.startRow + moved.height;
  const obstacleEndCol = obstacle.startColumn + obstacle.width;
  const obstacleEndRow = obstacle.startRow + obstacle.height;

  const overlapX =
    Math.min(movedEndCol, obstacleEndCol) -
    Math.max(moved.startColumn, obstacle.startColumn);
  const overlapY =
    Math.min(movedEndRow, obstacleEndRow) -
    Math.max(moved.startRow, obstacle.startRow);

  if (overlapX <= 0 || overlapY <= 0) {
    return [];
  }

  const prefersHorizontalNudge = overlapX <= overlapY;

  if (prefersHorizontalNudge) {
    return [
      {
        startRow: moved.startRow,
        startColumn: obstacle.startColumn - moved.width,
      },
      {
        startRow: moved.startRow,
        startColumn: obstacleEndCol,
      },
    ];
  }

  return [
    {
      startRow: obstacle.startRow - moved.height,
      startColumn: moved.startColumn,
    },
    {
      startRow: obstacleEndRow,
      startColumn: moved.startColumn,
    },
  ];
};

const findNearestFreePosition = <T,>(
  moved: GridItem<T>,
  obstacles: GridItem<T>[],
  rows: number,
  columns: number,
  minWidth: number,
  minHeight: number,
): GridItem<T> => {
  const normalizedStart = clampWithinGrid(
    moved,
    rows,
    columns,
    minWidth,
    minHeight,
  );

  if (!overlapsAny(normalizedStart, obstacles)) {
    return normalizedStart;
  }

  const overlappingObstacles = obstacles.filter((obstacle) =>
    isOverlapping(normalizedStart, obstacle),
  );

  const scoredCandidates: Array<{ score: number; item: GridItem<T> }> = [];
  for (const obstacle of overlappingObstacles) {
    for (const candidate of flushCandidatesForObstacle(
      normalizedStart,
      obstacle,
    )) {
      const positioned = clampWithinGrid(
        {
          ...normalizedStart,
          startRow: candidate.startRow,
          startColumn: candidate.startColumn,
        },
        rows,
        columns,
        minWidth,
        minHeight,
      );

      if (overlapsAny(positioned, obstacles)) {
        continue;
      }

      const score =
        Math.abs(positioned.startColumn - normalizedStart.startColumn) +
        Math.abs(positioned.startRow - normalizedStart.startRow);
      scoredCandidates.push({ score, item: positioned });
    }
  }

  if (scoredCandidates.length > 0) {
    scoredCandidates.sort((a, b) => a.score - b.score);
    return scoredCandidates[0].item;
  }

  // Fallback: radial search around current target, no wrap-to-origin behavior.
  const maxRadius = Math.max(columns, rows);
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let dCol = -radius; dCol <= radius; dCol += 1) {
      const dRow = radius - Math.abs(dCol);
      const rowOffsets = dRow === 0 ? [0] : [-dRow, dRow];

      for (const rowOffset of rowOffsets) {
        const candidate = clampWithinGrid(
          {
            ...normalizedStart,
            startColumn: normalizedStart.startColumn + dCol,
            startRow: normalizedStart.startRow + rowOffset,
          },
          rows,
          columns,
          minWidth,
          minHeight,
        );
        if (!overlapsAny(candidate, obstacles)) {
          return candidate;
        }
      }
    }
  }

  return normalizedStart;
};

const resolveCollisionsOnDrop = <T,>(
  nextItems: GridItem<T>[],
  previousItems: GridItem<T>[],
  rows: number,
  columns: number,
  minWidth: number,
  minHeight: number,
): GridItem<T>[] => {
  const previousById = new Map(previousItems.map((item) => [item.id, item]));
  const normalizedNext = nextItems.map((item) =>
    clampWithinGrid(item, rows, columns, minWidth, minHeight),
  );

  const changedIds = normalizedNext
    .filter((item) => {
      const previous = previousById.get(item.id);
      if (!previous) return true;
      return (
        previous.startColumn !== item.startColumn ||
        previous.startRow !== item.startRow ||
        previous.width !== item.width ||
        previous.height !== item.height
      );
    })
    .map((item) => item.id);

  if (changedIds.length === 0) {
    return normalizedNext;
  }

  const fixedById = new Map<string, GridItem<T>>();
  for (const item of normalizedNext) {
    if (!changedIds.includes(item.id)) {
      fixedById.set(item.id, item);
    }
  }

  const resolvedById = new Map<string, GridItem<T>>();

  for (const changedId of changedIds) {
    const changedItem = normalizedNext.find((item) => item.id === changedId);
    if (!changedItem) {
      continue;
    }

    const obstacles = [...fixedById.values(), ...resolvedById.values()].filter(
      (item) => item.id !== changedItem.id,
    );

    const resolved = findNearestFreePosition(
      changedItem,
      obstacles,
      rows,
      columns,
      minWidth,
      minHeight,
    );

    if (overlapsAny(resolved, obstacles)) {
      const previous = previousById.get(changedId);
      if (previous) {
        resolvedById.set(
          changedId,
          clampWithinGrid(previous, rows, columns, minWidth, minHeight),
        );
      } else {
        resolvedById.set(changedId, resolved);
      }
    } else {
      resolvedById.set(changedId, resolved);
    }
  }

  return normalizedNext.map(
    (item) => resolvedById.get(item.id) ?? fixedById.get(item.id) ?? item,
  );
};

export enum ResizeHandleDirection {
  TOP = "top",
  TOP_RIGHT = "topRight",
  RIGHT = "right",
  BOTTOM_RIGHT = "bottomRight",
  BOTTOM = "bottom",
  BOTTOM_LEFT = "bottomLeft",
  LEFT = "left",
  TOP_LEFT = "topLeft",
}

export type GridItemControls = {
  isSelected?: boolean;
  onSelect?: () => void;
  onLongPress?: () => void;
  resizePreview?: {
    cellPixelWidth: number;
    cellPixelHeight: number;
    widthCells: number;
    heightCells: number;
  };
  onResizeStart?: (direction: ResizeHandleDirection) => void;
  onResizeUpdate?: (
    direction: ResizeHandleDirection,
    translationX: number,
    translationY: number,
  ) => void;
  onResizeEnd?: (direction: ResizeHandleDirection) => void;
};

interface ReshufflableGridWrapperProps<T> {
  itemData: ItemData<T>[];
  renderedComponent: React.ComponentType<T & GridItemControls>;
  onItemChange: (items: ItemData<T>[]) => void;
  onItemLongPress?: (itemId: string) => void;
  rows?: number;
  columns?: number;
  containerStyle?: object;
}

const ReshufflableGridWrapper = <T extends { id: string }>({
  itemData,
  renderedComponent: RenderedComponent,
  onItemChange,
  onItemLongPress,
  rows: initialRows = 20,
  columns: initialColumns = 20,
  containerStyle,
}: ReshufflableGridWrapperProps<T>) => {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const nitroHealth = useNitroHealth("ReshufflableGridWrapper");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const isUpdatingFromGrid = useRef(false);
  const resizeSessionRef = useRef<{
    itemId: string;
    startWidth: number;
    startHeight: number;
    startColumn: number;
    startRow: number;
    direction: ResizeHandleDirection;
  } | null>(null);
  const lastResizeDeltaRef = useRef<{
    itemId: string;
    colDelta: number;
    rowDelta: number;
  } | null>(null);

  const highGridOptimizationEnabled =
    columns * rows > HIGH_GRID_OPTIMIZATION_THRESHOLD;
  const minTileWidth = Math.min(MIN_TILE_WIDTH_CELLS, columns);
  const minTileHeight = Math.min(MIN_TILE_HEIGHT_CELLS, rows);

  const [data, setData] = useState<GridItem<T>[]>(() =>
    itemData.map((item) => ({
      id: item.props.id,
      width: item.initial.width,
      height: item.initial.height,
      startColumn: item.initial.col,
      startRow: item.initial.row,
      itemProps: item.props,
    })),
  );

  // Sync prop changes from itemData to internal data state.
  // Handles structural changes (add / remove / reorder) by matching on semantic id.
  useEffect(() => {
    setData((prev) => {
      const next = itemData.map((item) => ({
        id: item.props.id,
        width: item.initial.width,
        height: item.initial.height,
        startColumn: item.initial.col,
        startRow: item.initial.row,
        itemProps: item.props,
      }));

      // Avoid unnecessary state updates
      if (areGridItemsEquivalent(next, prev)) {
        if (isUpdatingFromGrid.current) {
          isUpdatingFromGrid.current = false;
        }
        return prev;
      }

      if (isUpdatingFromGrid.current) {
        isUpdatingFromGrid.current = false;
        if (__DEV__) {
          console.log("[LayoutGrid] Applying external layout correction", {
            ...summarizeGridDiff(prev, next),
            nextItemCount: next.length,
          });
        }
      }

      return next;
    });
  }, [itemData]);

  useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    resizeSessionRef.current = null;
    lastResizeDeltaRef.current = null;
    setSelectedItemId(null);
  }, [columns, rows]);

  useEffect(() => {
    if (!__DEV__) return;
    console.info("[LayoutGrid] Performance mode", {
      columns,
      rows,
      cells: columns * rows,
      highGridOptimizationEnabled,
      nitroPath: nitroHealth.path,
      nitroReason: nitroHealth.reason,
    });
  }, [
    columns,
    rows,
    highGridOptimizationEnabled,
    nitroHealth.path,
    nitroHealth.reason,
  ]);

  const updateGridItemSize = (
    id: string,
    key: "width" | "height",
    value: number,
  ) => {
    const parsed = value;
    if (Number.isNaN(parsed)) {
      return;
    }

    const direction = key === "width" ? "horizontal" : "vertical";

    setData((previousData) => {
      const nextData = previousData.map((item) => ({ ...item }));
      const targetIndex = nextData.findIndex((item) => item.id === id);
      if (targetIndex === -1) {
        return previousData;
      }

      const target = nextData[targetIndex];
      const initialStartColumn = target.startColumn;
      const initialStartRow = target.startRow;
      let horizontalPushDirection: "left" | "right" = "right";
      let verticalPushDirection: "up" | "down" = "down";

      if (key === "width") {
        const requestedWidth = Math.max(1, Math.min(parsed, columns));
        const rightCapacity = columns - target.startColumn;

        if (requestedWidth > rightCapacity) {
          const missingOnRight = requestedWidth - rightCapacity;
          const shiftLeft = Math.min(missingOnRight, target.startColumn);
          target.startColumn -= shiftLeft;
        }

        target.width = Math.max(
          1,
          Math.min(requestedWidth, columns - target.startColumn),
        );
      } else {
        const requestedHeight = Math.max(1, Math.min(parsed, rows));
        const downCapacity = rows - target.startRow;

        if (requestedHeight > downCapacity) {
          const missingOnBottom = requestedHeight - downCapacity;
          const shiftUp = Math.min(missingOnBottom, target.startRow);
          target.startRow -= shiftUp;
        }

        target.height = Math.max(
          1,
          Math.min(requestedHeight, rows - target.startRow),
        );
      }

      if (target.startColumn < initialStartColumn) {
        horizontalPushDirection = "left";
      }
      if (target.startRow < initialStartRow) {
        verticalPushDirection = "up";
      }

      nextData[targetIndex] = clampWithinGrid(
        target,
        rows,
        columns,
        minTileWidth,
        minTileHeight,
      );

      const queue: string[] = [id];
      const queued = new Set<string>([id]);
      let safetyCounter = 0;

      while (queue.length > 0 && safetyCounter < 500) {
        safetyCounter += 1;
        const sourceId = queue.shift();
        if (!sourceId) {
          break;
        }
        queued.delete(sourceId);

        const source = nextData.find((item) => item.id === sourceId);
        if (!source) {
          continue;
        }

        if (direction === "horizontal" && horizontalPushDirection === "left") {
          const colliding = nextData.filter(
            (item) => item.id !== source.id && isOverlapping(source, item),
          );
          const verticalGroups = splitByVerticalOverlap(colliding);

          for (const group of verticalGroups) {
            const availableLeft = source.startColumn;
            const sortedGroup = [...group].sort(
              (first, second) => first.startColumn - second.startColumn,
            );

            if (availableLeft < sortedGroup.length) {
              sortedGroup.forEach((groupItem) => {
                groupItem.startColumn = source.startColumn + source.width;
                if (groupItem.startColumn >= columns) {
                  groupItem.startColumn = columns - 1;
                }
                groupItem.width = Math.max(
                  1,
                  Math.min(groupItem.width, columns - groupItem.startColumn),
                );
              });
            } else {
              const widths = sortedGroup.map((groupItem) => groupItem.width);
              const totalWidth = widths.reduce((sum, width) => sum + width, 0);
              const deficit = Math.max(0, totalWidth - availableLeft);
              const nextWidths = distributeEqualShrink(widths, deficit);

              let cursor = source.startColumn;
              for (
                let groupIndex = sortedGroup.length - 1;
                groupIndex >= 0;
                groupIndex -= 1
              ) {
                const groupItem = sortedGroup[groupIndex];
                const width = nextWidths[groupIndex];
                cursor -= width;
                groupItem.width = width;
                groupItem.startColumn = cursor;
              }
            }

            sortedGroup.forEach((groupItem) => {
              const groupItemIndex = nextData.findIndex(
                (item) => item.id === groupItem.id,
              );
              if (groupItemIndex === -1) {
                return;
              }

              nextData[groupItemIndex] = clampWithinGrid(
                groupItem,
                rows,
                columns,
                minTileWidth,
                minTileHeight,
              );
              if (!queued.has(groupItem.id)) {
                queue.push(groupItem.id);
                queued.add(groupItem.id);
              }
            });
          }

          continue;
        }

        for (let index = 0; index < nextData.length; index += 1) {
          const current = nextData[index];
          if (current.id === source.id || !isOverlapping(source, current)) {
            continue;
          }

          if (direction === "vertical") {
            if (verticalPushDirection === "down") {
              current.startRow = source.startRow + source.height;
              if (current.startRow >= rows) {
                current.startRow = rows - 1;
              }
              current.height = Math.max(
                1,
                Math.min(current.height, rows - current.startRow),
              );
            } else {
              const availableAbove = source.startRow;
              if (availableAbove >= 1) {
                current.height = Math.max(
                  1,
                  Math.min(current.height, availableAbove),
                );
                current.startRow = source.startRow - current.height;
              } else {
                current.startRow = source.startRow + source.height;
                if (current.startRow >= rows) {
                  current.startRow = rows - 1;
                }
                current.height = Math.max(
                  1,
                  Math.min(current.height, rows - current.startRow),
                );
              }
            }
          } else {
            current.startColumn = source.startColumn + source.width;
            if (current.startColumn >= columns) {
              current.startColumn = columns - 1;
            }
            current.width = Math.max(
              1,
              Math.min(current.width, columns - current.startColumn),
            );
          }

          nextData[index] = clampWithinGrid(
            current,
            rows,
            columns,
            minTileWidth,
            minTileHeight,
          );

          if (!queued.has(current.id)) {
            queue.push(current.id);
            queued.add(current.id);
          }
        }
      }

      return nextData;
    });
  };

  const normalizedData = useMemo(() => {
    return data.map((item) => {
      const width = Math.min(item.width, columns);
      const height = Math.min(item.height, rows);
      const startColumn = Math.min(item.startColumn, columns - width);
      const startRow = Math.min(item.startRow, rows - height);

      return {
        ...item,
        width: Math.max(minTileWidth, width),
        height: Math.max(minTileHeight, height),
        startColumn: Math.max(0, startColumn),
        startRow: Math.max(0, startRow),
        color: item.color || "#6200EE",
      };
    });
  }, [data, columns, rows, minTileWidth, minTileHeight]);

  const handleItemsChange = (items: Cell[]) => {
    isUpdatingFromGrid.current = true;

    const gridById = new Map(items.map((item) => [item.id, item]));
    const mergedData = data.map((previousItem) => {
      const nextItem = gridById.get(previousItem.id);
      if (!nextItem) {
        return previousItem;
      }

      return {
        ...previousItem,
        width: nextItem.width,
        height: nextItem.height,
        startColumn: nextItem.startColumn,
        startRow: nextItem.startRow,
      };
    });

    const nextData = highGridOptimizationEnabled
      ? resolveCollisionsOnDrop(
          mergedData,
          data,
          rows,
          columns,
          minTileWidth,
          minTileHeight,
        )
      : mergedData;

    setData(nextData);

    const updatedItemData: ItemData<T>[] = nextData.map((item) => ({
      initial: {
        width: item.width,
        height: item.height,
        col: item.startColumn,
        row: item.startRow,
      },
      props: item.itemProps,
    }));
    onItemChange(updatedItemData);
  };

  const handleResizeStart = (
    itemId: string,
    direction: ResizeHandleDirection,
  ): void => {
    lastResizeDeltaRef.current = null;
    setSelectedItemId(itemId);

    const target = data.find((item) => item.id === itemId);
    if (!target) {
      resizeSessionRef.current = null;
      return;
    }

    resizeSessionRef.current = {
      itemId,
      startWidth: target.width,
      startHeight: target.height,
      startColumn: target.startColumn,
      startRow: target.startRow,
      direction,
    };
  };

  const handleResizeUpdate = (
    itemId: string,
    _direction: ResizeHandleDirection,
    translationX: number,
    translationY: number,
  ): void => {
    const session = resizeSessionRef.current;
    if (!session || session.itemId !== itemId) return;

    const cellPixelWidth = gridSize.width > 0 ? gridSize.width / columns : 1;
    const cellPixelHeight = gridSize.height > 0 ? gridSize.height / rows : 1;
    const colDelta = Math.round(translationX / cellPixelWidth);
    const rowDelta = Math.round(translationY / cellPixelHeight);

    const previousDelta = lastResizeDeltaRef.current;
    if (
      previousDelta &&
      previousDelta.itemId === itemId &&
      previousDelta.colDelta === colDelta &&
      previousDelta.rowDelta === rowDelta
    ) {
      return;
    }
    lastResizeDeltaRef.current = { itemId, colDelta, rowDelta };

    LayoutAnimation.configureNext({
      duration: highGridOptimizationEnabled ? 90 : 70,
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
    });

    setData((prevData) => {
      const nextData = prevData.map((item) => ({ ...item }));
      const index = nextData.findIndex((item) => item.id === itemId);
      if (index === -1) return prevData;

      const target = nextData[index];
      const dir = session.direction;
      const rightEdge = session.startColumn + session.startWidth;
      const bottomEdge = session.startRow + session.startHeight;

      // Horizontal axis
      if (dir === "left" || dir === "topLeft" || dir === "bottomLeft") {
        const newCol = Math.max(
          0,
          Math.min(rightEdge - 1, session.startColumn + colDelta),
        );
        target.startColumn = newCol;
        target.width = rightEdge - newCol;
      } else if (
        dir === "right" ||
        dir === "topRight" ||
        dir === "bottomRight"
      ) {
        target.startColumn = session.startColumn;
        target.width = Math.max(
          1,
          Math.min(
            columns - session.startColumn,
            session.startWidth + colDelta,
          ),
        );
      }

      // Vertical axis
      if (dir === "top" || dir === "topLeft" || dir === "topRight") {
        const newRow = Math.max(
          0,
          Math.min(bottomEdge - 1, session.startRow + rowDelta),
        );
        target.startRow = newRow;
        target.height = bottomEdge - newRow;
      } else if (
        dir === "bottom" ||
        dir === "bottomLeft" ||
        dir === "bottomRight"
      ) {
        target.startRow = session.startRow;
        target.height = Math.max(
          1,
          Math.min(rows - session.startRow, session.startHeight + rowDelta),
        );
      }

      // ── Collision resolution ─────────────────────────────────────────────
      // Push siblings away from the resized item so they never visually overlap.
      // Direction of push follows which edge(s) are being dragged.
      const pushRight =
        dir === "right" || dir === "topRight" || dir === "bottomRight";
      const pushLeft =
        dir === "left" || dir === "topLeft" || dir === "bottomLeft";
      const pushDown =
        dir === "bottom" || dir === "bottomLeft" || dir === "bottomRight";
      const pushUp = dir === "top" || dir === "topLeft" || dir === "topRight";

      // ── Collision-chain pushing ────────────────────────────────────────────
      // Keep empty space intact and only move siblings when they are actually
      // touched by the resized item (or by another moved sibling in the chain).
      // This prevents distant, non-neighbour items from being redistributed.

      // Helper: does `cell` overlap the dragged item's ORIGINAL row span?
      const inOriginalRowBand = (cell: GridItem<T>) =>
        cell.startRow < session.startRow + session.startHeight &&
        cell.startRow + cell.height > session.startRow;

      // Helper: does `cell` overlap the dragged item's ORIGINAL column span?
      const inOriginalColBand = (cell: GridItem<T>) =>
        cell.startColumn < session.startColumn + session.startWidth &&
        cell.startColumn + cell.width > session.startColumn;

      const redistributeHFromLeft = (
        cells: GridItem<T>[],
        rangeStart: number,
        rangeEnd: number,
      ) => {
        if (cells.length === 0) return;

        const available = Math.max(0, rangeEnd - rangeStart);

        const allocated = allocateProportionalSizes(
          cells.map((cell) => cell.width),
          available,
        );
        let cursor = rangeStart;

        cells.forEach((cell, index) => {
          const nextWidth = allocated[index] ?? 1;

          const dataIndex = nextData.findIndex((item) => item.id === cell.id);
          if (dataIndex >= 0) {
            nextData[dataIndex].startColumn = cursor;
            nextData[dataIndex].width = nextWidth;
          }
          cursor += nextWidth;
        });
      };

      const redistributeHFromRight = (
        cells: GridItem<T>[],
        rangeStart: number,
        rangeEnd: number,
      ) => {
        if (cells.length === 0) return;

        const available = Math.max(0, rangeEnd - rangeStart);

        const allocated = allocateProportionalSizes(
          cells.map((cell) => cell.width),
          available,
        );
        let cursor = rangeEnd;

        cells.forEach((cell, index) => {
          const nextWidth = allocated[index] ?? 1;

          cursor -= nextWidth;
          const dataIndex = nextData.findIndex((item) => item.id === cell.id);
          if (dataIndex >= 0) {
            nextData[dataIndex].startColumn = cursor;
            nextData[dataIndex].width = nextWidth;
          }
        });
      };

      const redistributeVFromTop = (
        cells: GridItem<T>[],
        rangeStart: number,
        rangeEnd: number,
      ) => {
        if (cells.length === 0) return;

        const available = Math.max(0, rangeEnd - rangeStart);

        const allocated = allocateProportionalSizes(
          cells.map((cell) => cell.height),
          available,
        );
        let cursor = rangeStart;

        cells.forEach((cell, index) => {
          const nextHeight = allocated[index] ?? 1;

          const dataIndex = nextData.findIndex((item) => item.id === cell.id);
          if (dataIndex >= 0) {
            nextData[dataIndex].startRow = cursor;
            nextData[dataIndex].height = nextHeight;
          }
          cursor += nextHeight;
        });
      };

      const redistributeVFromBottom = (
        cells: GridItem<T>[],
        rangeStart: number,
        rangeEnd: number,
      ) => {
        if (cells.length === 0) return;

        const available = Math.max(0, rangeEnd - rangeStart);

        const allocated = allocateProportionalSizes(
          cells.map((cell) => cell.height),
          available,
        );
        let cursor = rangeEnd;

        cells.forEach((cell, index) => {
          const nextHeight = allocated[index] ?? 1;

          cursor -= nextHeight;
          const dataIndex = nextData.findIndex((item) => item.id === cell.id);
          if (dataIndex >= 0) {
            nextData[dataIndex].startRow = cursor;
            nextData[dataIndex].height = nextHeight;
          }
        });
      };

      if (pushRight && target.width > session.startWidth) {
        const affected = nextData.filter(
          (c) =>
            c.id !== itemId &&
            c.startColumn >= session.startColumn + session.startWidth &&
            inOriginalRowBand(c),
        );
        const targetRight = target.startColumn + target.width;
        const verticalGroups = splitByVerticalOverlap(affected);
        verticalGroups.forEach((group) => {
          const sorted = group
            .slice()
            .sort((a, b) => a.startColumn - b.startColumn);

          const touched: GridItem<T>[] = [];
          let cursor = targetRight;
          let gapStart: number | null = null;

          for (const cell of sorted) {
            if (cell.startColumn > cursor) {
              gapStart = cell.startColumn;
              break;
            }

            touched.push(cell);
            cursor = Math.max(cursor, cell.startColumn + cell.width);
          }

          if (touched.length === 0) {
            return;
          }

          const rangeEnd = gapStart ?? columns;
          redistributeHFromLeft(touched, targetRight, rangeEnd);
        });
      }

      if (pushLeft && target.startColumn < session.startColumn) {
        const affected = nextData.filter(
          (c) =>
            c.id !== itemId &&
            c.startColumn + c.width <= session.startColumn &&
            inOriginalRowBand(c),
        );
        const verticalGroups = splitByVerticalOverlap(affected);
        verticalGroups.forEach((group) => {
          const sorted = group
            .slice()
            .sort((a, b) => b.startColumn - a.startColumn);

          const touched: GridItem<T>[] = [];
          let cursor = target.startColumn;
          let gapEnd: number | null = null;

          for (const cell of sorted) {
            const cellEnd = cell.startColumn + cell.width;
            if (cellEnd < cursor) {
              gapEnd = cellEnd;
              break;
            }

            touched.push(cell);
            cursor = Math.min(cursor, cell.startColumn);
          }

          if (touched.length === 0) {
            return;
          }

          const rangeStart = gapEnd ?? 0;
          redistributeHFromRight(touched, rangeStart, target.startColumn);
        });
      }

      if (pushDown && target.height > session.startHeight) {
        const affected = nextData.filter(
          (c) =>
            c.id !== itemId &&
            c.startRow >= session.startRow + session.startHeight &&
            inOriginalColBand(c),
        );
        const targetBottom = target.startRow + target.height;
        const horizontalGroups = splitByHorizontalOverlap(affected);
        horizontalGroups.forEach((group) => {
          const sorted = group.slice().sort((a, b) => a.startRow - b.startRow);

          const touched: GridItem<T>[] = [];
          let cursor = targetBottom;
          let gapStart: number | null = null;

          for (const cell of sorted) {
            if (cell.startRow > cursor) {
              gapStart = cell.startRow;
              break;
            }

            touched.push(cell);
            cursor = Math.max(cursor, cell.startRow + cell.height);
          }

          if (touched.length === 0) {
            return;
          }

          const rangeEnd = gapStart ?? rows;
          redistributeVFromTop(touched, targetBottom, rangeEnd);
        });
      }

      if (pushUp && target.startRow < session.startRow) {
        const affected = nextData.filter(
          (c) =>
            c.id !== itemId &&
            c.startRow + c.height <= session.startRow &&
            inOriginalColBand(c),
        );
        const horizontalGroups = splitByHorizontalOverlap(affected);
        horizontalGroups.forEach((group) => {
          const sorted = group.slice().sort((a, b) => b.startRow - a.startRow);

          const touched: GridItem<T>[] = [];
          let cursor = target.startRow;
          let gapEnd: number | null = null;

          for (const cell of sorted) {
            const cellBottom = cell.startRow + cell.height;
            if (cellBottom < cursor) {
              gapEnd = cellBottom;
              break;
            }

            touched.push(cell);
            cursor = Math.min(cursor, cell.startRow);
          }

          if (touched.length === 0) {
            return;
          }

          const rangeStart = gapEnd ?? 0;
          redistributeVFromBottom(touched, rangeStart, target.startRow);
        });
      }

      // Clamp everything back within the grid bounds.
      for (let i = 0; i < nextData.length; i += 1) {
        nextData[i] = clampWithinGrid(
          nextData[i],
          rows,
          columns,
          minTileWidth,
          minTileHeight,
        );
      }

      return nextData;
    });
  };

  const handleResizeEnd = (_itemId: string): void => {
    lastResizeDeltaRef.current = null;
    resizeSessionRef.current = null;
    setSelectedItemId(null);
    setData((latestData) => {
      const updatedItemData: ItemData<T>[] = latestData.map((item) => ({
        initial: {
          width: item.width,
          height: item.height,
          col: item.startColumn,
          row: item.startRow,
        },
        props: item.itemProps,
      }));
      onItemChange(updatedItemData);
      return latestData;
    });
  };

  return (
    <View
      style={[styles.container, containerStyle]}
      pointerEvents="box-none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setGridSize({ width, height });
      }}
    >
      <ReshufflableGrid
        data={normalizedData as Cell[]}
        onDragEnd={handleItemsChange}
        allowCollisions={highGridOptimizationEnabled}
        columns={columns}
        rows={rows}
        style={styles.grid}
        renderItem={({ item }) => {
          const gridItem = item as GridItem<T>;
          const isSelected = selectedItemId === gridItem.id;
          const cellPixelWidth =
            gridSize.width > 0 ? gridSize.width / columns : 1;
          const cellPixelHeight =
            gridSize.height > 0 ? gridSize.height / rows : 1;
          return (
            <RenderedComponent
              {...(gridItem.itemProps as any)}
              isSelected={isSelected}
              resizePreview={{
                cellPixelWidth,
                cellPixelHeight,
                widthCells: gridItem.width,
                heightCells: gridItem.height,
              }}
              onSelect={() => setSelectedItemId(gridItem.id)}
              onLongPress={() => onItemLongPress?.(gridItem.id)}
              onResizeStart={(dir: ResizeHandleDirection) =>
                handleResizeStart(gridItem.id, dir)
              }
              onResizeUpdate={(
                dir: ResizeHandleDirection,
                dx: number,
                dy: number,
              ) => handleResizeUpdate(gridItem.id, dir, dx, dy)}
              onResizeEnd={() => handleResizeEnd(gridItem.id)}
            />
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#0f0f1a" },
  grid: { flex: 1 },
});

export default ReshufflableGridWrapper;
