import { useCallback, useEffect, useRef, useState } from 'react';
import type { Input, RoomState, AvailableShader } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { useStreamsSpinner } from '../whip-input/hooks/use-streams-spinner';
import { loadUserName, saveUserName } from '../whip-input/utils/whip-storage';

export type InputWrapper = { id: number; inputId: string };

export function useControlPanelState(
  roomId: string,
  roomState: RoomState,
  refreshState: () => Promise<void>,
) {
  const { getAvailableShaders, updateRoom: updateRoomAction } = useActions();
  const [userName, setUserName] = useState<string>(() => {
    const saved = loadUserName(roomId);
    if (saved) return saved;
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem('smelter-display-name');
      if (storedName) return `${storedName} Camera`;
    }
    const random = Math.floor(1000 + Math.random() * 9000);
    return `User ${random}`;
  });

  useEffect(() => {
    saveUserName(roomId, userName);
  }, [roomId, userName]);

  const inputsRef = useRef<Input[]>(roomState.inputs);
  const [inputs, setInputs] = useState<Input[]>(roomState.inputs);

  const { showStreamsSpinner, onInputsChange } = useStreamsSpinner(
    roomState.inputs,
  );

  const getInputWrappers = useCallback(
    (inputsArg: Input[] = inputsRef.current): InputWrapper[] =>
      inputsArg.map((input, index) => ({
        id: index,
        inputId: input.inputId,
      })),
    [],
  );

  const [inputWrappers, setInputWrappers] = useState<InputWrapper[]>(() =>
    getInputWrappers(roomState.inputs),
  );
  const [listVersion, setListVersion] = useState<number>(0);

  const handleRefreshState = useCallback(async () => {
    setInputWrappers(getInputWrappers(inputsRef.current));
    setListVersion((v) => v + 1);
    await refreshState();
  }, [getInputWrappers, refreshState]);

  useEffect(() => {
    setInputWrappers(getInputWrappers(inputs));
    inputsRef.current = inputs;
    onInputsChange(inputs);
  }, [inputs, getInputWrappers, onInputsChange]);

  useEffect(() => {
    setInputs(roomState.inputs);
    inputsRef.current = roomState.inputs;
    onInputsChange(roomState.inputs);
  }, [roomState.inputs, onInputsChange]);

  const [availableShaders, setAvailableShaders] = useState<AvailableShader[]>(
    [],
  );

  useEffect(() => {
    let mounted = true;
    getAvailableShaders()
      .then((shaders) => {
        if (mounted) setAvailableShaders(shaders);
      })
      .catch(() => {
        if (mounted) setAvailableShaders([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const [isSwapping, setIsSwapping] = useState(false);
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateOrder = useCallback(
    async (newInputWrappers: InputWrapper[]) => {
      try {
        const newOrderIds = newInputWrappers.map((item) => item.inputId);
        await updateRoomAction(roomId, { inputOrder: newOrderIds });
      } catch (e) {
        console.error('updateOrder failed:', e);
        alert('Failed to save stream order.');
      }
    },
    [roomId],
  );

  const [openFxInputId, setOpenFxInputId] = useState<string | null>(null);
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);

  useEffect(() => {
    if (!openFxInputId) return;
    if (!inputs.some((i) => i.inputId === openFxInputId)) {
      setOpenFxInputId(null);
    }
  }, [inputs, openFxInputId]);

  useEffect(() => {
    if (!selectedInputId) return;
    if (!inputs.some((i) => i.inputId === selectedInputId)) {
      setSelectedInputId(null);
    }
  }, [inputs, selectedInputId]);

  return {
    userName,
    setUserName,
    inputs,
    inputsRef,
    showStreamsSpinner,
    inputWrappers,
    setInputWrappers,
    listVersion,
    setListVersion,
    handleRefreshState,
    availableShaders,
    updateOrder,
    openFxInputId,
    setOpenFxInputId,
    selectedInputId,
    setSelectedInputId,
    isSwapping,
    setIsSwapping,
    swapTimerRef,
  };
}
