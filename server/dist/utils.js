"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.spawn = spawn;
exports.sleep = sleep;
exports.isProcessRunning = isProcessRunning;
exports.ensureProcessKill = ensureProcessKill;
const node_child_process_1 = require("node:child_process");
function spawn(command, args, options) {
    console.log('spawn', command, args);
    const child = (0, node_child_process_1.spawn)(command, args, {
        stdio: 'inherit',
        ...options,
    });
    let stdout = [];
    let stderr = [];
    const promise = new Promise((res, rej) => {
        var _a, _b;
        child.on('error', err => {
            rej(err);
        });
        child.on('exit', code => {
            if (code === 0) {
                res({ stdout: stdout.join('\n'), stderr: stderr.join('\n') });
            }
            else {
                let err = new Error(`Command "${command} ${args.join(' ')}" failed with exit code ${code}.`);
                err.stdout = stdout.length > 0 ? stdout.join('\n') : undefined;
                err.stderr = stderr.length > 0 ? stderr.join('\n') : undefined;
                rej(err);
            }
        });
        (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', chunk => {
            if (stdout.length >= 100) {
                stdout.shift();
            }
            stdout.push(chunk.toString());
        });
        (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', chunk => {
            if (stderr.length >= 100) {
                stderr.shift();
            }
            stderr.push(chunk.toString());
        });
    });
    promise.child = child;
    return promise;
}
function sleep(timeoutMs) {
    return new Promise(res => {
        setTimeout(() => res(), timeoutMs);
    });
}
function isProcessRunning(pid) {
    try {
        return process.kill(pid, 0);
    }
    catch (e) {
        return e.code === 'EPERM';
    }
}
async function ensureProcessKill(pid) {
    if (!isProcessRunning(pid)) {
        return;
    }
    try {
        process.kill(pid);
    }
    catch (err) {
        console.log(err);
    }
    let startMs = Date.now();
    while (Date.now() - startMs < 3000) {
        if (!isProcessRunning(pid)) {
            return;
        }
        await sleep(200);
    }
    try {
        process.kill(pid, 'SIGKILL');
    }
    catch (err) {
        console.log(err);
    }
    while (Date.now() - startMs < 5000) {
        if (!isProcessRunning(pid)) {
            return;
        }
        await sleep(200);
    }
    throw new Error('Unable to kill process');
}
