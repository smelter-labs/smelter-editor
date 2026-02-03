'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { parseCommand } from './parseCommand';
import { validateCommand, type VoiceCommand } from './commandTypes';
import {
  findMatchingMacro,
  executeMacro,
  type MacroExecutionCallbacks,
} from './macroExecutor';
import type { MacroDefinition } from './macroTypes';

export type UseVoiceCommandsOptions = {
  mp4Files?: string[];
  imageFiles?: string[];
};

export type UseVoiceCommandsResult = {
  lastCommand: VoiceCommand | null;
  lastError: string | null;
  lastClarify: string | null;
  lastTranscript: string | null;
  isTypingMode: boolean;
  isMacroMode: boolean;
  isExecutingMacro: boolean;
  activeMacro: MacroDefinition | null;
  handleTranscript: (text: string) => void;
};

type EmitContext = {
  mp4Files: string[];
  imageFiles: string[];
};

function emitVoiceEvent(command: VoiceCommand, ctx: EmitContext) {
  switch (command.intent) {
    case 'ADD_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-input', {
          detail: {
            inputType: command.inputType,
            mp4FileName: command.mp4FileName || ctx.mp4Files[0],
            imageFileName: command.imageFileName || ctx.imageFiles[0],
          },
        }),
      );
      break;
    case 'REMOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-input', {
          detail: { inputIndex: command.inputIndex },
        }),
      );
      break;
    case 'MOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:move-input', {
          detail: {
            inputIndex: command.inputIndex,
            direction: command.direction.toLowerCase(),
            steps: command.steps ?? 1,
          },
        }),
      );
      break;
    case 'ADD_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-shader', {
          detail: {
            inputIndex: command.inputIndex,
            shader: command.shader,
            targetColor: command.targetColor,
          },
        }),
      );
      break;
    case 'REMOVE_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-shader', {
          detail: { inputIndex: command.inputIndex, shader: command.shader },
        }),
      );
      break;
    case 'SELECT_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:select-input', {
          detail: { inputIndex: command.inputIndex },
        }),
      );
      break;
    case 'DESELECT_INPUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:deselect-input'));
      break;
    case 'START_TYPING':
      window.dispatchEvent(new CustomEvent('smelter:voice:start-typing'));
      break;
    case 'STOP_TYPING':
      window.dispatchEvent(new CustomEvent('smelter:voice:stop-typing'));
      break;
    case 'START_ROOM':
      window.dispatchEvent(new CustomEvent('smelter:voice:start-room'));
      break;
    case 'NEXT_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:next-layout'));
      break;
    case 'PREVIOUS_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:previous-layout'));
      break;
    case 'SET_TEXT_COLOR':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-color', {
          detail: { color: command.color },
        }),
      );
      break;
    case 'SET_TEXT_MAX_LINES':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-max-lines', {
          detail: { maxLines: command.maxLines },
        }),
      );
      break;
    case 'EXPORT_CONFIGURATION':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:export-configuration'),
      );
      break;
  }
}

const STOP_TYPING_PATTERN =
  /\b(stop typing|end typing|stop dictation|end dictation|finish typing)\b/i;
const START_MACRO_PATTERN = /\b(start macro|begin macro|macro mode)\b/i;
const END_MACRO_PATTERN = /\b(end macro|stop macro|cancel macro|exit macro)\b/i;

export function useVoiceCommands(
  options: UseVoiceCommandsOptions = {},
): UseVoiceCommandsResult {
  const { mp4Files = [], imageFiles = [] } = options;
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastClarify, setLastClarify] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [isMacroMode, setIsMacroMode] = useState(false);
  const [isExecutingMacro, setIsExecutingMacro] = useState(false);
  const [activeMacro, setActiveMacro] = useState<MacroDefinition | null>(null);
  const isTypingModeRef = useRef(false);
  const isMacroModeRef = useRef(false);
  const mp4FilesRef = useRef(mp4Files);
  const imageFilesRef = useRef(imageFiles);

  useEffect(() => {
    mp4FilesRef.current = mp4Files;
  }, [mp4Files]);

  useEffect(() => {
    imageFilesRef.current = imageFiles;
  }, [imageFiles]);

  const handleTranscript = useCallback((text: string) => {
    setLastTranscript(text);
    setLastError(null);
    setLastClarify(null);

    try {
      if (isTypingModeRef.current) {
        if (STOP_TYPING_PATTERN.test(text.toLowerCase())) {
          isTypingModeRef.current = false;
          setIsTypingMode(false);
          setLastCommand({ intent: 'STOP_TYPING' });
          window.dispatchEvent(new CustomEvent('smelter:voice:stop-typing'));
          return;
        }

        window.dispatchEvent(
          new CustomEvent('smelter:voice:append-text', {
            detail: { text },
          }),
        );
        return;
      }

      if (START_MACRO_PATTERN.test(text.toLowerCase())) {
        isMacroModeRef.current = true;
        setIsMacroMode(true);
        setActiveMacro(null);
        window.dispatchEvent(
          new CustomEvent('smelter:voice:macro-mode-started'),
        );
        return;
      }

      if (isMacroModeRef.current) {
        if (END_MACRO_PATTERN.test(text.toLowerCase())) {
          isMacroModeRef.current = false;
          setIsMacroMode(false);
          setActiveMacro(null);
          window.dispatchEvent(
            new CustomEvent('smelter:voice:macro-mode-ended'),
          );
          return;
        }

        const matchedMacro = findMatchingMacro(text);
        if (matchedMacro) {
          isMacroModeRef.current = false;
          setIsMacroMode(false);
          setActiveMacro(matchedMacro);
          setIsExecutingMacro(true);

          const callbacks: MacroExecutionCallbacks = {
            onStepStart: (step, index, total) => {
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-step-start', {
                  detail: { step, index, total, macro: matchedMacro },
                }),
              );
            },
            onStepComplete: (step, index, total) => {
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-step-complete', {
                  detail: { step, index, total, macro: matchedMacro },
                }),
              );
            },
            onMacroComplete: (macro) => {
              setIsExecutingMacro(false);
              setActiveMacro(null);
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-complete', {
                  detail: { macro },
                }),
              );
            },
            onError: (error, step, index) => {
              setIsExecutingMacro(false);
              setLastError(
                `Macro error at step ${index + 1}: ${error.message}`,
              );
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-error', {
                  detail: {
                    error: error.message,
                    step,
                    index,
                    macro: matchedMacro,
                  },
                }),
              );
            },
          };

          executeMacro(matchedMacro, callbacks).catch((err) => {
            setIsExecutingMacro(false);
            setLastError(
              err instanceof Error ? err.message : 'Macro execution failed',
            );
          });

          return;
        }

        setLastError(
          `No macro found for: "${text}". Say the macro trigger or "end macro" to cancel.`,
        );
        return;
      }

      const parsed = parseCommand(text, {
        mp4Files: mp4FilesRef.current,
        imageFiles: imageFilesRef.current,
      });

      if (!parsed) {
        setLastError(`Could not understand: "${text}"`);
        return;
      }

      const validated = validateCommand(parsed);
      if (!validated) {
        setLastError('Invalid command structure');
        return;
      }

      setLastCommand(validated);

      const emitCtx = {
        mp4Files: mp4FilesRef.current,
        imageFiles: imageFilesRef.current,
      };
      if (validated.intent === 'CLARIFY') {
        setLastClarify(validated.question);
      } else if (validated.intent === 'START_TYPING') {
        isTypingModeRef.current = true;
        setIsTypingMode(true);
        emitVoiceEvent(validated, emitCtx);
      } else {
        emitVoiceEvent(validated, emitCtx);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  return {
    lastCommand,
    lastError,
    lastClarify,
    lastTranscript,
    isTypingMode,
    isMacroMode,
    isExecutingMacro,
    activeMacro,
    handleTranscript,
  };
}
