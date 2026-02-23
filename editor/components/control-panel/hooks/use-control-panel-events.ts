import { useEffect, useRef } from 'react';
import type { InputWrapper } from './use-control-panel-state';
import { useControlPanelInputOrderEvents } from './use-control-panel-input-order-events';
import type { Input, AvailableShader } from '@/app/actions/actions';
import {
  removeInput,
  addTwitchInput,
  addMP4Input,
  addImageInput,
  addTextInput,
  addCameraInput,
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
import { LAYOUT_CONFIGS, type Layout } from '@/components/layout-selector';

type UseControlPanelEventsProps = {
  inputsRef: React.MutableRefObject<Input[]>;
  inputWrappers: InputWrapper[];
  setInputWrappers: (
    wrappers: InputWrapper[] | ((prev: InputWrapper[]) => InputWrapper[]),
  ) => void;
  setListVersion: (v: number | ((prev: number) => number)) => void;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  addVideoAccordionRef: React.MutableRefObject<any>;
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

export function useControlPanelEvents({
  inputsRef,
  inputWrappers,
  setInputWrappers,
  setListVersion,
  updateOrder,
  addVideoAccordionRef,
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
    const onRemove = async (e: CustomEvent<{ inputId: string }>) => {
      const { inputId } = e.detail;
      if (activeCameraInputId === inputId) {
        stopCameraAndConnection(cameraPcRef, cameraStreamRef);
        setActiveCameraInputId(null);
        setIsCameraActive(false);
        clearWhipSessionFor(roomId, inputId);
      }
      if (activeScreenshareInputId === inputId) {
        stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
        setActiveScreenshareInputId(null);
        setIsScreenshareActive(false);
        clearWhipSessionFor(roomId, inputId);
      }
      await removeInput(roomId, inputId);
      await handleRefreshState();
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
  }, [
    roomId,
    handleRefreshState,
    activeCameraInputId,
    activeScreenshareInputId,
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  ]);

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
        switch (inputType) {
          case 'stream': {
            const suggestions = await getTwitchSuggestions();
            const firstStream = suggestions?.twitch?.[0];
            if (firstStream?.streamId) {
              await addTwitchInput(roomId, firstStream.streamId);
            } else {
              console.warn(
                'Voice: no twitch streams available, using fallback',
              );
              await addTwitchInput(roomId, 'shroud');
            }
            break;
          }
          case 'mp4':
            if (mp4FileName) {
              await addMP4Input(roomId, mp4FileName);
            }
            break;
          case 'image':
            if (imageFileName) {
              await addImageInput(roomId, imageFileName);
            }
            break;
          case 'text': {
            const text = (e.detail as any).text ?? '';
            const textAlign = (e.detail as any).textAlign ?? 'center';
            await addTextInput(roomId, text, textAlign);
            break;
          }
          case 'camera': {
            const cameraName = `Camera-${Date.now()}`;
            const cameraResponse = await addCameraInput(roomId, cameraName);
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
    const onRemoveInput = async (e: CustomEvent<{ inputIndex: number }>) => {
      try {
        const { inputIndex } = e.detail;
        const currentInputs = inputsRef.current || [];
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= currentInputs.length) {
          console.warn(`Voice: input ${inputIndex} does not exist`);
          return;
        }
        const input = currentInputs[idx];
        await removeInput(roomId, input.inputId);
        await handleRefreshState();
      } catch (err) {
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
  }, [roomId, handleRefreshState, inputsRef]);

  useEffect(() => {
    const onMoveByIndex = (
      e: CustomEvent<{ inputIndex: number; direction: string; steps: number }>,
    ) => {
      try {
        const { inputIndex, direction, steps } = e.detail;
        const currentInputs = inputsRef.current || [];
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= currentInputs.length) {
          console.warn(`Voice: input ${inputIndex} does not exist`);
          return;
        }
        const input = currentInputs[idx];
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

        let input;
        if (inputIndex !== null) {
          const idx = inputIndex - 1;
          if (idx < 0 || idx >= currentInputs.length) {
            console.warn(`Voice: input ${inputIndex} does not exist`);
            return;
          }
          input = currentInputs[idx];
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
        await updateInput(roomId, input.inputId, {
          shaders: [...existingShaders, newShader],
          volume: input.volume,
        });
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

        let input;
        if (inputIndex !== null) {
          const idx = inputIndex - 1;
          if (idx < 0 || idx >= currentInputs.length) {
            console.warn(`Voice: input ${inputIndex} does not exist`);
            return;
          }
          input = currentInputs[idx];
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
        const currentInputs = inputsRef.current || [];
        const idx = inputIndex - 1;
        if (idx < 0 || idx >= currentInputs.length) {
          console.warn(`Voice: input ${inputIndex} does not exist`);
          return;
        }
        const input = currentInputs[idx];
        setSelectedInputId(input.inputId);
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

      const currentSpeed = input.textScrollSpeed ?? 40;
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
          console.warn('Voice: no text input found for color change');
          return;
        }

        await updateInput(roomId, input.inputId, {
          textColor: color,
          volume: input.volume,
        });
        await handleRefreshState();
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
          console.warn('Voice: no text input selected for max lines change');
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

        let input;
        if (inputIndex !== undefined) {
          input = currentInputs[inputIndex - 1];
        } else if (selectedInputId) {
          input = currentInputs.find(
            (i: Input) => i.inputId === selectedInputId,
          );
        }

        if (!input || input.type !== 'text-input') {
          console.warn('Voice: no text input found for font size change');
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
    const onExportConfiguration = () => {
      window.dispatchEvent(new CustomEvent('smelter:export-configuration'));
    };

    window.addEventListener(
      'smelter:voice:export-configuration',
      onExportConfiguration as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:export-configuration',
        onExportConfiguration as EventListener,
      );
    };
  }, []);

  useEffect(() => {
    const onRemoveAllInputs = async () => {
      try {
        const currentInputs = inputsRef.current || [];
        for (const input of currentInputs) {
          const session = loadWhipSession();
          const isSavedInSession =
            (session &&
              session.roomId === roomId &&
              session.inputId === input.inputId) ||
            loadLastWhipInputId(roomId) === input.inputId;
          const isWhipCandidate =
            (input.inputId && input.inputId.indexOf('whip') > 0) ||
            isSavedInSession;
          if (isWhipCandidate) {
            try {
              stopCameraAndConnection(cameraPcRef, cameraStreamRef);
              stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
            } catch {}
            try {
              clearWhipSessionFor(roomId, input.inputId);
            } catch {}
            if (activeCameraInputId === input.inputId) {
              setActiveCameraInputId(null);
              setIsCameraActive(false);
            }
            if (activeScreenshareInputId === input.inputId) {
              setActiveScreenshareInputId(null);
              setIsScreenshareActive(false);
            }
          }
          try {
            await removeInput(roomId, input.inputId);
          } catch (err) {
            console.warn('Macro: failed to remove input', {
              inputId: input.inputId,
              err,
            });
          }
        }
        await handleRefreshState();
      } catch (err) {
        console.error('Macro: failed to remove all inputs', err);
      }
    };

    window.addEventListener(
      'smelter:voice:remove-all-inputs',
      onRemoveAllInputs as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:voice:remove-all-inputs',
        onRemoveAllInputs as EventListener,
      );
    };
  }, [
    roomId,
    handleRefreshState,
    inputsRef,
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
  ]);

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
          console.warn('Macro: no text input found for set text');
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
          console.warn('Voice: no text input found for scroll');
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
}
