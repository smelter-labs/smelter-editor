'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import {
  PENDING_TIMEOUT_MS,
  commandEchoed,
  pendingKeyOf,
} from '@/lib/ob-van/pending';

type Entry = {
  cmd: ObOperatorCommand;
  before: ObState | null;
  timer: number;
};

export type ObPending = {
  /** Send unless the same press is still in flight; true when sent. */
  send: (cmd: ObOperatorCommand) => boolean;
  isPending: (cmd: ObOperatorCommand) => boolean;
  /** Any press of this op in flight (`take`, `auto`…). */
  anyPending: (op: ObOperatorCommand['op']) => boolean;
  /** Drop every mark (the server refused something). */
  clear: () => void;
};

/**
 * Pending-until-echo for desk commands (see lib/ob-van/pending.ts): the
 * press shows a pending bar, repeats are ignored, and the mark clears when
 * `ob_state` echoes the change or after PENDING_TIMEOUT_MS.
 */
export function useObPending(
  state: ObState | null,
  transport: (cmd: ObOperatorCommand) => void,
): ObPending {
  const [keys, setKeys] = useState<Record<string, ObOperatorCommand['op']>>({});
  const entriesRef = useRef(new Map<string, Entry>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const transportRef = useRef(transport);
  transportRef.current = transport;

  const drop = useCallback((key: string) => {
    const entry = entriesRef.current.get(key);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    entriesRef.current.delete(key);
    setKeys((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const send = useCallback(
    (cmd: ObOperatorCommand) => {
      const key = pendingKeyOf(cmd);
      if (entriesRef.current.has(key)) return false;
      const timer = window.setTimeout(() => drop(key), PENDING_TIMEOUT_MS);
      entriesRef.current.set(key, { cmd, before: stateRef.current, timer });
      setKeys((prev) => ({ ...prev, [key]: cmd.op }));
      transportRef.current(cmd);
      return true;
    },
    [drop],
  );

  useEffect(() => {
    if (!state) return;
    for (const [key, entry] of entriesRef.current) {
      if (entry.before === state) continue;
      if (commandEchoed(entry.cmd, entry.before, state)) drop(key);
    }
  }, [state, drop]);

  useEffect(() => {
    const entries = entriesRef.current;
    return () => {
      for (const e of entries.values()) window.clearTimeout(e.timer);
      entries.clear();
    };
  }, []);

  const isPending = useCallback(
    (cmd: ObOperatorCommand) => pendingKeyOf(cmd) in keys,
    [keys],
  );
  const anyPending = useCallback(
    (op: ObOperatorCommand['op']) => Object.values(keys).includes(op),
    [keys],
  );
  const clear = useCallback(() => {
    for (const key of [...entriesRef.current.keys()]) drop(key);
  }, [drop]);

  return { send, isPending, anyPending, clear };
}
