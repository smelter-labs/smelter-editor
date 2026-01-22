import React, { useMemo, useState, useEffect } from 'react';
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

import './sortable-list.css';
import { SortableOverlay } from '@/components/control-panel/sortable-list/sortable-overlay';
import { useDriverTourControls } from '@/components/tour/DriverTourContext';

interface BaseItem {
  id: UniqueIdentifier;
}

interface Props<T extends BaseItem> {
  items: T[];
  renderItem(item: T, index: number, orderedItems: T[]): ReactNode;
  onOrderChange(items: T[]): void;
  resetVersion?: number;
  disableDrag?: boolean;
}

export function SortableList<T extends BaseItem>({
  items,
  renderItem,
  onOrderChange,
  resetVersion,
  disableDrag = false,
}: Props<T>) {
  const [orderedItems, setOrderedItems] = useState<T[]>(items);
  const [active, setActive] = useState<Active | null>(null);
  const { nextIf } = useDriverTourControls('composing');
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
        //@ts-expect-error todo for laters
        { nativeEvent: event }: PointerEvent<Element>,
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
    nextIf(0);
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
        <ul
          data-tour='inputs-list-container'
          className='SortableList'
          role='application'
          style={{
            overflowY: 'hidden',
            overflowX: 'hidden',
            maxHeight: 'none',
          }}>
          {orderedItems.map((item, index) => {
            const isActive = active?.id === item.id;
            return (
              <li key={item.id} style={isActive ? { opacity: 0.5 } : undefined}>
                {renderItem(item, index, orderedItems)}
              </li>
            );
          })}
        </ul>
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
