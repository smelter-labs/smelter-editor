/**
 * One shared ticker for every mounted puppet, instead of a private interval
 * per component. Subscribers run in a single burst, so when several puppets
 * change pose in the same window their forced renders collapse into one
 * React commit per root — and smelter-core's per-output throttle then sends
 * one scene update instead of six.
 *
 * The tick itself is cheap pure math (pose-key checks); a subscriber only
 * calls setState when its quantized pose actually changed.
 */
export const PUPPET_CHECK_MS = 50;

const subscribers = new Set<() => void>();
let timer: NodeJS.Timeout | null = null;

export function subscribePuppetTick(cb: () => void): () => void {
  subscribers.add(cb);
  if (timer == null) {
    timer = setInterval(() => {
      for (const sub of [...subscribers]) sub();
    }, PUPPET_CHECK_MS);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
