'use client';

import { useState, useEffect, useRef } from 'react';

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

type SlotMachineOptions = {
  delay?: number;
  baseSpeed?: number;
  slowdownFactor?: number;
  maxIterations?: number;
};

export function useSlotMachineText(
  fromText: string,
  toText: string,
  shouldAnimate: boolean,
  options: SlotMachineOptions = {},
) {
  const {
    delay = 1500,
    baseSpeed = 30,
    slowdownFactor = 1.15,
    maxIterations = 15,
  } = options;

  const [displayText, setDisplayText] = useState(fromText);
  const [isAnimating, setIsAnimating] = useState(false);
  const animationRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (!shouldAnimate || fromText === toText) {
      setDisplayText(toText);
      return;
    }

    animationRef.current.cancelled = true;
    const currentAnimation = { cancelled: false };
    animationRef.current = currentAnimation;

    setDisplayText(fromText);
    setIsAnimating(false);

    const delayTimeout = setTimeout(() => {
      if (currentAnimation.cancelled) return;
      setIsAnimating(true);

      const maxLen = Math.max(fromText.length, toText.length);
      const charStates: {
        current: string;
        target: string;
        iterations: number;
        settled: boolean;
      }[] = [];

      for (let i = 0; i < maxLen; i++) {
        charStates.push({
          current: fromText[i] ?? '',
          target: toText[i] ?? '',
          iterations: 0,
          settled: false,
        });
      }

      const animate = async () => {
        let allSettled = false;
        let currentSpeed = baseSpeed;

        while (!allSettled && !currentAnimation.cancelled) {
          allSettled = true;

          for (let i = 0; i < charStates.length; i++) {
            const state = charStates[i];
            if (state.settled) continue;

            allSettled = false;
            state.iterations++;

            const shouldSettle =
              state.iterations >= maxIterations ||
              (state.iterations > 5 &&
                Math.random() < state.iterations / maxIterations);

            if (shouldSettle) {
              state.current = state.target;
              state.settled = true;
            } else {
              if (state.target === ' ') {
                state.current =
                  Math.random() > 0.5
                    ? ' '
                    : CHARS[Math.floor(Math.random() * CHARS.length)];
              } else if (state.target === '') {
                state.current =
                  state.iterations > maxIterations / 2
                    ? ''
                    : CHARS[Math.floor(Math.random() * CHARS.length)];
              } else {
                state.current = CHARS[Math.floor(Math.random() * CHARS.length)];
              }
            }
          }

          setDisplayText(charStates.map((s) => s.current).join(''));

          currentSpeed *= slowdownFactor;
          await new Promise((r) => setTimeout(r, currentSpeed));
        }

        if (!currentAnimation.cancelled) {
          setDisplayText(toText);
          setIsAnimating(false);
        }
      };

      animate();
    }, delay);

    return () => {
      currentAnimation.cancelled = true;
      clearTimeout(delayTimeout);
    };
  }, [
    fromText,
    toText,
    shouldAnimate,
    delay,
    baseSpeed,
    slowdownFactor,
    maxIterations,
  ]);

  return { displayText, isAnimating };
}
