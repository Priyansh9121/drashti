import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import {
  CAPTION_WORDS_FILE_BYTES,
  captionWordsCsv,
  readCaptionWordsCsv,
  type CaptionWord,
} from '../../shared/caption-words';
import type { CaptionsShown } from '../../shared/captions';
import { cleanCaption, cleanWords, type CleanLookup } from '../../shared/caption-clean/clean';
import { CAPTION_CLEAN_HASH_PREFIX, cleanPhraseKey } from '../../shared/caption-clean/key';
import {
  CAPTION_CLEAN_EN,
  CAPTION_CLEAN_GU,
  CAPTION_CLEAN_HI,
  CAPTION_CLEAN_SA,
} from '../../shared/caption-clean/list';
import {
  addCleanWords,
  parseCleanWords,
  type CaptionCleanCount,
  type CaptionCleanResult,
  type CaptionCleanView,
} from '../../shared/caption-clean/words';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import type { VideoCaptionTrack } from '../../shared/video-captions';
import { plural } from '../../shared/text';

/*
 * Words left out of captions (alpha.24, QA24-CAPCLEAN-1; the owner: "sensor bad words accross all 4 languages. do
 * not show them"): live captions and translated captions never show a bad word, on any screen, in the stream or its
 * recording, or in a sound recording's caption draft. The word is simply left out.
 *
 * The seam (src/main/index.ts): every phrase heard passes heard() right after the caption words' spelling fixer,
 * before anything else sees it (today's captions, caption AI, the operator's correction panel, the draft); and every
 * caption passes shown() last, just before the screens (so a translation, after translating, and an operator's
 * correction too). Each word is checked against every language's words: Drashti's own list (hashes only:
 * shared/caption-clean/list.ts), the admin's own (the library, migration 094) and, in tests only, the test switch's
 * placeholder words. A caption that cannot be checked is not shown. The log says counts, never a word; the
 * operator window is told only how many words were left out since captions were turned on.
 */

export type CaptionCleanList = Readonly<Record<SpeechLanguage, readonly string[]>>;

/** Drashti's own list, as shipped. */
export const CAPTION_CLEAN_OWN: CaptionCleanList = Object.freeze({
  gu: CAPTION_CLEAN_GU,
  hi: CAPTION_CLEAN_HI,
  sa: CAPTION_CLEAN_SA,
  en: CAPTION_CLEAN_EN,
});

/** A key's hash as Drashti's own list holds it: SHA-256 of the prefix and the key, lower-case hex. */
export function captionCleanHash(key: string): string {
  return createHash('sha256').update(`${CAPTION_CLEAN_HASH_PREFIX}${key}`, 'utf8').digest('hex');
}

export interface CaptionCleanDeps {
  repo: { get(): CaptionWord[]; set(words: readonly CaptionWord[]): void };
  /** Drashti's own list (CAPTION_CLEAN_OWN when left out). */
  own?: CaptionCleanList;
  /** Tests only (DRASHTI_TEST_CAPTION_CLEAN, never packaged): placeholder words taken as on Drashti's own list. */
  testWords?: readonly string[];
  /** A key's hash (captionCleanHash; a test may make it fail). */
  hash?: (key: string) => string;
  /** The system's Open and Save dialogs; null when cancelled. */
  pickImport: () => Promise<string | null>;
  pickExport: (defaultName: string) => Promise<string | null>;
  /** The count changed: the operator window is told (a number, never a word). */
  changed: (count: CaptionCleanCount) => void;
  /** The admin's list changed: the screens' video captions are drawn again with it. */
  listChanged?: () => void;
  log: { info(message: string): void; warn(message: string): void };
}

const wordsOf = (n: number): string => plural(n, 'word');
/** A key of one word with nothing in it but letters, signs and digits. */
const LETTERS_ONLY = /^[\p{L}\p{M}\p{N}]+$/u;
const keysOf = (words: readonly string[]): Set<string> =>
  new Set(words.map(cleanPhraseKey).filter((key) => key !== ''));

/** A file's text: UTF-8 (with or without its mark), or UTF-16 with its mark; null when it is not text. */
function textOf(bytes: Uint8Array): string | null {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe)
      return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff)
      return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export class CaptionCleanService {
  private list: CaptionWord[];
  private adminKeys: Set<string>;
  private readonly testKeys: Set<string>;
  private readonly own: ReadonlySet<string>;
  private readonly ownCounts: Record<SpeechLanguage, number>;
  private readonly hash: (key: string) => string;
  private leftOut = 0;
  /** The phrase being heard and how many it leaves out, counted once it is final or the next one starts. */
  private hearing: { id: string; left: number } | null = null;
  /**
   * The hash of the last caption the screens were given that had words left out, so a repaint is not counted again:
   * never the caption itself (review F3).
   */
  private lastShown = '';
  private on = false;
  private failedOnce = false;
  private readonly bad: CleanLookup;
  /**
   * Single words known not to be on Drashti's own list, so each is hashed once: letters only, never a listed word, nor a
   * run of words or a joined word that may hold one (review F3); at most 100,000.
   */
  private readonly notOwn = new Set<string>();
  /** The lists' version: a video's caption track is cleaned again when the admin's list changes. */
  private version = 0;
  /** Each video caption track as cleaned, while it and the lists are unchanged (the engine compares tracks by identity). */
  private readonly tracks = new WeakMap<VideoCaptionTrack, { version: number; track: VideoCaptionTrack }>();

  constructor(private readonly deps: CaptionCleanDeps) {
    const own = deps.own ?? CAPTION_CLEAN_OWN;
    this.own = new Set([...own.gu, ...own.hi, ...own.sa, ...own.en]);
    this.ownCounts = { gu: own.gu.length, hi: own.hi.length, sa: own.sa.length, en: own.en.length };
    this.testKeys = keysOf(deps.testWords ?? []);
    this.hash = deps.hash ?? captionCleanHash;
    this.list = parseCleanWords(deps.repo.get());
    this.adminKeys = keysOf(this.list.map((w) => w.word));
    this.bad = (key) => key !== '' && (this.adminKeys.has(key) || this.testKeys.has(key) || this.ownHas(key));
  }

  /** Whether a key is on Drashti's own list, by its hash. */
  private ownHas(key: string): boolean {
    if (this.notOwn.has(key)) return false;
    if (this.own.has(this.hash(key))) return true;
    if (LETTERS_ONLY.test(key)) {
      if (this.notOwn.size >= 100_000) this.notOwn.clear();
      this.notOwn.add(key);
    }
    return false;
  }

  /** A phrase heard with the bad words left out (each other word as it came); as it came when none is. */
  heard(h: Heard): Heard {
    let cleaned: { heard: Heard; left: number };
    try {
      cleaned = this.cleanHeard(h);
    } catch {
      this.failed();
      return { ...h, final: false, words: [], text: '' };
    }
    this.countHeard(h, cleaned.left);
    const out = cleaned.heard;
    // A final phrase left with nothing goes on as an empty partial of its own id (review F4): the hub passes it on
    // (a final phrase must have words), and what showed of it while it was heard comes off the screens.
    return out.final && (out.words.length === 0 || out.text === '')
      ? { ...out, final: false, words: [], text: '' }
      : out;
  }

  private cleanHeard(h: Heard): { heard: Heard; left: number } {
    const words = cleanWords(
      h.words.map((w) => w.text),
      this.bad,
    );
    const text = cleanCaption(h.text, this.bad);
    const left = Math.max(words.left, text.left);
    if (left === 0) return { heard: h, left };
    const kept = words.kept.map(({ from, text: t }) => {
      const word = h.words[from];
      if (!word) throw new Error('A word is missing.');
      return word.text === t ? word : { ...word, text: t };
    });
    // The phrase's text as its words that stay; a partial with no words yet keeps its own text, cleaned.
    const shownText = h.words.length > 0 ? kept.map((w) => w.text).join(' ') : text.text;
    return { heard: { ...h, words: kept, text: shownText }, left };
  }

  /** The lines for the screens with the bad words left out (a line left empty goes; none left: nothing shown). */
  shown(captions: CaptionsShown | null): CaptionsShown | null {
    if (captions === null) return null;
    try {
      const cleaned = this.cleanLines(captions.lines);
      if (cleaned.left === 0) return captions;
      this.countShown(captions, cleaned.left);
      return cleaned.lines.length === 0 ? null : { ...captions, lines: cleaned.lines };
    } catch {
      this.failed();
      return null;
    }
  }

  /**
   * A video's caption track (a file beside it, a YouTube download's automatic track among them) as the screens show
   * it (the owner: "Yes, clean them too"): each cue with the words left out, its lines and times kept; a cue left with
   * nothing is dropped, and a cue that cannot be checked is not shown. Never counted. The same object while the track
   * and the lists are unchanged.
   */
  track(track: VideoCaptionTrack | null): VideoCaptionTrack | null {
    if (track === null) return null;
    const known = this.tracks.get(track);
    if (known?.version === this.version) return known.track;
    let changed = false;
    const cues: VideoCaptionTrack['cues'] = [];
    for (const cue of track.cues) {
      let text: string;
      try {
        const cleaned = this.cleanLines(cue.text.split(/\r\n|\n|\r/u));
        text = cleaned.left === 0 ? cue.text : cleaned.lines.join('\n');
      } catch {
        this.failed();
        text = '';
      }
      if (text === cue.text) cues.push(cue);
      else {
        changed = true;
        if (text !== '') cues.push({ ...cue, text });
      }
    }
    const out = changed ? { ...track, cues } : track;
    this.tracks.set(track, { version: this.version, track: out });
    return out;
  }

  /** Lines with the bad words left out (an entry may run on from one line to the next); a line left empty goes. */
  private cleanLines(lines: readonly string[]): { lines: string[]; left: number } {
    const words: { line: number; text: string }[] = [];
    lines.forEach((line, i) => {
      for (const text of line.split(/\s+/u)) if (text !== '') words.push({ line: i, text });
    });
    const cleaned = cleanWords(
      words.map((w) => w.text),
      this.bad,
    );
    if (cleaned.left === 0) return { lines: [...lines], left: 0 };
    const kept: string[][] = lines.map(() => []);
    for (const { from, text } of cleaned.kept) kept[words[from]?.line ?? 0]?.push(text);
    return { lines: kept.map((l) => l.join(' ')).filter((l) => l !== ''), left: cleaned.left };
  }

  /** Captions turned on or off on this computer: from nothing again each time they are turned on. */
  captionsOn(on: boolean): void {
    const was = this.on;
    this.on = on;
    if (!on || was) return;
    this.leftOut = 0;
    this.hearing = null;
    this.lastShown = '';
    this.deps.changed({ leftOut: 0 });
  }

  view(): CaptionCleanView {
    return { words: this.list, own: { ...this.ownCounts }, leftOut: this.leftOut };
  }

  /** The admin's list, whole, as the dialog sends it after a change: each word checked again. */
  set(raw: unknown): CaptionCleanResult {
    this.keep(parseCleanWords(raw));
    return { ok: true, view: this.view(), message: null };
  }

  /** Import…: the words of a file the admin chooses (Caption Words' file), added to the list. */
  async importFile(): Promise<CaptionCleanResult> {
    const path = await this.deps.pickImport();
    if (path === null) return { ok: true, view: this.view(), message: null };
    const refused = (message: string): CaptionCleanResult => ({ ok: false, view: this.view(), message });
    let text: string | null;
    try {
      if ((await stat(path)).size > CAPTION_WORDS_FILE_BYTES)
        return refused('That file is too large for a list of words (256 KB at most).');
      text = textOf(await readFile(path));
    } catch {
      return refused('That file could not be read. Check it and try again.');
    }
    if (text === null) return refused('That file is not text. Save the list as CSV (UTF-8) and try again.');
    const read = readCaptionWordsCsv(text);
    const added = addCleanWords(this.list, read.words);
    this.keep(added.words);
    this.deps.log.info(
      `Words left out of captions: ${wordsOf(added.added)} added from a file (${String(added.already)} there already, ${String(added.full)} past the limit, ${plural(read.problems.length, 'line')} not read).`,
    );
    const said = [`Added ${wordsOf(added.added)}.`];
    if (added.already > 0)
      said.push(`${wordsOf(added.already)} ${added.already === 1 ? 'was' : 'were'} in the list already.`);
    if (added.full > 0) said.push(`${wordsOf(added.full)} did not fit: a language keeps 200 at most.`);
    const first = read.problems[0];
    if (first)
      said.push(
        `${plural(read.problems.length, 'line')} could not be read; line ${String(first.line)}: ${first.message}`,
      );
    return {
      ok: read.words.length > 0 || read.problems.length === 0,
      view: this.view(),
      message: said.join(' '),
    };
  }

  /** Export…: the admin's list as a CSV file (Caption Words' file) where the admin chooses. */
  async exportFile(): Promise<CaptionCleanResult> {
    const path = await this.deps.pickExport('Words left out of captions.csv');
    if (path === null) return { ok: true, view: this.view(), message: null };
    try {
      await writeFile(path, captionWordsCsv(this.list), 'utf8');
    } catch {
      return {
        ok: false,
        view: this.view(),
        message: 'The list could not be saved there. Choose another place.',
      };
    }
    this.deps.log.info(`Words left out of captions: ${wordsOf(this.list.length)} exported to a file.`);
    return { ok: true, view: this.view(), message: `Saved ${wordsOf(this.list.length)}.` };
  }

  private keep(list: CaptionWord[]): void {
    this.deps.repo.set(list);
    this.list = parseCleanWords(this.deps.repo.get());
    this.adminKeys = keysOf(this.list.map((w) => w.word));
    this.version += 1;
    this.deps.listChanged?.();
  }

  /** A phrase counts once: its last revision's words, when it is final or the next phrase starts. */
  private countHeard(h: Heard, left: number): void {
    let more = 0;
    if (this.hearing && this.hearing.id !== h.id) more += this.hearing.left;
    if (h.final) {
      more += left;
      this.hearing = null;
    } else this.hearing = { id: h.id, left };
    this.add(more);
  }

  /** A caption counts once however often the screens are given it again (a repaint, other line breaks). */
  private countShown(captions: CaptionsShown, left: number): void {
    const key = captionCleanHash(`${captions.language}\n${captions.lines.join(' ')}`);
    if (key === this.lastShown) return;
    this.lastShown = key;
    this.add(left);
  }

  private add(more: number): void {
    if (more === 0) return;
    this.leftOut += more;
    this.deps.changed({ leftOut: this.leftOut });
  }

  private failed(): void {
    if (this.failedOnce) return;
    this.failedOnce = true;
    this.deps.log.warn('Words left out of captions: a caption could not be checked, so it is not shown.');
  }
}
