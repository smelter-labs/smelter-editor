import { execFileSync } from 'node:child_process';

// A stale copy of this server (e.g. left behind by a background task or a
// crashed shell) keeps holding the fixed ports (3001, 8082, 8083+) and every
// new `pnpm start` dies with EADDRINUSE. Kill leftover instances up front.
// The command must END with the entrypoint path — a substring check also
// matches unrelated shells that merely quote these strings in their argv.
const STALE_CMD_RE = /ts-node.*[ /]src\/index\.ts$/;

// AI sidecar workers orphaned by a previous server (crash or a shutdown path
// that skipped killing them). They loop reconnecting to the sidecar WS ports
// forever and, with inherited stdio, spam whatever terminal spawned them.
const STALE_WORKER_RE = /[ /]src\/ai-models\/[^ ]+\/worker\.py$/;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findStaleServerPids(): number[] {
  const out = execFileSync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
  });
  const pids: number[] = [];
  for (const line of out.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const cmd = match[2].trimEnd();
    // Skip ourselves and our own `sh -c ... ts-node ./src/index.ts` wrapper.
    if (pid === process.pid || pid === process.ppid) continue;
    if (STALE_CMD_RE.test(cmd) || STALE_WORKER_RE.test(cmd)) {
      pids.push(pid);
    }
  }
  return pids;
}

export async function killStaleServerInstances(): Promise<void> {
  if (process.platform === 'win32') return;
  let stale: number[];
  try {
    stale = findStaleServerPids();
  } catch (err) {
    console.warn('[startup] stale-instance check failed:', err);
    return;
  }
  if (stale.length === 0) return;

  console.warn(
    `[startup] killing ${stale.length} stale server instance(s): ${stale.join(', ')}`,
  );
  for (const pid of stale) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!stale.some(isAlive)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const pid of stale.filter(isAlive)) {
    console.warn(`[startup] pid ${pid} ignored SIGTERM — sending SIGKILL`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
