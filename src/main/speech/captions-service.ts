import {
  CAPTION_MODELS,
  isLanguageModelLanguage,
  LANGUAGE_MODEL_LANGUAGES,
  parseCaptionSettings,
  parseCaptionTiming,
  type CaptionTiming,
  type LanguageModelLanguage,
  type LanguageModelView,
  type CaptionModelId,
  type CaptionSettings,
  type CaptionsDownload,
  type CaptionsShown,
  type CaptionsStatus,
} from '../../shared/captions';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import { createCaptionsFeed, type CaptionsFeed } from './captions-feed';
import {
  readCaptionsSwitch,
  readCaptionsTuning,
  writeCaptionsSwitch,
  writeCaptionsTuning,
  type CaptionsSwitch,
  type CaptionsTuning,
} from './captions-switch';
import { createSpeechHub, type SpeechEngine, type SpeechHubControl } from './hub';
import {
  languageName,
  LanguageModelRefused,
  type LanguageModelCheck,
  type LanguageModelEntry,
} from './language-models';

export type { CaptionsStatus } from '../../shared/captions';

/*
 * Live captions as an admin runs them (Session 55, Part 10): the switch on this computer (off until turned on), the
 * library's settings, the model (downloaded once, with progress, when captions are turned on), the speech hub and
 * the captions feed. What the Live captions dialog shows comes from view(); it never holds a word heard.
 */

export interface CaptionsServiceDeps {
  userData: string;
  platform: string;
  arch: string;
  repo: { get(): CaptionSettings; set(settings: CaptionSettings): void };
  /** What hears (the whisper engine, or the test switch's stand-in). */
  engine: SpeechEngine;
  /** Why this computer cannot run captions (no engine here, or too old a Mac), or null when it can. */
  engineProblem: () => string | null;
  modelReady: (id: CaptionModelId) => boolean;
  download: (
    id: CaptionModelId,
    progress: (done: number, total: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** The engine's setCaptions. */
  show: (captions: CaptionsShown | null) => void;
  onFinalPhrase?: (phrase: Heard) => void;
  /** Tell the operator window (the dialog). */
  changed: (view: CaptionsStatus) => void;
  log: { info(message: string): void; warn(message: string): void };
  /** The language models on this computer (alpha.22; main/speech/language-models.ts). None known when left out. */
  languageModels?: LanguageModelStore;
}

/** A model of its own per language on this computer (alpha.22): what Drashti knows, and each file's check. */
export interface LanguageModelStore {
  /** The models this copy of Drashti knows (by SHA-256). */
  known(): readonly LanguageModelEntry[];
  /** The quick check before each use. */
  check(entry: LanguageModelEntry): LanguageModelCheck;
  /** The file checked whole again (stamped again when it is still the same). */
  verify(entry: LanguageModelEntry): Promise<LanguageModelCheck>;
  /** Add a file the admin chose for `language`: its entry, or LanguageModelRefused with what to say. */
  add(language: LanguageModelLanguage, source: string): Promise<LanguageModelEntry>;
}

const NO_LANGUAGE_MODELS: LanguageModelStore = {
  known: () => [],
  check: () => 'missing',
  verify: () => Promise.resolve('missing'),
  add: () => Promise.reject(new LanguageModelRefused('This copy of Drashti knows no language models.')),
};

export class CaptionsService {
  readonly hub: SpeechHubControl;
  private readonly feed: CaptionsFeed;
  private switch: CaptionsSwitch;
  private tuning: CaptionsTuning;
  private readonly models: LanguageModelStore;
  /** A file being checked or added, per language (alpha.22). */
  private readonly checking = new Set<LanguageModelLanguage>();
  /** Why a file was not added, per language, until the next change there (alpha.22). */
  private readonly notices = new Map<LanguageModelLanguage, string>();
  private download: CaptionsDownload;
  private downloading: { controller: AbortController; promise: Promise<void> } | null = null;
  private streamInUse = false;
  private closed = false;
  private toldAt = 0;
  private telling: NodeJS.Timeout | null = null;

  constructor(private readonly deps: CaptionsServiceDeps) {
    this.switch = readCaptionsSwitch(deps.userData, deps.platform, deps.arch);
    this.tuning = readCaptionsTuning(deps.userData);
    this.models = deps.languageModels ?? NO_LANGUAGE_MODELS;
    this.hub = createSpeechHub({
      engine: {
        // The model first: without it the hub is held (no-model) until it is downloaded.
        start: (language, to) => {
          // A model of its own chosen for the language (alpha.22) is used only when it is here and checked: never
          // the general model in its place.
          const own = this.ownModel(language);
          if (own !== null) {
            if (own.phase !== 'ready') {
              to.state({ phase: 'failed', message: own.message });
              return () => undefined;
            }
            return this.deps.engine.start(language, to);
          }
          if (!this.deps.modelReady(this.switch.model)) {
            to.state({ phase: 'held', reason: 'no-model' });
            return () => undefined;
          }
          return this.deps.engine.start(language, to);
        },
      },
      log: deps.log,
    });
    this.feed = createCaptionsFeed({
      hub: this.hub,
      show: deps.show,
      onFinalPhrase: (phrase) => deps.onFinalPhrase?.(phrase),
      settings: () => this.settings(),
    });
    this.hub.onState(() => {
      this.tell();
    });
    this.download = this.modelState();
  }

  private settings(): CaptionSettings {
    return parseCaptionSettings(this.deps.repo.get());
  }

  private modelState(): CaptionsDownload {
    const total = CAPTION_MODELS[this.switch.model].bytes;
    return this.deps.modelReady(this.switch.model)
      ? { phase: 'ready', done: total, total, message: null }
      : {
          phase: 'missing',
          done: 0,
          total,
          message:
            this.switch.on && this.streamInUse
              ? 'The model download waits until the stream and recording stop.'
              : null,
        };
  }

  selectedModel(): CaptionModelId {
    return this.switch.model;
  }

  view(): CaptionsStatus {
    const engineProblem = this.deps.engineProblem();
    return {
      on: this.switch.on,
      model: this.switch.model,
      settings: this.settings(),
      download: this.download,
      speech: this.hub.state(),
      engine: engineProblem === null,
      engineProblem,
      trial: true,
      languageModels: LANGUAGE_MODEL_LANGUAGES.map((language) => this.languageModelView(language)),
      timing: this.tuning.timing,
    };
  }

  /** At Drashti's start: captions left on carry on (their model downloaded again if it has gone). */
  start(): void {
    this.hub.setLanguage(this.settings().language);
    if (this.switch.on) void this.turnOn();
  }

  async setOn(on: boolean): Promise<CaptionsStatus> {
    const next = { ...this.switch, on };
    writeCaptionsSwitch(this.deps.userData, next);
    this.switch = next;
    this.deps.log.info(`Captions: turned ${on ? 'on' : 'off'} on this computer.`);
    if (on) {
      if (!this.downloading || this.downloading.controller.signal.aborted) this.download = this.modelState();
      await this.turnOn();
    } else this.turnOff();
    this.tell();
    return this.view();
  }

  async setModel(model: CaptionModelId): Promise<CaptionsStatus> {
    if (model === this.switch.model) return this.view();
    const next = { ...this.switch, model };
    writeCaptionsSwitch(this.deps.userData, next);
    this.switch = next;
    if (this.switch.on) {
      this.turnOff();
      await this.turnOn();
    } else this.download = this.modelState();
    this.tell();
    return this.view();
  }

  setSettings(settings: CaptionSettings): CaptionsStatus {
    const s = parseCaptionSettings(settings);
    this.deps.repo.set(s);
    this.hub.setLanguage(s.language);
    this.feed.refresh();
    this.tell();
    return this.view();
  }

  /** Try the download again (after no internet). */
  async retry(): Promise<CaptionsStatus> {
    await this.fetchModel();
    return this.view();
  }

  /** Downloads give way to the show; a model already on disk keeps listening. */
  setStreamInUse(inUse: boolean): void {
    if (this.streamInUse === inUse || this.closed) return;
    this.streamInUse = inUse;
    if (!this.switch.on) return;
    if (inUse) {
      this.stopDownload();
      this.tell();
    } else void this.fetchModel();
  }

  close(): void {
    this.closed = true;
    this.downloading?.controller.abort();
    this.feed.stop();
    this.hub.close();
    if (this.telling) clearTimeout(this.telling);
  }

  private async turnOn(): Promise<void> {
    if (this.deps.engineProblem() !== null) return;
    this.hub.setOn(true);
    this.feed.start();
    await this.fetchModel();
  }

  private turnOff(): void {
    this.stopDownload();
    this.feed.stop();
    this.hub.setOn(false);
  }

  private stopDownload(): void {
    this.downloading?.controller.abort();
    this.download = this.modelState();
  }

  private async fetchModel(): Promise<void> {
    const id = this.switch.model;
    if (
      this.closed ||
      !this.switch.on ||
      this.streamInUse ||
      this.deps.engineProblem() !== null ||
      this.deps.modelReady(id)
    )
      return;
    const running = this.downloading;
    if (running) {
      await running.promise;
      // Even when the operator switches right back, wait for the old writer to close the partial file.
      if (running.controller.signal.aborted) await this.fetchModel();
      return;
    }
    const total = CAPTION_MODELS[id].bytes;
    const controller = new AbortController();
    this.download = { phase: 'downloading', done: 0, total, message: null };
    const promise = Promise.resolve().then(() => this.runDownload(id, total, controller.signal));
    this.downloading = { controller, promise };
    this.tell();
    await promise;
  }

  private async runDownload(id: CaptionModelId, total: number, signal: AbortSignal): Promise<void> {
    const stopped = (): boolean => signal.aborted || this.switch.model !== id;
    try {
      if (stopped()) return;
      this.deps.log.info(
        `Captions: downloading the ${id} model (${String(Math.round(total / 1_000_000))} MB).`,
      );
      await this.deps.download(
        id,
        (done, of) => {
          if (stopped()) return;
          this.download = { phase: 'downloading', done, total: of, message: null };
          this.tellSoon();
        },
        signal,
      );
      if (stopped()) return;
      this.download = { phase: 'ready', done: total, total, message: null };
      this.deps.log.info(`Captions: the ${id} model is downloaded and checked.`);
      // Listening starts again, now with its model.
      this.hub.setOn(false);
      this.hub.setOn(true);
    } catch (error) {
      if (stopped()) return;
      const message =
        error instanceof Error
          ? error.message
          : 'The captions model could not be downloaded: try again when this computer is online.';
      this.download = { phase: 'failed', done: 0, total, message };
      this.deps.log.warn(`Captions: the ${id} model was not downloaded (${message})`);
    } finally {
      this.downloading = null;
      this.tell();
    }
  }

  /* ---- a model per language and live timing (alpha.22) ---- */

  /**
   * The model of its own that hears this language now, here and checked, or null: the general model does (none
   * chosen, "as heard", Sanskrit), or nothing does (the chosen one is not ready: listening says why).
   */
  languageModelFor(language: SpeechLanguage | 'auto'): LanguageModelEntry | null {
    const own = this.ownModel(language);
    return own?.phase === 'ready' ? own.entry : null;
  }

  /**
   * Why the model for this language may not be used now (its own model chosen but not here, changed or unknown),
   * or null: asked again before every start of the engine.
   */
  modelProblem(language: SpeechLanguage | 'auto'): string | null {
    const own = this.ownModel(language);
    return own === null || own.phase === 'ready' ? null : own.message;
  }

  /** The live timing on this computer. */
  timing(): CaptionTiming {
    return this.tuning.timing;
  }

  /** Choose the model for a language (a known id), or the general model (null). */
  setLanguageModel(language: LanguageModelLanguage, id: string | null): CaptionsStatus {
    if (!isLanguageModelLanguage(language)) return this.view();
    if (id !== null && !this.known(language).some((entry) => entry.id === id)) return this.view();
    this.notices.delete(language);
    this.choose(language, id);
    this.tell();
    return this.view();
  }

  /** Add a model file the admin chose for a language: checked, copied in, and chosen for it. */
  async addLanguageModel(language: LanguageModelLanguage, source: string): Promise<CaptionsStatus> {
    if (!isLanguageModelLanguage(language) || this.checking.has(language) || this.closed) return this.view();
    if (this.streamInUse) {
      this.notices.set(language, 'Add a model file when the stream and recording have stopped.');
      this.tell();
      return this.view();
    }
    this.notices.delete(language);
    this.checking.add(language);
    this.tell();
    try {
      const entry = await this.models.add(language, source);
      this.deps.log.info(`Captions: the ${entry.id} model was added for ${languageName(language)}.`);
      this.checking.delete(language);
      this.choose(language, entry.id, true);
    } catch (error) {
      this.checking.delete(language);
      const message =
        error instanceof LanguageModelRefused
          ? error.message
          : 'Drashti could not add that model file: check the file, then add it again.';
      this.notices.set(language, message);
      this.deps.log.warn(`Captions: a model file for ${languageName(language)} was not added.`);
    }
    this.tell();
    return this.view();
  }

  /** Check the chosen model's file whole again (after it was found changed). */
  async checkLanguageModel(language: LanguageModelLanguage): Promise<CaptionsStatus> {
    if (!isLanguageModelLanguage(language) || this.checking.has(language) || this.closed) return this.view();
    const id = this.tuning.languageModels[language];
    const entry = this.known(language).find((e) => e.id === id);
    if (!entry) return this.view();
    this.notices.delete(language);
    this.checking.add(language);
    this.tell();
    const result = await this.models.verify(entry).catch((): LanguageModelCheck => 'missing');
    this.checking.delete(language);
    this.deps.log.info(`Captions: the ${entry.id} model was checked again (${result}).`);
    if (result === 'ready' && this.hearing(language)) this.relisten();
    this.tell();
    return this.view();
  }

  /** Keep the live timing on this computer; listening starts again with it. */
  setTiming(timing: CaptionTiming): CaptionsStatus {
    const next = { ...this.tuning, timing: parseCaptionTiming(timing) };
    writeCaptionsTuning(this.deps.userData, next);
    this.tuning = next;
    this.relisten();
    this.tell();
    return this.view();
  }

  private known(language: LanguageModelLanguage): LanguageModelEntry[] {
    return this.models.known().filter((entry) => entry.language === language);
  }

  /** Whether listening is on and hears this language now. */
  private hearing(language: LanguageModelLanguage): boolean {
    return this.switch.on && this.settings().language === language;
  }

  private choose(language: LanguageModelLanguage, id: string | null, always = false): void {
    const was = this.tuning.languageModels[language] ?? null;
    if (was === id && !always) return;
    const languageModels: CaptionsTuning['languageModels'] = {};
    for (const each of LANGUAGE_MODEL_LANGUAGES) {
      const chosen = each === language ? id : (this.tuning.languageModels[each] ?? null);
      if (chosen !== null) languageModels[each] = chosen;
    }
    const next = { ...this.tuning, languageModels };
    writeCaptionsTuning(this.deps.userData, next);
    this.tuning = next;
    if (this.hearing(language)) this.relisten();
  }

  /** Listening starts again (a model or the timing changed), when it is on. */
  private relisten(): void {
    if (!this.switch.on || this.closed) return;
    this.hub.setOn(false);
    this.hub.setOn(true);
  }

  /** The model of its own chosen for this language, and how it stands; null when none is chosen. */
  private ownModel(
    language: SpeechLanguage | 'auto',
  ): { entry: LanguageModelEntry | null; phase: LanguageModelView['phase']; message: string } | null {
    if (!isLanguageModelLanguage(language)) return null;
    const id = this.tuning.languageModels[language];
    if (id === undefined) return null;
    const name = languageName(language);
    const entry = this.known(language).find((e) => e.id === id) ?? null;
    if (!entry)
      return {
        entry,
        phase: 'unknown',
        message: `The model chosen for ${name} is not one this copy of Drashti knows, so captions do not use it. Choose another model for ${name}.`,
      };
    if (this.checking.has(language)) return { entry, phase: 'checking', message: 'Checking the file…' };
    switch (this.models.check(entry)) {
      case 'ready':
        return { entry, phase: 'ready', message: '' };
      case 'missing':
        return {
          entry,
          phase: 'missing',
          message: `The ${name} model is not on this computer: add its file in File › Live Captions….`,
        };
      case 'changed':
        return {
          entry,
          phase: 'changed',
          message: `The ${name} model’s file has changed since Drashti checked it, so captions do not use it. Check it again, or add its file again.`,
        };
    }
  }

  private languageModelView(language: LanguageModelLanguage): LanguageModelView {
    const known = this.known(language).map((entry) => ({
      id: entry.id,
      name: entry.name,
      bytes: entry.bytes,
      here: this.models.check(entry) === 'ready',
    }));
    const own = this.ownModel(language);
    const notice = this.notices.get(language) ?? null;
    const checking = this.checking.has(language);
    if (own === null)
      return {
        language,
        known,
        chosen: null,
        phase: checking ? 'checking' : 'general',
        message: checking ? 'Checking the file…' : notice,
      };
    return {
      language,
      known,
      chosen: this.tuning.languageModels[language] ?? null,
      phase: own.phase,
      message: notice ?? (own.phase === 'ready' ? null : own.message),
    };
  }

  /** Tell the dialog now. */
  private tell(): void {
    if (this.closed) return;
    if (this.telling) clearTimeout(this.telling);
    this.telling = null;
    this.toldAt = Date.now();
    this.deps.changed(this.view());
  }

  /** Tell the dialog at most four times a second (a download's progress). */
  private tellSoon(): void {
    const wait = this.toldAt + 250 - Date.now();
    if (wait <= 0) this.tell();
    else
      this.telling ??= setTimeout(() => {
        this.tell();
      }, wait);
  }
}
