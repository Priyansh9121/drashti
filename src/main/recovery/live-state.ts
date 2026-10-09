import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { audioChoiceSchema, messageSchema, musicStartSchema, propSchema } from '../../shared/engine/commands';
import type {
  AudioLayer,
  BackgroundLayer,
  EngineState,
  MaskLayer,
  MessageItem,
  PlaylistCursor,
  PropItem,
  TickerLayer,
} from '../../shared/engine/state';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { maskSchema } from '../../shared/masks';
import { hexColorSchema, idSchema } from '../../shared/model-schema';
import { RECOVERY_MAX_AGE_MS } from '../../shared/recovery';

/*
 * Restart recovery (PLAN.md Phase 1). What is live is saved to a small file
 * as it changes (throttled, written in the background, never in the way of
 * a slide change), under an id for this run of Drashti. Quitting on purpose
 * writes that id to a second file, the clean-quit mark. If Drashti starts
 * and the saved state is not from a run that quit cleanly, it stopped
 * unexpectedly (a crash, a power cut), and the same slide, background and
 * black-out go back on the screens. (Two files, so a save still in flight
 * at quit can never undo the clean-quit mark.)
 *
 * Since Session 20 every run saves the show from its start, again every
 * minute while it runs, and once more as it quits on purpose, so the saved
 * file always names the last run. Before, a run that changed nothing saved
 * nothing, and its clean quit made the next start take the show of the run
 * before it for a crash. And a show saved RECOVERY_MAX_AGE_MS or more
 * before the start is named in the notice but not put back.
 */

export interface SavedLive {
  /** 2 since Session 20: saved from the run's start, every minute, and as it quits. */
  version: 1 | 2;
  /** Which run of Drashti saved it. */
  session: string;
  /** The engine state version the background was saved with; another version is not restored. */
  engineVersion: number;
  savedAt: string;
  /** The slide on screen (not just the cursor: a cleared slide is not put back), in the order it was played in. */
  slide: { presentationId: string; slideIndex: number; arrangementId: string | null } | null;
  /** The playlist item being played, so Next carries on after the restart. */
  playlist: PlaylistCursor | null;
  background: BackgroundLayer | null;
  blackout: boolean;
  /** The logo shown instead of the picture (Simple Mode's Logo). */
  logo: PropItem | null;
  /** The sound playing, with when it started: it carries on from there. */
  audio: AudioLayer | null;
  props: PropItem[];
  messages: MessageItem[];
  /** The announcements ticker, with when it started: it carries on in step. */
  ticker: TickerLayer | null;
  stageMessage: string | null;
  /** Timers that were running or paused (their definitions are in the library). */
  timers: { id: string; startedAt: number | null; elapsedMs: number }[];
  /**
   * The slide was moving on by itself: how long it had left when this was
   * saved (saved again every second while it counts), and its whole time.
   */
  autoAdvance: { leftMs: number; durationMs: number } | null;
  /** The live Look (an id: it comes back whatever the engine version). */
  lookId: string | null;
  /** The mask up on the Masks layer. */
  masks: MaskLayer | null;
}

const backgroundSchema: z.ZodType<BackgroundLayer> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('color'), color: hexColorSchema }),
  z.object({
    kind: z.literal('media'),
    mediaId: idSchema,
    media: z.enum(['image', 'video']),
    fit: z.enum(['fit', 'fill', 'stretch']),
    loop: z.boolean(),
    startedAt: z.number(),
    durationMs: z.number().positive().optional(),
  }),
]);

const tickerSchema: z.ZodType<TickerLayer> = z.object({
  items: z
    .array(z.object({ id: idSchema, text: z.string().min(1).max(500) }))
    .min(1)
    .max(50),
  startedAt: z.number(),
});

const savedSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  session: z.string().min(1).max(64),
  engineVersion: z.number(),
  savedAt: z.string(),
  slide: z
    .object({
      presentationId: idSchema,
      slideIndex: z.number().int().min(0),
      // Files saved before arrangements played every slide in order.
      arrangementId: idSchema.nullable().default(null),
    })
    .nullable(),
  // Files saved before playlists could be played have none.
  playlist: z.object({ playlistId: idSchema, itemId: idSchema }).nullable().default(null),
  // Checked below, only when the engine version matches.
  background: z.unknown(),
  blackout: z.boolean(),
  // Files saved before these were kept have none.
  logo: z.unknown().default(null),
  audio: z.unknown().default(null),
  props: z.unknown().default([]),
  messages: z.unknown().default([]),
  ticker: z.unknown().default(null),
  stageMessage: z.string().max(300).nullable().default(null),
  timers: z
    .array(z.object({ id: idSchema, startedAt: z.number().nullable(), elapsedMs: z.number().min(0) }))
    .max(200)
    .default([]),
  // Files saved before auto-advance have none.
  autoAdvance: z
    .object({ leftMs: z.number().min(0), durationMs: z.number().positive() })
    .nullable()
    .default(null),
  // Files saved before Looks have none.
  lookId: idSchema.nullable().default(null),
  masks: z.unknown().default(null),
});
const audioLayerSchema = z.intersection(
  audioChoiceSchema,
  z.object({
    startedAt: z.number(),
    durationMs: z.number().positive().optional(),
    // An audio playlist's track (Session 14): it comes back where it would be by now, or paused where it was.
    music: musicStartSchema.extend({ index: z.number().int().min(0).max(999) }).optional(),
    pausedAtMs: z.number().min(0).optional(),
  }),
);
const markSchema = z.object({ session: z.string().min(1).max(64) });

export function savedFrom(state: EngineState, session: string, now = new Date()): SavedLive {
  const slide = state.layers.slide;
  return {
    version: 2,
    session,
    engineVersion: ENGINE_STATE_VERSION,
    savedAt: now.toISOString(),
    slide: slide
      ? {
          presentationId: slide.presentationId,
          slideIndex: slide.slideIndex,
          arrangementId: state.live.arrangementId,
        }
      : null,
    playlist: state.live.playlist,
    background: state.layers.background,
    blackout: state.blackout,
    logo: state.logo,
    audio: state.layers.audio,
    props: state.layers.props,
    messages: state.layers.messages,
    ticker: state.layers.ticker,
    stageMessage: state.stageMessage,
    timers: state.timers
      .filter((t) => t.startedAt !== null || t.elapsedMs > 0)
      .map(({ id, startedAt, elapsedMs }) => ({ id, startedAt, elapsedMs })),
    autoAdvance: state.autoAdvance
      ? {
          leftMs: Math.max(0, state.autoAdvance.startedAt + state.autoAdvance.durationMs - now.getTime()),
          durationMs: state.autoAdvance.durationMs,
        }
      : null,
    lookId: state.look.id === '' ? null : state.look.id,
    masks: state.layers.masks,
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export interface RecoveryFiles {
  /** What is live, saved as it changes. */
  state: string;
  /** The id of the last run that quit on purpose. */
  cleanMark: string;
}

/** What a start finds about the run before it (Session 20): one answer for restart recovery and the starting mode. */
export interface StartupRecovery {
  /**
   * The last run quit on purpose, or there is no saved show to judge it by (a first start, or a file
   * that cannot be read). False only after an unexpected stop: a crash, a power cut, a forced quit.
   */
  cleanQuit: boolean;
  /**
   * The last run stopped unexpectedly less than RECOVERY_MAX_AGE_MS before this start, so Drashti carries
   * on where it was: the show put back and the mode it was in. A stop that long ago or longer (or one whose
   * time cannot be read) starts like a clean quit, live or not (Session 21).
   */
  recentStop: boolean;
  /** What to put back on the screens: the last run's show, when it stopped unexpectedly less than RECOVERY_MAX_AGE_MS before this start. */
  putBack: SavedLive | null;
  /** The last run's show, when it stopped unexpectedly RECOVERY_MAX_AGE_MS or more before this start: named, never put back. */
  tooOld: SavedLive | null;
}

type Saved = z.infer<typeof savedSchema>;

/**
 * Whether the run that saved the show quit on purpose. Since Session 20 the saved file always names the
 * last run, so the clean-quit mark names the same run exactly when it quit cleanly. A file saved before
 * Session 20 (version 1) can name an earlier run than the last: a run that changed nothing saved nothing.
 * A clean-quit mark written after such a show was saved means a later run quit on purpose; and that
 * Drashti always saved a show it put back after a crash, so the show's own run had quit cleanly too.
 */
function quitCleanly(files: RecoveryFiles, saved: Saved): boolean {
  const mark = markSchema.safeParse(readJson(files.cleanMark));
  if (!mark.success) return false;
  if (mark.data.session === saved.session) return true;
  if (saved.version !== 1) return false;
  try {
    return statSync(files.cleanMark).mtimeMs > Date.parse(saved.savedAt);
  } catch {
    return false;
  }
}

/**
 * The show worth putting back from a saved state, or null when nothing was live. A background saved by
 * another engine version is left out (its shape may differ). A Look other than `startLookId` (the one
 * Drashti starts with) counts as something live.
 */
function liveIn(s: Saved, startLookId: string | null): SavedLive | null {
  // The layers' shapes belong to one engine version: from another, only the slide and cursors come back.
  const same = s.engineVersion === ENGINE_STATE_VERSION;
  const layer = <T>(schema: z.ZodType<T>, value: unknown, none: T): T => {
    if (!same) return none;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : none;
  };
  const background = layer(backgroundSchema.nullable(), s.background, null);
  const audio = layer(audioLayerSchema.nullable(), s.audio, null);
  const logo = layer(propSchema.nullable(), s.logo, null);
  const props = layer(z.array(propSchema).max(50), s.props, []);
  const messages = layer(z.array(messageSchema).max(50), s.messages, []);
  const ticker = layer(tickerSchema.nullable(), s.ticker, null);
  const masks = layer(maskSchema.nullable(), s.masks, null);
  const timers = same ? s.timers : [];
  const stageMessage = same ? s.stageMessage : null;
  const anything = [
    s.slide !== null,
    s.playlist !== null,
    background !== null,
    s.blackout,
    logo !== null,
    audio !== null,
    props.length > 0,
    messages.length > 0,
    ticker !== null,
    masks !== null,
    stageMessage !== null,
    timers.length > 0,
    s.lookId !== null && s.lookId !== startLookId,
  ].some(Boolean);
  if (!anything) return null;
  return { ...s, background, logo, audio, props, messages, ticker, masks, stageMessage, timers };
}

/**
 * What the start finds, read once before this run saves anything: whether the last run quit cleanly,
 * and what it left live when it did not. A stop RECOVERY_MAX_AGE_MS or more before `now` (or one whose
 * time cannot be read) is not a recent one: its show is not put back, and the mode starts as after a
 * clean quit.
 */
export function startupRecovery(
  files: RecoveryFiles,
  options: { startLookId?: string | null; now?: Date } = {},
): StartupRecovery {
  const saved = savedSchema.safeParse(readJson(files.state));
  if (!saved.success || quitCleanly(files, saved.data))
    return { cleanQuit: true, recentStop: false, putBack: null, tooOld: null };
  // Saved every minute while it ran, so the last save is the stop, within a minute.
  const age = (options.now ?? new Date()).getTime() - Date.parse(saved.data.savedAt);
  const recentStop = age < RECOVERY_MAX_AGE_MS;
  const show = liveIn(saved.data, options.startLookId ?? null);
  if (!show) return { cleanQuit: false, recentStop, putBack: null, tooOld: null };
  return recentStop
    ? { cleanQuit: false, recentStop, putBack: show, tooOld: null }
    : { cleanQuit: false, recentStop, putBack: null, tooOld: show };
}

/** What to put back at startup (see startupRecovery), or null. */
export function toRestore(
  files: RecoveryFiles,
  startLookId: string | null = null,
  now = new Date(),
): SavedLive | null {
  return startupRecovery(files, { startLookId, now }).putBack;
}

export interface LiveStateWriterOptions {
  /** Wait this long after a change before writing, so a run of changes is one write. */
  throttleMs?: number;
  /** While a slide is moving on by itself, save again this often (its time left goes down). */
  heartbeatMs?: number;
  /**
   * From start() on, save the show again this often (Session 20; a minute), so its time says when
   * Drashti was last running: the age limit counts from there.
   */
  aliveMs?: number;
  /** The clock (tests). */
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Writes what is live: after a change (at most every `throttleMs`), in the
 * background, replacing the file whole so it is never half-written.
 */
export class LiveStateWriter {
  readonly session = randomUUID();
  private pending: EngineState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly throttleMs: number;
  private heartbeat: NodeJS.Timeout | null = null;
  private alive: NodeJS.Timeout | null = null;
  private latest: EngineState | null = null;

  constructor(
    private readonly files: RecoveryFiles,
    private readonly options: LiveStateWriterOptions = {},
  ) {
    this.throttleMs = options.throttleMs ?? 250;
  }

  /**
   * This run takes the saved file over from its start (Session 20): the show is saved at once, after
   * the start has read what the run before left, and again every `aliveMs` until Drashti quits.
   */
  start(state: EngineState): void {
    this.update(state);
    if (this.alive) return;
    this.alive = setInterval(() => {
      if (this.latest) this.update(this.latest);
    }, this.options.aliveMs ?? 60_000);
    this.alive.unref();
  }

  /** The live state changed. */
  update(state: EngineState): void {
    this.latest = state;
    // While a slide counts down, save every second, so a stop loses at most a second of its time.
    if (state.autoAdvance && !this.heartbeat) {
      this.heartbeat = setInterval(() => {
        if (this.latest?.autoAdvance) this.update(this.latest);
      }, this.options.heartbeatMs ?? 1000);
    } else if (!state.autoAdvance && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    this.pending = state;
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next) {
        const saved = savedFrom(next, this.session, this.now());
        this.writing = this.writing.then(() => this.write(saved));
      }
    }, this.throttleMs);
  }

  /** Wait for writes already started (tests). */
  async settle(): Promise<void> {
    await this.writing;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** No more saves: what a crash leaves (tests). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.alive) clearInterval(this.alive);
    this.alive = null;
    this.pending = null;
  }

  private async write(saved: SavedLive): Promise<void> {
    const partial = `${this.files.state}.${randomUUID()}.tmp`;
    try {
      await writeFile(partial, JSON.stringify(saved));
      await rename(partial, this.files.state);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      // The next change writes again.
      this.options.log?.(`Could not save the live state: ${(error as Error).message}`);
    }
  }

  /**
   * Drashti is quitting on purpose: save the show as it is now and write the
   * clean-quit mark, synchronously, so both are on disk before the process
   * ends and name this run (Session 20: even a run that changed nothing).
   */
  markClean(): void {
    this.stop();
    if (this.latest) {
      const state = `${this.files.state}.${randomUUID()}.tmp`;
      try {
        writeFileSync(state, JSON.stringify(savedFrom(this.latest, this.session, this.now())));
        renameSync(state, this.files.state);
      } catch (error) {
        rmSync(state, { force: true });
        this.options.log?.(`Could not save the live state at quit: ${(error as Error).message}`);
      }
    }
    const partial = `${this.files.cleanMark}.${randomUUID()}.tmp`;
    try {
      writeFileSync(partial, JSON.stringify({ session: this.session }));
      renameSync(partial, this.files.cleanMark);
    } catch (error) {
      this.options.log?.(`Could not mark a clean quit: ${(error as Error).message}`);
    }
  }
}
