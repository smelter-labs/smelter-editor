/**
 * The host pushes its live knobs (perf / director / AI / minimap / replay) to
 * the room whenever they change. Only the sections that actually changed go
 * out: re-sending the whole set would revert what the moderator toggled from
 * the panel (REPLAY, MINIMAP) every time the host touched an unrelated knob.
 */
export function changedSections<T extends Record<string, unknown>>(
  prev: T,
  next: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key]))
      out[key] = next[key];
  }
  return out;
}
