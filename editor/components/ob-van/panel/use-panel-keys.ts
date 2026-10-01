'use client';

import { useEffect, useRef } from 'react';
import type { ObOperatorCommand } from '@smelter-editor/types';
import { shouldIgnoreGlobalShortcut } from '@/lib/keyboard';
import { panelKeyToCommand, type PanelKeyContext } from './panel-keys';

export { panelKeyToCommand, type PanelKeyContext } from './panel-keys';

/**
 * Bind the desk key map to the window. `ctx` and `send` are read through
 * refs, so callers pass fresh values every render without re-binding; typing
 * in a field and chorded keys (Ctrl / ⌘ / Alt) never fire commands.
 */
export function usePanelKeys(
  ctx: PanelKeyContext | null,
  send: (cmd: ObOperatorCommand) => void,
  enabled = true,
): void {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (shouldIgnoreGlobalShortcut(e.target)) return;
      const current = ctxRef.current;
      if (!current) return;
      const cmd = panelKeyToCommand(e.key, current);
      if (!cmd) return;
      // On the desk Enter is TAKE and Space is CUT even while a button has
      // focus (after a click): preventDefault stops the focused button from
      // re-firing its own click on the same key.
      e.preventDefault();
      sendRef.current(cmd);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
