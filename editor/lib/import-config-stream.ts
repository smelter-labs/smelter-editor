import type {
  ImportConfigRequest,
  ImportConfigProgressEvent,
  ImportConfigDoneEvent,
  ImportConfigStreamEvent,
} from '@smelter-editor/types';

const SERVER_URL =
  process.env.NEXT_PUBLIC_SMELTER_SERVER_URL?.replace(/\/$/, '') ?? '';

type ImportConfigProgress = {
  onProgress: (event: ImportConfigProgressEvent) => void;
};

export async function streamImportConfig(
  roomId: string,
  body: ImportConfigRequest,
  callbacks: ImportConfigProgress,
): Promise<ImportConfigDoneEvent> {
  const url = `${SERVER_URL}/room/${encodeURIComponent(roomId)}/import-config`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Import config request failed (${response.status}): ${text}`,
    );
  }

  if (!response.body) {
    throw new Error('No response body from import-config endpoint');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let doneEvent: ImportConfigDoneEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event: ImportConfigStreamEvent = JSON.parse(trimmed);
        if ('done' in event && event.done) {
          doneEvent = event;
        } else {
          callbacks.onProgress(event as ImportConfigProgressEvent);
        }
      } catch {
        console.warn('[import-config-stream] Failed to parse line:', trimmed);
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    try {
      const event: ImportConfigStreamEvent = JSON.parse(buffer.trim());
      if ('done' in event && event.done) {
        doneEvent = event;
      }
    } catch {
      console.warn(
        '[import-config-stream] Failed to parse final buffer:',
        buffer,
      );
    }
  }

  if (!doneEvent) {
    throw new Error('Import config stream ended without a done event');
  }

  return doneEvent;
}
