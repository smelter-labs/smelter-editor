export function formatDate(value: number | string): string {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse user-typed duration text into milliseconds.
 * Accepts "mm:ss", "hh:mm:ss", or a plain number (treated as seconds).
 * Returns null when the input cannot be parsed.
 */
export function parseDurationInput(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length === 2) {
    const [min, sec] = parts.map(Number);
    if (Number.isFinite(min) && Number.isFinite(sec) && min >= 0 && sec >= 0) {
      return (min * 60 + sec) * 1000;
    }
    return null;
  }
  if (parts.length === 3) {
    const [hr, min, sec] = parts.map(Number);
    if (
      Number.isFinite(hr) &&
      Number.isFinite(min) &&
      Number.isFinite(sec) &&
      hr >= 0 &&
      min >= 0 &&
      sec >= 0
    ) {
      return (hr * 3600 + min * 60 + sec) * 1000;
    }
    return null;
  }

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1000;
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
