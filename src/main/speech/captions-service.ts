import { availableParallelism } from 'node:os';
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
  type CaptionsStopped,
} from '../../shared/captions';
import type { CaptionCorrection, CaptionReview } from '../../shared/caption-coordinator';
import type { Heard, SlowHold, SpeechLanguage, SpeechState } from '../../shared/speech';
import type { CaptionRecognizer } from './caption-routes';
import {
  chooseCaptionPath,
  createCaptionFlow,
  type CaptionPaths,
  type CaptionSpelling,
  type ClauseSink,
} from './caption-flow';
import { CaptionPrototype } from './caption-prototype';
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
import { languageName, type LanguageModelCheck, type LanguageModelEntry } from './language-models';

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
  /**
   * Caption AI (alpha.22): when the admin chose it, the speaker's language is heard by a recognizer made from that
   * language's checked model in the offline pack (Route W's whisper.cpp or Route C's IndicConformer: caption-routes.ts),
   * and what it hears goes through the coordinator instead of today's feed. Not given, or off: today's captions
   * exactly as before.
   */
  aiPath?: {
    on(): boolean;
    /**
     * The route this language's own model runs on ('conformer', 'whisper'), without making its engine, or null.
     * Route C ('conformer') needs no whisper-server (alpha.23); left out, every route is taken to need it.
     */
    route?(language: SpeechLanguage): string | null;
    /** What keeps Route C itself from running on this computer (its helper, macOS 13.4), or null (review S1). */
    problem?(language: SpeechLanguage): string | null;
    /** The recognizer for this language, from the pack's checked model, or null. */
    recognizer(language: SpeechLanguage): CaptionRecognizer | null;
    coordinator: ClauseSink;
    spelling?: CaptionSpelling;
  };
  /** Separate private operator review; never included in the existing status. */
  prototypeChanged?: (review: CaptionReview) => void;
  /** The caption words' spelling fixer (alpha.22): each phrase from the engine passes through it, partials too. */
  spell?: (phrase: Heard) => Heard;
  /** Tell the operator window (the dialog). */
  changed: (view: CaptionsStatus) => void;
  log: { info(message: string): void; warn(message: string): void };
  /** The language models on this computer (alpha.22; main/speech/language-models.ts). None known when left out. */
  languageModels?: LanguageModelStore;
  /** This computer's logical processors (os.availableParallelism; a test may say), for the dialog (cap-threads). */
  processors?: () => number;
}

const LANGUAGE_NAMES: Readonly<Record<SpeechLanguage, string>> = Object.freeze({
  gu: 'Gujarati',
  hi: 'Hindi',
  sa: 'Sanskrit',
  en: 'English',
});

/** A model of its own per language on this computer (alpha.22): what Drashti knows, and each file's check. */
export interface LanguageModelStore {
  /** The models this copy of Drashti knows (by SHA-256). */
  known(): readonly LanguageModelEntry[];
  /** The quick check before each use. */
  check(entry: LanguageModelEntry): LanguageModelCheck;
  /** The file checked whole again (stamped again when it is still the same). */
  verify(entry: LanguageModelEntry): Promise<LanguageModelCheck>;
}

const NO_LANGUAGE_MODELS: LanguageModelStore = {
  known: () => [],
  check: () => 'missing',
  verify: () => Promise.resolve('missing'),
};

export class CaptionsService {
  readonly hub: SpeechHubControl;
  /** Why captions turned themselves off (cap-threads), until they are turned on again. */
  private tooSlow: CaptionsStopped | null = null;
  /**
   * A phrase shown whole since the operator last turned captions on, with this model (MUST-1b): kept across the
   * engine's own starts (a language or timing change, Route W's fresh engine), so a computer that has kept up is never
   * stopped as too slow. Forgotten when the operator turns captions on, and on another model.
   */
  private shownWhole = false;
  private stoppingTooSlow = false;
  private readonly feed: CaptionsFeed;
  /** Today's feed or caption AI's flow, when caption AI is wired in (null: today's feed alone). */
  private readonly paths: CaptionPaths | null;
  /** What caption AI's recognizer is while it runs. */
  private recognizer: { route: string; modelId: string } | null = null;
  /** Whether captions were started (turnOn), not only switched on: whisper's problem can keep them from it. */
  private listening = false;
  /**
   * Switched on but kept from starting by the engine's problem (turnOn): a choice that lets another engine hear may
   * start them (resume). Never set by the rehearsal or an access stop, so nothing starts again after those (review n1).
   */
  private blocked = false;
  private readonly prototype: CaptionPrototype;
  private switch: CaptionsSwitch;
  private tuning: CaptionsTuning;
  private readonly models: LanguageModelStore;
  /** A language's model being checked whole again, per language (alpha.22). */
  private readonly checking = new Set<LanguageModelLanguage>();
  private download: CaptionsDownload;
  private downloading: { controller: AbortController; promise: Promise<void> } | null = null;
  private streamInUse = false;
  private closed = false;
  private toldAt = 0;
  private telling: NodeJS.Timeout | null = null;

  constructor(private readonly deps: CaptionsServiceDeps) {
    this.prototype = new CaptionPrototype({
      settings: () => this.settings(),
      show: deps.show,
      changed: (review) => deps.prototypeChanged?.(review),
    });
    this.switch = readCaptionsSwitch(deps.userData, deps.platform, deps.arch);
    this.tuning = readCaptionsTuning(deps.userData);
    this.models = deps.languageModels ?? NO_LANGUAGE_MODELS;
    this.hub = createSpeechHub({
      engine: {
        // The model first: without it the hub is held (no-model) until it is downloaded.
        start: (language, given) => {
          // The caption words' fixer (cap-glossary) on every phrase from whichever engine hears: caption AI's, a
          // language's own model or the general one.
          const spell = this.deps.spell;
          const to = spell
            ? { heard: (h: Heard) => given.heard(spell(h)), state: (s: SpeechState) => given.state(s) }
            : given;
          // Caption AI: the speaker's language, and its checked model from the pack (never a download). Only while
          // its path is the one running: a restart on today's path (a model downloaded) stays today's (review S2).
          if (this.paths ? this.paths.usingAi() : this.useAi()) {
            if (language === 'auto') {
              to.state({
                phase: 'failed',
                message: 'Caption AI listens for one language: choose the speaker’s language.',
              });
              return () => undefined;
            }
            const recognizer = this.deps.aiPath?.recognizer(language) ?? null;
            if (recognizer === null) {
              to.state({
                phase: 'failed',
                message: `Caption AI has no checked model for ${LANGUAGE_NAMES[language]}: import the model pack (Help › Caption and Translation Models…).`,
              });
              return () => undefined;
            }
            // Route W runs on Drashti's whisper engine: what is wrong with it stops it as today's captions.
            const problem = recognizer.route === 'conformer' ? null : this.deps.engineProblem();
            if (problem !== null) {
              to.state({ phase: 'failed', message: problem });
              return () => undefined;
            }
            this.recognizer = { route: recognizer.route, modelId: recognizer.modelId };
            const stop = recognizer.engine.start(language, to);
            return () => {
              this.recognizer = null;
              stop();
            };
          }
          // Today's captions need Drashti's whisper engine (reached here when caption AI on Route C, which needs
          // none, was listening and the speaker's language changed).
          const problem = this.deps.engineProblem();
          if (problem !== null) {
            to.state({ phase: 'failed', message: problem });
            return () => undefined;
          }
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
    const today = createCaptionsFeed({
      hub: this.hub,
      show: deps.show,
      onFinalPhrase: (phrase) => {
        this.shownWhole = true;
        deps.onFinalPhrase?.(phrase);
      },
      settings: () => this.settings(),
    });
    const ai = deps.aiPath;
    this.paths = ai
      ? chooseCaptionPath(
          today,
          createCaptionFlow({
            hub: this.hub,
            coordinator: ai.coordinator,
            ...(ai.spelling ? { spelling: ai.spelling } : {}),
            onFinalPhrase: (phrase) => {
              this.shownWhole = true;
              deps.onFinalPhrase?.(phrase);
            },
          }),
          () => this.useAi(),
          () => {
            this.hub.setOn(false);
            this.hub.setOn(true);
          },
        )
      : null;
    this.feed = this.paths ?? today;
    this.hub.onState((s) => {
      // The owner (cap-threads, Q-CT-1): "Say so and stop". The engine's own decision turns captions off (review n5).
      if (s.phase === 'held' && s.reason === 'busy' && s.slow?.stops === true) this.stopTooSlow(s.slow);
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

  private useAi(): boolean {
    return this.deps.aiPath?.on() === true;
  }

  /** The route and pack model caption AI listens with now, or null (today's captions). Never a word. */
  aiRecognizer(): { route: string; modelId: string } | null {
    return this.recognizer;
  }

  /** The admin turned caption AI on or off: while captions run, the other path takes over at once. */
  aiPathChanged(): void {
    if (this.closed || !this.paths) return;
    this.choosePath();
    this.tell();
  }

  /** Caption AI's path or today's chosen again; back on today's, its general model is fetched if it is not here. */
  private choosePath(): void {
    if (!this.paths) return;
    const wasAi = this.paths.usingAi();
    this.paths.reselect();
    if (wasAi && !this.paths.usingAi() && this.switch.on) void this.fetchModel();
    this.resume();
  }

  /** The operator's review: caption AI's phrases while it runs (and no rehearsal does), else the rehearsal's. */
  prototypeView(): CaptionReview {
    return (this.aiReview() ?? this.prototype).view();
  }

  /** Caption AI's coordinator while its flow runs and no placeholder rehearsal does, or null. */
  private aiReview(): ClauseSink | null {
    const ai = this.deps.aiPath;
    return ai && this.paths?.usingAi() === true && !this.prototype.view().on ? ai.coordinator : null;
  }

  setPrototypeOn(on: boolean): void {
    if (this.closed || on === this.prototype.view().on) return;
    if (on) {
      this.turnOff();
      this.prototype.setOn(true);
    } else {
      this.prototype.setOn(false);
      if (this.switch.on) void this.turnOn();
    }
    this.tell();
  }

  /** An access stop: the rehearsal ends at once, and nothing of the real captions starts again (no listening, no download). */
  cancelPrototype(): void {
    if (this.closed || !this.prototype.view().on) return;
    this.prototype.setOn(false);
    this.tell();
  }

  advancePrototype(): void {
    if (!this.closed) this.prototype.advance();
  }
  restartPrototype(): void {
    if (!this.closed && this.prototype.view().on) this.prototype.restart();
  }
  correctPrototype(correction: CaptionCorrection): boolean {
    return !this.closed && (this.aiReview() ?? this.prototype).correct(correction);
  }
  dismissPrototype(key: Omit<CaptionCorrection, 'text'>): boolean {
    return !this.closed && (this.aiReview() ?? this.prototype).dismiss(key);
  }

  selectedModel(): CaptionModelId {
    return this.switch.model;
  }

  view(): CaptionsStatus {
    const engineProblem = this.hearingProblem();
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
      processors: (this.deps.processors ?? availableParallelism)(),
      stopped: this.tooSlow,
    };
  }

  /** At Drashti's start: captions left on carry on (their model downloaded again if it has gone). */
  start(): void {
    this.hub.setLanguage(this.settings().language);
    if (this.switch.on) void this.turnOn();
  }

  async setOn(on: boolean): Promise<CaptionsStatus> {
    return this.switchTo(on, null);
  }

  /**
   * This computer rested CAPTIONS_STOP_AFTER_RESTS times in a row, never having kept up since it started, too slow
   * for live captions with the model (cap-threads): captions turn off on this computer, as the switch does (the engine
   * stopped, so Route W gives its pack's file back), Off saved as the switch saves it, with the reason kept for the
   * dialog and the status bar until they are turned on again or another model is chosen (never on disk).
   */
  private stopTooSlow(slow: SlowHold): void {
    if (this.closed || !this.switch.on || this.stoppingTooSlow) return;
    this.stoppingTooSlow = true;
    const stopped: CaptionsStopped = { slow, language: this.settings().language };
    this.deps.log.warn(
      `Captions: this computer is too slow for live captions with this model (${String(slow.rests)} rests in a row), so they stop.`,
    );
    // After the hub has told every listener of this rest: never stopped from inside its own telling.
    queueMicrotask(() => {
      this.stoppingTooSlow = false;
      if (!this.closed && this.switch.on) void this.switchTo(false, stopped);
    });
  }

  /** Whether captions have shown a phrase whole since the operator last turned them on (cap-review-threads MUST-1b). */
  keptUp(): boolean {
    return this.shownWhole;
  }

  /** The switch on this computer, with why captions turned themselves off (or null). */
  private async switchTo(on: boolean, stopped: CaptionsStopped | null): Promise<CaptionsStatus> {
    this.tooSlow = stopped;
    // Turned on by the operator: a fresh start, nothing kept up yet (MUST-1b).
    if (on) this.shownWhole = false;
    if (this.prototype.view().on) this.prototype.setOn(false);
    const next = { ...this.switch, on };
    try {
      writeCaptionsSwitch(this.deps.userData, next);
    } catch (error) {
      // Turning off by itself still turns off (review SHOULD-1): a full disk or a locked file only loses the saving.
      if (stopped === null) throw error;
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'unknown';
      this.deps.log.warn(
        `Captions: Off could not be saved on this computer (${code}); they are off until Drashti starts again.`,
      );
    }
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
    // Another model: "too slow with this model" no longer holds (review n2), nor what kept up before (MUST-1b); the
    // switch stays as it is.
    this.tooSlow = null;
    this.shownWhole = false;
    const next = { ...this.switch, model };
    writeCaptionsSwitch(this.deps.userData, next);
    this.switch = next;
    if (this.prototype.view().on) {
      // The rehearsal starts a fresh session; the newly chosen model is not loaded while it runs.
      this.prototype.restart();
      this.download = this.modelState();
    } else if (this.switch.on) {
      this.turnOff();
      await this.turnOn();
    } else this.download = this.modelState();
    this.tell();
    return this.view();
  }

  setSettings(settings: CaptionSettings): CaptionsStatus {
    const s = parseCaptionSettings(settings);
    const languageChanged = s.language !== this.settings().language;
    this.deps.repo.set(s);
    if (this.prototype.view().on) {
      if (languageChanged) this.prototype.restart();
      else this.prototype.refresh();
    }
    this.hub.setLanguage(s.language);
    // Caption AI follows the speaker's language at once (a language with its own model, or not).
    this.choosePath();
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
    this.prototype.setOn(false);
    this.downloading?.controller.abort();
    this.feed.stop();
    this.hub.close();
    if (this.telling) clearTimeout(this.telling);
  }

  private async turnOn(): Promise<void> {
    if (this.closed || this.prototype.view().on) return;
    if (this.hearingProblem() !== null) {
      this.blocked = true;
      return;
    }
    this.blocked = false;
    this.listening = true;
    this.hub.setOn(true);
    this.feed.start();
    await this.fetchModel();
  }

  private turnOff(): void {
    this.listening = false;
    this.blocked = false;
    this.stopDownload();
    this.feed.stop();
    this.hub.setOn(false);
  }

  /**
   * What keeps the engine that hears now from running on this computer: Drashti's whisper engine for today's captions
   * and Route W; for a language whose own model runs on Route C, Route C's own reason (a Mac before 13.4, no helper),
   * never whisper's (alpha.23: cap-realc, the review's S1).
   */
  private hearingProblem(): string | null {
    const language = this.settings().language;
    if (!this.useAi() || language === 'auto') return this.deps.engineProblem();
    const ai = this.deps.aiPath;
    return ai?.route?.(language) === 'conformer'
      ? (ai.problem?.(language) ?? null)
      : this.deps.engineProblem();
  }

  /**
   * Captions are on but did not start (an engine's problem): a language whose engine can run starts now. Captions the
   * rehearsal or an access stop stopped are not waiting: they start again only when turned on (review n1).
   */
  private resume(): void {
    if (this.switch.on && this.blocked && !this.listening && !this.closed) void this.turnOn();
  }

  private stopDownload(): void {
    this.downloading?.controller.abort();
    this.download = this.modelState();
  }

  private async fetchModel(): Promise<void> {
    const id = this.switch.model;
    if (
      this.closed ||
      this.prototype.view().on ||
      !this.switch.on ||
      this.streamInUse ||
      this.deps.engineProblem() !== null ||
      this.deps.modelReady(id) ||
      // Caption AI's models come from the pack, imported by the admin: nothing is downloaded for it.
      this.useAi()
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
    this.tooSlow = null;
    this.shownWhole = false;
    this.choose(language, id);
    this.tell();
    return this.view();
  }

  /** Check the chosen model's file whole again (after it was found changed). */
  async checkLanguageModel(language: LanguageModelLanguage): Promise<CaptionsStatus> {
    if (!isLanguageModelLanguage(language) || this.checking.has(language) || this.closed) return this.view();
    const id = this.tuning.languageModels[language];
    const entry = this.known(language).find((e) => e.id === id);
    if (!entry) return this.view();
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

  private choose(language: LanguageModelLanguage, id: string | null): void {
    const was = this.tuning.languageModels[language] ?? null;
    if (was === id) return;
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
    // Not listening: kept from starting by whisper's problem, start now if what hears needs no whisper; else (the
    // rehearsal or an access stop) stay as it is.
    if (!this.listening) {
      this.resume();
      return;
    }
    // A language's own model chosen or taken away: caption AI or today's captions take over (listening again).
    const wasAi = this.paths?.usingAi() === true;
    if (this.paths?.reselect()) {
      if (wasAi && !this.paths.usingAi()) void this.fetchModel();
      return;
    }
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
          message: `The ${name} model is not on this computer: import the model pack that holds it (Help › Caption and Translation Models…).`,
        };
      case 'changed':
        return {
          entry,
          phase: 'changed',
          message: `The ${name} model’s file has changed since Drashti checked it, so captions do not use it. Check it again, or import the model pack again (Help › Caption and Translation Models…).`,
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
    const checking = this.checking.has(language);
    if (own === null)
      return {
        language,
        known,
        chosen: null,
        phase: checking ? 'checking' : 'general',
        message: checking ? 'Checking the file…' : null,
      };
    return {
      language,
      known,
      chosen: this.tuning.languageModels[language] ?? null,
      phase: own.phase,
      message: own.phase === 'ready' ? null : own.message,
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
