'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { formatMs, parseDurationInput } from '@/lib/format-utils';

export function EditableDuration({
  totalDurationMs,
  isPlaying,
  onChange,
}: {
  totalDurationMs: number;
  isPlaying: boolean;
  onChange: (ms: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    if (isPlaying) return;
    setDraft(formatMs(totalDurationMs));
    setEditing(true);
  }, [isPlaying, totalDurationMs]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseDurationInput(draft);
    if (parsed != null && parsed > 0) {
      onChange(parsed);
    }
  }, [draft, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(false);
      }
    },
    [commit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        className='bg-transparent border border-border rounded px-1 text-[11px] font-mono tabular-nums w-14 text-center outline-none focus:border-primary'
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:text-foreground transition-colors ${isPlaying ? 'pointer-events-none' : ''}`}
      onClick={startEditing}
      title='Click to edit total duration (mm:ss)'>
      {formatMs(totalDurationMs)}
    </span>
  );
}
