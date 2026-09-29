/*
 * Lyrics as plain text, the one format for importing .txt files and for
 * editing a presentation's words:
 *
 *   [Verse 1]            a line in square brackets starts a group
 *   first line
 *   second line          lines together make one slide
 *                        a blank line starts the next slide
 *   third line
 *
 *   [Chorus]
 *   ...
 *   [Verse 1]            a header again with no text after it repeats that
 *                        group: the words are sung in that order
 *
 * Text before the first header goes into a group with no name.
 */

const HEADER = /^\[([^\]\n]{1,80})\]$/u;

export interface LyricsGroup {
  name: string;
  /** Each slide's lines. */
  slides: string[][];
}

export interface ParsedLyrics {
  /** Groups with words, in the order written (a repeat header adds none). */
  groups: LyricsGroup[];
  /** The groups as sung, as indexes into `groups` (repeats included). */
  order: number[];
  /** A header came again with no words: the order differs from the groups. */
  repeats: boolean;
  /** Headers with no words that repeat nothing: left out. */
  emptyGroups: string[];
  /** Slides beyond the limit, left out. */
  droppedSlides: number;
}

/** A group's name as a key: case does not matter ("verse 1" is "Verse 1"). */
export const groupKey = (name: string): string => name.trim().toLocaleLowerCase('en');

export function parseLyrics(text: string, maxSlides = 2000): ParsedLyrics {
  const lines = text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((l) => l.replace(/\t/gu, ' ').trim());
  const written: LyricsGroup[] = [];
  let current: LyricsGroup | null = null;
  let pending: string[] = [];
  let slides = 0;
  let droppedSlides = 0;
  const flush = () => {
    if (pending.length === 0) return;
    if (!current) {
      current = { name: '', slides: [] };
      written.push(current);
    }
    if (slides < maxSlides) {
      current.slides.push(pending);
      slides++;
    } else {
      droppedSlides++;
    }
    pending = [];
  };
  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      flush();
      current = { name: (header[1] ?? '').trim(), slides: [] };
      written.push(current);
    } else if (line === '') {
      flush();
    } else {
      pending.push(line);
    }
  }
  flush();

  // A header with no words repeats the earlier group of that name; the rest are left out.
  const groups: LyricsGroup[] = [];
  const order: number[] = [];
  const byName = new Map<string, number>();
  const emptyGroups: string[] = [];
  let repeats = false;
  for (const g of written) {
    const key = groupKey(g.name);
    if (g.slides.length > 0) {
      groups.push(g);
      order.push(groups.length - 1);
      if (!byName.has(key)) byName.set(key, groups.length - 1);
      continue;
    }
    const earlier = byName.get(key);
    if (earlier !== undefined) {
      order.push(earlier);
      repeats = true;
    } else {
      emptyGroups.push(g.name);
    }
  }
  return { groups, order, repeats, emptyGroups, droppedSlides };
}

/** Groups and their slides as plain text, in the format parseLyrics reads. */
export function lyricsText(groups: readonly LyricsGroup[]): string {
  const blocks: string[] = [];
  groups.forEach((g, i) => {
    const slides = g.slides.map((lines) => lines.join('\n')).join('\n\n');
    // Only a nameless group at the very start can go without a header.
    const header = g.name === '' && i === 0 ? '' : `[${g.name === '' ? ' ' : g.name}]\n`;
    blocks.push(`${header}${slides}`);
  });
  return `${blocks.join('\n\n')}\n`;
}
