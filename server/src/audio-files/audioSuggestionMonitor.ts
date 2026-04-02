import path from 'node:path';
import fs from 'fs-extra';
import { DATA_DIR } from '../dataDir';

export interface FolderListing {
  files: string[];
  folders: string[];
}

class AudioSuggestionMonitor {
  public audioFiles: string[];
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.resolve(DATA_DIR, 'audios');
    this.audioFiles = this.scanAllFiles();
  }

  refresh(): void {
    this.audioFiles = this.scanAllFiles();
  }

  listFolder(subPath?: string): FolderListing {
    const dir = subPath ? path.join(this.baseDir, subPath) : this.baseDir;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return { files: [], folders: [] };
    }

    const files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp4'))
      .map((e) => e.name);

    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);

    return { files, folders };
  }

  private scanAllFiles(dir?: string, prefix?: string): string[] {
    const target = dir ?? this.baseDir;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
      return [];
    }

    const result: string[] = [];
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        result.push(rel);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        result.push(...this.scanAllFiles(path.join(target, entry.name), rel));
      }
    }
    return result;
  }
}

const audioSuggestionsMonitor = new AudioSuggestionMonitor();
export default audioSuggestionsMonitor;
