"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhipInputMonitor = void 0;
class WhipInputMonitor {
    constructor(username) {
        this.isStreamLive = true;
        this.lastAckTimestamp = Date.now();
        this.username = username;
    }
    static async startMonitor(username) {
        return new WhipInputMonitor(username);
    }
    getLastAckTimestamp() {
        return this.lastAckTimestamp;
    }
    isLive() {
        return this.isStreamLive;
    }
    touch() {
        this.lastAckTimestamp = Date.now();
        console.log(`[whip] Touch ${this.username}`);
    }
}
exports.WhipInputMonitor = WhipInputMonitor;
