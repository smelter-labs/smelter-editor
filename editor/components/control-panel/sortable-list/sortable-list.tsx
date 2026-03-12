import React, { useMemo, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  PointerSensorOptions,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  Active,
  UniqueIdentifier,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { motion, LayoutGroup } from 'framer-motion';

import './sortable-list.css';
import { SortableOverlay } from '@/components/control-panel/sortable-list/sortable-overlay';

interface BaseItem {
  id: UniqueIdentifier;
}

interface Props<T extends BaseItem> {
  items: T[];
  renderItem(item: T, index: number, orderedItems: T[]): ReactNode;
  onOrderChange(items: T[]): void;
  resetVersion?: number;
  disableDrag?: boolean;
  keyExtractor?: (item: T) => string | number;
}

const defaultKeyExtractor = <T extends BaseItem>(item: T): string | number =>
  typeof item.id === 'string' || typeof item.id === 'number'
    ? item.id
    : String(item.id);

export function SortableList<T extends BaseItem>({
  items,
  renderItem,
  onOrderChange,
  resetVersion,
  disableDrag = false,
  keyExtractor = defaultKeyExtractor,
}: Props<T>) {
  const [orderedItems, setOrderedItems] = useState<T[]>(items);
  const [active, setActive] = useState<Active | null>(null);
  const [swappedIds, setSwappedIds] = useState<Set<string | number>>(
    new Set(),
  );
  const prevKeysRef = useRef<(string | number)[]>([]);

  useEffect(() => {
    setOrderedItems((prev) => {
      if (
        prev.length === items.length &&
        prev.every((prevItem, index) => prevItem.id === items[index]?.id)
      ) {
        return prev;
      }
      return items;
    });
  }, [items]);

  useEffect(() => {
    if (resetVersion !== undefined) {
      setOrderedItems(items);
    }
  }, [resetVersion, items]);

  useEffect(() => {
    if (active) return;
    const newKeys = orderedItems.map(keyExtractor);
    const prevKeys = prevKeysRef.current;

    if (prevKeys.length > 0 && prevKeys.length === newKeys.length) {
      const moved = new Set<string | number>();
      for (let i = 0; i < newKeys.length; i++) {
        if (newKeys[i] !== prevKeys[i]) {
          moved.add(newKeys[i]);
        }
      }
      if (moved.size > 0) {
        setSwappedIds(moved);
        const timer = setTimeout(() => setSwappedIds(new Set()), 800);
        return () => clearTimeout(timer);
      }
    }
    prevKeysRef.current = newKeys;
  }, [orderedItems, active, keyExtractor]);

  const activeItem = useMemo(
    () => orderedItems.find((item) => item.id === active?.id),
    [active, orderedItems],
  );

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: disableDrag ? 999999 : 8,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);
  const IGNORE_TAGS = ['BUTTON'];

  const customHandleEvent = (element: HTMLElement | null) => {
    let cur = element;

    while (cur) {
      if (IGNORE_TAGS.includes(cur.tagName) || cur.dataset.noDnd) {
        return false;
      }
      cur = cur.parentElement;
    }

    return true;
  };
  PointerSensor.activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent: event }: React.PointerEvent<Element>,
        { onActivation }: PointerSensorOptions,
      ) => customHandleEvent(event.target as HTMLElement),
    },
  ];

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActive(active);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    onOrderChange(orderedItems);
    setActive(null);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (over && active.id !== over?.id) {
      const activeIndex = orderedItems.findIndex(({ id }) => id === active.id);
      const overIndex = orderedItems.findIndex(({ id }) => id === over.id);

      if (activeIndex !== -1 && overIndex !== -1) {
        const newItems = arrayMove(orderedItems, activeIndex, overIndex);
        setOrderedItems(newItems);
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActive(null);
      }}>
      <SortableContext items={orderedItems}>
        <LayoutGroup>
          <ul
            className='SortableList'
            role='application'
            style={{
              overflowY: 'hidden',
              overflowX: 'hidden',
              maxHeight: 'none',
            }}>
            {orderedItems.map((item, index) => {
              const key = keyExtractor(item);
              const isActive = active?.id === item.id;
              const isSwapped = swappedIds.has(key);
              return (
                <motion.li
                  key={key}
                  layout={active === null}
                  layoutId={String(key)}
                  transition={{ layout: { duration: 0.4, ease: 'easeInOut' } }}
                  className={isSwapped ? 'reorder-highlight' : undefined}
                  style={isActive ? { opacity: 0.5 } : undefined}>
                  {renderItem(item, index, orderedItems)}
                </motion.li>
              );
            })}
          </ul>
        </LayoutGroup>
      </SortableContext>
      <SortableOverlay>
        {activeItem
          ? renderItem(
              activeItem,
              orderedItems.findIndex((it) => it.id === activeItem.id),
              orderedItems,
            )
          : null}
      </SortableOverlay>
    </DndContext>
  );
}
