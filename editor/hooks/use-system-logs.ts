'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface LogEntry {
  timestamp: string;
  level: 'LOG' | 'ERR' | 'WRN' | 'OUT' | 'REQ';
  message: string;
}

const MAX_LOG_ENTRIES = 500;

export function useSystemLogs(): {
  logs: LogEntry[];
  clearLogs: () => void;
} {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/logs/sse');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => {
          const next = [...prev, entry];
          return next.length > MAX_LOG_ENTRIES
            ? next.slice(next.length - MAX_LOG_ENTRIES)
            : next;
        });
      } catch {
        // ignore malformed events
      }
    };

    es.addEventListener('batch', (event) => {
      try {
        const batch = JSON.parse(
          (event as MessageEvent).data,
        ) as LogEntry[];
        setLogs((prev) => {
          const merged = [...prev, ...batch];
          return merged.length > MAX_LOG_ENTRIES
            ? merged.slice(merged.length - MAX_LOG_ENTRIES)
            : merged;
        });
      } catch {
        // ignore malformed batch
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects on error
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  return { logs, clearLogs };
}
