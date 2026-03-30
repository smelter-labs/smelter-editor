'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useSystemLogs, type LogEntry } from '@/hooks/use-system-logs';

const LOG_LEVELS = ['LOG', 'ERR', 'WRN', 'OUT', 'REQ'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_COLORS: Record<LogLevel, string> = {
  LOG: 'text-[#bded00]',
  ERR: 'text-red-500',
  WRN: 'text-[#fe00fe]',
  OUT: 'text-[#00f3ff]',
  REQ: 'text-[#00f3ff]',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  LOG: 'LOG',
  ERR: 'ERR',
  WRN: 'WARN',
  OUT: 'INFO',
  REQ: 'REQ',
};

const FILTER_CHIP_ACTIVE: Record<LogLevel, string> = {
  LOG: 'bg-[#bded00]/20 border-[#bded00]/60 text-[#bded00]',
  ERR: 'bg-red-500/20 border-red-500/60 text-red-400',
  WRN: 'bg-[#fe00fe]/20 border-[#fe00fe]/60 text-[#fe00fe]',
  OUT: 'bg-[#00f3ff]/20 border-[#00f3ff]/60 text-[#00f3ff]',
  REQ: 'bg-[#00f3ff]/10 border-[#00f3ff]/40 text-[#00f3ff]/80',
};

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <p>
      <span className='text-[#849495]'>{entry.timestamp}</span>{' '}
      <span className={LEVEL_COLORS[entry.level]}>
        [{LEVEL_LABELS[entry.level]}]
      </span>{' '}
      <span className='text-[#b9cacb]'>{entry.message}</span>
    </p>
  );
}

function formatLogsAsText(logs: LogEntry[]): string {
  return logs
    .map((e) => `${e.timestamp} [${LEVEL_LABELS[e.level]}] ${e.message}`)
    .join('\n');
}

function PauseIcon() {
  return (
    <svg width='10' height='10' viewBox='0 0 10 10' fill='currentColor'>
      <rect x='1.5' y='1' width='2.5' height='8' rx='0.5' />
      <rect x='6' y='1' width='2.5' height='8' rx='0.5' />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width='10' height='10' viewBox='0 0 10 10' fill='currentColor'>
      <polygon points='2,1 9,5 2,9' />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width='10' height='10' viewBox='0 0 10 10' fill='none' stroke='currentColor' strokeWidth='1'>
      <rect x='3' y='3' width='6' height='6' rx='0.5' />
      <path d='M7 3V1.5a.5.5 0 00-.5-.5H1.5a.5.5 0 00-.5.5v5a.5.5 0 00.5.5H3' />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width='10' height='10' viewBox='0 0 10 10' fill='none' stroke='currentColor' strokeWidth='1.5'>
      <polyline points='2,5 4.5,7.5 8,2.5' />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width='10' height='10' viewBox='0 0 10 10' fill='none' stroke='currentColor' strokeWidth='1'>
      <circle cx='4.5' cy='4.5' r='3' />
      <line x1='6.8' y1='6.8' x2='9' y2='9' />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width='8' height='8' viewBox='0 0 8 8' fill='none' stroke='currentColor' strokeWidth='1.2'>
      <polyline points='1.5,3 4,5.5 6.5,3' />
    </svg>
  );
}

const COPY_LAST_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;

function CopyLastDropdown({
  filteredLogs,
}: {
  filteredLogs: LogEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleCopyLast = useCallback(
    async (n: number) => {
      const slice = filteredLogs.slice(-n);
      const text = formatLogsAsText(slice);
      await navigator.clipboard.writeText(text);
      setFeedback(n);
      setTimeout(() => {
        setFeedback(null);
        setOpen(false);
      }, 800);
    },
    [filteredLogs],
  );

  return (
    <div ref={containerRef} className='relative'>
      <button
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-0.5 transition-colors cursor-pointer uppercase tracking-wider ${
          open
            ? 'text-[#b9cacb]'
            : 'text-[#849495] hover:text-[#b9cacb]'
        }`}>
        <CopyIcon />
        Copy Last
        <ChevronDownIcon />
      </button>
      {open && (
        <div className='absolute right-0 top-full mt-1 z-50 bg-[#111] border border-[#3a494b]/40 shadow-lg shadow-black/50'>
          {COPY_LAST_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => handleCopyLast(n)}
              disabled={feedback !== null}
              className={`block w-full text-left px-3 py-1 text-[10px] uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap ${
                feedback === n
                  ? 'text-[#bded00] bg-[#bded00]/10'
                  : 'text-[#849495] hover:text-[#b9cacb] hover:bg-[#ffffff08]'
              }`}>
              {feedback === n ? (
                <span className='flex items-center gap-1'>
                  <CheckIcon /> Copied {Math.min(n, filteredLogs.length)}
                </span>
              ) : (
                `Last ${n} lines`
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemLogPanel() {
  const { logs, clearLogs } = useSystemLogs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeFilters, setActiveFilters] = useState<Set<LogLevel>>(
    () => new Set(LOG_LEVELS),
  );
  const [paused, setPaused] = useState(false);
  const [pausedSnapshot, setPausedSnapshot] = useState<LogEntry[]>([]);
  const pausedAtCountRef = useRef(0);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      if (!prev) {
        setPausedSnapshot(logs);
        pausedAtCountRef.current = logs.length;
      }
      return !prev;
    });
  }, [logs]);

  const activeLogs = paused ? pausedSnapshot : logs;

  const filteredLogs = useMemo(() => {
    let result = activeLogs.filter((entry) => activeFilters.has(entry.level));
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((entry) =>
        entry.message.toLowerCase().includes(query),
      );
    }
    return result;
  }, [activeLogs, activeFilters, searchQuery]);

  const newLogsSincePause = paused ? logs.length - pausedAtCountRef.current : 0;

  const toggleFilter = useCallback((level: LogLevel) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        if (next.size <= 1) return prev;
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current || paused) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filteredLogs.length, autoScroll, paused]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const handleCopy = useCallback(async () => {
    const text = formatLogsAsText(filteredLogs);
    await navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, [filteredLogs]);

  return (
    <div className='flex flex-col h-full font-mono text-[10px] bg-[#080808] overflow-hidden'>
      <div className='flex justify-between items-center px-3 py-1.5 text-[#b9cacb] border-b border-[#3a494b]/20 shrink-0'>
        <span className='tracking-widest uppercase'>System_Log_Feed.lnk</span>
        <div className='flex items-center gap-2'>
          <button
            onClick={handleCopy}
            title='Copy all filtered logs'
            className='text-[#849495] hover:text-[#b9cacb] transition-colors cursor-pointer flex items-center gap-1 uppercase tracking-wider'>
            {copyFeedback ? <CheckIcon /> : <CopyIcon />}
            {copyFeedback ? 'Copied' : 'Copy All'}
          </button>
          <span className='text-[#3a494b]'>|</span>
          <CopyLastDropdown filteredLogs={filteredLogs} />
          <span className='text-[#3a494b]'>|</span>
          <button
            onClick={clearLogs}
            className='text-[#849495] hover:text-[#b9cacb] transition-colors cursor-pointer uppercase tracking-wider'>
            Clear
          </button>
          <span className='text-[#3a494b]'>|</span>
          <button
            onClick={togglePause}
            title={paused ? 'Resume live logging' : 'Pause logging'}
            className={`flex items-center gap-1 transition-colors cursor-pointer uppercase tracking-wider ${
              paused
                ? 'text-amber-400 hover:text-amber-300'
                : 'text-[#849495] hover:text-[#b9cacb]'
            }`}>
            {paused ? <PlayIcon /> : <PauseIcon />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <span className='text-[#3a494b]'>|</span>
          {paused ? (
            <span className='text-amber-400 flex items-center gap-1'>
              <span className='inline-block w-1.5 h-1.5 rounded-sm bg-amber-400' />
              PAUSED
              {newLogsSincePause > 0 && (
                <span className='text-amber-400/70'>+{newLogsSincePause}</span>
              )}
            </span>
          ) : (
            <span className='text-[#bded00] flex items-center gap-1'>
              <span className='inline-block w-1.5 h-1.5 rounded-full bg-[#bded00] animate-pulse' />
              LIVE_SYNC
            </span>
          )}
        </div>
      </div>

      <div className='flex items-center gap-1 px-3 py-1 border-b border-[#3a494b]/20 shrink-0'>
        {LOG_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => toggleFilter(level)}
            className={`px-1.5 py-0.5 border text-[9px] uppercase tracking-wider transition-colors cursor-pointer ${
              activeFilters.has(level)
                ? FILTER_CHIP_ACTIVE[level]
                : 'border-[#3a494b]/30 text-[#849495]/50 hover:text-[#849495]'
            }`}>
            {LEVEL_LABELS[level]}
          </button>
        ))}
        <span className='text-[#3a494b] mx-1'>|</span>
        <div className='flex items-center gap-1 flex-1'>
          <span className='text-[#849495]'>
            <SearchIcon />
          </span>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='filter messages...'
            className='bg-transparent border-none outline-none text-[#b9cacb] placeholder-[#849495]/40 text-[10px] w-full min-w-0'
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className='text-[#849495] hover:text-[#b9cacb] cursor-pointer text-[9px] shrink-0'>
              ✕
            </button>
          )}
        </div>
        <span className='text-[#849495]/50 text-[9px] shrink-0 ml-1'>
          {filteredLogs.length} lines
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className='flex-1 overflow-y-auto px-3 py-1 space-y-px text-[#b9cacb]'>
        {filteredLogs.map((entry, i) => (
          <LogLine key={i} entry={entry} />
        ))}
        {!paused && <p className='animate-pulse text-[#b9cacb]'>_</p>}
      </div>
    </div>
  );
}
