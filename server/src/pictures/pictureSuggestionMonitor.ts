import path from 'node:path';
import fs from 'fs-extra';

export interface FolderListing {
  files: string[];
  folders: string[];
}

const PICTURE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];

function isPictureFile(name: string): boolean {
  const lower = name.toLowerCase();
  return PICTURE_EXTS.some((ext) => lower.endsWith(ext));
}

class PictureSuggestionMonitor {
  public pictureFiles: string[];
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), 'pictures');
    this.pictureFiles = this.scanAllFiles();
  }

  refresh(): void {
    this.pictureFiles = this.scanAllFiles();
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
      .filter((e) => e.isFile() && isPictureFile(e.name))
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
      if (entry.isFile() && isPictureFile(entry.name)) {
        result.push(rel);
      } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
        result.push(...this.scanAllFiles(path.join(target, entry.name), rel));
      }
    }
    return result;
  }
}

const pictureSuggestionsMonitor = new PictureSuggestionMonitor();
export default pictureSuggestionsMonitor;
