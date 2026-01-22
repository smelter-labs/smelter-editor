import { useCallback, useEffect, useRef, useState } from 'react';
import type { Input } from '@/app/actions/actions';

export function useStreamsSpinner(initialInputs: Input[]) {
  const [showStreamsSpinner, setShowStreamsSpinner] = useState(
    initialInputs.length === 0,
  );
  const spinnerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everHadInputRef = useRef<boolean>(initialInputs.length > 0);

  useEffect(
    () => () => {
      if (spinnerTimeoutRef.current) clearTimeout(spinnerTimeoutRef.current);
    },
    [],
  );

  const onInputsChange = useCallback((inputs: Input[]) => {
    if (inputs.length > 0) everHadInputRef.current = true;
    if (everHadInputRef.current) {
      setShowStreamsSpinner(false);
      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
        spinnerTimeoutRef.current = null;
      }
      return;
    }
    if (inputs.length === 0) {
      setShowStreamsSpinner(true);
      if (spinnerTimeoutRef.current) clearTimeout(spinnerTimeoutRef.current);
      spinnerTimeoutRef.current = setTimeout(
        () => setShowStreamsSpinner(false),
        10000,
      );
    } else {
      setShowStreamsSpinner(false);
      if (spinnerTimeoutRef.current) {
        clearTimeout(spinnerTimeoutRef.current);
        spinnerTimeoutRef.current = null;
      }
    }
  }, []);

  return { showStreamsSpinner, onInputsChange } as const;
}
