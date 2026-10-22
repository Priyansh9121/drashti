/*
 * A folder's files in a playlist's order (Session 26c; Priyansh's answer of
 * 14 Oct 2026): folder by folder, depth first. The top folder's own files
 * first, then each subfolder A→Z the same way, and its subfolders in turn.
 * Within a folder, by kind (videos first, then decks, then the rest), each
 * A→Z: case-blind, with numbers in order ("2" before "10"). A header comes
 * before each subfolder's part, named by its path ("Week 1 › Videos"): none
 * for the top folder, and none for a folder with nothing of its own.
 */

import { SOUND_EXTENSIONS, VIDEO_EXTENSIONS } from './media';

/** A→Z as people read it: case and accents aside, numbers by their value. */
export const naturalCompare: (a: string, b: string) => number = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
}).compare;

/** A file's place in its folder's part: lower comes first. */
export type KindRank = (relativePath: string) => number;

/** One folder's part of the playlist: its header (none for the top folder) and its files in order. */
export interface FolderPart<T> {
  /** The folder's path inside the top folder, "/"-separated; '' for the top folder itself. */
  folder: string;
  /** What its header says: "Week 1 › Videos"; '' for the top folder. */
  title: string;
  entries: T[];
}

const SEPARATOR = ' › ';

/** "Week 1/Videos" -> "Week 1 › Videos". */
export const partTitle = (folder: string): string => folder.split('/').filter(Boolean).join(SEPARATOR);

/** The folder a "/"-separated path inside the top folder is in ('' for the top folder). */
export const folderOf = (relativePath: string): string => {
  const parts = relativePath.split('/').filter(Boolean);
  return parts.slice(0, -1).join('/');
};

const nameOf = (relativePath: string): string => relativePath.split('/').filter(Boolean).pop() ?? '';

interface Node<T> {
  own: T[];
  children: Map<string, Node<T>>;
}

/**
 * `entries` in folder order, as parts. `pathOf` gives each one's path inside the top folder ("/"
 * between folders); `rank` orders kinds within a folder.
 */
export function partsInFolderOrder<T>(
  entries: readonly T[],
  pathOf: (entry: T) => string,
  rank: KindRank,
): FolderPart<T>[] {
  const root: Node<T> = { own: [], children: new Map() };
  for (const entry of entries) {
    const parts = pathOf(entry).split('/').filter(Boolean);
    let node = root;
    for (const folder of parts.slice(0, -1)) {
      let next = node.children.get(folder);
      if (!next) {
        next = { own: [], children: new Map() };
        node.children.set(folder, next);
      }
      node = next;
    }
    node.own.push(entry);
  }
  const out: FolderPart<T>[] = [];
  const walk = (node: Node<T>, folder: string) => {
    if (node.own.length > 0) {
      const own = [...node.own].sort((a, b) => {
        const pa = pathOf(a);
        const pb = pathOf(b);
        return rank(pa) - rank(pb) || naturalCompare(nameOf(pa), nameOf(pb)) || pa.localeCompare(pb);
      });
      out.push({ folder, title: partTitle(folder), entries: own });
    }
    for (const name of [...node.children.keys()].sort(naturalCompare)) {
      const child = node.children.get(name);
      if (child) walk(child, folder === '' ? name : `${folder}/${name}`);
    }
  };
  walk(root, '');
  return out;
}

// The videos and sounds the import takes (Session 50: one list, in shared/media.ts).
const VIDEO = new Set(VIDEO_EXTENSIONS);
const DECK = new Set(['pptx', 'ppt', 'key', 'pdf']);
const PICTURE = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'webp', 'avif']);
const SOUND = new Set(SOUND_EXTENSIONS);

const extOf = (path: string): string => {
  const name = nameOf(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/**
 * The order of kinds within a folder: videos, then decks (PowerPoint, Keynote and PDF files), then
 * other presentations (lyrics, ProPresenter files), then pictures, then sounds.
 */
export const kindRank: KindRank = (path) => {
  const ext = extOf(path);
  if (VIDEO.has(ext)) return 0;
  if (DECK.has(ext)) return 1;
  if (PICTURE.has(ext)) return 3;
  if (SOUND.has(ext)) return 4;
  return 2;
};
