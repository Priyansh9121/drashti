import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  audioChoiceSchema,
  messageSchema,
  musicStartSchema,
  pipPlaceSchema,
} from '../../shared/engine/commands';
import type {
  AudienceTimerLayer,
  AudioLayer,
  BackgroundLayer,
  EngineState,
  LowerThirdLayer,
  MessageItem,
  PipLayer,
  PlaylistCursor,
  TickerLayer,
  VideoSeeks,
} from '../../shared/engine/state';
import { ENGINE_STATE_VERSION, readsEngineVersion } from '../../shared/engine/state';
import { lowerThirdSchema } from '../../shared/lower-thirds';
import type { PlaybackSeek } from '../../shared/media';
import { hexColorSchema, idSchema } from '../../shared/model-schema';
import { RECOVERY_MAX_AGE_MS } from '../../shared/recovery';
import { STAGE_MESSAGE_SIZES, STAGE_RECENT, type StageCall } from '../../shared/stage-message';

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
  /**
   * The slide on screen (not just the cursor: a cleared slide is not put back), in the order it was played in, and
   * when it went up (Session 51): put back, its videos and their sound carry on from then, and it draws settled.
   * Left out under a timer shown alone (the slide the show was at was not on the screens) and in files before.
   */
  slide: {
    presentationId: string;
    slideIndex: number;
    arrangementId: string | null;
    shownAt?: number;
    /** Where the time bar had moved or paused its videos (Session 54): put back, they carry on from there. */
    seeks?: VideoSeeks;
    /** A deck's slide's step, when it was shown and how far into its clip (Session 54, C2): put back on that step. */
    step?: number;
    stepAt?: number;
    stepFromMs?: number;
  } | null;
  /** The playlist item being played, so Next carries on after the restart. */
  playlist: PlaylistCursor | null;
  background: BackgroundLayer | null;
  blackout: boolean;
  /** The Wallpaper up (Session 55, Part 13, in the Logo's place): it comes back up. */
  wallpaper: boolean;
  /** The sound playing, with when it started and where it last jumped to (Session 51): it carries on from there. */
  audio: AudioLayer | null;
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
  /** A Repeat Slides playlist going round (Session 26d): it carries on after the restart. */
  repeat: { playlistId: string } | null;
  /** The lower third up (Session 44), with when it went up: put back, it comes back still. */
  lowerThird: LowerThirdLayer | null;
  /**
   * The picture-in-picture box up (Session 50), with when it went up, without what it was animating: put back,
   * it comes back still (never a window, an input only while it is in the list: show-engine.ts decides).
   */
  pip: PipLayer | null;
  /**
   * A timer shown alone (Session 50), put back over `slide` (then the slide the show was at under it, not one on
   * the screens): it is no presentation's. Left out when none.
   */
  timer?: { timerId: string } | null;
  /** The stage message's size and flash, and the last few (Session 55): left out by files saved before. */
  stageCall?: StageCall | null;
  stageRecent?: string[];
  /** A timer for the audience up (Session 55): put back still. Left out when none, and by files saved before. */
  audienceTimer?: AudienceTimerLayer | null;
}

/**
 * Where a video or a sound last jumped to (a marker, Back 15 s, Forward 15 s, Last 10 s): put back, it plays on
 * from there (Session 51); paused there by the time bar (Session 54), it waits there. Its start and end points and
 * markers are not read back: the library has them, and the engine takes them from it as it puts the file back
 * (show-engine.ts restore).
 */
const seekSchema: z.ZodType<PlaybackSeek> = z.object({
  at: z.number(),
  toMs: z.number().min(0),
  paused: z.boolean().optional(),
  // A deck's video or sound not played yet (Session 54, C2).
  waiting: z.boolean().optional(),
});
/** Where the time bar moved or paused a slide's, a prop's, the logo's or the box's videos, by file (Session 54). */
const seeksSchema: z.ZodType<VideoSeeks> = z.record(idSchema, seekSchema);

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
    seek: seekSchema.optional(),
  }),
  // Another app's window (Session 48): read back only to be named; the engine never puts it back.
  z.object({
    kind: z.literal('window'),
    sourceId: z.string().min(1).max(200),
    name: z.string().max(500),
    startedAt: z.number(),
  }),
  // A video input (Session 50): put back while it is still in this computer's list (the engine looks it up).
  z.object({
    kind: z.literal('input'),
    inputId: idSchema,
    name: z.string().max(500),
    device: z.string().max(500),
    fit: z.enum(['fit', 'fill']),
    startedAt: z.number(),
    fade: z.object({ at: z.number(), durationMs: z.number().min(0) }).optional(),
  }),
]);

const tickerSchema: z.ZodType<TickerLayer> = z.object({
  items: z
    .array(z.object({ id: idSchema, text: z.string().min(1).max(500) }))
    .min(1)
    .max(50),
  startedAt: z.number(),
  // When the band came up (Session 27): put back as it was, so it comes back still.
  shownAt: z.number().optional(),
});

/**
 * A saved message, with the time it went up (Session 27): put back, it comes back still, with no entrance; and when
 * it goes by itself (Session 55): put back for the rest of its time.
 */
const savedMessageSchema = messageSchema.and(
  z.object({ shownAt: z.number().optional(), until: z.number().optional() }),
);
/** A saved lower third (Session 44), with the time it went up. */
const savedLowerThirdSchema: z.ZodType<LowerThirdLayer> = lowerThirdSchema.and(
  z.object({ shownAt: z.number() }),
);
/**
 * A saved picture-in-picture box (Session 50): what it held, where, swapped or not, and when it went up. Its video's
 * start and end points are not read back (Session 53): the engine takes them from the library as it puts the box
 * back, as for a background's (show-engine.ts restore).
 */
const savedPipSchema: z.ZodType<PipLayer> = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('slides') }),
    z.object({ kind: z.literal('media'), mediaId: idSchema, media: z.enum(['image', 'video']) }),
    z.object({
      kind: z.literal('input'),
      inputId: idSchema,
      name: z.string().max(500),
      device: z.string().max(500),
    }),
    // Read back only to be named: the engine never puts a window back.
    z.object({ kind: z.literal('window'), sourceId: z.string().min(1).max(200), name: z.string().max(500) }),
  ]),
  place: pipPlaceSchema,
  swapped: z.boolean(),
  shownAt: z.number(),
  // Where the time bar left its video (Session 54).
  seeks: seeksSchema.optional(),
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
      // Files saved before Session 51 have none: the slide comes back from the restart.
      shownAt: z.number().optional(),
      // Where the time bar left its videos (Session 54); files saved before have none.
      seeks: seeksSchema.optional(),
      // A deck's slide's step, when it was shown and how far into its clip (Session 54, C2); none for any other.
      step: z.number().int().min(0).optional(),
      stepAt: z.number().optional(),
      stepFromMs: z.number().min(0).optional(),
    })
    .nullable(),
  // Files saved before playlists could be played have none.
  playlist: z.object({ playlistId: idSchema, itemId: idSchema }).nullable().default(null),
  // Checked below, only when the engine version matches.
  background: z.unknown(),
  blackout: z.boolean(),
  // Files saved before Session 55 (Part 13) have none.
  wallpaper: z.boolean().default(false),
  // Files saved before these were kept have none. A file saved before Session 55 (Part 12) may also hold a logo,
  // props, a mask and the live Look's id: read and left out (they are gone; nothing of them comes back).
  audio: z.unknown().default(null),
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
  // Files saved before Repeat Slides have none.
  repeat: z.object({ playlistId: idSchema }).nullable().default(null),
  // Files saved before Lower Thirds (Session 44) have none.
  lowerThird: z.unknown().default(null),
  // Files saved before picture in picture (Session 50) have none.
  pip: z.unknown().default(null),
  // A timer shown alone (Session 50); files saved without one have none.
  timer: z.object({ timerId: idSchema }).nullable().optional(),
  // Session 55 (Part 15): the stage message's size and flash, the last few, and a timer for the audience; files saved
  // before have none.
  stageCall: z
    .object({ size: z.enum(STAGE_MESSAGE_SIZES), flash: z.boolean(), shownAt: z.number() })
    .nullable()
    .optional(),
  stageRecent: z.array(z.string().min(1).max(300)).max(STAGE_RECENT).optional(),
  audienceTimer: z.object({ timerId: idSchema, shownAt: z.number() }).nullable().optional(),
});
const soundLayerFields = z.object({
  startedAt: z.number(),
  durationMs: z.number().positive().optional(),
  // An audio playlist's track (Session 14): it comes back where it would be by now, or paused where it was.
  music: musicStartSchema.extend({ index: z.number().int().min(0).max(999) }).optional(),
  pausedAtMs: z.number().min(0).optional(),
  seek: seekSchema.optional(),
  // A sound set to play across slides (Session 54): it comes back with its slides, and its deck's fades.
  across: z.object({ presentationId: idSchema, lastIndex: z.number().int().min(0).max(100_000) }).optional(),
  fades: z.object({ inMs: z.number().min(0), outMs: z.number().min(0) }).optional(),
  // A slide's own sound (Session 55, Part 7).
  cue: z.literal(true).optional(),
});
const audioLayerSchema = z.intersection(
  z.intersection(audioChoiceSchema, soundLayerFields),
  // A slide's own sound or a deck's own soundtrack over the music (Session 55, Part 7): it comes back over it.
  z.object({ over: z.intersection(audioChoiceSchema, soundLayerFields).optional() }),
);
const markSchema = z.object({ session: z.string().min(1).max(64) });

/** The picture-in-picture box as it is, without what it was animating (Session 50). */
function stillBox(box: PipLayer | null): PipLayer | null {
  if (!box) return null;
  const { changed: _animating, ...still } = box;
  return still;
}

export function savedFrom(state: EngineState, session: string, now = new Date()): SavedLive {
  const slide = state.layers.slide;
  // A timer shown alone (Session 50): the slide the show was at under it, and the timer, put back over it.
  const alone = slide?.timer ?? null;
  const cursor = state.live;
  return {
    version: 2,
    session,
    engineVersion: ENGINE_STATE_VERSION,
    savedAt: now.toISOString(),
    slide: alone
      ? cursor.presentationId !== null && cursor.slideIndex !== null
        ? {
            presentationId: cursor.presentationId,
            slideIndex: cursor.slideIndex,
            arrangementId: cursor.arrangementId,
          }
        : null
      : slide
        ? {
            presentationId: slide.presentationId,
            slideIndex: slide.slideIndex,
            arrangementId: state.live.arrangementId,
            shownAt: slide.shownAt,
            ...(slide.seeks ? { seeks: slide.seeks } : {}),
            // A deck's slide's step (Session 54, C2).
            ...(slide.step !== undefined ? { step: slide.step } : {}),
            ...(slide.stepAt !== undefined ? { stepAt: slide.stepAt } : {}),
            ...(slide.stepFromMs !== undefined ? { stepFromMs: slide.stepFromMs } : {}),
          }
        : null,
    playlist: state.live.playlist,
    background: state.layers.background,
    blackout: state.blackout,
    wallpaper: state.wallpaper,
    audio: state.layers.audio,
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
    repeat: state.repeat ? { playlistId: state.repeat.playlistId } : null,
    lowerThird: state.layers.lowerThird,
    pip: stillBox(state.layers.pip),
    ...(alone ? { timer: { timerId: alone.timerId } } : {}),
    // Session 55 (Part 15).
    ...(state.stageCall ? { stageCall: state.stageCall } : {}),
    ...((state.stageRecent?.length ?? 0) > 0 ? { stageRecent: state.stageRecent } : {}),
    ...(state.layers.timer ? { audienceTimer: state.layers.timer } : {}),
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
 * another engine version is left out (its shape may differ). A logo, props, a mask or a Look an older file
 * holds are left out (Session 55, Part 12): nothing of them comes back, and the rest comes back whole.
 */
function liveIn(s: Saved): SavedLive | null {
  // The layers' shapes belong to one engine version: from another, only the slide and cursors come back. 12
  // (alpha.11's) is read whole, as 13 only adds to it (Session 52).
  const same = readsEngineVersion(s.engineVersion);
  const layer = <T>(schema: z.ZodType<T>, value: unknown, none: T): T => {
    if (!same) return none;
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : none;
  };
  const background = layer(backgroundSchema.nullable(), s.background, null);
  const audio = layer(audioLayerSchema.nullable(), s.audio, null);
  const messages = layer(z.array(savedMessageSchema).max(50), s.messages, []);
  const ticker = layer(tickerSchema.nullable(), s.ticker, null);
  const lowerThird = layer(savedLowerThirdSchema.nullable(), s.lowerThird, null);
  const pip = layer(savedPipSchema.nullable(), s.pip, null);
  const timers = same ? s.timers : [];
  const stageMessage = same ? s.stageMessage : null;
  // Session 55 (Part 15): kept only with the engine version's layers, as the stage message is.
  const stageCall = same ? (s.stageCall ?? null) : null;
  const stageRecent = same ? (s.stageRecent ?? []) : [];
  const audienceTimer = same ? (s.audienceTimer ?? null) : null;
  const anything = [
    s.slide !== null,
    s.playlist !== null,
    background !== null,
    s.blackout,
    s.wallpaper,
    audio !== null,
    messages.length > 0,
    ticker !== null,
    lowerThird !== null,
    pip !== null,
    stageMessage !== null,
    timers.length > 0,
    s.timer != null,
    audienceTimer !== null,
  ].some(Boolean);
  if (!anything) return null;
  // The schema keeps only what it names: an older file's logo, props, mask and Look are not carried on.
  return {
    ...s,
    background,
    audio,
    messages,
    ticker,
    lowerThird,
    pip,
    stageMessage,
    timers,
    stageCall,
    stageRecent,
    audienceTimer,
  };
}

/**
 * What the start finds, read once before this run saves anything: whether the last run quit cleanly,
 * and what it left live when it did not. A stop RECOVERY_MAX_AGE_MS or more before `now` (or one whose
 * time cannot be read) is not a recent one: its show is not put back, and the mode starts as after a
 * clean quit.
 */
export function startupRecovery(files: RecoveryFiles, options: { now?: Date } = {}): StartupRecovery {
  const saved = savedSchema.safeParse(readJson(files.state));
  if (!saved.success || quitCleanly(files, saved.data))
    return { cleanQuit: true, recentStop: false, putBack: null, tooOld: null };
  // Saved every minute while it ran, so the last save is the stop, within a minute.
  const age = (options.now ?? new Date()).getTime() - Date.parse(saved.data.savedAt);
  const recentStop = age < RECOVERY_MAX_AGE_MS;
  const show = liveIn(saved.data);
  if (!show) return { cleanQuit: false, recentStop, putBack: null, tooOld: null };
  return recentStop
    ? { cleanQuit: false, recentStop, putBack: show, tooOld: null }
    : { cleanQuit: false, recentStop, putBack: null, tooOld: show };
}

/** What to put back at startup (see startupRecovery), or null. */
export function toRestore(files: RecoveryFiles, now = new Date()): SavedLive | null {
  return startupRecovery(files, { now }).putBack;
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
  /**
   * How a save writes its partial file and moves it over the saved one (tests: a disk that fails now and then, as
   * Windows' does while a scanner or a reader holds a file). The file system's own unless given.
   */
  writeFile?: (file: string, text: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * After a save that fails, the newest show is saved again this long after (Session 57), then twice as long after
 * each failure in a row, up to RETRY_MAX_MS: soon after a moment's hold on a file (a scanner, a reader), and never a
 * busy loop on a disk that keeps failing.
 */
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 5000;

/**
 * Writes what is live: after a change (at most every `throttleMs`), in the
 * background, replacing the file whole so it is never half-written. A save
 * that fails is tried again by itself, with the newest show (Session 57):
 * the next change may never come.
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
  /** The next try after a failed save (Session 57). */
  private retry: NodeJS.Timeout | null = null;
  /** Saves that failed in a row: the first is logged, and the one that works after them. */
  private failures = 0;
  /** stop() was called (a crash in tests, or the clean quit), until start(): a failed save is not tried again. */
  private stopped = false;

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
    this.stopped = false;
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
    // Saved at a change's own pace, also while a failed save waits for its next try: this saves the newest.
    this.cancelRetry();
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const next = this.pending;
      this.pending = null;
      if (next) this.save(next);
    }, this.throttleMs);
  }

  /** Saves this state after the saves before it: in order, so never an older show over a newer one. */
  private save(state: EngineState): void {
    const saved = savedFrom(state, this.session, this.now());
    this.writing = this.writing.then(() => this.write(saved));
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
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.cancelRetry();
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.alive) clearInterval(this.alive);
    this.alive = null;
    this.pending = null;
  }

  private async write(saved: SavedLive): Promise<void> {
    const partial = `${this.files.state}.${randomUUID()}.tmp`;
    try {
      await (this.options.writeFile ?? writeFile)(partial, JSON.stringify(saved));
      await (this.options.rename ?? rename)(partial, this.files.state);
    } catch (error) {
      // Said once for failures in a row, and tried again by itself: the next change may never come (Session 57).
      this.failures += 1;
      if (this.failures === 1)
        this.options.log?.(`Could not save the live state: ${(error as Error).message}`);
      this.tryAgainLater();
      await rm(partial, { force: true }).catch(() => undefined);
      return;
    }
    if (this.failures > 0) {
      const failed = this.failures === 1 ? '1 failed save' : `${this.failures} failed saves`;
      this.options.log?.(`Saved the live state again, after ${failed}`);
    }
    this.failures = 0;
    this.cancelRetry();
  }

  /**
   * After a failed save, the newest show is saved again by itself (Session 57): RETRY_FIRST_MS on, twice as long
   * after each failure in a row, up to RETRY_MAX_MS. One try waits at a time, none while a change waits to be saved
   * (that saves the newest), and none after stop(): a crash, or the clean quit (no try comes after its save and mark).
   */
  private tryAgainLater(): void {
    if (this.stopped || this.timer || this.retry) return;
    const wait = Math.min(RETRY_FIRST_MS * 2 ** (this.failures - 1), RETRY_MAX_MS);
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.latest) this.save(this.latest);
    }, wait);
    // It never keeps a process up by itself (Node's, in tests); Drashti's own runs on, so it comes.
    this.retry.unref();
  }

  private cancelRetry(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  /**
   * Drashti is quitting on purpose: save the show as it is now and write the
   * clean-quit mark, synchronously, so both are on disk before the process
   * ends and name this run (Session 20: even a run that changed nothing).
   * A save that failed before it is not tried again after it (Session 57).
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
