import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { audioChoiceSchema, messageSchema, propSchema } from '../../shared/engine/commands';
import type {
  AudioLayer,
  BackgroundLayer,
  EngineState,
  MessageItem,
  PlaylistCursor,
  PropItem,
  TickerLayer,
} from '../../shared/engine/state';
import { ENGINE_STATE_VERSION } from '../../shared/engine/state';
import { hexColorSchema, idSchema } from '../../shared/model-schema';

/*
 * Restart recovery (PLAN.md Phase 1). What is live is saved to a small file
 * as it changes (throttled, written in the background, never in the way of
 * a slide change), under an id for this run of Drashti. Quitting on purpose
 * writes that id to a second file, the clean-quit mark. If Drashti starts
 * and the saved state is not from a run that quit cleanly, it stopped
 * unexpectedly (a crash, a power cut), and the same slide, background and
 * black-out go back on the screens. (Two files, so a save still in flight
 * at quit can never undo the clean-quit mark.)
 */

export interface SavedLive {
  version: 1;
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
  version: z.literal(1),
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
});
const audioLayerSchema = z.intersection(audioChoiceSchema, z.object({ startedAt: z.number() }));
const markSchema = z.object({ session: z.string().min(1).max(64) });

export function savedFrom(state: EngineState, session: string, now = new Date()): SavedLive {
  const slide = state.layers.slide;
  return {
    version: 1,
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

/**
 * What to put back at startup: the saved state when the run that saved it
 * did not quit cleanly and something was live; otherwise null. A background
 * saved by another engine version is left out (its shape may differ).
 */
export function toRestore(files: RecoveryFiles): SavedLive | null {
  const saved = savedSchema.safeParse(readJson(files.state));
  if (!saved.success) return null;
  const mark = markSchema.safeParse(readJson(files.cleanMark));
  if (mark.success && mark.data.session === saved.data.session) return null;
  const s = saved.data;
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
    stageMessage !== null,
    timers.length > 0,
  ].some(Boolean);
  if (!anything) return null;
  return { ...s, version: 1, background, logo, audio, props, messages, ticker, stageMessage, timers };
}

export interface LiveStateWriterOptions {
  /** Wait this long after a change before writing, so a run of changes is one write. */
  throttleMs?: number;
  /** While a slide is moving on by itself, save again this often (its time left goes down). */
  heartbeatMs?: number;
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
  private latest: EngineState | null = null;

  constructor(
    private readonly files: RecoveryFiles,
    private readonly options: LiveStateWriterOptions = {},
  ) {
    this.throttleMs = options.throttleMs ?? 250;
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
        const saved = savedFrom(next, this.session);
        this.writing = this.writing.then(() => this.write(saved));
      }
    }, this.throttleMs);
  }

  /** Wait for writes already started (tests). */
  async settle(): Promise<void> {
    await this.writing;
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
   * Drashti is quitting on purpose: write the clean-quit mark now,
   * synchronously, so it is on disk before the process ends.
   */
  markClean(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.pending = null;
    const partial = `${this.files.cleanMark}.${randomUUID()}.tmp`;
    try {
      writeFileSync(partial, JSON.stringify({ session: this.session }));
      renameSync(partial, this.files.cleanMark);
    } catch (error) {
      this.options.log?.(`Could not mark a clean quit: ${(error as Error).message}`);
    }
  }
}
