import type { DeviceAnswer } from '../../shared/network-api';
import { PHONE_ARGS, type RemoteWallpapers } from '../../shared/network-phone';
import { framed, type PictureLook } from '../../shared/picture-look';
import type { PlaylistResult } from '../../shared/playlists';
import type { QuickBarResult, QuickPin } from '../../shared/quick-bar';
import type { WallpaperResult, WallpapersView, WhenEnds } from '../../shared/wallpapers';
import { RateLimiter } from './limits';

/*
 * What the main process answers a Remote's own requests (Session 55, Part 9; shared/network-phone.ts): the wallpapers,
 * the quick bar, a picture's look, Rename… and a video row's When it ends, each done by the very function the operator
 * window's own request calls (index.ts gives them), after network-service.ts's checks (Drashti let in, the device and
 * its kind, Simple Mode's lock and its tables). Each takes only what it names, by id; anything else is refused before
 * anything runs. A phone's changes are limited as its library changes are (five a second, thirty at once).
 */

type Done = { ok: true } | { ok: false; message: string };

/** The window's own functions, as index.ts registers them for its requests. */
export interface PhoneActs {
  wallpapers: {
    view(): WallpapersView;
    choose(id: string | null): WallpaperResult;
    rename(id: string, name: string): WallpaperResult;
    remove(id: string): WallpaperResult;
    restore(id: string): WallpaperResult;
  };
  quickBar: {
    view(): QuickPin[];
    set(pins: QuickPin[]): QuickBarResult;
  };
  looks: {
    /** A picture's kept look (null: as it was taken). */
    look(mediaId: string): PictureLook | null;
    /** A photo (its blurred fill on unless its look says not), not a deck's slide. */
    photo(mediaId: string): boolean;
    /** Kept as the Picture editor's Save keeps it (null: as it was taken). */
    set(mediaId: string, look: PictureLook | null): Done;
  };
  rename: {
    media(mediaId: string, name: string): Done;
    presentation(presentationId: string, name: string): Done;
  };
  whenEnds(itemId: string, whenEnds: WhenEnds): PlaylistResult;
}

export type PhoneOp =
  | 'wallpapers'
  | 'wallpaper.choose'
  | 'wallpaper.rename'
  | 'wallpaper.remove'
  | 'wallpaper.restore'
  | 'quickBar'
  | 'quickBar.set'
  | 'media.look'
  | 'media.setLook'
  | 'media.rename'
  | 'presentation.rename'
  | 'playlist.whenEnds';

/** The ops that read only (never limited). */
const READS: ReadonlySet<PhoneOp> = new Set(['wallpapers', 'quickBar', 'media.look']);

const ok = (body: Record<string, unknown> = {}): DeviceAnswer => ({
  status: 200,
  body: { ok: true, ...body },
});
const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

export class PhoneAnswers {
  /** A phone's changes: five a second, thirty at once, as a person tapping through them makes them. */
  private readonly changes: RateLimiter;

  constructor(
    private readonly acts: PhoneActs,
    private readonly ctx: { log(message: string): void; now(): number },
  ) {
    this.changes = new RateLimiter(5, 30, () => ctx.now());
  }

  /** The wallpapers as a phone reads them: by name, each picture by its id (no files, no timing). */
  private wallpapers(): RemoteWallpapers {
    const view = this.acts.wallpapers.view();
    return {
      chosenId: view.chosenId,
      wallpapers: view.wallpapers.map((w) => ({
        id: w.id,
        name: w.name,
        pictures: w.pictures.map((p) => ({ mediaId: p.mediaId, name: p.name, missing: p.missing })),
      })),
    };
  }

  answer(op: PhoneOp, args: Record<string, unknown>, device: { id: string }, who: string): DeviceAnswer {
    if (!READS.has(op) && !this.changes.take(device.id))
      return deny(429, 'Too many changes at once: wait a moment, then try again.');
    const wallpaper = (result: WallpaperResult, did: string): DeviceAnswer => {
      if (!result.ok) return deny(409, result.message);
      this.ctx.log(`Network: ${who} ${did}`);
      return ok({ ids: result.ids, ...this.wallpapers() });
    };
    const done = (result: Done | PlaylistResult, did: string, ids: string[]): DeviceAnswer => {
      if (!result.ok) return deny(409, result.message);
      this.ctx.log(`Network: ${who} ${did}`);
      return ok({ ids });
    };
    switch (op) {
      case 'wallpapers':
        return ok({ ...this.wallpapers() });
      case 'wallpaper.choose': {
        const a = PHONE_ARGS.wallpaperChoose.safeParse(args);
        if (!a.success) return deny(400, 'Which wallpaper?');
        return wallpaper(
          this.acts.wallpapers.choose(a.data.wallpaperId),
          a.data.wallpaperId === null ? 'chose no wallpaper' : 'chose a wallpaper',
        );
      }
      case 'wallpaper.rename': {
        const a = PHONE_ARGS.wallpaperRename.safeParse(args);
        if (!a.success) return deny(400, 'A wallpaper needs a name (1 to 200 characters).');
        return wallpaper(this.acts.wallpapers.rename(a.data.wallpaperId, a.data.name), 'renamed a wallpaper');
      }
      case 'wallpaper.remove': {
        const a = PHONE_ARGS.wallpaperRef.safeParse(args);
        if (!a.success) return deny(400, 'Which wallpaper?');
        return wallpaper(this.acts.wallpapers.remove(a.data.wallpaperId), 'deleted a wallpaper');
      }
      case 'wallpaper.restore': {
        const a = PHONE_ARGS.wallpaperRef.safeParse(args);
        if (!a.success) return deny(400, 'Which wallpaper?');
        return wallpaper(this.acts.wallpapers.restore(a.data.wallpaperId), 'put a wallpaper back');
      }
      case 'quickBar':
        return ok({ pins: this.acts.quickBar.view() });
      case 'quickBar.set': {
        const a = PHONE_ARGS.quickBarSet.safeParse(args);
        if (!a.success) return deny(400, 'The quick bar holds at most 8 things, each once.');
        const result = this.acts.quickBar.set(a.data.pins);
        if (!result.ok) return deny(409, result.message);
        this.ctx.log(`Network: ${who} changed the quick bar (${String(result.pins.length)} pinned)`);
        return ok({ pins: result.pins });
      }
      case 'media.look': {
        const a = PHONE_ARGS.mediaRef.safeParse(args);
        if (!a.success) return deny(400, 'Which picture?');
        return ok({
          look: this.acts.looks.look(a.data.mediaId),
          photo: this.acts.looks.photo(a.data.mediaId),
        });
      }
      case 'media.setLook': {
        const a = PHONE_ARGS.mediaLook.safeParse(args);
        if (!a.success) return deny(400, 'That look cannot be kept.');
        const look = a.data.look === null ? null : framed(a.data.look);
        return done(this.acts.looks.set(a.data.mediaId, look), 'changed a picture’s look', [a.data.mediaId]);
      }
      case 'media.rename': {
        const a = PHONE_ARGS.mediaRename.safeParse(args);
        if (!a.success) return deny(400, 'A name needs 1 to 200 characters.');
        return done(this.acts.rename.media(a.data.mediaId, a.data.name), 'renamed a media file', [
          a.data.mediaId,
        ]);
      }
      case 'presentation.rename': {
        const a = PHONE_ARGS.presentationRename.safeParse(args);
        if (!a.success) return deny(400, 'A name needs 1 to 200 characters.');
        return done(
          this.acts.rename.presentation(a.data.presentationId, a.data.name),
          'renamed a presentation',
          [a.data.presentationId],
        );
      }
      case 'playlist.whenEnds': {
        const a = PHONE_ARGS.whenEnds.safeParse(args);
        if (!a.success) return deny(400, 'That is not something a video can do when it ends.');
        return done(
          this.acts.whenEnds(a.data.itemId, a.data.whenEnds),
          'set what a video does when it ends',
          [a.data.itemId],
        );
      }
    }
  }
}
