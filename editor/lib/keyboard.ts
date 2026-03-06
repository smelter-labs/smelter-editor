export function shouldIgnoreGlobalShortcut(
  target: EventTarget | null,
): boolean {
  if (!target || typeof target !== 'object') {
    return false;
  }

  const maybeElement = target as {
    tagName?: string;
    isContentEditable?: boolean;
    contentEditable?: string;
  };
  const tagName = maybeElement.tagName?.toUpperCase();

  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    maybeElement.isContentEditable === true ||
    maybeElement.contentEditable === 'true'
  );
}
