export const captionsDebug = process.env.CAPTIONS_DEBUG === '1';

export function captionDebug(...args: unknown[]): void {
  if (captionsDebug) {
    console.log('[captions:debug]', ...args);
  }
}

/** Structured trace — always logged at info for caption pipeline diagnosis. */
export function captionTrace(step: string, data?: Record<string, unknown>): void {
  if (data === undefined) {
    console.log(`[captions:trace] ${step}`);
    return;
  }
  console.log(`[captions:trace] ${step}`, data);
}
