import type { InputCard } from "../types/input";

export function areInputCardsEquivalent(
  first: InputCard[],
  second: InputCard[],
): boolean {
  if (first === second) return true;
  if (first.length !== second.length) return false;

  for (let index = 0; index < first.length; index += 1) {
    const a = first[index];
    const b = second[index];
    if (!b) return false;
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.isHidden !== b.isHidden ||
      a.nativeWidth !== b.nativeWidth ||
      a.nativeHeight !== b.nativeHeight ||
      a.isRunning !== b.isRunning ||
      a.isMuted !== b.isMuted ||
      a.inputVolume !== b.inputVolume
    ) {
      return false;
    }
  }

  return true;
}
