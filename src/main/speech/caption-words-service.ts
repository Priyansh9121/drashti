import { readFile, stat, writeFile } from 'node:fs/promises';
import {
  addCaptionWords,
  CAPTION_WORDS_FILE_BYTES,
  captionWordsCsv,
  parseCaptionWords,
  readCaptionWordsCsv,
  type CaptionWord,
  type CaptionWordsResult,
  type CaptionWordsView,
} from '../../shared/caption-words';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import { plural } from '../../shared/text';
import { createCaptionHints, type CaptionHints } from './caption-hints';
import { spellingFixer } from './spelling-fixer';

/*
 * Caption words as the admin keeps them (alpha.22; File › Live Captions… › Caption Words…, Pro Mode): the list
 * in the library (db/caption-words.ts), the hints the captions engine is given (caption-hints.ts) and the
 * spelling fixer the captions pass each phrase through (spelling-fixer.ts), both made again when the list
 * changes. Imported from and exported to a small CSV file the admin chooses. The log says counts, never a word.
 */

export interface CaptionWordsDeps {
  repo: {
    get(): CaptionWord[];
    set(words: readonly CaptionWord[]): void;
    hintsOn(): Record<SpeechLanguage, boolean>;
    setHintsOn(language: SpeechLanguage, on: boolean): void;
  };
  /** The system's Open and Save dialogs; null when cancelled. */
  pickImport: () => Promise<string | null>;
  pickExport: (defaultName: string) => Promise<string | null>;
  log: { info(message: string): void; warn(message: string): void };
}

const words = (n: number): string => plural(n, 'word');

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

export class CaptionWordsService {
  /** The engine's hints from the list as it is now. */
  readonly hints: CaptionHints;
  private list: CaptionWord[];
  private fixer: (h: Heard) => Heard;
  private fixFailed = false;

  constructor(private readonly deps: CaptionWordsDeps) {
    this.list = parseCaptionWords(deps.repo.get());
    this.fixer = spellingFixer(this.list);
    this.hints = createCaptionHints(() => this.list);
  }

  view(): CaptionWordsView {
    return { words: this.list, hinted: this.hints.hinted(), hintsOn: this.deps.repo.hintsOn() };
  }

  /** Red first: a language's hints switch, not written yet. */
  setHints(_language: unknown, _on: unknown): CaptionWordsResult {
    return { ok: true, view: this.view(), message: null };
  }

  /** The list, whole, as the dialog sends it after a change: each word checked again. */
  set(raw: unknown): CaptionWordsResult {
    this.keep(parseCaptionWords(raw));
    return { ok: true, view: this.view(), message: null };
  }

  /** Import…: the words of a file the admin chooses, added to the list (the words there stay). */
  async importFile(): Promise<CaptionWordsResult> {
    const path = await this.deps.pickImport();
    if (path === null) return { ok: true, view: this.view(), message: null };
    const refused = (message: string): CaptionWordsResult => ({ ok: false, view: this.view(), message });
    let text: string | null;
    try {
      if ((await stat(path)).size > CAPTION_WORDS_FILE_BYTES)
        return refused('That file is too large for a caption words list (256 KB at most).');
      text = textOf(await readFile(path));
    } catch {
      return refused('That file could not be read. Check it and try again.');
    }
    if (text === null) return refused('That file is not text. Save the list as CSV (UTF-8) and try again.');
    const read = readCaptionWordsCsv(text);
    const added = addCaptionWords(this.list, read.words);
    this.keep(added.words);
    this.deps.log.info(
      `Caption words: ${words(added.added)} added from a file (${String(added.already)} there already, ${String(added.full)} past the limit, ${plural(read.problems.length, 'line')} not read).`,
    );
    const said = [`Added ${words(added.added)}.`];
    if (added.already > 0)
      said.push(`${words(added.already)} ${added.already === 1 ? 'was' : 'were'} in the list already.`);
    if (added.full > 0) said.push(`${words(added.full)} did not fit: a language keeps 200 at most.`);
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

  /** Export…: the list as a CSV file where the admin chooses. */
  async exportFile(): Promise<CaptionWordsResult> {
    const path = await this.deps.pickExport('Caption words.csv');
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
    this.deps.log.info(`Caption words: ${words(this.list.length)} exported to a file.`);
    return { ok: true, view: this.view(), message: `Saved ${words(this.list.length)}.` };
  }

  /** A phrase heard, spelt by the list. Never throws: should the fixer fail, the phrase goes on as heard. */
  fix(h: Heard): Heard {
    try {
      return this.fixer(h);
    } catch {
      if (!this.fixFailed) {
        this.fixFailed = true;
        this.deps.log.warn('Caption words: the spelling fixer failed, so phrases go on as heard.');
      }
      return h;
    }
  }

  private keep(list: CaptionWord[]): void {
    this.deps.repo.set(list);
    this.list = parseCaptionWords(this.deps.repo.get());
    this.fixer = spellingFixer(this.list);
    this.fixFailed = false;
  }
}
