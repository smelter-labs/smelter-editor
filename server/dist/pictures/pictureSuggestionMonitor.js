"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const fs_extra_1 = __importDefault(require("fs-extra"));
class PictureSuggestionMonitor {
    constructor() {
        const picturesDir = node_path_1.default.resolve(process.cwd(), 'pictures');
        let files = [];
        try {
            files = fs_extra_1.default.readdirSync(picturesDir);
        }
        catch {
            files = [];
        }
        const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
        this.pictureFiles = files.filter(f => exts.some(ext => f.toLowerCase().endsWith(ext)));
    }
}
const pictureSuggestionsMonitor = new PictureSuggestionMonitor();
exports.default = pictureSuggestionsMonitor;
