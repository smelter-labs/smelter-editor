'use client';

import { useState, useEffect, useCallback } from 'react';

import type { InputOrientation } from './commandTypes';

export const AUTO_PLAY_MACRO_STORAGE_KEY = 'smelter:voice:auto-play-macro';
export const AUTO_PLAY_MACRO_CHANGED_EVENT =
  'smelter:voice:auto-play-macro-changed';

export const FEEDBACK_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'center-left',
  'center',
  'center-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export type FeedbackPosition = (typeof FEEDBACK_POSITIONS)[number];

export const FEEDBACK_SIZES = ['s', 'm', 'l'] as const;
export type FeedbackSize = (typeof FEEDBACK_SIZES)[number];

const FEEDBACK_POSITION_STORAGE_KEY = 'smelter:voice:feedback-position';
const FEEDBACK_POSITION_CHANGED_EVENT =
  'smelter:voice:feedback-position-changed';
const DEFAULT_FEEDBACK_POSITION: FeedbackPosition = 'top-center';

const FEEDBACK_ENABLED_STORAGE_KEY = 'smelter:voice:feedback-enabled';
const FEEDBACK_ENABLED_CHANGED_EVENT = 'smelter:voice:feedback-enabled-changed';

const FEEDBACK_SIZE_STORAGE_KEY = 'smelter:voice:feedback-size';
const FEEDBACK_SIZE_CHANGED_EVENT = 'smelter:voice:feedback-size-changed';
const DEFAULT_FEEDBACK_SIZE: FeedbackSize = 's';

const FEEDBACK_DURATION_STORAGE_KEY = 'smelter:voice:feedback-duration';
const FEEDBACK_DURATION_CHANGED_EVENT =
  'smelter:voice:feedback-duration-changed';
const DEFAULT_FEEDBACK_DURATION = 2;

type AutoPlayMacroChangedDetail = {
  value: boolean;
};

export function getAutoPlayMacroSetting(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem(AUTO_PLAY_MACRO_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  return stored !== 'false';
}

export function setAutoPlayMacroSetting(value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(AUTO_PLAY_MACRO_STORAGE_KEY, String(value));
  window.dispatchEvent(
    new CustomEvent<AutoPlayMacroChangedDetail>(AUTO_PLAY_MACRO_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function subscribeToAutoPlayMacroSetting(
  listener: (value: boolean) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onChanged = (event: Event) => {
    const customEvent = event as CustomEvent<AutoPlayMacroChangedDetail>;
    listener(customEvent.detail?.value ?? true);
  };

  window.addEventListener(AUTO_PLAY_MACRO_CHANGED_EVENT, onChanged);
  return () => {
    window.removeEventListener(AUTO_PLAY_MACRO_CHANGED_EVENT, onChanged);
  };
}

export function useAutoPlayMacroSetting(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => getAutoPlayMacroSetting());

  useEffect(() => {
    setValue(getAutoPlayMacroSetting());
    return subscribeToAutoPlayMacroSetting(setValue);
  }, []);

  const setAutoPlay = useCallback((next: boolean) => {
    setAutoPlayMacroSetting(next);
    setValue(next);
  }, []);

  return [value, setAutoPlay];
}

export function getFeedbackPositionSetting(): FeedbackPosition {
  if (typeof window === 'undefined') {
    return DEFAULT_FEEDBACK_POSITION;
  }

  const stored = window.localStorage.getItem(FEEDBACK_POSITION_STORAGE_KEY);
  if (stored && FEEDBACK_POSITIONS.includes(stored as FeedbackPosition)) {
    return stored as FeedbackPosition;
  }
  return DEFAULT_FEEDBACK_POSITION;
}

export function setFeedbackPositionSetting(value: FeedbackPosition): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(FEEDBACK_POSITION_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: FeedbackPosition }>(
      FEEDBACK_POSITION_CHANGED_EVENT,
      { detail: { value } },
    ),
  );
}

export function useFeedbackPositionSetting(): [
  FeedbackPosition,
  (value: FeedbackPosition) => void,
] {
  const [value, setValue] = useState<FeedbackPosition>(() =>
    getFeedbackPositionSetting(),
  );

  useEffect(() => {
    setValue(getFeedbackPositionSetting());

    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: FeedbackPosition }>;
      setValue(customEvent.detail?.value ?? DEFAULT_FEEDBACK_POSITION);
    };

    window.addEventListener(FEEDBACK_POSITION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(FEEDBACK_POSITION_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setPosition = useCallback((next: FeedbackPosition) => {
    setFeedbackPositionSetting(next);
    setValue(next);
  }, []);

  return [value, setPosition];
}

export function getFeedbackEnabledSetting(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage.getItem(FEEDBACK_ENABLED_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  return stored !== 'false';
}

export function setFeedbackEnabledSetting(value: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(FEEDBACK_ENABLED_STORAGE_KEY, String(value));
  window.dispatchEvent(
    new CustomEvent<{ value: boolean }>(FEEDBACK_ENABLED_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useFeedbackEnabledSetting(): [
  boolean,
  (value: boolean) => void,
] {
  const [value, setValue] = useState<boolean>(() =>
    getFeedbackEnabledSetting(),
  );

  useEffect(() => {
    setValue(getFeedbackEnabledSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: boolean }>;
      setValue(customEvent.detail?.value ?? true);
    };
    window.addEventListener(FEEDBACK_ENABLED_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(FEEDBACK_ENABLED_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setFeedbackEnabledSetting(next);
    setValue(next);
  }, []);

  return [value, setEnabled];
}

export function getFeedbackSizeSetting(): FeedbackSize {
  if (typeof window === 'undefined') {
    return DEFAULT_FEEDBACK_SIZE;
  }
  const stored = window.localStorage.getItem(FEEDBACK_SIZE_STORAGE_KEY);
  if (stored && FEEDBACK_SIZES.includes(stored as FeedbackSize)) {
    return stored as FeedbackSize;
  }
  return DEFAULT_FEEDBACK_SIZE;
}

export function setFeedbackSizeSetting(value: FeedbackSize): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(FEEDBACK_SIZE_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: FeedbackSize }>(FEEDBACK_SIZE_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useFeedbackSizeSetting(): [
  FeedbackSize,
  (value: FeedbackSize) => void,
] {
  const [value, setValue] = useState<FeedbackSize>(() =>
    getFeedbackSizeSetting(),
  );

  useEffect(() => {
    setValue(getFeedbackSizeSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: FeedbackSize }>;
      setValue(customEvent.detail?.value ?? DEFAULT_FEEDBACK_SIZE);
    };
    window.addEventListener(FEEDBACK_SIZE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(FEEDBACK_SIZE_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setSize = useCallback((next: FeedbackSize) => {
    setFeedbackSizeSetting(next);
    setValue(next);
  }, []);

  return [value, setSize];
}

export function getFeedbackDurationSetting(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_FEEDBACK_DURATION;
  }
  const stored = window.localStorage.getItem(FEEDBACK_DURATION_STORAGE_KEY);
  if (stored !== null) {
    const parsed = Number(stored);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 15) {
      return parsed;
    }
  }
  return DEFAULT_FEEDBACK_DURATION;
}

export function setFeedbackDurationSetting(value: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const clamped = Math.max(1, Math.min(15, value));
  window.localStorage.setItem(FEEDBACK_DURATION_STORAGE_KEY, String(clamped));
  window.dispatchEvent(
    new CustomEvent<{ value: number }>(FEEDBACK_DURATION_CHANGED_EVENT, {
      detail: { value: clamped },
    }),
  );
}

export function useFeedbackDurationSetting(): [
  number,
  (value: number) => void,
] {
  const [value, setValue] = useState<number>(() =>
    getFeedbackDurationSetting(),
  );

  useEffect(() => {
    setValue(getFeedbackDurationSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: number }>;
      setValue(customEvent.detail?.value ?? DEFAULT_FEEDBACK_DURATION);
    };
    window.addEventListener(FEEDBACK_DURATION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(FEEDBACK_DURATION_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setDuration = useCallback((next: number) => {
    setFeedbackDurationSetting(next);
    setValue(next);
  }, []);

  return [value, setDuration];
}

const DEFAULT_ORIENTATION_STORAGE_KEY = 'smelter:voice:default-orientation';
const DEFAULT_ORIENTATION_CHANGED_EVENT =
  'smelter:voice:default-orientation-changed';
const DEFAULT_ORIENTATION: InputOrientation = 'horizontal';

export function getDefaultOrientationSetting(): InputOrientation {
  if (typeof window === 'undefined') {
    return DEFAULT_ORIENTATION;
  }
  const stored = window.localStorage.getItem(DEFAULT_ORIENTATION_STORAGE_KEY);
  if (stored === 'horizontal' || stored === 'vertical') {
    return stored;
  }
  return DEFAULT_ORIENTATION;
}

export function setDefaultOrientationSetting(value: InputOrientation): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(DEFAULT_ORIENTATION_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: InputOrientation }>(
      DEFAULT_ORIENTATION_CHANGED_EVENT,
      { detail: { value } },
    ),
  );
}

export function useDefaultOrientationSetting(): [
  InputOrientation,
  (value: InputOrientation) => void,
] {
  const [value, setValue] = useState<InputOrientation>(() =>
    getDefaultOrientationSetting(),
  );

  useEffect(() => {
    setValue(getDefaultOrientationSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: InputOrientation }>;
      setValue(customEvent.detail?.value ?? DEFAULT_ORIENTATION);
    };
    window.addEventListener(DEFAULT_ORIENTATION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(DEFAULT_ORIENTATION_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setOrientation = useCallback((next: InputOrientation) => {
    setDefaultOrientationSetting(next);
    setValue(next);
  }, []);

  return [value, setOrientation];
}

export const VOICE_PANEL_SIZES = ['s', 'l'] as const;
export type VoicePanelSize = (typeof VOICE_PANEL_SIZES)[number];

const VOICE_PANEL_SIZE_STORAGE_KEY = 'smelter:voice:panel-size';
const VOICE_PANEL_SIZE_CHANGED_EVENT = 'smelter:voice:panel-size-changed';
const DEFAULT_VOICE_PANEL_SIZE: VoicePanelSize = 'l';

export function getVoicePanelSizeSetting(): VoicePanelSize {
  if (typeof window === 'undefined') {
    return DEFAULT_VOICE_PANEL_SIZE;
  }
  const stored = window.localStorage.getItem(VOICE_PANEL_SIZE_STORAGE_KEY);
  if (stored && VOICE_PANEL_SIZES.includes(stored as VoicePanelSize)) {
    return stored as VoicePanelSize;
  }
  return DEFAULT_VOICE_PANEL_SIZE;
}

export function setVoicePanelSizeSetting(value: VoicePanelSize): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(VOICE_PANEL_SIZE_STORAGE_KEY, value);
  window.dispatchEvent(
    new CustomEvent<{ value: VoicePanelSize }>(VOICE_PANEL_SIZE_CHANGED_EVENT, {
      detail: { value },
    }),
  );
}

export function useVoicePanelSizeSetting(): [
  VoicePanelSize,
  (value: VoicePanelSize) => void,
] {
  const [value, setValue] = useState<VoicePanelSize>(() =>
    getVoicePanelSizeSetting(),
  );

  useEffect(() => {
    setValue(getVoicePanelSizeSetting());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: VoicePanelSize }>;
      setValue(customEvent.detail?.value ?? DEFAULT_VOICE_PANEL_SIZE);
    };
    window.addEventListener(VOICE_PANEL_SIZE_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(VOICE_PANEL_SIZE_CHANGED_EVENT, onChanged);
    };
  }, []);

  const setSize = useCallback((next: VoicePanelSize) => {
    setVoicePanelSizeSetting(next);
    setValue(next);
  }, []);

  return [value, setSize];
}
