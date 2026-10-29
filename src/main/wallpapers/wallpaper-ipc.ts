import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { dialog } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OldIdleRotation } from '../../shared/idle';
import { IPC } from '../../shared/ipc';
import type { ChosenWallpaper, WallpaperResult, WallpapersView } from '../../shared/wallpapers';
import {
  quotePictureSchema,
  wallpaperIdSchema,
  wallpaperNameSchema,
  wallpaperPathsSchema,
  wallpaperPicturesSchema,
  wallpaperTimingSchema,
} from '../../shared/wallpapers';
import type { Db } from '../db/database';
import { WallpaperRepo } from '../db/wallpapers';
import { handle } from '../ipc/handle';
import { sortWallpaperFiles } from './wallpaper-files';
import { WallpaperService } from './wallpaper-service';

/*
 * The wallpapers' requests (Session 55, Part 6): anyone of Drashti's pages may read them; only the operator window may
 * change them, every argument checked here. Files offered are sorted here (pictures only), Import… is the system's
 * dialog for pictures, and a quote of the idle rotation's, drawn as a picture by the operator window, is written to a
 * folder of its own for a moment and imported as any picture is.
 */

/** The picture types offered by Import… (the import's own list, so Part 5's types come too). */
export interface WallpaperIpcDeps {
  db: Db;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  media: (mediaId: string) => { kind: 'image' | 'video' | 'audio'; name: string } | null;
  engine: { setChosenWallpaper(wallpaper: Omit<ChosenWallpaper, 'since'> | null): unknown };
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  operatorWindow: () => BrowserWindow | null;
  /** The picture types Import… offers (every one Drashti imports as a picture). */
  pictureExtensions: () => string[];
  /** Import a picture file as any import does: its media id, or null. */
  importPicture: (file: string) => Promise<string | null>;
  /** The wallpapers changed: the operator window hears, and nodes copy their pictures. */
  changed: (view: WallpapersView) => void;
  /** What the idle rotation was set to show (Part 12 took it out): made into a wallpaper once. */
  idleRotationWas: () => OldIdleRotation;
  log: (line: string) => void;
}

const refused: WallpaperResult = {
  ok: false,
  message: 'Only the operator window can change the wallpapers.',
};
const failed = (message: string): WallpaperResult => ({ ok: false, message });

export function registerWallpapers(deps: WallpaperIpcDeps): WallpaperService {
  const service = new WallpaperService({
    repo: new WallpaperRepo(deps.db),
    settings: deps.settings,
    media: deps.media,
    engine: deps.engine,
    changed: deps.changed,
    keepPicture: async (png, name) => {
      const dir = await mkdtemp(join(tmpdir(), 'drashti-quote-'));
      try {
        const file = join(dir, `${name}.png`);
        await writeFile(file, png);
        return await deps.importPicture(file);
      } finally {
        // Its own folder for a moment: gone once the import has its copy (on Windows a file still held a moment
        // longer stays in the temporary folder, which the system empties).
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  });
  service.start();
  service.fromIdleRotation(deps.idleRotationWas());
  const quotes = service.view().quotesToDraw;
  deps.log(
    `Wallpapers: ${String(service.view().wallpapers.length)}${quotes ? `, ${String(quotes.quotes.length)} quote(s) of the idle rotation still to draw` : ''}`,
  );

  /** Run a change for the operator window. */
  const change = (event: IpcMainInvokeEvent, run: () => WallpaperResult): WallpaperResult =>
    deps.fromOperator(event) ? run() : refused;

  handle(IPC.wallpapers.view, () => service.view());
  handle(IPC.wallpapers.sortFiles, async (e, paths) => {
    const parsed = wallpaperPathsSchema.safeParse(paths);
    if (!deps.fromOperator(e) || !parsed.success) return { pictures: [], refused: [] };
    return sortWallpaperFiles(parsed.data);
  });
  handle(IPC.wallpapers.pickFiles, async (e) => {
    const window = deps.operatorWindow();
    if (!deps.fromOperator(e) || !window) return [];
    const picked = await dialog.showOpenDialog(window, {
      title: 'Import wallpapers',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Pictures', extensions: deps.pictureExtensions() },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  handle(IPC.wallpapers.add, (e, mediaIds, into) =>
    change(e, () => {
      const ids = wallpaperPicturesSchema.safeParse(mediaIds);
      const target = wallpaperIdSchema.nullable().safeParse(into);
      if (!ids.success || !target.success) return failed('Choose one or more pictures.');
      return service.add(ids.data, target.data);
    }),
  );
  handle(IPC.wallpapers.rename, (e, id, name) =>
    change(e, () => {
      const which = wallpaperIdSchema.safeParse(id);
      const to = wallpaperNameSchema.safeParse(name);
      if (!which.success || !to.success) return failed('A wallpaper needs a name (1 to 200 characters).');
      return service.rename(which.data, to.data);
    }),
  );
  handle(IPC.wallpapers.setPictures, (e, id, mediaIds) =>
    change(e, () => {
      const which = wallpaperIdSchema.safeParse(id);
      const ids = wallpaperPicturesSchema.safeParse(mediaIds);
      if (!which.success || !ids.success) return failed('A wallpaper needs one picture at least.');
      return service.setPictures(which.data, ids.data);
    }),
  );
  handle(IPC.wallpapers.setTiming, (e, id, timing) =>
    change(e, () => {
      const which = wallpaperIdSchema.safeParse(id);
      const t = wallpaperTimingSchema.safeParse(timing);
      if (!which.success || !t.success)
        return failed('Each picture is up 3 to 600 seconds, with a fade of up to 5 seconds.');
      return service.setTiming(which.data, t.data);
    }),
  );
  handle(IPC.wallpapers.remove, (e, id) =>
    change(e, () => {
      const which = wallpaperIdSchema.safeParse(id);
      return which.success ? service.remove(which.data) : failed('That wallpaper is no longer there.');
    }),
  );
  handle(IPC.wallpapers.restore, (e, id) =>
    change(e, () => {
      const which = wallpaperIdSchema.safeParse(id);
      return which.success
        ? service.restore(which.data)
        : failed('That wallpaper can no longer be brought back.');
    }),
  );
  handle(IPC.wallpapers.choose, (e, id) =>
    change(e, () => {
      const which = wallpaperIdSchema.nullable().safeParse(id);
      return which.success ? service.choose(which.data) : failed('That wallpaper is no longer there.');
    }),
  );
  handle(IPC.wallpapers.quotePicture, async (e, into, quoteId, png) => {
    if (!deps.fromOperator(e)) return refused;
    const which = wallpaperIdSchema.safeParse(into);
    const quote = wallpaperIdSchema.safeParse(quoteId);
    const bytes = quotePictureSchema.safeParse(png);
    if (!which.success || !quote.success || !bytes.success)
      return failed('That quote’s picture cannot be kept.');
    const done = await service.addQuotePicture(which.data, quote.data, bytes.data);
    if (done.ok) deps.log('Wallpapers: a quote of the idle rotation drawn as a picture');
    return done;
  });
  return service;
}
