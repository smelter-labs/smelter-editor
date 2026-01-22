'use client';

import { useState, useRef, useEffect } from 'react';
import useSpeechToText from 'react-hook-speech-to-text';
import { Mic, MicOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SpeechToText() {
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    speechRecognitionProperties: {
      interimResults: true,
    },
  });

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

  const reversedResults = [...results].reverse();

  return (
    <div className='fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3'>
      {isOpen && (
        <div className='bg-[#141414] border border-neutral-700 p-4 w-[400px] max-h-[300px]'>
          <div className='flex items-center justify-between mb-3 border-b border-neutral-700 pb-3'>
            <div className='flex items-center gap-2'>
              {isRecording && (
                <span className='size-2 rounded-full bg-red-500 animate-pulse' />
              )}
              <span className='text-sm text-neutral-400'>
                {isRecording ? 'Nagrywanie...' : 'Rozpoznawanie mowy'}
              </span>
            </div>
            <Button
              variant='ghost'
              size='icon'
              className='size-6'
              onClick={handleClose}>
              <X className='size-4' />
            </Button>
          </div>

          {error && (
            <p className='text-red-500 text-sm mb-2'>
              Błąd: Web Speech API nie jest dostępne w tej przeglądarce
            </p>
          )}

          <div
            ref={scrollRef}
            className='overflow-y-auto max-h-[200px] space-y-2'>
            {interimResult && (
              <p className='text-neutral-500 text-sm italic'>{interimResult}</p>
            )}
            {reversedResults.map((result) => (
              <p
                key={(result as { timestamp: number }).timestamp}
                className='text-neutral-200 text-sm'>
                {(result as { transcript: string }).transcript}
              </p>
            ))}
            {results.length === 0 && !interimResult && !error && (
              <p className='text-neutral-600 text-sm'>
                {isRecording
                  ? 'Mów coś...'
                  : 'Kliknij mikrofon, aby rozpocząć nagrywanie'}
              </p>
            )}
          </div>
        </div>
      )}

      <Button
        onClick={handleToggleRecording}
        size='icon'
        className={cn(
          'size-12 border border-neutral-700 transition-all',
          isRecording
            ? 'bg-red-500 hover:bg-red-600 animate-pulse border-red-500'
            : 'bg-[#141414] hover:bg-[#1a1a1a]',
        )}>
        {isRecording ? (
          <MicOff className='size-5' />
        ) : (
          <Mic className='size-5' />
        )}
      </Button>
    </div>
  );
}
