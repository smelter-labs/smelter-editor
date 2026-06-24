export const captionsDebug = process.env.CAPTIONS_DEBUG === '1';

export function captionDebug(...args: unknown[]): void {
  if (captionsDebug) {
    console.log('[captions:debug]', ...args);
  }
}
