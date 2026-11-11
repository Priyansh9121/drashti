import {
  CAPTION_MODELS,
  parseCaptionSettings,
  type CaptionModelId,
  type CaptionSettings,
  type CaptionsDownload,
  type CaptionsShown,
  type CaptionsStatus,
} from '../../shared/captions';
import type { Heard } from '../../shared/speech';
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
  download: (id: CaptionModelId, progress: (done: number, total: number) => void) => Promise<void>;
  /** The engine's setCaptions. */
  show: (captions: CaptionsShown | null) => void;
  onFinalPhrase?: (phrase: Heard) => void;
  /** Tell the operator window (the dialog). */
  changed: (view: CaptionsStatus) => void;
  log: { info(message: string): void; warn(message: string): void };
}

export class CaptionsService {
  readonly hub: SpeechHubControl;
  private readonly feed: CaptionsFeed;
  private switch: CaptionsSwitch;
  private download: CaptionsDownload;
  private downloading: Promise<void> | null = null;
  private toldAt = 0;
  private telling: NodeJS.Timeout | null = null;

  constructor(private readonly deps: CaptionsServiceDeps) {
    this.switch = readCaptionsSwitch(deps.userData, deps.platform, deps.arch);
    this.hub = createSpeechHub({
      engine: {
        // The model first: without it the hub is held (no-model) until it is downloaded.
        start: (language, to) => {
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
      : { phase: 'missing', done: 0, total, message: null };
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
    this.switch = { ...this.switch, on };
    writeCaptionsSwitch(this.deps.userData, this.switch);
    this.deps.log.info(`Captions: turned ${on ? 'on' : 'off'} on this computer.`);
    if (on) await this.turnOn();
    else this.turnOff();
    this.tell();
    return this.view();
  }

  async setModel(model: CaptionModelId): Promise<CaptionsStatus> {
    if (model === this.switch.model) return this.view();
    this.switch = { ...this.switch, model };
    writeCaptionsSwitch(this.deps.userData, this.switch);
    this.download = this.modelState();
    if (this.switch.on) {
      this.turnOff();
      await this.turnOn();
    }
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
    if (this.switch.on && !this.deps.modelReady(this.switch.model)) await this.fetchModel();
    return this.view();
  }

  close(): void {
    this.feed.stop();
    this.hub.close();
    if (this.telling) clearTimeout(this.telling);
  }

  private async turnOn(): Promise<void> {
    if (this.deps.engineProblem() !== null) return;
    this.hub.setOn(true);
    this.feed.start();
    if (!this.deps.modelReady(this.switch.model)) await this.fetchModel();
  }

  private turnOff(): void {
    this.feed.stop();
    this.hub.setOn(false);
  }

  private fetchModel(): Promise<void> {
    if (this.downloading) return this.downloading;
    const id = this.switch.model;
    const total = CAPTION_MODELS[id].bytes;
    this.download = { phase: 'downloading', done: 0, total, message: null };
    this.tell();
    this.deps.log.info(
      `Captions: downloading the ${id} model (${String(Math.round(total / 1_000_000))} MB).`,
    );
    this.downloading = this.deps
      .download(id, (done, of) => {
        this.download = { phase: 'downloading', done, total: of, message: null };
        this.tellSoon();
      })
      .then(() => {
        this.download = { phase: 'ready', done: total, total, message: null };
        this.deps.log.info(`Captions: the ${id} model is downloaded and checked.`);
        // Listening starts again, now with its model.
        if (this.switch.on && this.switch.model === id) {
          this.hub.setOn(false);
          this.hub.setOn(true);
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : 'The captions model could not be downloaded: try again when this computer is online.';
        this.download = { phase: 'failed', done: 0, total, message };
        this.deps.log.warn(`Captions: the ${id} model was not downloaded (${message})`);
      })
      .finally(() => {
        this.downloading = null;
        this.tell();
      });
    return this.downloading;
  }

  /** Tell the dialog now. */
  private tell(): void {
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
