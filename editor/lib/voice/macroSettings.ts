'use client';

import { useState, useEffect, useCallback } from 'react';

export const AUTO_PLAY_MACRO_STORAGE_KEY = 'smelter:voice:auto-play-macro';
export const AUTO_PLAY_MACRO_CHANGED_EVENT =
  'smelter:voice:auto-play-macro-changed';

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
