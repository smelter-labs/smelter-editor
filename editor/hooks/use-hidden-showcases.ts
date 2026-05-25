'use client';

import { useCallback, useEffect, useState } from 'react';

const SHOWCASE_HIDDEN_PREFIX = 'showcase:';

function extractFileNames(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((v): v is string => typeof v === 'string')
    .filter((v) => v.startsWith(SHOWCASE_HIDDEN_PREFIX))
    .map((v) => v.slice(SHOWCASE_HIDDEN_PREFIX.length));
}

export function useHiddenShowcases() {
  const [hiddenFileNames, setHiddenFileNames] = useState<Set<string>>(
    () => new Set(),
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/hidden-assets');
      if (!res.ok) return;
      const data = (await res.json()) as { hiddenAssets?: string[] };
      setHiddenFileNames(new Set(extractFileNames(data.hiddenAssets)));
    } catch {
      // ignore — leave list as-is so UI keeps working offline
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setHidden = useCallback(
    async (fileName: string, hidden: boolean): Promise<boolean> => {
      const key = `${SHOWCASE_HIDDEN_PREFIX}${fileName}`;
      const endpoint = hidden
        ? '/api/hidden-assets/hide'
        : '/api/hidden-assets/unhide';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filePath: key }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { hiddenAssets?: string[] };
        if (Array.isArray(data.hiddenAssets)) {
          setHiddenFileNames(new Set(extractFileNames(data.hiddenAssets)));
        } else {
          setHiddenFileNames((prev) => {
            const next = new Set(prev);
            if (hidden) next.add(fileName);
            else next.delete(fileName);
            return next;
          });
        }
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  return { hiddenFileNames, setHidden, refresh };
}
