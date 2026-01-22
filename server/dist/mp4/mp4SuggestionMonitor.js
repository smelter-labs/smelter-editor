"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
class Mp4SuggestionMonitor {
    constructor() {
        const mp4sDir = node_path_1.default.resolve(process.cwd(), 'mp4s');
        let files = [];
        try {
            files = fs_extra_1.default.readdirSync(mp4sDir);
        }
        catch {
            files = [];
        }
        this.mp4Files = files.filter(f => f.toLowerCase().endsWith('.mp4'));
    }
}
const mp4SuggestionsMonitor = new Mp4SuggestionMonitor();
exports.default = mp4SuggestionsMonitor;
