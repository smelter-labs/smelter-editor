import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { PointerSensorOptions } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { PointerEvent as ReactPointerEvent } from 'react';

const IGNORE_TAGS = ['BUTTON'];

function shouldActivateDrag(element: HTMLElement | null): boolean {
  let cur = element;

  while (cur) {
    if (IGNORE_TAGS.includes(cur.tagName) || cur.dataset.noDnd) {
      return false;
    }
    cur = cur.parentElement;
  }

  return true;
}

PointerSensor.activators = [
  {
    eventName: 'onPointerDown' as const,
    handler: (
      { nativeEvent: event }: ReactPointerEvent<Element>,
      _options: PointerSensorOptions,
    ) => shouldActivateDrag(event.target as HTMLElement),
  },
];

export function useSortableSensors({ disabled }: { disabled?: boolean }) {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: disabled ? 999999 : 8,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  return useSensors(pointerSensor, keyboardSensor);
}
