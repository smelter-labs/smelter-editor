'use client';

import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import useSpeechToText from 'react-hook-speech-to-text';
import { Mic, MicOff, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useVoiceCommands } from '@/lib/voice';

export function SpeechToTextWithCommands() {
  const [isOpen, setIsOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastProcessedIndex = useRef(-1);

  const { inputs, lastCommand, lastError, lastClarify, handleTranscript, setInputs } =
    useVoiceCommands([]);

  const {
    error,
    interimResult,
    isRecording,
    results,
    startSpeechToText,
    stopSpeechToText,
  } = useSpeechToText({
    continuous: true,
    useLegacyResults: false,
    crossBrowser: true,
    googleApiKey: process.env.NEXT_PUBLIC_GOOGLE_SPEECH_API_KEY,
    speechRecognitionProperties: {
      interimResults: true,
      lang: 'en-US',
    },
  });

  useEffect(() => {
    if (results.length > lastProcessedIndex.current + 1) {
      for (let i = lastProcessedIndex.current + 1; i < results.length; i++) {
        const result = results[i] as { transcript: string; timestamp: number };
        handleTranscript(result.transcript);
      }
      lastProcessedIndex.current = results.length - 1;
    }
  }, [results, handleTranscript]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [results, interimResult]);

  const handleToggleRecording = () => {
    if (isRecording) {
      stopSpeechToText();
    } else {
      startSpeechToText();
      setIsOpen(true);
    }
  };

  const handleClose = () => {
    if (isRecording) {
      stopSpeechToText();
    }
    setIsOpen(false);
  };

  const handleManualSubmit = () => {
    const text = manualInput.trim();
    if (text) {
      handleTranscript(text);
      setManualInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualSubmit();
    }
  };

  const reversedResults = [...results].reverse();

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3">
      {isOpen && (
        <div className="bg-[#141414] border border-neutral-700 p-4 w-[400px] max-h-[400px]">
          <div className="flex items-center justify-between mb-3 border-b border-neutral-700 pb-3">
            <div className="flex items-center gap-2">
              {isRecording && (
                <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              )}
              <span className="text-sm text-neutral-400">
                {isRecording ? 'Listening...' : 'Voice Commands'}
              </span>
            </div>
            <Button variant="ghost" size="icon" className="size-6" onClick={handleClose}>
              <X className="size-4" />
            </Button>
          </div>

          {error && (
            <p className="text-red-500 text-sm mb-2">
              Error: Web Speech API not available in this browser
            </p>
          )}

          {lastError && (
            <p className="text-amber-500 text-sm mb-2">⚠ {lastError}</p>
          )}

          {lastClarify && (
            <p className="text-blue-400 text-sm mb-2">❓ {lastClarify}</p>
          )}

          {lastCommand && lastCommand.intent !== 'CLARIFY' && (
            <p className="text-green-400 text-sm mb-2">
              ✓ {lastCommand.intent}
              {lastCommand.intent === 'ADD_INPUT' && ` → ${lastCommand.inputType}`}
              {lastCommand.intent === 'REMOVE_INPUT' && ` → input ${lastCommand.inputIndex}`}
              {lastCommand.intent === 'ADD_SHADER' &&
                ` → ${lastCommand.shader} on input ${lastCommand.inputIndex}`}
              {lastCommand.intent === 'REMOVE_SHADER' &&
                ` → ${lastCommand.shader} from input ${lastCommand.inputIndex}`}
              {lastCommand.intent === 'MOVE_INPUT' &&
                ` → input ${lastCommand.inputIndex} ${lastCommand.direction.toLowerCase()}${lastCommand.steps && lastCommand.steps > 1 ? ` by ${lastCommand.steps}` : ''}`}
            </p>
          )}

          <div className="flex gap-2 mb-3">
            <input
              ref={inputRef}
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type command..."
              className="flex-1 bg-neutral-800 border border-neutral-600 rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={handleManualSubmit}
              disabled={!manualInput.trim()}
            >
              <Send className="size-4" />
            </Button>
          </div>

          <div className="text-xs text-neutral-500 mb-2 space-y-1">
            <div>Inputs: {inputs.length}</div>
            {inputs.map((inp, i) => (
              <div key={inp.id} className="ml-2">
                [{i + 1}] {inp.type}
                {inp.shaders.length > 0 && (
                  <span className="text-neutral-400 ml-1">
                    ({inp.shaders.map((s) => s.toLowerCase()).join(', ')})
                  </span>
                )}
              </div>
            ))}
          </div>

          <div ref={scrollRef} className="overflow-y-auto max-h-[200px] space-y-2">
            {interimResult && (
              <p className="text-neutral-500 text-sm italic">{interimResult}</p>
            )}
            {reversedResults.map((result) => (
              <p
                key={(result as { timestamp: number }).timestamp}
                className="text-neutral-200 text-sm"
              >
                {(result as { transcript: string }).transcript}
              </p>
            ))}
            {results.length === 0 && !interimResult && !error && (
              <p className="text-neutral-600 text-sm">
                {isRecording ? 'Say a command...' : 'Click mic to start'}
              </p>
            )}
          </div>
        </div>
      )}

      <Button
        onClick={handleToggleRecording}
        size="icon"
        className={cn(
          'size-12 border border-neutral-700 transition-all',
          isRecording
            ? 'bg-red-500 hover:bg-red-600 animate-pulse border-red-500'
            : 'bg-[#141414] hover:bg-[#1a1a1a]',
        )}
      >
        {isRecording ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </Button>
    </div>
  );
}
