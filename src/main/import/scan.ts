import type { Dirent } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { ImportFormat } from '../../shared/import';

export type MediaKind = 'image' | 'video' | 'audio';

const MEDIA: Record<string, MediaKind> = {};
for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'webp', 'avif'])
  MEDIA[ext] = 'image';
for (const ext of ['mp4', 'm4v', 'mov', 'qt', 'avi', 'wmv', 'mkv', 'mpg', 'mpeg', 'webm', 'mts', 'm2ts'])
  MEDIA[ext] = 'video';
for (const ext of ['mp3', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma'])
  MEDIA[ext] = 'audio';

const PP6 = new Set(['pro6', 'pro6x', 'pro6pl', 'pro6plx', 'pro6template']);
const PP7 = new Set(['pro', 'probundle', 'proplaylist']);
/** Clutter that operating systems leave in folders: never content. */
const IGNORED = new Set(['thumbs.db', 'desktop.ini', 'icon\r']);
const IGNORED_DIRS = new Set(['__macosx', '$recycle.bin', 'system volume information']);

export function extOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

export function mediaKindOf(path: string): MediaKind | null {
  return MEDIA[extOf(path)] ?? null;
}

export function formatOf(path: string): ImportFormat {
  const ext = extOf(path);
  if (ext === 'txt') return 'text';
  if (MEDIA[ext]) return 'media';
  if (PP6.has(ext)) return 'pp6';
  if (PP7.has(ext)) return 'pp7';
  return 'unknown';
}

export interface ScannedFile {
  path: string;
  size: number;
  format: ImportFormat;
}

export interface ScanResult {
  files: ScannedFile[];
  /** Paths that were asked for but do not exist (or cannot be read). */
  missing: { path: string; message: string }[];
  /** Lower-case file name -> paths, for every media file found (for relinking by name). */
  mediaByName: Map<string, string[]>;
  /** True when the scan stopped at the file limit. */
  truncated: boolean;
}

export interface ScanOptions {
  maxFiles?: number;
  maxDepth?: number;
  /** Folders never to enter (Drashti's own data folder). */
  skip?: (dir: string) => boolean;
}

/**
 * Every file under the given files and folders, in a stable order (each
 * root in turn, then by path). Hidden files, OS clutter and symbolic links
 * to folders are skipped. Nothing is read beyond folder listings and sizes.
 */
export async function scanPaths(paths: readonly string[], options: ScanOptions = {}): Promise<ScanResult> {
  const maxFiles = options.maxFiles ?? 100_000;
  const maxDepth = options.maxDepth ?? 16;
  const result: ScanResult = { files: [], missing: [], mediaByName: new Map(), truncated: false };
  const seen = new Set<string>();

  const addFile = (path: string, size: number) => {
    if (seen.has(path)) return;
    if (result.files.length >= maxFiles) {
      result.truncated = true;
      return;
    }
    seen.add(path);
    const format = formatOf(path);
    result.files.push({ path, size, format });
    if (format === 'media') {
      const key = basename(path).toLowerCase();
      const list = result.mediaByName.get(key) ?? [];
      list.push(path);
      result.mediaByName.set(key, list);
    }
  };

  const walk = async (dir: string, depth: number, out: { path: string; size: number }[]) => {
    if (depth > maxDepth || options.skip?.(dir)) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      const lower = name.toLowerCase();
      if (name.startsWith('.') || IGNORED.has(lower)) continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(lower) && !lower.endsWith('.app')) await walk(full, depth + 1, out);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          const s = await stat(full);
          if (s.isFile()) out.push({ path: full, size: s.size });
        } catch {
          // A broken link: nothing to import.
        }
      }
    }
  };

  for (const root of paths) {
    let info;
    try {
      info = await lstat(root);
      if (info.isSymbolicLink()) info = await stat(root);
    } catch (error) {
      result.missing.push({
        path: root,
        message: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Not found.' : String(error),
      });
      continue;
    }
    if (info.isFile()) {
      addFile(root, info.size);
    } else if (info.isDirectory()) {
      const found: { path: string; size: number }[] = [];
      await walk(root, 0, found);
      found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      for (const f of found) addFile(f.path, f.size);
    }
  }
  return result;
}
