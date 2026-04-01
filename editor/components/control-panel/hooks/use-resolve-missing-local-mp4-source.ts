'use client';

import { useCallback, useEffect, useState } from 'react';
import { useActions } from '../contexts/actions-context';
import { toast } from 'sonner';

export function useResolveMissingLocalMp4Source({
  roomId,
  inputId,
  assetType,
  enabled,
  refreshState,
}: {
  roomId: string;
  inputId: string;
  assetType: 'mp4' | 'audio' | 'picture';
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
      toast.error(
        assetType === 'audio'
          ? 'Select an audio file.'
          : assetType === 'picture'
            ? 'Select an image file.'
            : 'Select an MP4 file.',
      );
      return false;
    }
    setAttaching(true);
    try {
      if (assetType === 'picture') {
        await actions.resolveMissingImage(roomId, inputId, {
          fileName: selected,
        });
      } else {
        await actions.resolveMissingLocalMp4(roomId, inputId, {
          fileName: assetType === 'audio' ? undefined : selected,
          audioFileName: assetType === 'audio' ? selected : undefined,
        });
      }
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
  }, [actions, roomId, inputId, assetType, selected, refreshState]);

  return {
    selected,
    setSelected,
    attaching,
    attach,
  };
}
