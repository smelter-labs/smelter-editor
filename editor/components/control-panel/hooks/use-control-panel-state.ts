import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type {
  Input,
  RoomState,
  AvailableShader,
  Layout,
} from '@/app/actions/actions';
import {
  getAvailableShaders,
  updateRoom as updateRoomAction,
  updateInput,
} from '@/app/actions/actions';
import { useStreamsSpinner } from '../whip-input/hooks/use-streams-spinner';
import { loadUserName, saveUserName } from '../whip-input/utils/whip-storage';
import type { AddTab } from '../components/AddVideoSection';

export type InputWrapper = { id: number; inputId: string };

export function useControlPanelState(
  roomId: string,
  roomState: RoomState,
  refreshState: () => Promise<void>,
) {
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

  const pathname = usePathname();
  const isKick = pathname?.toLowerCase().includes('kick');

  const [addInputActiveTab, setAddInputActiveTab] = useState<AddTab>('stream');

  type StreamTab = 'twitch' | 'kick';
  const [streamActiveTab, setStreamActiveTab] = useState<StreamTab>(
    isKick ? 'kick' : 'twitch',
  );

  type InputsTab = 'camera' | 'screenshare';
  const [inputsActiveTab, setInputsActiveTab] = useState<InputsTab>('camera');

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

  useEffect(() => {
    if (roomState.layout !== 'wrapped') return;
    if (!availableShaders || availableShaders.length === 0) return;

    const shaderDef =
      availableShaders.find((s) => s.id === 'multiple-pictures') ||
      availableShaders.find(
        (s) =>
          s.name.toLowerCase().includes('multiple') &&
          s.name.toLowerCase().includes('picture'),
      );
    if (!shaderDef) return;

    (async () => {
      const updates: Promise<any>[] = [];
      for (const input of inputsRef.current) {
        const hasShader = (input.shaders || []).some(
          (s) => s.shaderId === shaderDef.id,
        );
        if (!hasShader) {
          const newShadersConfig = [
            ...(input.shaders || []),
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params:
                shaderDef.params?.map((param) => ({
                  paramName: param.name,
                  paramValue: param.defaultValue ?? 0,
                })) || [],
            },
          ];
          updates.push(
            updateInput(roomId, input.inputId, {
              shaders: newShadersConfig,
              volume: input.volume,
            }),
          );
        }
      }
      if (updates.length > 0) {
        try {
          await Promise.allSettled(updates);
          await handleRefreshState();
        } catch {}
      }
    })();
  }, [roomState.layout, availableShaders, roomId, handleRefreshState]);

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

  const changeLayout = useCallback(
    async (layout: Layout) => {
      try {
        await updateRoomAction(roomId, { layout });
        await refreshState();
        if (layout === 'wrapped' && typeof window !== 'undefined') {
          setTimeout(async () => {
            try {
              const currentInputs = inputsRef.current;
              if (!currentInputs || currentInputs.length < 2) return;

              const newWrappers = [...getInputWrappers(currentInputs)];
              const temp = newWrappers[0];
              newWrappers[0] = newWrappers[1];
              newWrappers[1] = temp;

              await updateOrder(newWrappers);
            } catch (e) {
              console.warn(
                'Failed to swap first two inputs for wrapped layout:',
                e,
              );
            }
          }, 1000);
        }
      } catch (e) {
        console.error('changeLayout failed:', e);
        alert('Failed to change layout.');
      }
    },
    [roomId, refreshState, getInputWrappers, updateOrder],
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
    addInputActiveTab,
    setAddInputActiveTab,
    streamActiveTab,
    setStreamActiveTab,
    inputsActiveTab,
    setInputsActiveTab,
    inputWrappers,
    setInputWrappers,
    listVersion,
    setListVersion,
    handleRefreshState,
    availableShaders,
    updateOrder,
    changeLayout,
    openFxInputId,
    setOpenFxInputId,
    selectedInputId,
    setSelectedInputId,
    isSwapping,
    setIsSwapping,
    swapTimerRef,
  };
}
