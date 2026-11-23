import {
  CAPTION_MODELS,
  parseCaptionSettings,
  type CaptionModelId,
  type CaptionSettings,
  type CaptionsDownload,
  type CaptionsShown,
  type CaptionsStatus,
} from '../../shared/captions';
import type { Heard, SpeechLanguage } from '../../shared/speech';
import type { CaptionRecognizer } from './caption-routes';
import {
  chooseCaptionPath,
  createCaptionFlow,
  type CaptionPaths,
  type CaptionSpelling,
  type ClauseSink,
} from './caption-flow';
import { createCaptionsFeed, type CaptionsFeed } from './captions-feed';
import { readCaptionsSwitch, writeCaptionsSwitch, type CaptionsSwitch } from './captions-switch';
import { createSpeechHub, type SpeechEngine, type SpeechHubControl } from './hub';

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
    /** The recognizer for this language, from the pack's checked model, or null. */
    recognizer(language: SpeechLanguage): CaptionRecognizer | null;
    coordinator: ClauseSink;
    spelling?: CaptionSpelling;
  };
  /** Tell the operator window (the dialog). */
  changed: (view: CaptionsStatus) => void;
  log: { info(message: string): void; warn(message: string): void };
}

const LANGUAGE_NAMES: Readonly<Record<SpeechLanguage, string>> = Object.freeze({
  gu: 'Gujarati',
  hi: 'Hindi',
  sa: 'Sanskrit',
  en: 'English',
});

export class CaptionsService {
  readonly hub: SpeechHubControl;
  private readonly feed: CaptionsFeed;
  /** Today's feed or caption AI's flow, when caption AI is wired in (null: today's feed alone). */
  private readonly paths: CaptionPaths | null;
  private switch: CaptionsSwitch;
  private download: CaptionsDownload;
  private downloading: { controller: AbortController; promise: Promise<void> } | null = null;
  private streamInUse = false;
  private closed = false;
  private toldAt = 0;
  private telling: NodeJS.Timeout | null = null;

  constructor(private readonly deps: CaptionsServiceDeps) {
    this.switch = readCaptionsSwitch(deps.userData, deps.platform, deps.arch);
    this.hub = createSpeechHub({
      engine: {
        // The model first: without it the hub is held (no-model) until it is downloaded.
        start: (language, to) => {
          // Caption AI: the speaker's language, and its checked model from the pack (never a download).
          if (this.useAi()) {
            const problem =
              language === 'auto'
                ? 'Caption AI listens for one language: choose the speaker’s language.'
                : this.deps.aiPath?.recognizer(language)
                  ? null
                  : `Caption AI has no checked model for ${LANGUAGE_NAMES[language]}: import the model pack (Help › Caption and Translation Models…).`;
            if (problem !== null) {
              to.state({ phase: 'failed', message: problem });
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
      onFinalPhrase: (phrase) => deps.onFinalPhrase?.(phrase),
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
            onFinalPhrase: (phrase) => deps.onFinalPhrase?.(phrase),
          }),
          () => this.useAi(),
          () => {
            this.hub.setOn(false);
            this.hub.setOn(true);
          },
        )
      : null;
    this.feed = this.paths ?? today;
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

  private useAi(): boolean {
    return this.deps.aiPath?.on() === true;
  }

  /** The route and pack model caption AI listens with now, or null (today's captions). Never a word. */
  aiRecognizer(): { route: string; modelId: string } | null {
    return null;
  }

  /** The admin turned caption AI on or off: while captions run, the other path takes over at once. */
  aiPathChanged(): void {
    if (this.closed || !this.paths) return;
    this.paths.reselect();
    if (this.switch.on) void this.fetchModel();
    this.tell();
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
