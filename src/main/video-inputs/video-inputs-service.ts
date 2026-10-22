import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BackgroundLayer, InputBackground } from '../../shared/engine/state';
import { nfc } from '../../shared/nfc';
import {
  type CameraAccess,
  VIDEO_INPUT_DEVICE_MAX,
  VIDEO_INPUT_NAME_MAX,
  VIDEO_INPUTS_MAX,
  type VideoInput,
  type VideoInputReport,
  type VideoInputResult,
  type VideoInputsView,
  type VideoInputStatus,
} from '../../shared/video-inputs';
import type { CameraSystem } from './camera';
import { readVideoInputs, writeVideoInputs } from './video-inputs-file';

/*
 * Video inputs as the main process keeps them (Session 50): this computer's list (named in Pro Mode's Media, kept
 * in its data folder), whether Drashti may use the cameras, and how the input up now stands on the screens.
 *
 * Only the engine puts an input up (its showInput command, which looks the input up here by its id): a page
 * names an input of this list, never a device of its own choosing. Each page drawing the input up now (an output,
 * the stream's page, the operator window's LIVE picture) says whether it plays or stopped; the operator's notice
 * says it stopped while any of them says so, and goes when they all play it again. After a restart, the input
 * put back waits for the first page's word: no camera of its name on this computer, and it comes off, named in
 * the recovery notice; otherwise it stays.
 */

/** How long after a restart the screens have to say whether the input put back is there. */
export const RESTORE_WAIT_MS = 8000;

export interface VideoInputsDeps {
  /** Drashti's data folder on this computer: the list is kept there (./video-inputs-file.ts). */
  userData: string;
  camera: CameraSystem;
  /** The background layer now. */
  background(): BackgroundLayer | null;
  /** Take the background off (the input put back after a restart is not on this computer now). */
  clearBackground(): void;
  /** An input changed in the list while it is up: the screens follow (the engine's refreshInput). */
  refresh(input: VideoInput): void;
  /** The operator window is told of every change to the list. */
  changed(view: VideoInputsView): void;
  /** And of every change to how the input up now stands. */
  statusChanged(status: VideoInputStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  /** Run `run` after `ms`; returns a way to cancel it (setTimeout when left out; tests run it by hand). */
  schedule?: (ms: number, run: () => void) => () => void;
  /** Tests: how long to wait before reading an unreadable file again. */
  retryMs?: number;
}

/** What Add a Video Input… and a change to one send; checked here, whatever the page says. */
const fieldsSchema = z.object({
  name: z.string().max(1000),
  device: z.string().max(VIDEO_INPUT_DEVICE_MAX),
  fit: z.enum(['fit', 'fill']),
});
const reportSchema: z.ZodType<VideoInputReport> = z.object({
  inputId: z.string().min(1).max(512),
  state: z.enum(['playing', 'stopped', 'missing']),
});

const CANNOT_KEEP = 'That video input cannot be kept.';
const GONE = 'That video input is no longer on this computer.';

/** One showing of an input: the same input put up again, or on another device, is another. */
const showingOf = (bg: InputBackground): string => `${bg.inputId}@${String(bg.startedAt)}:${bg.device}`;

/** Names compared as the operator reads them: any letter case, any Unicode form. */
const sameName = (a: string, b: string): boolean => nfc(a).toLowerCase() === nfc(b).toLowerCase();

const sameStatus = (a: VideoInputStatus, b: VideoInputStatus): boolean =>
  a.access === b.access && a.stopped?.inputId === b.stopped?.inputId && a.stopped?.name === b.stopped?.name;

interface Pending {
  showing: string;
  name: string;
  done(gone: string | null): void;
}

export class VideoInputsService {
  private inputs: VideoInput[];
  /** The showing of the input up now, or null. */
  private following: string | null = null;
  /** What each page drawing it said last, by the page's id. */
  private readonly words = new Map<number, VideoInputReport['state']>();
  private stopped: VideoInputStatus['stopped'] = null;
  private told: VideoInputStatus | null = null;
  /** After a restart: the input put back, until a page says whether it is there. */
  private pending: Pending | null = null;
  private settledWith: Promise<string | null> = Promise.resolve(null);

  constructor(private readonly deps: VideoInputsDeps) {
    this.inputs = readVideoInputs(
      deps.userData,
      (line) => {
        deps.log('warn', line);
      },
      deps.retryMs === undefined ? {} : { retryMs: deps.retryMs },
    );
  }

  view(): VideoInputsView {
    return { inputs: this.inputs.map((i) => ({ ...i })) };
  }

  /** An input by its id, for the engine's showInput (and a picture-in-picture box's), or null. */
  get(inputId: string): VideoInput | null {
    const found = this.inputs.find((i) => i.id === inputId);
    return found ? { ...found } : null;
  }

  /** Add a Video Input…: one of this computer's cameras or capture inputs, named. */
  add(raw: unknown): VideoInputResult {
    const parsed = fieldsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, message: CANNOT_KEEP };
    const checked = this.check(parsed.data, null);
    if (typeof checked === 'string') return { ok: false, message: checked };
    if (this.inputs.length >= VIDEO_INPUTS_MAX)
      return {
        ok: false,
        message: `This computer keeps ${String(VIDEO_INPUTS_MAX)} video inputs at most: remove one first.`,
      };
    const input: VideoInput = { id: randomUUID(), ...checked };
    const kept = this.keep([...this.inputs, input]);
    if (kept) return kept;
    this.deps.log('info', `Video input added (${String(this.inputs.length)} on this computer)`);
    return { ok: true, view: this.view() };
  }

  /** A change to one (its name, its device, fit or fill): the screens follow while it is up. */
  update(id: unknown, raw: unknown): VideoInputResult {
    const was = typeof id === 'string' ? this.inputs.find((i) => i.id === id) : undefined;
    if (!was) return { ok: false, message: GONE };
    const parsed = fieldsSchema.partial().safeParse(raw);
    if (!parsed.success) return { ok: false, message: CANNOT_KEEP };
    const checked = this.check({ ...was, ...defined(parsed.data) }, was.id);
    if (typeof checked === 'string') return { ok: false, message: checked };
    const input: VideoInput = { id: was.id, ...checked };
    const kept = this.keep(this.inputs.map((i) => (i.id === was.id ? input : i)));
    if (kept) return kept;
    const bg = this.deps.background();
    if (bg?.kind === 'input' && bg.inputId === input.id) this.deps.refresh({ ...input });
    return { ok: true, view: this.view() };
  }

  /**
   * Remove one from the list. The show never changes for it: an input up now stays on the screens until
   * something replaces or clears it (it is not put back after a restart).
   */
  remove(id: unknown): VideoInputResult {
    if (typeof id !== 'string' || !this.inputs.some((i) => i.id === id)) return { ok: false, message: GONE };
    const kept = this.keep(this.inputs.filter((i) => i.id !== id));
    if (kept) return kept;
    this.deps.log('info', `Video input removed (${String(this.inputs.length)} on this computer)`);
    return { ok: true, view: this.view() };
  }

  /** Whether Drashti may use the cameras now. */
  access(): CameraAccess {
    return this.deps.camera.access();
  }

  /** A Mac: macOS's question (the page has said why first). How it stands then. */
  async askAccess(): Promise<CameraAccess> {
    const access = await this.deps.camera.ask();
    this.publish();
    return access;
  }

  openSettings(): Promise<void> {
    return this.deps.camera.openSettings();
  }

  status(): VideoInputStatus {
    return { stopped: this.stopped, access: this.deps.camera.access() };
  }

  /** A page drawing the input up now says how it stands (`page`: its web contents' id). */
  report(page: number, raw: unknown): void {
    const parsed = reportSchema.safeParse(raw);
    if (!parsed.success) return;
    const { inputId, state } = parsed.data;
    const bg = this.deps.background();
    if (bg?.kind !== 'input' || bg.inputId !== inputId) return;
    this.follow();
    const pending = this.pending;
    if (pending?.showing === showingOf(bg)) {
      if (state === 'missing') {
        // Not on this computer after the restart: off the screens, and the recovery notice names it.
        this.deps.log(
          'warn',
          'The video input put back after the restart is not on this computer: taken off',
        );
        pending.done(pending.name);
        this.deps.clearBackground();
        return;
      }
      pending.done(null);
    }
    this.words.set(page, state);
    this.recount(bg);
  }

  /** A page closed: what it said is forgotten. */
  pageGone(page: number): void {
    if (!this.words.delete(page)) return;
    const bg = this.deps.background();
    if (bg?.kind === 'input') this.recount(bg);
  }

  /** The show changed: follow the background (an input up, put back, replaced or cleared). */
  follow(): void {
    const bg = this.deps.background();
    const showing = bg?.kind === 'input' ? showingOf(bg) : null;
    if (showing === this.following) {
      // The same showing, renamed in Media while up: the notice says its new name.
      const stopped = this.stopped;
      if (bg?.kind === 'input' && stopped !== null && stopped.name !== bg.name) this.recount(bg);
      return;
    }
    this.following = showing;
    this.words.clear();
    this.stopped = null;
    if (this.pending && this.pending.showing !== showing) this.pending.done(null);
    this.publish();
  }

  /**
   * Restart recovery has just put an input back: the first page to draw it says whether it is on this computer
   * (`settled` answers then, or after RESTORE_WAIT_MS with no word, or once something else is up).
   */
  restored(): void {
    const bg = this.deps.background();
    if (bg?.kind !== 'input') return;
    this.follow();
    let answer: (gone: string | null) => void = () => undefined;
    this.settledWith = new Promise((resolve) => {
      answer = resolve;
    });
    const schedule =
      this.deps.schedule ??
      ((ms: number, run: () => void) => {
        const t = setTimeout(run, ms);
        return () => {
          clearTimeout(t);
        };
      });
    let cancel: () => void = () => undefined;
    const pending: Pending = {
      showing: showingOf(bg),
      name: bg.name,
      done: (gone) => {
        if (this.pending !== pending) return;
        this.pending = null;
        cancel();
        answer(gone);
      },
    };
    this.pending = pending;
    cancel = schedule(RESTORE_WAIT_MS, () => {
      pending.done(null);
    });
  }

  /** The name of the input restart recovery put back that was not on this computer (taken off), or null. */
  settled(): Promise<string | null> {
    return this.settledWith;
  }

  close(): void {
    this.pending?.done(null);
  }

  /** A name and a device as they are kept, or why not. */
  private check(fields: z.infer<typeof fieldsSchema>, self: string | null): Omit<VideoInput, 'id'> | string {
    const name = nfc(fields.name.trim());
    if (name === '') return 'Give the video input a name, such as “Input 1”.';
    if (name.length > VIDEO_INPUT_NAME_MAX)
      return `A video input’s name has ${String(VIDEO_INPUT_NAME_MAX)} characters at most.`;
    const taken = this.inputs.find((i) => i.id !== self && sameName(i.name, name));
    if (taken) return `There is already a video input called “${taken.name}”: give this one another name.`;
    // The device's name exactly as this computer gives it: every page finds the camera by it.
    if (fields.device === '') return 'Choose one of this computer’s cameras or capture inputs.';
    return { name, device: fields.device, fit: fields.fit };
  }

  /** Keep the list on disk, then tell the operator window; why not, when it could not be written. */
  private keep(inputs: VideoInput[]): VideoInputResult | null {
    try {
      writeVideoInputs(this.deps.userData, inputs);
    } catch (error) {
      this.deps.log('warn', `The video inputs could not be saved: ${String(error)}`);
      return { ok: false, message: 'The video inputs could not be saved on this computer. Try again.' };
    }
    this.inputs = inputs;
    this.deps.changed(this.view());
    return null;
  }

  /** Stopped while any page drawing the input says it is not playing. */
  private recount(bg: InputBackground): void {
    const stopped = [...this.words.values()].some((w) => w !== 'playing');
    this.stopped = stopped ? { inputId: bg.inputId, name: bg.name } : null;
    this.publish();
  }

  private publish(): void {
    const status = this.status();
    if (this.told && sameStatus(this.told, status)) return;
    const was = this.told?.stopped ?? null;
    this.told = status;
    if (status.stopped && !was) this.deps.log('warn', 'The video input on the screens stopped');
    else if (!status.stopped && was)
      this.deps.log('info', 'The video input on the screens plays again, or is off');
    this.deps.statusChanged(status);
  }
}

/** The fields given, without the ones left out (a page may send one as undefined). */
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
