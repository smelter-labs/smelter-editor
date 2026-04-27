export function shouldIgnoreGlobalShortcut(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const maybeTarget = target as {
    contentEditable?: string;
  };
  const tagName = target.tagName.toUpperCase();

  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (target.isContentEditable === true || maybeTarget.contentEditable === 'true') {
    return true;
  }

  let current: Element | null = target.parentElement;
  while (current) {
    const maybeCurrent = current as {
      contentEditable?: string;
    };
    if (
      current.isContentEditable === true ||
      maybeCurrent.contentEditable === 'true'
    ) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}
