'use client';

import { useEffect, useRef } from 'react';

export type KeyboardInputRef = {
  current: { upHeld: boolean; downHeld: boolean };
};

export type KeyBindings = {
  up: string;
  down: string;
};

// Listens to window keydown/keyup. Returns a ref the game loop reads each frame.
// We use refs (not state) so we don't trigger React re-renders on every press.
export function useKeyboardInput(bindings: KeyBindings, enabled: boolean): KeyboardInputRef {
  const ref = useRef<{ upHeld: boolean; downHeld: boolean }>({
    upHeld: false,
    downHeld: false,
  });

  useEffect(() => {
    if (!enabled) {
      ref.current.upHeld = false;
      ref.current.downHeld = false;
      return;
    }

    const onDown = (e: KeyboardEvent) => {
      if (e.key === bindings.up) {
        ref.current.upHeld = true;
        e.preventDefault();
      } else if (e.key === bindings.down) {
        ref.current.downHeld = true;
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === bindings.up) ref.current.upHeld = false;
      else if (e.key === bindings.down) ref.current.downHeld = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      ref.current.upHeld = false;
      ref.current.downHeld = false;
    };
  }, [bindings.up, bindings.down, enabled]);

  return ref;
}
