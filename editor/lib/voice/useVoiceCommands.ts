'use client';

import { useState, useCallback, useRef } from 'react';
import { parseCommand } from './parseCommand';
import { validateCommand, type VoiceCommand } from './commandTypes';

export type UseVoiceCommandsResult = {
  lastCommand: VoiceCommand | null;
  lastError: string | null;
  lastClarify: string | null;
  lastTranscript: string | null;
  isTypingMode: boolean;
  handleTranscript: (text: string) => void;
};

function emitVoiceEvent(command: VoiceCommand) {
  switch (command.intent) {
    case 'ADD_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-input', {
          detail: { inputType: command.inputType },
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
          detail: { inputIndex: command.inputIndex, shader: command.shader, targetColor: command.targetColor },
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
      window.dispatchEvent(new CustomEvent('smelter:voice:export-configuration'));
      break;
  }
}

const STOP_TYPING_PATTERN = /\b(stop typing|end typing|stop dictation|end dictation|finish typing)\b/i;

export function useVoiceCommands(): UseVoiceCommandsResult {
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastClarify, setLastClarify] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [isTypingMode, setIsTypingMode] = useState(false);
  const isTypingModeRef = useRef(false);

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

      const parsed = parseCommand(text);

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

      if (validated.intent === 'CLARIFY') {
        setLastClarify(validated.question);
      } else if (validated.intent === 'START_TYPING') {
        isTypingModeRef.current = true;
        setIsTypingMode(true);
        emitVoiceEvent(validated);
      } else {
        emitVoiceEvent(validated);
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
    handleTranscript,
  };
}
