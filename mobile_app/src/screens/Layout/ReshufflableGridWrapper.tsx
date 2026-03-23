import React, { useState, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { ReshufflableGrid, type Cell } from "react-native-reshuffled";

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

const clampWithinGrid = <T,>(
  item: GridItem<T>,
  rows: number,
  columns: number,
): GridItem<T> => {
  const width = Math.max(1, Math.min(item.width, columns));
  const height = Math.max(1, Math.min(item.height, rows));

  return {
    ...item,
    width,
    height,
    startColumn: Math.max(0, Math.min(item.startColumn, columns - width)),
    startRow: Math.max(0, Math.min(item.startRow, rows - height)),
  };
};

interface ReshufflableGridWrapperProps<T> {
  itemData: ItemData<T>[];
  renderedComponent: React.ComponentType<T>;
  onItemChange: (items: ItemData<T>[]) => void;
  rows?: number;
  columns?: number;
  containerStyle?: object;
}

const ReshufflableGridWrapper = <T extends { id: string }>({
  itemData,
  renderedComponent: RenderedComponent,
  onItemChange,
  rows: initialRows = 20,
  columns: initialColumns = 20,
  containerStyle,
}: ReshufflableGridWrapperProps<T>) => {
  const [columns, setColumns] = useState(initialColumns);
  const [rows, setRows] = useState(initialRows);
  const isUpdatingFromGrid = useRef(false);

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

  // Sync prop changes from itemData to internal data state, but only if not from grid.
  // Handles structural changes (add / remove / reorder) by matching on semantic id.
  useEffect(() => {
    if (isUpdatingFromGrid.current) {
      isUpdatingFromGrid.current = false;
      return;
    }

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
      if (
        next.length === prev.length &&
        next.every(
          (item, i) =>
            item.id === prev[i].id &&
            item.startColumn === prev[i].startColumn &&
            item.startRow === prev[i].startRow &&
            item.width === prev[i].width &&
            item.height === prev[i].height &&
            item.itemProps === prev[i].itemProps,
        )
      ) {
        return prev;
      }

      return next;
    });
  }, [itemData]);

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

      nextData[targetIndex] = clampWithinGrid(target, rows, columns);

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

          nextData[index] = clampWithinGrid(current, rows, columns);

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
        width: Math.max(1, width),
        height: Math.max(1, height),
        startColumn: Math.max(0, startColumn),
        startRow: Math.max(0, startRow),
        color: item.color || "#6200EE",
      };
    });
  }, [data, columns, rows]);

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

    setData(mergedData);

    const updatedItemData: ItemData<T>[] = mergedData.map((item) => ({
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

  return (
    <View style={[styles.container, containerStyle]} pointerEvents="box-none">
      <ReshufflableGrid
        data={normalizedData as Cell[]}
        onItemsChange={handleItemsChange}
        columns={columns}
        rows={rows}
        style={styles.grid}
        renderItem={({ item }) => {
          const gridItem = item as GridItem<T>;
          return <RenderedComponent {...(gridItem.itemProps as any)} />;
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  grid: { flex: 1 },
});

export default ReshufflableGridWrapper;
