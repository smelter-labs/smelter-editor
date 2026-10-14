/**
 * Put a freshly created room in the address bar (so a refresh rejoins it)
 * once the server action the caller just awaited has left Next's router
 * queue. Call it right after that action and BEFORE any state that makes
 * room-bound hooks start sending server actions of their own.
 *
 * Next patches `history.replaceState` to dispatch a router restore. A server
 * action's promise resolves a few microtasks before the router's action
 * queue lets go of it, so a rewrite issued straight after the `await` still
 * finds that action pending. The queue discards it but keeps `last` pointing
 * at the discarded node (app-router-instance.js, Next 15.4), so every server
 * action dispatched until the restore lands is chained to a dead node: it is
 * never sent and its promise never settles. One macrotask later the awaited
 * action is gone, the restore becomes the queue's tail, and whatever is
 * dispatched next simply runs after it.
 */
export async function rewriteRoomUrl(path: string): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  window.history.replaceState(null, '', path);
}
