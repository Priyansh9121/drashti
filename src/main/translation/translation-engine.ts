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

/** What the engine needs of the model pack store (main/model-packs/store.ts). */
export interface TranslationModels {
  forPurpose(purpose: ModelPurpose): readonly {
    id: string;
    format: string;
    files: readonly { name: string; path: string }[];
  }[];
  acquire(id: string): Promise<{ release(): void } | null>;
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
}

const purposeOf = (from: TranslationLanguage, to: TranslationLanguage): ModelPurpose =>
  `translation-${from}-${to}`;

export class TranslationEngine implements Translator {
  private helper: TranslationHelper | null = null;
  private loaded: { route: Route; modelId: string; hold: { release(): void } } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private idle: NodeJS.Timeout | null = null;
  private generation = 0;

  constructor(private readonly o: TranslationEngineOptions) {}

  /** The model for a direction, when this copy of Drashti has the helper and a pack holds a whole one. */
  private modelFor(from: TranslationLanguage, to: TranslationLanguage) {
    if (from === to || this.o.program() === null) return null;
    return (
      this.o.models
        .forPurpose(purposeOf(from, to))
        .find(
          (m) =>
            m.format === INDICTRANS2_FORMAT &&
            INDICTRANS2_FILES.every((name) => m.files.some((f) => basename(f.path) === name)),
        ) ?? null
    );
  }

  /** Whether Prepare translations can run for this direction. */
  available(from: TranslationLanguage, to: TranslationLanguage): boolean {
    return this.modelFor(from, to) !== null;
  }

  /** Whether this copy of Drashti has the translation helper at all. */
  installed(): boolean {
    return this.o.program() !== null;
  }

  /** A draft translation of the source, line by line. Throws a HelperError with plain words when it cannot. */
  translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string> {
    const generation = this.generation;
    // Stop (or the stream going on air) starts a new generation: everything of an older one stops at its next step.
    const stopped = (): boolean => generation !== this.generation;
    const run = this.queue.then(async () => {
      try {
        if (stopped()) throw cancelled();
        const out: string[] = [];
        for (const line of source.split(/\r\n|\n|\r/u)) {
          if (stopped()) throw cancelled();
          out.push(pyStrip(line) === '' ? line : await this.translateLine(line, from, to, stopped));
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

  /** Stop what is under way and anything waiting (the helper ends: a careful search cannot stop mid-sentence). */
  cancel(): void {
    this.generation += 1;
    this.stopHelper();
  }

  /** Let the model and the helper go (closing Drashti, or nothing to do for a while). */
  stop(): void {
    this.generation += 1;
    this.stopHelper();
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
  ): Promise<string> {
    if (holdsSpecialToken(line))
      throw new HelperError(
        'special-token',
        'These words hold a model marker (such as </s>) and cannot be translated.',
      );
    const prepared = preprocess(wellFormed(line), from);
    // Nothing left to translate once prepared (only marks the pipeline drops): the line stays as it is.
    if (prepared.text === '') return line;
    // Too long for one request: this box only, and the helper keeps running for the next box.
    if (Buffer.byteLength(JSON.stringify(prepared.text), 'utf8') > MAX_REQUEST_TEXT_BYTES) throw tooLong();
    const route = routeFor(from, to);
    const helper = await this.ready(route, from, to, stopped);
    const tokens = await helper.translate(route, TAG_OF[from], TAG_OF[to], prepared.text, this.o.beam ?? 5);
    if (stopped()) throw cancelled();
    // No end token: the model stopped at its length limit mid-sentence. Never a shortened draft that looks whole.
    if (tokens.at(-1) !== '</s>') throw tooLong();
    this.restartIdle();
    return restoreSourceClockSpacing(line, postprocess(decodeTokens(tokens), to, prepared.placeholders));
  }

  /**
   * The running helper with this direction's model loaded. After every wait (the helper's start, the model's check
   * and load) a Stop is honoured: a helper started for a stopped run is ended, a hold taken for it let go.
   */
  private async ready(
    route: Route,
    from: TranslationLanguage,
    to: TranslationLanguage,
    stopped: () => boolean,
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
      const hold = await this.o.models.acquire(model.id);
      if (!hold)
        throw new HelperError(
          'model-changed',
          'The translation model on this computer changed or is incomplete. Import the model pack again.',
        );
      if (stopped()) {
        hold.release();
        throw cancelled();
      }
      const file = (name: string) => model.files.find((f) => basename(f.path) === name)?.path ?? '';
      try {
        await helper.load(route, dirname(file('model.bin')), file('source.spm'), this.o.threads ?? 2);
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
