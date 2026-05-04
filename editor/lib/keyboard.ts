export function shouldIgnoreGlobalShortcut(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName.toUpperCase();

  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (isEditableElement(target)) {
    return true;
  }

  let current: Element | null = target.parentElement;
  while (current) {
    if (isEditableElement(current)) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

function isEditableElement(element: Element): boolean {
  if (element instanceof HTMLElement) {
    if (element.isContentEditable) {
      return true;
    }
    if (element.contentEditable === 'true') {
      return true;
    }
  }
  const maybe = element as { contentEditable?: string };
  return maybe.contentEditable === 'true';
}
