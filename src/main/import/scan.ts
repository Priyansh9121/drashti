import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { isSystemFileName } from '../../shared/drop-folder';
import { captionFileInfo } from '../../shared/video-captions';
import type { ImportFormat } from '../../shared/import';
import { IMAGE_EXTENSIONS, SOUND_EXTENSIONS, VIDEO_EXTENSIONS } from '../../shared/media';
import { PICTURE_EXTENSIONS, pictureSourceOf } from '../../shared/pictures';

import { folderReadPath, OutsideImportFolder } from './folder-containment';

export type MediaKind = 'image' | 'video' | 'audio';

const MEDIA: Record<string, MediaKind> = {};
// Every picture Drashti takes (Session 55, Part 5: one list, in shared/media.ts).
for (const ext of IMAGE_EXTENSIONS) MEDIA[ext] = 'image';
// Every common video and sound FFmpeg reads (Session 50: shared/media.ts lists them).
for (const ext of VIDEO_EXTENSIONS) MEDIA[ext] = 'video';
/** Sounds Drashti imports (the Audio panel's Import offers just these, Session 44). */
export { SOUND_EXTENSIONS };
for (const ext of SOUND_EXTENSIONS) MEDIA[ext] = 'audio';

const PP6 = new Set(['pro6', 'pro6x', 'pro6pl', 'pro6plx', 'pro6template']);
const PP7 = new Set(['pro', 'probundle', 'proplaylist']);
const IGNORED_DIRS = new Set(['__macosx', '$recycle.bin', 'system volume information']);

/**
 * Every extension Drashti imports (Session 26a: the Import… menu's Files… offers just these): text and
 * Word lyrics (Session 26f), media, ProPresenter 6 and 7 files and their bundles and playlists, and PDF,
 * PowerPoint and Keynote.
 */
export function importableExtensions(): string[] {
  return ['txt', 'docx', 'drashti-kirtans', ...Object.keys(MEDIA), ...PP6, ...PP7, ...PICTURE_EXTENSIONS];
}

/**
 * What Simple Mode brings in (Session 55, Part 18; its Add files… offers just these): sounds, videos and pictures,
 * and PDF, PowerPoint and Keynote files.
 */
export function simpleImportExtensions(): string[] {
  return [...Object.keys(MEDIA), ...PICTURE_EXTENSIONS];
}

export function extOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

export function mediaKindOf(path: string): MediaKind | null {
  return MEDIA[extOf(path)] ?? null;
}

export function formatOf(path: string): ImportFormat {
  const ext = extOf(path);
  // Lyrics: a text file, or a Word document (Session 26f; formats/docx.ts).
  if (ext === 'drashti-kirtans') return 'kirtan-bundle';
  if (ext === 'txt' || ext === 'docx') return 'text';
  if (MEDIA[ext]) return 'media';
  // PDF, PowerPoint and Keynote files become pictures (Session 15).
  if (pictureSourceOf(ext)) return 'pictures';
  if (PP6.has(ext)) return 'pp6';
  if (PP7.has(ext)) return 'pp7';
  // ProPresenter 7 keeps themes and playlists in files without an extension.
  if (ext === '' && (basename(path) === 'Theme' || basename(dirname(path)) === 'Playlists')) return 'pp7';
  // ...and props in Configuration/Props.
  if (ext === '' && basename(path) === 'Props' && basename(dirname(path)) === 'Configuration') return 'pp7';
  return 'unknown';
}

export interface ScannedFile {
  path: string;
  /** Canonical chosen folder; absent for an explicit file choice. */
  folderRoot?: string;
  size: number;
  format: ImportFormat;
}

export interface ScanResult {
  files: ScannedFile[];
  /** Main-selected folders and explicit file choices, retained for referenced sources too. */
  folderRoots: Map<string, string>;
  explicitFiles: Set<string>;
  /** Paths that were asked for but do not exist (or cannot be read). */
  missing: { path: string; message: string }[];
  /** Folder entries refused at the containment boundary, named in the import report. */
  skipped: { path: string; message: string }[];
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
  const result: ScanResult = {
    files: [],
    folderRoots: new Map(),
    explicitFiles: new Set(),
    missing: [],
    skipped: [],
    mediaByName: new Map(),
    truncated: false,
  };
  const seen = new Set<string>();

  const addFile = (path: string, size: number, folderRoot?: string) => {
    if (seen.has(path)) {
      if (folderRoot === undefined) {
        const existing = result.files.find((file) => file.path === path);
        if (existing) delete existing.folderRoot;
      }
      return;
    }
    if (result.files.length >= maxFiles) {
      result.truncated = true;
      return;
    }
    seen.add(path);
    const format = formatOf(path);
    result.files.push({ path, size, format, ...(folderRoot === undefined ? {} : { folderRoot }) });
    if (format === 'media') {
      const key = basename(path).toLowerCase();
      const list = result.mediaByName.get(key) ?? [];
      list.push(path);
      result.mediaByName.set(key, list);
    }
  };

  const walk = async (
    dir: string,
    depth: number,
    out: { path: string; size: number }[],
    folderRoot: string,
  ) => {
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
      if (name.startsWith('.') || isSystemFileName(name)) continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        // A Keynote file saved as a package is a folder: one item, never its pictures inside.
        if (lower.endsWith('.key')) out.push({ path: full, size: 0 });
        else if (!IGNORED_DIRS.has(lower) && !lower.endsWith('.app'))
          await walk(full, depth + 1, out, folderRoot);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          const target = await folderReadPath({ path: full, folderRoot });
          const s = await stat(target);
          if (s.isFile()) out.push({ path: full, size: s.size });
        } catch (error) {
          if (error instanceof OutsideImportFolder)
            result.skipped.push({ path: full, message: error.message });
          // A broken link still has nothing to import.
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
      result.explicitFiles.add(resolve(root));
      addFile(root, info.size);
    } else if (info.isDirectory() && root.toLowerCase().endsWith('.key')) {
      addFile(root, 0);
    } else if (info.isDirectory()) {
      const found: { path: string; size: number }[] = [];
      const folderRoot = await realpath(root);
      result.folderRoots.set(resolve(root), folderRoot);
      await walk(root, 0, found, folderRoot);
      found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      for (const f of found) addFile(f.path, f.size, folderRoot);
    }
  }
  // A video imports its own caption files in MediaStore. A folder/drop must not report them as unsupported items.
  const videoNames = new Map<string, Set<string>>();
  const folderKey = (file: string) =>
    process.platform === 'win32' ? dirname(file).toLowerCase() : dirname(file);
  for (const file of result.files) {
    if (mediaKindOf(file.path) !== 'video') continue;
    const folder = folderKey(file.path);
    const names = videoNames.get(folder) ?? new Set<string>();
    names.add(
      basename(file.path)
        .replace(/\.[^.]+$/u, '')
        .toLowerCase(),
    );
    videoNames.set(folder, names);
  }
  result.files = result.files.filter((file) => {
    if (!/\.(srt|vtt)$/iu.test(file.path)) return true;
    const names = videoNames.get(folderKey(file.path));
    if (!names) return true;
    const stem = basename(file.path).replace(/\.(srt|vtt)$/iu, '');
    if (names.has(stem.toLowerCase())) return false;
    const match = /^(.*)\.([a-z]{2,3}(?:-[a-z\d]{2,8}){0,3})(?:\.auto)?$/iu.exec(stem);
    const name = match?.[1];
    return !(name && names.has(name.toLowerCase()) && captionFileInfo(`${name}.mp4`, file.path));
  });
  result.skipped = result.skipped.filter((file) => !result.explicitFiles.has(resolve(file.path)));
  return result;
}
