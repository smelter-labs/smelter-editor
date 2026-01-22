import type { ChildProcess, SpawnOptions } from 'node:child_process';
export interface SpawnPromise extends Promise<{
    stdout: string;
    stderr: string;
}> {
    child: ChildProcess;
}
export declare function spawn(command: string, args: string[], options: SpawnOptions): SpawnPromise;
export declare function sleep(timeoutMs: number): Promise<void>;
export declare function isProcessRunning(pid: number): boolean;
export declare function ensureProcessKill(pid: number): Promise<void>;
