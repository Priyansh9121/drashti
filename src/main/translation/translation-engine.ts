import { readdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ModelPurpose } from '../../shared/model-packs';
import type { TranslationLanguage, Translator } from '../../shared/prepared-translations';
import {
  TAG_OF,
  decodeTokens,
  holdsSpecialToken,
  postprocess,
  preprocess,
  restoreSourceClockSpacing,
  routeFor,
  type Route,
} from './indictrans-text';
import { HelperError, TranslationHelper } from './translation-helper';
import { pyStrip } from './python-text';

const cancelled = (): HelperError => new HelperError('cancelled', 'Stopped.');
const unreadableModel = (): HelperError =>
  new HelperError(
    'model-unreadable',
    'The translation model\u2019s folder could not be read just now. Try Prepare translations again in a moment.',
  );
/** What Finder (.DS_Store) and Windows (Thumbs.db, desktop.ini) write into a folder someone opens, in lower case. */
const FOLDER_NOTES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const changedModel = (): HelperError =>
  new HelperError(
    'model-changed',
    'The translation model on this computer changed or is incomplete. Import the model pack again.',
  );
const tooLong = (): HelperError =>
  new HelperError('too-long', 'This text is too long for one translation. Split it into shorter lines.');
/** The prepared words, with their JSON escapes, that one request may carry (the helper reads lines of 64 KiB). */
export const MAX_REQUEST_TEXT_BYTES = 60_000;
/** A lone surrogate (half of a broken emoji) as U+FFFD: the helper refuses text that is not well-formed. */
const wellFormed = (text: string): string => text.replace(/[\ud800-\udfff]/gu, '\ufffd');

/*
 * Prepare translations' engine (alpha.22, a22-mt, from Codex x92's job; x79's design, x74's trial): IndicTrans2's
 * distilled models (int8, CTranslate2) from an imported model pack, through drashti-translate. It only ever makes
 * DRAFTS for the Translation… dialog: a named reader checks each one before it can show (x83's rule), and nothing
 * here ever reaches a screen. Off until both the helper (in this copy of Drashti) and a pack's model for the chosen
 * direction are there. Each line of a text box is translated on its own, so lines stay lines.
 */

/** The pack format of an IndicTrans2 model converted for CTranslate2 (int8) with its source SentencePiece model. */
export const INDICTRANS2_FORMAT = 'indictrans2-ct2-int8';
/** The files such a model holds, in its own folder. */
export const INDICTRANS2_FILES = [
  'model.bin',
  'config.json',
  'source_vocabulary.json',
  'target_vocabulary.json',
  'source.spm',
] as const;
type IndicTransFile = (typeof INDICTRANS2_FILES)[number];

/**
 * The conversions this Drashti runs (a22-review-mt A14): x74's int8 conversions of IndicTrans2's distilled models for
 * CTranslate2 4.9.1, with each model's own SentencePiece source model, every file by its SHA-256. A pack's own list
 * only vouches for itself; these parsers (CTranslate2's model reader, nlohmann json, protobuf-lite) then read only
 * files whose bytes are known. Another conversion needs a new Drashti.
 */
export const KNOWN_INDICTRANS2_MODELS: Readonly<Record<Route, Readonly<Record<IndicTransFile, string>>>> = {
  'en-indic': {
    'model.bin': '5fae4eadf678b5547b774e31f8019dbbdda65f47ac22da470475781e24f59353',
    'config.json': '8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af',
    'source_vocabulary.json': 'f404c39242ac4035f66d7da979136aab758a2f7de929fa7a87c7912797489d54',
    'target_vocabulary.json': '44b9a6330ffcd1902f2da87a8cfbabc4ef9a2385acc62e5818633eef9dea0262',
    'source.spm': '3cedc5cbcc740369b76201942a0f096fec7287fee039b55bdb956f301235b914',
  },
  'indic-en': {
    'model.bin': '063a70cf116082e0949a2657cda85c667c82f26f7e24c1afa97b68f05ec614d3',
    'config.json': '8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af',
    'source_vocabulary.json': '2ff49c008d38db52374040405d7e44d15b5397355307defdb2896b4b0135a7bf',
    'target_vocabulary.json': '7dabfabf69dd1cf567dac17f01528f0e38e71bbf0ba78287cb60697ca1346a39',
    'source.spm': 'ac9257c8e76b8b607705b959cc3d075656ea33032f7a974e467b8941df6e98d4',
  },
  'indic-indic': {
    'model.bin': '9bd1bf44ed13e82cd05b0fb93ede9c03d5ad730775cdb40cb5fd77c07a7f50a1',
    'config.json': '8f6496adfc930cbfecbe8281112197705c488fab47d34b4829b06d7f478909af',
    'source_vocabulary.json': '2ff49c008d38db52374040405d7e44d15b5397355307defdb2896b4b0135a7bf',
    'target_vocabulary.json': '44b9a6330ffcd1902f2da87a8cfbabc4ef9a2385acc62e5818633eef9dea0262',
    'source.spm': 'ac9257c8e76b8b607705b959cc3d075656ea33032f7a974e467b8941df6e98d4',
  },
};

interface PackFile {
  name: string;
  path: string;
  sha256: string;
}

/**
 * Whether a model's files are the known conversion for this direction family: exactly its five files, each once, all
 * in one folder, every one by its SHA-256 (a22-review-mt2 S1). Nothing else may be listed with them: CTranslate2
 * opens some files by name (a shared vocabulary, a vocabulary map) and would read them before the checked ones, and
 * the helper loads the folder of model.bin.
 */
export function knownConversion(route: Route, files: readonly PackFile[]): boolean {
  const known = KNOWN_INDICTRANS2_MODELS[route];
  if (files.length !== INDICTRANS2_FILES.length) return false;
  const folder = dirname(files[0]?.path ?? '');
  return INDICTRANS2_FILES.every((name) => {
    const named = files.filter((f) => basename(f.path) === name);
    const [file] = named;
    return named.length === 1 && file?.sha256 === known[name] && dirname(file.path) === folder;
  });
}

/** What the engine needs of the model pack store (main/model-packs/store.ts). */
export interface TranslationModels {
  forPurpose(purpose: ModelPurpose): readonly {
    id: string;
    format: string;
    files: readonly PackFile[];
  }[];
  /** Checks the model's files again and holds it; stops at once when `signal` aborts (it then rejects). */
  acquire(id: string, signal?: AbortSignal): Promise<{ release(): void } | null>;
}

export interface TranslationEngineOptions {
  /** The helper program in this copy of Drashti, or null when it has none. */
  program: () => string | null;
  models: TranslationModels;
  log: { info(line: string): void; warn(line: string): void };
  createHelper?: (program: string) => TranslationHelper;
  /** x74's choice: two threads. */
  threads?: number;
  /** Prepared drafts use the careful search (beam 5): the reader's grades were better into Gujarati with it. */
  beam?: number;
  /** A loaded model is let go after this long unused. */
  idleMs?: number;
  /** Whether a model's files are a conversion this Drashti runs (tests' stand-in models only replace it). */
  checkFiles?: (route: Route, files: readonly PackFile[]) => boolean;
  /** The names in a model's folder on this disk (tests' stand-in folders only replace it). */
  listFolder?: (folder: string) => Promise<readonly string[]>;
}

const purposeOf = (from: TranslationLanguage, to: TranslationLanguage): ModelPurpose =>
  `translation-${from}-${to}`;

export class TranslationEngine implements Translator {
  private helper: TranslationHelper | null = null;
  private loaded: { route: Route; modelId: string; hold: { release(): void } } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | null = null;
  private generation = 0;
  /** Aborted by Stop (and by the stream going on air): the model's check of this generation ends at once. */
  private abort = new AbortController();

  constructor(private readonly o: TranslationEngineOptions) {}

  /** The pack's models of this engine's format, with every file, offered for the direction. */
  private candidates(from: TranslationLanguage, to: TranslationLanguage) {
    if (from === to || this.o.program() === null) return [];
    return this.o.models
      .forPurpose(purposeOf(from, to))
      .filter(
        (m) =>
          m.format === INDICTRANS2_FORMAT &&
          INDICTRANS2_FILES.every((name) => m.files.some((f) => basename(f.path) === name)),
      );
  }

  /** The model for a direction: one of the known conversions, for that direction's family. */
  private modelFor(from: TranslationLanguage, to: TranslationLanguage) {
    const route = routeFor(from, to);
    const check = this.o.checkFiles ?? knownConversion;
    return this.candidates(from, to).find((m) => check(route, m.files)) ?? null;
  }

  /** Whether Prepare translations can run for this direction. */
  available(from: TranslationLanguage, to: TranslationLanguage): boolean {
    return this.modelFor(from, to) !== null;
  }

  /** The pack offers a model of this format for the direction, but not one this Drashti knows. */
  unknownModel(from: TranslationLanguage, to: TranslationLanguage): boolean {
    return this.candidates(from, to).length > 0 && this.modelFor(from, to) === null;
  }

  /** Whether this copy of Drashti has the translation helper at all. */
  installed(): boolean {
    return this.o.program() !== null;
  }

  /** A draft translation of the source, line by line. Throws a HelperError with plain words when it cannot. */
  translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
    const generation = this.generation;
    const { signal } = this.abort;
    // Stop (or the stream going on air) starts a new generation: everything of an older one stops at its next step.
    const stopped = (): boolean => generation !== this.generation;
    const run = this.queue.then(async () => {
      try {
        if (stopped()) throw cancelled();
        const out: string[] = [];
        for (const line of source.split(/\r\n|\n|\r/u)) {
          if (stopped()) throw cancelled();
          out.push(pyStrip(line) === '' ? line : await this.translateLine(line, from, to, stopped, signal));
        }
        return out.join('\n');
      } catch (error) {
        // Whatever failed after Stop (the helper it ended, a hold let go) is the Stop itself.
        if (stopped()) throw cancelled();
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Load a direction's model now (alpha.24: live captions, before the first phrase, so it is not late). Queued as a
   * translation is; nothing is translated. Throws a HelperError with plain words when it cannot.
   */
  prepare(from: TranslationLanguage, to: TranslationLanguage): Promise<void> {
    const generation = this.generation;
    const { signal } = this.abort;
    const stopped = (): boolean => generation !== this.generation;
    const run = this.queue.then(async () => {
      try {
        await this.ready(routeFor(from, to), from, to, stopped, signal);
        this.restartIdle();
      } catch (error) {
        if (stopped()) throw cancelled();
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stop what is under way and anything waiting (the helper ends: a careful search cannot stop mid-sentence). */
  cancel(): void {
    this.nextGeneration();
    this.stopHelper();
  }

  /** Let the model and the helper go (closing Drashti, or nothing to do for a while). */
  stop(): void {
    this.nextGeneration();
    this.stopHelper();
  }

  private nextGeneration(): void {
    this.generation += 1;
    this.abort.abort();
    this.abort = new AbortController();
  }

  private stopHelper(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    this.helper?.stop();
    this.helper = null;
    this.loaded?.hold.release();
    this.loaded = null;
  }

  private async translateLine(
    line: string,
    from: TranslationLanguage,
    to: TranslationLanguage,
    stopped: () => boolean,
    signal: AbortSignal,
  ): Promise<string> {
    const prepared = preprocess(wellFormed(line), from);
    // Nothing left to translate once prepared (only marks the pipeline drops): the line stays as it is.
    if (prepared.text === '') return line;
    // A backstop: the tokenisers split a written marker apart, so prepared text never holds one.
    if (holdsSpecialToken(prepared.text))
      throw new HelperError(
        'special-token',
        'These words hold a model marker (such as </s>) and cannot be translated. Write this translation by hand.',
      );
    // Too long for one request: this box only, and the helper keeps running for the next box.
    if (Buffer.byteLength(JSON.stringify(prepared.text), 'utf8') > MAX_REQUEST_TEXT_BYTES) throw tooLong();
    const route = routeFor(from, to);
    const helper = await this.ready(route, from, to, stopped, signal);
    const tokens = await helper.translate(route, TAG_OF[from], TAG_OF[to], prepared.text, this.o.beam ?? 5);
    if (stopped()) throw cancelled();
    // No end token: the model stopped at its length limit mid-sentence. Never a shortened draft that looks whole.
    if (tokens.at(-1) !== '</s>') throw tooLong();
    this.restartIdle();
    return restoreSourceClockSpacing(line, postprocess(decodeTokens(tokens), to, prepared.placeholders));
  }

  /**
   * The running helper with this direction's model loaded. After every wait (the helper's start, the model's check
   * and load) a Stop is honoured: a helper started for a stopped run is ended, a hold taken for it let go; the
   * model's check itself ends at once (`signal`).
   */
  private async ready(
    route: Route,
    from: TranslationLanguage,
    to: TranslationLanguage,
    stopped: () => boolean,
    signal: AbortSignal,
  ): Promise<TranslationHelper> {
    const program = this.o.program();
    const model = this.modelFor(from, to);
    if (program === null || model === null)
      throw new HelperError(
        'not-installed',
        'Translation is not installed: ask the admin to import the offline model pack (Help \u203a Caption and Translation Models\u2026).',
      );
    let helper = this.helper;
    if (!helper?.running) {
      this.stopHelper();
      const started = (
        this.o.createHelper ?? ((p) => new TranslationHelper({ program: p, log: this.o.log }))
      )(program);
      await started.start();
      if (stopped()) {
        started.stop();
        throw cancelled();
      }
      this.helper = started;
      helper = started;
    }
    if (this.loaded?.route !== route || this.loaded.modelId !== model.id) {
      // One model in memory at a time: the one before is let go in the helper, then by the pack store.
      const before = this.loaded;
      this.loaded = null;
      if (before) {
        try {
          await helper.unload(before.route);
        } finally {
          before.hold.release();
        }
      }
      if (stopped()) throw cancelled();
      const hold = await this.o.models.acquire(model.id, signal);
      if (!hold) throw changedModel();
      if (stopped()) {
        hold.release();
        throw cancelled();
      }
      const file = (name: string) => model.files.find((f) => basename(f.path) === name)?.path ?? '';
      const folder = dirname(file('model.bin'));
      try {
        // The folder on this disk holds the five checked files and nothing else (a22-review-mt2 S1): a file the
        // pack's list never named (one CTranslate2 opens by name) is never read. Only what Finder and Windows
        // write into a folder someone opened is passed over: CTranslate2 opens none of them.
        let listed: readonly string[];
        try {
          listed = await (this.o.listFolder ?? readdir)(folder);
        } catch (error) {
          if (stopped()) throw cancelled();
          const code = (error as NodeJS.ErrnoException).code;
          // Gone since the check: a changed model. Anything else (an antivirus holding it) passes: try again.
          throw code === 'ENOENT' || code === 'ENOTDIR' ? changedModel() : unreadableModel();
        }
        if (stopped()) throw cancelled();
        const onDisk = listed.filter((name) => !FOLDER_NOTES.has(name.toLowerCase())).sort();
        if (onDisk.join('\n') !== [...INDICTRANS2_FILES].sort().join('\n')) {
          this.o.log.warn(`Translation: ${model.id}'s folder holds a file its pack does not list.`);
          throw changedModel();
        }
        await helper.load(route, folder, file('source.spm'), this.o.threads ?? 2);
      } catch (error) {
        hold.release();
        throw error;
      }
      if (stopped()) {
        hold.release();
        throw cancelled();
      }
      this.loaded = { route, modelId: model.id, hold };
      this.o.log.info(`Translation: loaded ${model.id} for ${route}.`);
    }
    return helper;
  }

  private restartIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(
      () => {
        this.o.log.info('Translation: the model was let go after a quiet while.');
        this.stopHelper();
      },
      this.o.idleMs ?? 5 * 60_000,
    );
    this.idle.unref();
  }
}
