import { useCallback, useEffect, useRef, useState } from 'react';
import type { Input } from '@/lib/types';

export function useStreamsSpinner(initialInputs: Input[]) {
  const [showStreamsSpinner, setShowStreamsSpinner] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      setShowStreamsSpinner(false);
    }
  }, [initialInputs]);

  const onInputsChange = useCallback((_inputs: Input[]) => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      setShowStreamsSpinner(false);
      return;
    }
    setShowStreamsSpinner(false);
  }, []);

  return { showStreamsSpinner, onInputsChange } as const;
}
