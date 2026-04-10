export function isSmelterTransportError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    code?: unknown;
    errno?: unknown;
    message?: unknown;
  };
  const code =
    typeof maybeError.code === 'string'
      ? maybeError.code
      : typeof maybeError.errno === 'string'
        ? maybeError.errno
        : '';
  const message =
    typeof maybeError.message === 'string'
      ? maybeError.message.toLowerCase()
      : '';

  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE' ||
    message.includes('socket hang up') ||
    message.includes('network socket disconnected') ||
    message.includes('connect econnrefused')
  );
}
