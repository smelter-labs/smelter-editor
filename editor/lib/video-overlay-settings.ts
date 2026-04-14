'use client';

import { useState, useEffect, useCallback } from 'react';

const ENABLED_KEY = 'smelter:video-overlay:enabled';
const ENABLED_EVENT = 'smelter:video-overlay:enabled-changed';

const LINE_WIDTH_KEY = 'smelter:video-overlay:line-width';
const LINE_WIDTH_EVENT = 'smelter:video-overlay:line-width-changed';
const DEFAULT_LINE_WIDTH = 2;

const GLOWING_KEY = 'smelter:video-overlay:glowing';
const GLOWING_EVENT = 'smelter:video-overlay:glowing-changed';

// ── Enabled ──────────────────────────────────────────────────────────────────

export function getVideoOverlayEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ENABLED_KEY) === 'true';
}

function setVideoOverlayEnabled(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ENABLED_KEY, String(value));
  window.dispatchEvent(
    new CustomEvent<{ value: boolean }>(ENABLED_EVENT, {
      detail: { value },
    }),
  );
}

export function useVideoOverlayEnabledSetting(): [
  boolean,
  (value: boolean) => void,
] {
  const [value, setValue] = useState<boolean>(() => getVideoOverlayEnabled());

  useEffect(() => {
    setValue(getVideoOverlayEnabled());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: boolean }>;
      setValue(customEvent.detail?.value ?? false);
    };
    window.addEventListener(ENABLED_EVENT, onChanged);
    return () => window.removeEventListener(ENABLED_EVENT, onChanged);
  }, []);

  const set = useCallback((next: boolean) => {
    setVideoOverlayEnabled(next);
    setValue(next);
  }, []);

  return [value, set];
}

// ── Line width ───────────────────────────────────────────────────────────────

function getVideoOverlayLineWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_LINE_WIDTH;
  const stored = window.localStorage.getItem(LINE_WIDTH_KEY);
  if (stored !== null) {
    const parsed = Number(stored);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 20) return parsed;
  }
  return DEFAULT_LINE_WIDTH;
}

function setVideoOverlayLineWidth(value: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(1, Math.min(20, Math.round(value)));
  window.localStorage.setItem(LINE_WIDTH_KEY, String(clamped));
  window.dispatchEvent(
    new CustomEvent<{ value: number }>(LINE_WIDTH_EVENT, {
      detail: { value: clamped },
    }),
  );
}

export function useVideoOverlayLineWidthSetting(): [
  number,
  (value: number) => void,
] {
  const [value, setValue] = useState<number>(() => getVideoOverlayLineWidth());

  useEffect(() => {
    setValue(getVideoOverlayLineWidth());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: number }>;
      setValue(customEvent.detail?.value ?? DEFAULT_LINE_WIDTH);
    };
    window.addEventListener(LINE_WIDTH_EVENT, onChanged);
    return () => window.removeEventListener(LINE_WIDTH_EVENT, onChanged);
  }, []);

  const set = useCallback((next: number) => {
    setVideoOverlayLineWidth(next);
    setValue(Math.max(1, Math.min(20, Math.round(next))));
  }, []);

  return [value, set];
}

// ── Glowing ──────────────────────────────────────────────────────────────────

function getVideoOverlayGlowing(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(GLOWING_KEY) === 'true';
}

function setVideoOverlayGlowing(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GLOWING_KEY, String(value));
  window.dispatchEvent(
    new CustomEvent<{ value: boolean }>(GLOWING_EVENT, {
      detail: { value },
    }),
  );
}

export function useVideoOverlayGlowingSetting(): [
  boolean,
  (value: boolean) => void,
] {
  const [value, setValue] = useState<boolean>(() => getVideoOverlayGlowing());

  useEffect(() => {
    setValue(getVideoOverlayGlowing());
    const onChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ value: boolean }>;
      setValue(customEvent.detail?.value ?? false);
    };
    window.addEventListener(GLOWING_EVENT, onChanged);
    return () => window.removeEventListener(GLOWING_EVENT, onChanged);
  }, []);

  const set = useCallback((next: boolean) => {
    setVideoOverlayGlowing(next);
    setValue(next);
  }, []);

  return [value, set];
}
