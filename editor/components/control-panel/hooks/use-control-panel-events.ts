import { useCallback, useEffect, useRef } from 'react';
import type { InputWrapper } from './use-control-panel-state';
import { useControlPanelInputOrderEvents } from './use-control-panel-input-order-events';
import type { Input, AvailableShader } from '@/app/actions/actions';
import {
  removeInput,
  hideInput,
  updateRoom,
  addTwitchInput,
  addMP4Input,
  addImageInput,
  addTextInput,
  addCameraInput,
  startRecording,
  stopRecording,
  updateInput,
  getTwitchSuggestions,
} from '@/app/actions/actions';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  loadLastWhipInputId,
  clearWhipSessionFor,
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import type { InputType } from '@/lib/voice/commandTypes';
import { emitActionFeedback } from '@/lib/voice/feedbackEvents';
import { getDefaultOrientationSetting } from '@/lib/voice/macroSettings';
import { LAYOUT_CONFIGS, type Layout } from '@/components/layout-selector';

type UseControlPanelEventsProps = {
  inputsRef: React.MutableRefObject<Input[]>;
  inputWrappers: InputWrapper[];
  setInputWrappers: (
    wrappers: InputWrapper[] | ((prev: InputWrapper[]) => InputWrapper[]),
  ) => void;
  setListVersion: (v: number | ((prev: number) => number)) => void;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  screensharePcRef: React.MutableRefObject<RTCPeerConnection | null>;
  screenshareStreamRef: React.MutableRefObject<MediaStream | null>;
  activeCameraInputId: string | null;
  activeScreenshareInputId: string | null;
  setActiveCameraInputId: (id: string | null) => void;
  setIsCameraActive: (active: boolean) => void;
  setActiveScreenshareInputId: (id: string | null) => void;
  setIsScreenshareActive: (active: boolean) => void;
  setOpenFxInputId: (id: string | null) => void;
  inputs: Input[];
  availableShaders: AvailableShader[];
  selectedInputId: string | null;
  setSelectedInputId: (id: string | null) => void;
  currentLayout: Layout;
  changeLayout: (layout: Layout) => void;
};

type ApplyTextColorFromVoiceParams = {
  color: string;
  inputIndex?: number;
  inputs: Input[];
  selectedInputId: string | null;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  dispatchEvent: (event: Event) => boolean;
  updateInputFn: typeof updateInput;
};

export async function applyTextColorFromVoice({
  color,
  inputIndex,
  inputs,
  selectedInputId,
  roomId,
  handleRefreshState,
  dispatchEvent,
  updateInputFn,
}: ApplyTextColorFromVoiceParams): Promise<boolean> {
  const visibleInputs = inputs.filter((i) => !i.hidden);

  let input;
  if (inputIndex !== undefined) {
    input = visibleInputs[inputIndex - 1];
  } else if (selectedInputId) {
    input = inputs.find((i: Input) => i.inputId === selectedInputId);
  }

  if (!input || input.type !== 'text-input') {
    return false;
  }

  await updateInputFn(roomId, input.inputId, {
    textColor: color,
    volume: input.volume,
  });

  dispatchEvent(
    new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
      detail: {
        inputId: input.inputId,
        patch: { textColor: color },
      },
    }),
  );

  await handleRefreshState();
  return true;
}

export function useControlPanelEvents({
  inputsRef,
  inputWrappers,
  setInputWrappers,
  setListVersion,
  updateOrder,
  roomId,
  handleRefreshState,
  cameraPcRef,
  cameraStreamRef,
  screensharePcRef,
  screenshareStreamRef,
  activeCameraInputId,
  activeScreenshareInputId,
  setActiveCameraInputId,
  setIsCameraActive,
  setActiveScreenshareInputId,
  setIsScreenshareActive,
  setOpenFxInputId,
  inputs,
  availableShaders,
  selectedInputId,
  setSelectedInputId,
  currentLayout,
  changeLayout,
}: UseControlPanelEventsProps) {
  useControlPanelInputOrderEvents({
    setInputWrappers,
    setListVersion,
    updateOrder,
  });

  const emitMacroStepComplete = (requestId?: string, error?: unknown) => {
    if (!requestId) return;
    window.dispatchEvent(
      new CustomEvent('smelter:voice:macro-step-complete', {
        detail: {
          requestId,
          error:
            error instanceof Error
              ? error.message
              : typeof error === 'string'
                ? error
                : undefined,
        },
      }),
    );
  };

  const cleanupWhipIfNeeded = useCallback(
    (inputId: string) => {
      const session = loadWhipSession();
      const isSavedInSession =
        (session && session.roomId === roomId && session.inputId === inputId) ||
        loadLastWhipInputId(roomId) === inputId;
      const isWhipCandidate = inputId.includes('whip') || isSavedInSession;
      if (!isWhipCandidate) return;

      try {
        stopCameraAndConnection(cameraPcRef, cameraStreamRef);
        stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
      } catch {}
      try {
        clearWhipSessionFor(roomId, inputId);
      } catch {}
      if (activeCameraInputId === inputId) {
        setActiveCameraInputId(null);
        setIsCameraActive(false);
      }
      if (activeScreenshareInputId === inputId) {
        setActiveScreenshareInputId(null);
        setIsScreenshareActive(false);
      }
    },
    [
      roomId,
      cameraPcRef,
      cameraStreamRef,
      screensharePcRef,
      screenshareStreamRef,
      activeCameraInputId,
      activeScreenshareInputId,
      setActiveCameraInputId,
      setIsCameraActive,
      setActiveScreenshareInputId,
      setIsScreenshareActive,
    ],
  );

  useEffect(() => {
    const onSelect = (e: CustomEvent<{ inputId: string }>) => {
      setSelectedInputId(e.detail.inputId);
    };
    window.addEventListener(
      'smelter:inputs:select',
      onSelect as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:inputs:select',
        onSelect as unknown as EventListener,
      );
    };
  }, [setSelectedInputId]);

  useEffect(() => {
    const onToggleMute = async (e: CustomEvent<{ inputId: string }>) => {
      const input = inputsRef.current.find(
        (i) => i.inputId === e.detail.inputId,
      );
      if (!input) return;
      await updateInput(roomId, input.inputId, {
        volume: input.volume === 0 ? 1 : 0,
        shaders: input.shaders,
      });
      await handleRefreshState();
    };
    window.addEventListener(
      'smelter:inputs:toggle-mute',
      onToggleMute as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:inputs:toggle-mute',
        onToggleMute as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef]);

  useEffect(() => {
    const onRemove = async (
      e: CustomEvent<{ inputId: string; requestId?: string }>,
    ) => {
      const { inputId, requestId } = e.detail;
      try {
        cleanupWhipIfNeeded(inputId);
        try {
          await hideInput(roomId, inputId);
        } catch {}
        await removeInput(roomId, inputId);
        await handleRefreshState();
        emitMacroStepComplete(requestId);
      } catch (err) {
        emitMacroStepComplete(requestId, err);
        console.error('Failed to remove input', err);
      }
    };
    window.addEventListener(
      'smelter:inputs:remove',
      onRemove as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:inputs:remove',
        onRemove as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, cleanupWhipIfNeeded]);

  useEffect(() => {
    const onHide = async (e: CustomEvent<{ inputId: string }>) => {
      const { inputId } = e.detail;
      await hideInput(roomId, inputId);
      await handleRefreshState();
    };
    window.addEventListener(
      'smelter:inputs:hide',
      onHide as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:inputs:hide',
        onHide as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState]);

  useEffect(() => {
    const onHideAllInputs = async (e: CustomEvent<{ requestId?: string }>) => {
      const requestId = e.detail?.requestId;
      try {
        const currentInputs = [...(inputsRef.current || [])];
        for (const input of currentInputs) {
          try {
            await hideInput(roomId, input.inputId);
          } catch (err) {
            console.warn('Macro: failed to hide input', {
              inputId: input.inputId,
              err,
            });
          }
        }
        await handleRefreshState();
        emitMacroStepComplete(requestId);
      } catch (err) {
        emitMacroStepComplete(requestId, err);
        console.error('Macro: failed to hide all inputs', err);
      }
    };

    window.addEventListener(
      'smelter:voice:hide-all-inputs',
      onHideAllInputs as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:hide-all-inputs',
        onHideAllInputs as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef]);

  useEffect(() => {
    const onRemoveAllInputs = async (
      e: CustomEvent<{ requestId?: string }>,
    ) => {
      const requestId = e.detail?.requestId;
      try {
        const currentInputs = [...(inputsRef.current || [])];
        const failures: string[] = [];
        const removedInputIds: string[] = [];
        for (const input of currentInputs) {
          cleanupWhipIfNeeded(input.inputId);
          try {
            try {
              await hideInput(roomId, input.inputId);
            } catch {}
            await removeInput(roomId, input.inputId);
            removedInputIds.push(input.inputId);
          } catch (err) {
            failures.push(input.inputId);
            console.warn('Macro: failed to remove input', {
              inputId: input.inputId,
              err,
            });
          }
        }
        if (removedInputIds.length > 0) {
          window.dispatchEvent(
            new CustomEvent('smelter:timeline:purge-input-ids', {
              detail: { inputIds: removedInputIds },
            }),
          );
        }
        await handleRefreshState();
        if (failures.length > 0) {
          throw new Error(`Failed to remove inputs: ${failures.join(', ')}`);
        }
        emitMacroStepComplete(requestId);
      } catch (err) {
        emitMacroStepComplete(requestId, err);
        console.error('Macro: failed to remove all inputs', err);
      }
    };

    window.addEventListener(
      'smelter:voice:remove-all-inputs',
      onRemoveAllInputs as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:remove-all-inputs',
        onRemoveAllInputs as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, cleanupWhipIfNeeded]);

  useEffect(() => {
    const onRemoveInput = async (
      e: CustomEvent<{ inputIndex: number; requestId?: string }>,
    ) => {
      const requestId = e.detail?.requestId;
      try {
        const { inputIndex } = e.detail;
        const visibleInputs = (inputsRef.current || []).filter(
          (i) => !i.hidden,
        );
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= visibleInputs.length) {
          const error = new Error(`Voice: input ${inputIndex} does not exist`);
          console.warn(error.message);
          emitMacroStepComplete(requestId, error);
          return;
        }
        const input = visibleInputs[idx];
        cleanupWhipIfNeeded(input.inputId);
        try {
          await hideInput(roomId, input.inputId);
        } catch {}
        await removeInput(roomId, input.inputId);
        await handleRefreshState();
        emitMacroStepComplete(requestId);
      } catch (err) {
        emitMacroStepComplete(requestId, err);
        console.error('Voice: failed to remove input', err);
      }
    };

    window.addEventListener(
      'smelter:voice:remove-input',
      onRemoveInput as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:remove-input',
        onRemoveInput as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, cleanupWhipIfNeeded]);

  useEffect(() => {
    const onMoveByIndex = (
      e: CustomEvent<{ inputIndex: number; direction: string; steps: number }>,
    ) => {
      try {
        const { inputIndex, direction, steps } = e.detail;
        const visibleInputs = (inputsRef.current || []).filter(
          (i) => !i.hidden,
        );
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= visibleInputs.length) {
          console.warn(`Voice: input ${inputIndex} does not exist`);
          return;
        }
        const input = visibleInputs[idx];
        for (let i = 0; i < steps; i++) {
          window.dispatchEvent(
            new CustomEvent('smelter:inputs:move', {
              detail: { inputId: input.inputId, direction },
            }),
          );
        }
      } catch (err) {
        console.error('Voice: failed to move input', err);
      }
    };

    window.addEventListener(
      'smelter:voice:move-input',
      onMoveByIndex as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:move-input',
        onMoveByIndex as unknown as EventListener,
      );
    };
  }, [inputsRef]);

  useEffect(() => {
    const onAddInput = async (
      e: CustomEvent<{
        inputType: InputType;
        mp4FileName?: string;
        imageFileName?: string;
      }>,
    ) => {
      try {
        const { inputType, mp4FileName, imageFileName } = e.detail;
        let addedInputId: string | undefined;
        switch (inputType) {
          case 'stream': {
            const suggestions = await getTwitchSuggestions();
            const firstStream = suggestions?.twitch?.[0];
            if (firstStream?.streamId) {
              const res = await addTwitchInput(roomId, firstStream.streamId);
              addedInputId = res?.inputId;
            } else {
              console.warn(
                'Voice: no twitch streams available, using fallback',
              );
              const res = await addTwitchInput(roomId, 'shroud');
              addedInputId = res?.inputId;
            }
            break;
          }
          case 'mp4':
            if (mp4FileName) {
              const res = await addMP4Input(roomId, mp4FileName);
              addedInputId = res?.inputId;
            }
            break;
          case 'image':
            if (imageFileName) {
              const res = await addImageInput(roomId, imageFileName);
              addedInputId = res?.inputId;
            }
            break;
          case 'text': {
            const text = (e.detail as any).text ?? '';
            const textAlign = (e.detail as any).textAlign ?? 'center';
            const res = await addTextInput(roomId, text, textAlign);
            addedInputId = res?.inputId;
            break;
          }
          case 'camera': {
            const cameraName = `Camera-${Date.now()}`;
            const cameraResponse = await addCameraInput(roomId, cameraName);
            addedInputId = cameraResponse.inputId;
            setActiveCameraInputId(cameraResponse.inputId);
            setIsCameraActive(false);
            const onCameraDisconnected = () => {
              stopCameraAndConnection(cameraPcRef, cameraStreamRef);
              setIsCameraActive(false);
            };
            const { location: cameraLocation } = await startPublish(
              cameraResponse.inputId,
              cameraResponse.bearerToken,
              cameraResponse.whipUrl,
              cameraPcRef,
              cameraStreamRef,
              onCameraDisconnected,
            );
            setIsCameraActive(true);
            saveWhipSession({
              roomId,
              inputId: cameraResponse.inputId,
              bearerToken: cameraResponse.bearerToken,
              location: cameraLocation,
              ts: Date.now(),
            });
            saveLastWhipInputId(roomId, cameraResponse.inputId);
            break;
          }
          case 'screenshare': {
            const screenName = `Screen-${Date.now()}`;
            const screenResponse = await addCameraInput(roomId, screenName);
            addedInputId = screenResponse.inputId;
            setActiveScreenshareInputId(screenResponse.inputId);
            setIsScreenshareActive(false);
            const onScreenDisconnected = () => {
              stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
              setIsScreenshareActive(false);
            };
            const { location: screenLocation } = await startScreensharePublish(
              screenResponse.inputId,
              screenResponse.bearerToken,
              screenResponse.whipUrl,
              screensharePcRef,
              screenshareStreamRef,
              onScreenDisconnected,
            );
            setIsScreenshareActive(true);
            saveWhipSession({
              roomId,
              inputId: screenResponse.inputId,
              bearerToken: screenResponse.bearerToken,
              location: screenLocation,
              ts: Date.now(),
            });
            saveLastWhipInputId(roomId, screenResponse.inputId);
            break;
          }
        }

        if (addedInputId) {
          const defaultOrientation = getDefaultOrientationSetting();
          if (defaultOrientation === 'vertical') {
            await updateInput(roomId, addedInputId, {
              orientation: 'vertical',
              volume: 1,
            });
          }
        }

        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to add input', err);
      }
    };

    window.addEventListener(
      'smelter:voice:add-input',
      onAddInput as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:add-input',
        onAddInput as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState]);

  useEffect(() => {
    const hexToPackedInt = (hex: string): number => {
      const cleanHex = hex.replace('#', '');
      const fullHex =
        cleanHex.length === 3
          ? cleanHex
              .split('')
              .map((char) => char + char)
              .join('')
          : cleanHex;
      return parseInt(fullHex, 16);
    };

    const onAddShader = async (
      e: CustomEvent<{
        inputIndex: number | null;
        shader: string;
        targetColor?: string;
      }>,
    ) => {
      try {
        const { inputIndex, shader: shaderId, targetColor } = e.detail;
        const currentInputs = inputs || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== null) {
          const idx = inputIndex - 1;
          if (idx < 0 || idx >= visibleInputs.length) {
            console.warn(`Voice: input ${inputIndex} does not exist`);
            return;
          }
          input = visibleInputs[idx];
        } else if (selectedInputId) {
          input = currentInputs.find((i) => i.inputId === selectedInputId);
          if (!input) {
            console.warn('Voice: selected input no longer exists');
            return;
          }
        } else {
          console.warn('Voice: no input specified and none selected');
          return;
        }
        const shaderDef = availableShaders.find((s) => s.id === shaderId);
        if (!shaderDef) {
          console.warn(`Voice: shader ${shaderId} not found`);
          return;
        }
        const existingShaders = input.shaders || [];
        if (existingShaders.some((s) => s.shaderId === shaderId)) {
          return;
        }
        const newShader = {
          shaderName: shaderDef.name,
          shaderId: shaderDef.id,
          enabled: true,
          params: (shaderDef.params || []).map((p) => {
            if (p.type === 'color' && typeof p.defaultValue === 'string') {
              const colorValue =
                shaderId === 'remove-color' &&
                p.name === 'target_color' &&
                targetColor
                  ? targetColor
                  : p.defaultValue;
              return {
                paramName: p.name,
                paramValue: hexToPackedInt(colorValue),
              };
            }
            return {
              paramName: p.name,
              paramValue:
                typeof p.defaultValue === 'number' ? p.defaultValue : 0,
            };
          }),
        };
        const updatedShaders = [...existingShaders, newShader];
        await updateInput(roomId, input.inputId, {
          shaders: updatedShaders,
          volume: input.volume,
        });
        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
            detail: {
              inputId: input.inputId,
              patch: { shaders: updatedShaders },
            },
          }),
        );
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to add shader', err);
      }
    };

    window.addEventListener(
      'smelter:voice:add-shader',
      onAddShader as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:add-shader',
        onAddShader as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputs, availableShaders, selectedInputId]);

  useEffect(() => {
    const onRemoveShader = async (
      e: CustomEvent<{ inputIndex: number | null; shader: string }>,
    ) => {
      try {
        const { inputIndex, shader: shaderId } = e.detail;
        const currentInputs = inputs || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== null) {
          const idx = inputIndex - 1;
          if (idx < 0 || idx >= visibleInputs.length) {
            console.warn(`Voice: input ${inputIndex} does not exist`);
            return;
          }
          input = visibleInputs[idx];
        } else if (selectedInputId) {
          input = currentInputs.find((i) => i.inputId === selectedInputId);
          if (!input) {
            console.warn('Voice: selected input no longer exists');
            return;
          }
        } else {
          console.warn('Voice: no input specified and none selected');
          return;
        }
        const existingShaders = input.shaders || [];
        const updatedShaders = existingShaders.filter(
          (s) => s.shaderId !== shaderId,
        );
        await updateInput(roomId, input.inputId, {
          shaders: updatedShaders,
          volume: input.volume,
        });
        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
            detail: {
              inputId: input.inputId,
              patch: { shaders: updatedShaders },
            },
          }),
        );
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to remove shader', err);
      }
    };

    window.addEventListener(
      'smelter:voice:remove-shader',
      onRemoveShader as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:remove-shader',
        onRemoveShader as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputs, selectedInputId]);

  useEffect(() => {
    const onSelectInput = (e: CustomEvent<{ inputIndex: number }>) => {
      try {
        const { inputIndex } = e.detail;
        const visibleInputs = (inputsRef.current || []).filter(
          (i) => !i.hidden,
        );
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= visibleInputs.length) {
          console.warn(`Voice: input ${inputIndex} does not exist`);
          return;
        }
        const input = visibleInputs[idx];
        setSelectedInputId(input.inputId);
        window.dispatchEvent(
          new CustomEvent('smelter:timeline:select-clip', {
            detail: { inputId: input.inputId },
          }),
        );
      } catch (err) {
        console.error('Voice: failed to select input', err);
      }
    };

    window.addEventListener(
      'smelter:voice:select-input',
      onSelectInput as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:select-input',
        onSelectInput as unknown as EventListener,
      );
    };
  }, [inputsRef, setSelectedInputId]);

  useEffect(() => {
    const onDeselectInput = () => {
      setSelectedInputId(null);
    };

    window.addEventListener(
      'smelter:voice:deselect-input',
      onDeselectInput as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:deselect-input',
        onDeselectInput as unknown as EventListener,
      );
    };
  }, [setSelectedInputId]);

  const typingInputIdRef = useRef<string | null>(null);
  const accumulatedTextRef = useRef<string>('');

  useEffect(() => {
    const onStartTyping = () => {
      const currentInputs = inputs || [];
      let input;

      if (selectedInputId) {
        input = currentInputs.find((i) => i.inputId === selectedInputId);
      }

      if (!input || input.type !== 'text-input') {
        input = currentInputs.find((i) => i.type === 'text-input');
        if (!input) {
          console.warn('Voice: no text input available for typing mode');
          return;
        }
      }

      typingInputIdRef.current = input.inputId;
      accumulatedTextRef.current = input.text || '';
    };

    const onStopTyping = async () => {
      if (!typingInputIdRef.current) return;

      const currentInputs = inputs || [];
      const input = currentInputs.find(
        (i) => i.inputId === typingInputIdRef.current,
      );

      if (input) {
        try {
          await updateInput(roomId, input.inputId, {
            text: accumulatedTextRef.current,
            volume: input.volume,
          });
          await handleRefreshState();
        } catch (err) {
          console.error('Voice: failed to save text', err);
        }
      }

      typingInputIdRef.current = null;
      accumulatedTextRef.current = '';
    };

    const onAppendText = async (e: CustomEvent<{ text: string }>) => {
      if (!typingInputIdRef.current) return;

      const { text } = e.detail;
      const currentInputs = inputs || [];
      const input = currentInputs.find(
        (i) => i.inputId === typingInputIdRef.current,
      );

      if (!input) return;

      accumulatedTextRef.current = accumulatedTextRef.current
        ? `${accumulatedTextRef.current}\n${text}`
        : text;

      try {
        await updateInput(roomId, input.inputId, {
          text: accumulatedTextRef.current,
          volume: input.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to append text', err);
      }
    };

    window.addEventListener(
      'smelter:voice:start-typing',
      onStartTyping as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:stop-typing',
      onStopTyping as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:append-text',
      onAppendText as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        'smelter:voice:start-typing',
        onStartTyping as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:stop-typing',
        onStopTyping as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:append-text',
        onAppendText as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputs, selectedInputId]);

  useEffect(() => {
    const SPEED_STEP = 10;
    const MIN_SPEED = 10;
    const MAX_SPEED = 400;

    const onChangeScrollSpeed = async (
      e: CustomEvent<{ direction: 'up' | 'down'; steps: number }>,
    ) => {
      const { direction, steps } = e.detail;
      if (!typingInputIdRef.current) return;

      const currentInputs = inputs || [];
      const input = currentInputs.find(
        (i) => i.inputId === typingInputIdRef.current,
      );

      if (!input || input.type !== 'text-input') return;

      const currentSpeed = input.textScrollSpeed ?? 80;
      const delta =
        direction === 'up' ? SPEED_STEP * steps : -SPEED_STEP * steps;
      const newSpeed = Math.max(
        MIN_SPEED,
        Math.min(MAX_SPEED, currentSpeed + delta),
      );

      try {
        await updateInput(roomId, input.inputId, {
          textScrollSpeed: newSpeed,
          volume: input.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to change scroll speed', err);
      }
    };

    window.addEventListener(
      'smelter:voice:change-scroll-speed',
      onChangeScrollSpeed as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        'smelter:voice:change-scroll-speed',
        onChangeScrollSpeed as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputs]);

  useEffect(() => {
    const onNextLayout = () => {
      const currentIndex = LAYOUT_CONFIGS.findIndex(
        (l) => l.id === currentLayout,
      );
      const nextIndex = (currentIndex + 1) % LAYOUT_CONFIGS.length;
      changeLayout(LAYOUT_CONFIGS[nextIndex].id);
    };

    const onPreviousLayout = () => {
      const currentIndex = LAYOUT_CONFIGS.findIndex(
        (l) => l.id === currentLayout,
      );
      const prevIndex =
        (currentIndex - 1 + LAYOUT_CONFIGS.length) % LAYOUT_CONFIGS.length;
      changeLayout(LAYOUT_CONFIGS[prevIndex].id);
    };

    window.addEventListener('smelter:voice:next-layout', onNextLayout);
    window.addEventListener('smelter:voice:previous-layout', onPreviousLayout);

    return () => {
      window.removeEventListener('smelter:voice:next-layout', onNextLayout);
      window.removeEventListener(
        'smelter:voice:previous-layout',
        onPreviousLayout,
      );
    };
  }, [currentLayout, changeLayout]);

  useEffect(() => {
    const onSetTextColor = async (
      e: CustomEvent<{ color: string; inputIndex?: number }>,
    ) => {
      try {
        const { color, inputIndex } = e.detail;
        const didApply = await applyTextColorFromVoice({
          color,
          inputIndex,
          inputs: inputsRef.current || [],
          selectedInputId,
          roomId,
          handleRefreshState,
          dispatchEvent: (event) => window.dispatchEvent(event),
          updateInputFn: updateInput,
        });
        if (!didApply) {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
        }
      } catch (err) {
        console.error('Voice: failed to set text color', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text-color',
      onSetTextColor as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text-color',
        onSetTextColor as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const onSetTextMaxLines = async (e: CustomEvent<{ maxLines: number }>) => {
      try {
        const { maxLines } = e.detail;
        const currentInputs = inputs || [];

        let input;
        if (selectedInputId) {
          input = currentInputs.find((i) => i.inputId === selectedInputId);
        }

        if (!input || input.type !== 'text-input') {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        await updateInput(roomId, input.inputId, {
          textMaxLines: maxLines,
          volume: input.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set text max lines', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text-max-lines',
      onSetTextMaxLines as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text-max-lines',
        onSetTextMaxLines as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputs, selectedInputId]);

  useEffect(() => {
    const onSetTextFontSize = async (
      e: CustomEvent<{ fontSize: number; inputIndex?: number }>,
    ) => {
      try {
        const { fontSize, inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== undefined) {
          input = visibleInputs[inputIndex - 1];
        } else if (selectedInputId) {
          input = currentInputs.find(
            (i: Input) => i.inputId === selectedInputId,
          );
        }

        if (!input || input.type !== 'text-input') {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        await updateInput(roomId, input.inputId, {
          textFontSize: fontSize,
          volume: input.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set text font size', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text-font-size',
      onSetTextFontSize as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text-font-size',
        onSetTextFontSize as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const MIN_SPEED = 10;
    const MAX_SPEED = 400;

    const onSetTextScrollSpeed = async (
      e: CustomEvent<{ scrollSpeed: number; inputIndex?: number }>,
    ) => {
      try {
        const { scrollSpeed, inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== undefined) {
          input = visibleInputs[inputIndex - 1];
        } else if (selectedInputId) {
          input = currentInputs.find(
            (i: Input) => i.inputId === selectedInputId,
          );
        }

        if (!input || input.type !== 'text-input') {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        const nextSpeed = Math.max(
          MIN_SPEED,
          Math.min(MAX_SPEED, Math.round(scrollSpeed)),
        );
        await updateInput(roomId, input.inputId, {
          textScrollSpeed: nextSpeed,
          volume: input.volume,
        });

        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
            detail: {
              inputId: input.inputId,
              patch: { textScrollSpeed: nextSpeed },
            },
          }),
        );

        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set text scroll speed', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text-scroll-speed',
      onSetTextScrollSpeed as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text-scroll-speed',
        onSetTextScrollSpeed as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const onSetTextAlign = async (
      e: CustomEvent<{
        textAlign: 'left' | 'center' | 'right';
        inputIndex?: number;
      }>,
    ) => {
      try {
        const { textAlign, inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== undefined) {
          input = visibleInputs[inputIndex - 1];
        } else if (selectedInputId) {
          input = currentInputs.find(
            (i: Input) => i.inputId === selectedInputId,
          );
        }

        if (!input || input.type !== 'text-input') {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        await updateInput(roomId, input.inputId, {
          textAlign,
          volume: input.volume,
        });

        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
            detail: {
              inputId: input.inputId,
              patch: { textAlign },
            },
          }),
        );

        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set text align', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text-align',
      onSetTextAlign as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text-align',
        onSetTextAlign as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const onExportConfiguration = () => {
      window.dispatchEvent(new CustomEvent('smelter:export-configuration'));
    };

    window.addEventListener(
      'smelter:voice:export-configuration',
      onExportConfiguration as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:export-configuration',
        onExportConfiguration as unknown as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const onSetLayout = (e: CustomEvent<{ layout: Layout }>) => {
      try {
        const { layout } = e.detail;
        const validLayout = LAYOUT_CONFIGS.find((l) => l.id === layout);
        if (validLayout) {
          changeLayout(validLayout.id);
        } else {
          console.warn('Macro: invalid layout', layout);
        }
      } catch (err) {
        console.error('Macro: failed to set layout', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-layout',
      onSetLayout as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-layout',
        onSetLayout as unknown as EventListener,
      );
    };
  }, [changeLayout]);

  useEffect(() => {
    const onSetSwapDuration = async (
      e: CustomEvent<{ durationMs: number }>,
    ) => {
      try {
        await updateRoom(roomId, { swapDurationMs: e.detail.durationMs });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set swap duration', err);
      }
    };

    const onSetSwapFadeInDuration = async (
      e: CustomEvent<{ durationMs: number }>,
    ) => {
      try {
        await updateRoom(roomId, { swapFadeInDurationMs: e.detail.durationMs });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set swap fade in duration', err);
      }
    };

    const onSetSwapFadeOutDuration = async (
      e: CustomEvent<{ durationMs: number }>,
    ) => {
      try {
        await updateRoom(roomId, {
          swapFadeOutDurationMs: e.detail.durationMs,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set swap fade out duration', err);
      }
    };

    const onSetSwapOutgoingEnabled = async (
      e: CustomEvent<{ enabled: boolean }>,
    ) => {
      try {
        await updateRoom(roomId, { swapOutgoingEnabled: e.detail.enabled });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set outgoing transition', err);
      }
    };

    const onSetNewsStripEnabled = async (
      e: CustomEvent<{ enabled: boolean }>,
    ) => {
      try {
        await updateRoom(roomId, { newsStripEnabled: e.detail.enabled });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set news strip enabled', err);
      }
    };

    const onSetNewsStripFadeDuringSwap = async (
      e: CustomEvent<{ enabled: boolean }>,
    ) => {
      try {
        await updateRoom(roomId, { newsStripFadeDuringSwap: e.detail.enabled });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set news strip fade', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-swap-duration',
      onSetSwapDuration as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-swap-fade-in-duration',
      onSetSwapFadeInDuration as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-swap-fade-out-duration',
      onSetSwapFadeOutDuration as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-swap-outgoing-enabled',
      onSetSwapOutgoingEnabled as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-news-strip-enabled',
      onSetNewsStripEnabled as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:set-news-strip-fade-during-swap',
      onSetNewsStripFadeDuringSwap as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        'smelter:voice:set-swap-duration',
        onSetSwapDuration as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-swap-fade-in-duration',
        onSetSwapFadeInDuration as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-swap-fade-out-duration',
        onSetSwapFadeOutDuration as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-swap-outgoing-enabled',
        onSetSwapOutgoingEnabled as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-news-strip-enabled',
        onSetNewsStripEnabled as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:set-news-strip-fade-during-swap',
        onSetNewsStripFadeDuringSwap as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState]);

  useEffect(() => {
    const onStartRecording = async () => {
      try {
        await startRecording(roomId);
      } catch (err) {
        console.error('Voice: failed to start recording', err);
      }
    };

    const onStopRecording = async () => {
      try {
        await stopRecording(roomId);
      } catch (err) {
        console.error('Voice: failed to stop recording', err);
      }
    };

    window.addEventListener(
      'smelter:voice:start-recording',
      onStartRecording as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:stop-recording',
      onStopRecording as unknown as EventListener,
    );

    return () => {
      window.removeEventListener(
        'smelter:voice:start-recording',
        onStartRecording as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:stop-recording',
        onStopRecording as unknown as EventListener,
      );
    };
  }, [roomId]);

  useEffect(() => {
    const onSetText = async (
      e: CustomEvent<{ text: string; inputIndex?: number }>,
    ) => {
      try {
        const { text, inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];

        let input;
        if (inputIndex !== undefined) {
          input = currentInputs[inputIndex - 1];
        } else if (selectedInputId) {
          input = currentInputs.find(
            (i: Input) => i.inputId === selectedInputId,
          );
        }

        if (!input || input.type !== 'text-input') {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        await updateInput(roomId, input.inputId, {
          text,
          volume: input.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Macro: failed to set text', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-text',
      onSetText as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-text',
        onSetText as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const nudgeCounterRef = { current: 0 };

    const onScrollText = async (
      e: CustomEvent<{ direction: string; lines: number }>,
    ) => {
      try {
        const { direction, lines } = e.detail;
        const currentInputs = inputsRef.current || [];

        const textInput = selectedInputId
          ? currentInputs.find(
              (i: Input) =>
                i.inputId === selectedInputId && i.type === 'text-input',
            )
          : currentInputs.find((i: Input) => i.type === 'text-input');

        if (!textInput) {
          emitActionFeedback({
            type: 'error',
            label: 'Text input required',
            description: 'Select a text input first',
          });
          return;
        }

        nudgeCounterRef.current += 1;
        const nudgeValue = direction === 'down' ? lines : -lines;
        const uniqueNudge = nudgeValue + nudgeCounterRef.current * 0.001;

        await updateInput(roomId, textInput.inputId, {
          textScrollNudge: uniqueNudge,
          volume: textInput.volume,
        });
        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to scroll text', err);
      }
    };

    window.addEventListener(
      'smelter:voice:scroll-text',
      onScrollText as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:scroll-text',
        onScrollText as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);

  useEffect(() => {
    const onSetOrientation = async (
      e: CustomEvent<{
        orientation?: 'horizontal' | 'vertical';
        inputIndex?: number;
      }>,
    ) => {
      try {
        const { orientation, inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];
        const visibleInputs = currentInputs.filter((i) => !i.hidden);

        let input;
        if (inputIndex !== undefined && inputIndex !== null) {
          const idx = inputIndex - 1;
          if (idx < 0 || idx >= visibleInputs.length) {
            console.warn(`Voice: input ${inputIndex} does not exist`);
            return;
          }
          input = visibleInputs[idx];
        } else if (selectedInputId) {
          input = currentInputs.find((i) => i.inputId === selectedInputId);
        }

        if (!input) {
          emitActionFeedback({
            type: 'error',
            label: 'No input selected',
            description: 'Select an input or specify input number',
          });
          return;
        }

        const newOrientation = orientation
          ? orientation
          : input.orientation === 'vertical'
            ? 'horizontal'
            : 'vertical';

        await updateInput(roomId, input.inputId, {
          orientation: newOrientation,
          shaders: input.shaders,
          volume: input.volume,
        });

        window.dispatchEvent(
          new CustomEvent('smelter:timeline:update-clip-settings-for-input', {
            detail: {
              inputId: input.inputId,
              patch: { orientation: newOrientation },
            },
          }),
        );

        await handleRefreshState();
      } catch (err) {
        console.error('Voice: failed to set orientation', err);
      }
    };

    window.addEventListener(
      'smelter:voice:set-orientation',
      onSetOrientation as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:set-orientation',
        onSetOrientation as unknown as EventListener,
      );
    };
  }, [roomId, handleRefreshState, inputsRef, selectedInputId]);
}
