'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActions } from '../contexts/actions-context';
import { toast } from 'sonner';

export function useResolveMissingLocalMp4Source({
  roomId,
  inputId,
  isAudio,
  enabled,
  refreshState,
}: {
  roomId: string;
  inputId: string;
  isAudio: boolean;
  enabled: boolean;
  refreshState: () => Promise<void>;
}) {
  const actions = useActions();
  const [selected, setSelected] = useState('');
  const [attaching, setAttaching] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setSelected('');
  }, [enabled, inputId, roomId]);

  const attach = useCallback(async () => {
    if (!selected) {
      toast.error(isAudio ? 'Select an audio file.' : 'Select an MP4 file.');
      return false;
    }
    setAttaching(true);
    try {
      await actions.resolveMissingLocalMp4(roomId, inputId, {
        fileName: isAudio ? undefined : selected,
        audioFileName: isAudio ? selected : undefined,
      });
      await refreshState();
      toast.success('Source attached');
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg || 'Failed to attach file');
      return false;
    } finally {
      setAttaching(false);
    }
  }, [actions, roomId, inputId, isAudio, selected, refreshState]);

  return {
    selected,
    setSelected,
    attaching,
    attach,
  };
}
