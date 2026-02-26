import { useEffect } from 'react';
import type { InputWrapper } from './use-control-panel-state';

type UseControlPanelInputOrderEventsProps = {
  setInputWrappers: (
    wrappers: InputWrapper[] | ((prev: InputWrapper[]) => InputWrapper[]),
  ) => void;
  setListVersion: (v: number | ((prev: number) => number)) => void;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
};

export function useControlPanelInputOrderEvents({
  setInputWrappers,
  setListVersion,
  updateOrder,
}: UseControlPanelInputOrderEventsProps) {
  useEffect(() => {
    const onMove = (
      e: CustomEvent<{ inputId: string; direction: 'up' | 'down' }>,
    ) => {
      try {
        const { inputId, direction } = e?.detail || {};
        if (!inputId || !direction) return;
        setInputWrappers((prev) => {
          const current = [...prev];
          const idx = current.findIndex((it) => it.inputId === inputId);
          if (idx < 0) return prev;
          const target =
            direction === 'up'
              ? Math.max(0, idx - 1)
              : Math.min(current.length - 1, idx + 1);
          if (target === idx) return prev;
          const [item] = current.splice(idx, 1);
          current.splice(target, 0, item);
          void updateOrder(current);
          return current;
        });
        setListVersion((v) => v + 1);
      } catch {
        // ignore
      }
    };
    window.addEventListener(
      'smelter:inputs:move',
      onMove as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:inputs:move',
        onMove as unknown as EventListener,
      );
    };
  }, [updateOrder, setInputWrappers, setListVersion]);
}
