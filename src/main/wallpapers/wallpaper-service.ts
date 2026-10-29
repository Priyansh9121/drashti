import type { OldIdleRotation, Quote } from '../../shared/idle';
import { QUOTE_LANGS } from '../../shared/idle';
import type { ChosenWallpaper, Wallpaper, WallpaperResult, WallpapersView } from '../../shared/wallpapers';
import {
  WALLPAPER_FADE_DEFAULT_MS,
  WALLPAPER_PICTURES_MAX,
  WALLPAPER_SECONDS_MAX,
  WALLPAPER_SECONDS_MIN,
  wallpaperNameOf,
} from '../../shared/wallpapers';
import { cutText } from '../../shared/text';
import type { WallpaperRepo } from '../db/wallpapers';

/*
 * The wallpapers (Session 55, Part 6, shared/wallpapers.ts): a wallpaper made of each picture added (pictures only),
 * renamed, deleted with Undo, its pictures and timing changed; one chosen, kept by the library over a restart, and put
 * in the engine's state for every audience screen, node and phone (none: black). The operator window hears each
 * change. The idle rotation (taken out in Part 12) becomes one wallpaper, once: its pictures still in the library, in
 * its order and with its seconds, then its quotes, each drawn as a picture by the operator window (which has the
 * fonts: wallpapers/quote-pictures.ts) and kept in the library like any picture.
 */

/** The settings kept for the wallpapers. */
const CHOSEN = 'wallpapers.chosen';
const FROM_IDLE = 'wallpapers.fromIdle';
const QUOTES_TO_DRAW = 'wallpapers.quotesToDraw';

/** The wallpaper the idle rotation became. */
export const FROM_IDLE_NAME = 'Idle rotation';

export interface WallpaperServiceDeps {
  repo: WallpaperRepo;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  /** A media item's kind and name while it is in the library to show (not deleted, its file there), or null. */
  media(mediaId: string): { kind: 'image' | 'video' | 'audio'; name: string } | null;
  engine: { setChosenWallpaper(wallpaper: Omit<ChosenWallpaper, 'since'> | null): unknown };
  /** A picture Drashti made (a quote drawn), kept in the library under this name: its media id, or null. */
  keepPicture(png: Uint8Array, name: string): Promise<string | null>;
  /** The wallpapers changed: the operator window hears (and nodes get the files). */
  changed(view: WallpapersView): void;
}

const MEDIA_WORD = { video: 'a video', audio: 'a sound' } as const;

/** A quote's picture's name: "Quote · " and its first words, safe as a file's name on Windows too. */
export function quotePictureName(quote: Quote): string {
  const words = QUOTE_LANGS.map((l) => quote.words[l]).find((w) => w !== undefined && w.trim() !== '') ?? '';
  const safe = words
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return cutText(`Quote · ${safe}`.trim(), 60, '…');
}

function isQuoteList(value: unknown): value is { into: string; quotes: Quote[] } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { into?: unknown; quotes?: unknown };
  return typeof v.into === 'string' && Array.isArray(v.quotes);
}

export class WallpaperService {
  constructor(private readonly deps: WallpaperServiceDeps) {}

  /** At the start: those deleted before it go for good, and the engine has the chosen one. */
  start(): void {
    this.deps.repo.purge();
    this.push(false);
  }

  view(): WallpapersView {
    const wallpapers = this.deps.repo.list();
    const chosen = this.chosenId(wallpapers);
    const stored = this.deps.settings.get(QUOTES_TO_DRAW);
    const quotes = isQuoteList(stored) && wallpapers.some((w) => w.id === stored.into) ? stored : null;
    return {
      wallpapers,
      chosenId: chosen,
      quotesToDraw: quotes && quotes.quotes.length > 0 ? quotes : null,
    };
  }

  /** Every wallpaper's pictures still in the library, each once: the files a node copies. */
  pictureIds(): string[] {
    return this.deps.repo.pictureIds();
  }

  /** The wallpapers a picture is in, by name. */
  usedBy(mediaId: string): string[] {
    return this.deps.repo.usedBy(mediaId);
  }

  /**
   * Pictures from the library as wallpapers: one each, named as its file, or (`into`) added to that wallpaper's
   * pictures, which then go round. Anything not a picture is refused, saying why. The wallpapers made, or `into`.
   */
  add(mediaIds: readonly string[], into: string | null): WallpaperResult {
    const problem = this.notPictures(mediaIds);
    if (problem) return { ok: false, message: problem };
    if (into !== null) {
      const wallpaper = this.deps.repo.get(into);
      if (!wallpaper) return { ok: false, message: 'That wallpaper is no longer there.' };
      const pictures = [...wallpaper.pictures.map((p) => p.mediaId), ...mediaIds];
      if (pictures.length > WALLPAPER_PICTURES_MAX)
        return {
          ok: false,
          message: `A wallpaper can have ${String(WALLPAPER_PICTURES_MAX)} pictures at most.`,
        };
      this.deps.repo.setPictures(into, pictures);
      this.push();
      return { ok: true, ids: [into] };
    }
    const ids = mediaIds.map((id) =>
      this.deps.repo.create(wallpaperNameOf(this.deps.media(id)?.name ?? 'Wallpaper'), [id]),
    );
    this.push();
    return { ok: true, ids };
  }

  rename(id: string, name: string): WallpaperResult {
    if (!this.deps.repo.rename(id, name)) return { ok: false, message: 'That wallpaper is no longer there.' };
    this.push();
    return { ok: true, ids: [id] };
  }

  /** Its pictures in this order: pictures only. */
  setPictures(id: string, mediaIds: readonly string[]): WallpaperResult {
    const problem = this.notPictures(mediaIds);
    if (problem) return { ok: false, message: problem };
    if (!this.deps.repo.setPictures(id, mediaIds))
      return { ok: false, message: 'That wallpaper is no longer there.' };
    this.push();
    return { ok: true, ids: [id] };
  }

  setTiming(id: string, timing: { secondsEach: number; fadeMs: number }): WallpaperResult {
    if (!this.deps.repo.setTiming(id, timing))
      return { ok: false, message: 'That wallpaper is no longer there.' };
    this.push();
    return { ok: true, ids: [id] };
  }

  /**
   * Delete it (Undo brings it back). The chosen one leaves none chosen meanwhile: the screens show black where they
   * showed it; brought back, it is chosen again, unless another was chosen since.
   */
  remove(id: string): WallpaperResult {
    if (!this.deps.repo.remove(id)) return { ok: false, message: 'That wallpaper is no longer there.' };
    this.push();
    return { ok: true, ids: [id] };
  }

  restore(id: string): WallpaperResult {
    if (!this.deps.repo.restore(id))
      return { ok: false, message: 'That wallpaper can no longer be brought back.' };
    this.push();
    return { ok: true, ids: [id] };
  }

  /** Choose one (null: none, black). */
  choose(id: string | null): WallpaperResult {
    if (id !== null && !this.deps.repo.get(id))
      return { ok: false, message: 'That wallpaper is no longer there.' };
    this.deps.settings.set(CHOSEN, id);
    this.push();
    return { ok: true, ids: id === null ? [] : [id] };
  }

  /** A picture in the library changed (deleted, missing, found again): the screens follow. */
  mediaChanged(): void {
    this.push();
  }

  /**
   * The idle rotation (taken out in Part 12) as one wallpaper, once, so nothing of it is lost: its pictures still in
   * the library, in its order and with its seconds, then its quotes, each to be drawn as a picture by the operator
   * window (`quotesToDraw`). Not chosen by itself: the screens stay as they were. Nothing to make: nothing made.
   */
  fromIdleRotation(was: OldIdleRotation): void {
    if (this.deps.settings.get(FROM_IDLE) === true) return;
    this.deps.settings.set(FROM_IDLE, true);
    const pictures = was.pictures.filter(
      (p) => p.name !== null && this.deps.media(p.mediaId)?.kind === 'image',
    );
    if (pictures.length === 0 && was.quotes.length === 0) return;
    const into = this.deps.repo.create(
      FROM_IDLE_NAME,
      pictures.map((p) => p.mediaId),
      {
        secondsEach: Math.min(WALLPAPER_SECONDS_MAX, Math.max(WALLPAPER_SECONDS_MIN, was.secondsEach)),
        fadeMs: WALLPAPER_FADE_DEFAULT_MS,
      },
    );
    if (was.quotes.length > 0) this.deps.settings.set(QUOTES_TO_DRAW, { into, quotes: was.quotes });
    this.push();
  }

  /** A quote of the idle rotation's, drawn as a picture by the operator window: kept, and into its wallpaper. */
  async addQuotePicture(into: string, quoteId: string, png: Uint8Array): Promise<WallpaperResult> {
    const waiting = this.view().quotesToDraw;
    const quote = waiting?.into === into ? waiting.quotes.find((q) => q.id === quoteId) : undefined;
    if (!waiting || !quote) return { ok: false, message: 'That quote is not waiting to be drawn.' };
    const mediaId = await this.deps.keepPicture(png, quotePictureName(quote));
    if (mediaId === null)
      return {
        ok: false,
        message: 'The quote’s picture could not be kept: it is drawn again the next time Drashti starts.',
      };
    // Still waiting (another call may have taken it meanwhile): into the wallpaper, after what is there.
    const now = this.view().quotesToDraw;
    if (now?.into !== into || !now.quotes.some((q) => q.id === quoteId))
      return { ok: false, message: 'That quote is not waiting to be drawn.' };
    const rest = now.quotes.filter((q) => q.id !== quoteId);
    this.deps.settings.set(QUOTES_TO_DRAW, rest.length > 0 ? { into, quotes: rest } : null);
    const wallpaper = this.deps.repo.get(into);
    if (wallpaper) this.deps.repo.setPictures(into, [...wallpaper.pictures.map((p) => p.mediaId), mediaId]);
    this.push();
    return { ok: true, ids: [into] };
  }

  /** Why these cannot be a wallpaper's pictures, or null when each is a picture in the library. */
  private notPictures(mediaIds: readonly string[]): string | null {
    if (mediaIds.length === 0) return 'Choose one or more pictures.';
    for (const id of mediaIds) {
      const m = this.deps.media(id);
      if (!m) return 'That picture is no longer in the library.';
      if (m.kind !== 'image')
        return `“${m.name}” is ${MEDIA_WORD[m.kind]}, not a picture. Wallpapers are pictures only.`;
    }
    return null;
  }

  /** The chosen one, while it is there (deleted: none, until Undo brings it back). */
  private chosenId(wallpapers: readonly Wallpaper[]): string | null {
    const id = this.deps.settings.get(CHOSEN);
    return typeof id === 'string' && wallpapers.some((w) => w.id === id) ? id : null;
  }

  /** The engine has the chosen one as the library has it now, and (`tell`) the operator window hears. */
  private push(tell = true): void {
    const view = this.view();
    const chosen = view.wallpapers.find((w) => w.id === view.chosenId) ?? null;
    this.deps.engine.setChosenWallpaper(
      chosen && {
        id: chosen.id,
        name: chosen.name,
        pictures: chosen.pictures.filter((p) => !p.missing).map((p) => p.mediaId),
        secondsEach: chosen.secondsEach,
        fadeMs: chosen.fadeMs,
      },
    );
    if (tell) this.deps.changed(view);
  }
}
