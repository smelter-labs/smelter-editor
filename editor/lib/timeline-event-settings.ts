'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FEEDBACK_POSITIONS,
  type FeedbackPosition,
  FEEDBACK_SIZES,
  type FeedbackSize,
} from '@/lib/voice/macroSettings';

const ENABLED_STORAGE_KEY = 'smelter:timeline-events:enabled';
const ENABLED_CHANGED_EVENT = 'smelter:timeline-events:enabled-changed';

const POSITION_STORAGE_KEY = 'smelter:timeline-events:position';
const POSITION_CHANGED_EVENT = 'smelter:timeline-events:position-changed';
const DEFAULT_POSITION: FeedbackPosition = 'bottom-right';

const SIZE_STORAGE_KEY = 'smelter:timeline-events:size';
const SIZE_CHANGED_EVENT = 'smelter:timeline-events:size-changed';
const DEFAULT_SIZE: FeedbackSize = 's';

const DURATION_STORAGE_KEY = 'smelter:timeline-events:duration';
const DURATION_CHANGED_EVENT = 'smelter:timeline-events:duration-changed';
const DEFAULT_DURATION = 2;

export function getTimelineEventsEnabledSetting(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const stored = window.localStorage.getItem(ENABLED_STORAGE_KEY);
  if (stored === null) {
    return false;
  }
  return stored === 'true';
}

export function setTimelineEventsEnabledSetting(value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ENABLED_STORAGE_KEY, String(value));
  window.dispatchEvent(
    new CustomEvent<{ value: boolean }>(ENABLED_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useTimelineEventsEnabledSetting(): [
  boolean,
  (value: boolean) => void,
] {
  const [value, setValue] = useState<boolean>(() =>
    getTimelineEventsEnabledSetting(),
  );

  useEffect(() => {
    setValue(getTimelineEventsEnabledSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: boolean }>;
      setValue(customEvent.detail?.value ?? false);
    };
    window.addEventListener(ENABLED_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(ENABLED_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setTimelineEventsEnabledSetting(next);
    setValue(next);
  }, []);

  return [value, setEnabled];
}

export function getTimelineEventsPositionSetting(): FeedbackPosition {
  if (typeof window === 'undefined') {
    return DEFAULT_POSITION;
  }
  const stored = window.localStorage.getItem(POSITION_STORAGE_KEY);
  if (stored && FEEDBACK_POSITIONS.includes(stored as FeedbackPosition)) {
    return stored as FeedbackPosition;
  }
  return DEFAULT_POSITION;
}

export function setTimelineEventsPositionSetting(
  value: FeedbackPosition,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(POSITION_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: FeedbackPosition }>(POSITION_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useTimelineEventsPositionSetting(): [
  FeedbackPosition,
  (value: FeedbackPosition) => void,
] {
  const [value, setValue] = useState<FeedbackPosition>(() =>
    getTimelineEventsPositionSetting(),
  );

  useEffect(() => {
    setValue(getTimelineEventsPositionSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: FeedbackPosition }>;
      setValue(customEvent.detail?.value ?? DEFAULT_POSITION);
    };
    window.addEventListener(POSITION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(POSITION_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setPosition = useCallback((next: FeedbackPosition) => {
    setTimelineEventsPositionSetting(next);
    setValue(next);
  }, []);

  return [value, setPosition];
}

export function getTimelineEventsSizeSetting(): FeedbackSize {
  if (typeof window === 'undefined') {
    return DEFAULT_SIZE;
  }
  const stored = window.localStorage.getItem(SIZE_STORAGE_KEY);
  if (stored && FEEDBACK_SIZES.includes(stored as FeedbackSize)) {
    return stored as FeedbackSize;
  }
  return DEFAULT_SIZE;
}

export function setTimelineEventsSizeSetting(value: FeedbackSize): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(SIZE_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: FeedbackSize }>(SIZE_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useTimelineEventsSizeSetting(): [
  FeedbackSize,
  (value: FeedbackSize) => void,
] {
  const [value, setValue] = useState<FeedbackSize>(() =>
    getTimelineEventsSizeSetting(),
  );

  useEffect(() => {
    setValue(getTimelineEventsSizeSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: FeedbackSize }>;
      setValue(customEvent.detail?.value ?? DEFAULT_SIZE);
    };
    window.addEventListener(SIZE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(SIZE_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setSize = useCallback((next: FeedbackSize) => {
    setTimelineEventsSizeSetting(next);
    setValue(next);
  }, []);

  return [value, setSize];
}

export function getTimelineEventsDurationSetting(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_DURATION;
  }
  const stored = window.localStorage.getItem(DURATION_STORAGE_KEY);
  if (stored !== null) {
    const parsed = Number(stored);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 15) {
      return parsed;
    }
  }
  return DEFAULT_DURATION;
}

export function setTimelineEventsDurationSetting(value: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const clamped = Math.max(1, Math.min(15, value));
  window.localStorage.setItem(DURATION_STORAGE_KEY, String(clamped));
  window.dispatchEvent(
    new CustomEvent<{ value: number }>(DURATION_CHANGED_EVENT, {
      detail: { value: clamped },
    }),
  );
}

export function useTimelineEventsDurationSetting(): [
  number,
  (value: number) => void,
] {
  const [value, setValue] = useState<number>(() =>
    getTimelineEventsDurationSetting(),
  );

  useEffect(() => {
    setValue(getTimelineEventsDurationSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: number }>;
      setValue(customEvent.detail?.value ?? DEFAULT_DURATION);
    };
    window.addEventListener(DURATION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(DURATION_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setDuration = useCallback((next: number) => {
    setTimelineEventsDurationSetting(next);
    setValue(next);
  }, []);

  return [value, setDuration];
}
