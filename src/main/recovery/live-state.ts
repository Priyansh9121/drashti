import { randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { BackgroundLayer, EngineState } from '../../shared/engine/state';
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
  background: BackgroundLayer | null;
  blackout: boolean;
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
  // Checked below, only when the engine version matches.
  background: z.unknown(),
  blackout: z.boolean(),
});
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
    background: state.layers.background,
    blackout: state.blackout,
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
  const parsed = backgroundSchema.nullable().safeParse(s.background);
  const background = s.engineVersion === ENGINE_STATE_VERSION && parsed.success ? parsed.data : null;
  if (!s.slide && !background && !s.blackout) return null;
  return { ...s, version: 1, background };
}

export interface LiveStateWriterOptions {
  /** Wait this long after a change before writing, so a run of changes is one write. */
  throttleMs?: number;
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

  constructor(
    private readonly files: RecoveryFiles,
    private readonly options: LiveStateWriterOptions = {},
  ) {
    this.throttleMs = options.throttleMs ?? 250;
  }

  /** The live state changed. */
  update(state: EngineState): void {
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
