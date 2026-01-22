'use client';

import { useState, useCallback } from 'react';
import { parseCommand } from './parseCommand';
import { dispatchCommand, type DispatchResult } from './dispatchCommand';
import { validateCommand, type VoiceCommand, type VoiceInput } from './commandTypes';

export type UseVoiceCommandsResult = {
  inputs: VoiceInput[];
  lastCommand: VoiceCommand | null;
  lastError: string | null;
  lastClarify: string | null;
  handleTranscript: (text: string) => void;
  setInputs: (inputs: VoiceInput[]) => void;
};

export function useVoiceCommands(initialInputs: VoiceInput[] = []): UseVoiceCommandsResult {
  const [inputs, setInputs] = useState<VoiceInput[]>(initialInputs);
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastClarify, setLastClarify] = useState<string | null>(null);

  const handleTranscript = useCallback(
    (text: string) => {
      setLastError(null);
      setLastClarify(null);

      try {
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

        const result: DispatchResult = dispatchCommand(validated, inputs);

        if (result.success) {
          setInputs(result.inputs);
        } else if ('clarify' in result) {
          setLastClarify(result.clarify.question);
        }
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [inputs],
  );

  return {
    inputs,
    lastCommand,
    lastError,
    lastClarify,
    handleTranscript,
    setInputs,
  };
}
