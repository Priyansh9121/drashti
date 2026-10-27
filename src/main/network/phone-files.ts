import { mkdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { ImportItemReport } from '../../shared/import';
import type { DeviceKind } from '../../shared/network';
import {
  ADD_FILES_WORDS,
  ADDED_FROM_PHONES,
  type AddFilesView,
  type ArrivedFile,
  type ArrivedOutcome,
  nameWithoutExtension,
  type SharedPlaylist,
  UPLOAD_ID_PATTERN,
  UPLOAD_MAX_BYTES,
  UPLOAD_RESERVE_BYTES,
  type UploadPolicy,
} from '../../shared/phone-files';
import type { PlaylistItemInfo } from '../../shared/playlists';
import type { Db } from '../db/database';
import type { PlaylistRepo } from '../db/playlists';
import type { PresentationRepo } from '../db/presentations';
import { whatFileIs } from '../import/file-kind';
import { realPlaceAsync } from '../media/contained';
import { freeName, madeFrom } from '../playlists/folder-playlist';

/*
 * Files between Drashti and its phones, as the main process keeps them (Session 54, D3 and D4;
 * shared/phone-files.ts):
 *
 * - The switch, "Phones and tablets may add files", off until someone turns it on (every person's, in the
 *   Phones and tablets panel). What the network's worker is told: the switch, the size limit, the 2 GB kept free,
 *   and whether the stream is on air or recording (pieces then come more slowly).
 * - A file a phone sent, once the worker has all of it: checked again here (the switch, a Remote still paired, a
 *   name Drashti made in the uploads folder of the media folder and really there, and what is inside it), then
 *   imported as a dropped file is (so a deck comes in as any deck does, and what Drashti cannot play is
 *   converted by itself, never on air), named as the phone named it, marked with the device's name, and added to
 *   the playlist "Added from Phones" (made when the first file comes). It never goes live by itself. The file sent
 *   is removed once imported: the media folder keeps the library's own copy.
 * - The playlists shared with phones, for Remote devices to view.
 */

/** The switch (the library's settings), and the playlist a phone's files go into, by its id. */
export const ADD_FILES_SETTING = 'network.addFiles';
const ADDED_PLAYLIST_SETTING = 'network.addedFromPhones';
/** How often to look whether the stream went on or off air. */
const WATCH_MS = 2000;
/** What a deck waits for while the stream is on air or recording, as the phone reads it. */
export const DECK_WAITS =
  'Waiting for the stream to end: Drashti brings a PDF, PowerPoint or Keynote file in once it has (a deck is never converted on air).';
/** Kinds Drashti converts at import (Keynote or PowerPoint makes a PDF, pdf.js draws its pages): never on air. */
const DECKS = new Set<ArrivedFile['kind']>(['pdf', 'powerpoint', 'keynote']);

export interface PhoneFilesDeps {
  db: Db;
  settings: { get(name: string): unknown; set(name: string, value: unknown): void };
  playlists: PlaylistRepo;
  presentations: Pick<PresentationRepo, 'uniqueName'>;
  /** Index a presentation again (its name changed). */
  search: { update(presentationId: string): void };
  /** A paired device by its id, or null once it is no longer paired. */
  device(id: string): { name: string; kind: DeviceKind } | null;
  /** The media folder, and the uploads folder inside it. */
  mediaDir: string;
  dir: string;
  /** The normal import, as a dropped file goes. Resolves when it has ended. */
  importFiles(paths: string[]): Promise<{ ok: true; runId: string } | { ok: false; message: string }>;
  report(runId: string): { items: ImportItemReport[] } | null;
  onAir(): boolean;
  simpleMode(): boolean;
  /** One quiet notice for each file added, in Pro Mode. */
  notice(text: string): void;
  /** A file from a phone is in the library and its playlist (these presentations were renamed): tell everyone. */
  changed(presentationIds: string[]): void;
  log(level: 'info' | 'warn', message: string): void;
  /** The largest file a phone may add (2 GB; tests set less). */
  maxBytes?: number;
  /** How often a deck waiting for the stream to end looks again (2 s; tests set it shorter). */
  waitMs?: number;
  /**
   * Whether this computer is let in (Part E's access lock, access/gate.ts isLetIn): while it is not, nothing comes
   * from a phone. Left out: always.
   */
  letIn?: () => boolean;
}

const plainWord = (kind: ArrivedFile['kind']) =>
  kind === 'image'
    ? 'picture'
    : kind === 'video'
      ? 'video'
      : kind === 'audio'
        ? 'sound'
        : kind === 'pdf'
          ? 'PDF'
          : kind === 'powerpoint'
            ? 'PowerPoint file'
            : 'Keynote file';

export class PhoneFiles {
  private watching: ReturnType<typeof setInterval> | null = null;
  private wasOnAir = false;

  constructor(private readonly deps: PhoneFilesDeps) {
    // What an earlier run left (a file half-sent, or sent and never imported): gone before the network starts.
    try {
      rmSync(deps.dir, { recursive: true, force: true });
      mkdirSync(deps.dir, { recursive: true });
    } catch (error) {
      deps.log(
        'warn',
        `Files from phones: the uploads folder could not be cleared (${(error as Error).name})`,
      );
    }
  }

  get on(): boolean {
    return this.deps.settings.get(ADD_FILES_SETTING) === true;
  }

  /** Turn "Phones and tablets may add files" on or off. */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.deps.settings.set(ADD_FILES_SETTING, on);
    this.deps.log('info', `Files from phones: adding turned ${on ? 'on' : 'off'}`);
  }

  view(): AddFilesView {
    return { on: this.on, maxBytes: this.deps.maxBytes ?? UPLOAD_MAX_BYTES };
  }

  private letIn(): boolean {
    return this.deps.letIn?.() ?? true;
  }

  /** What the network's worker is told (the switch, and Drashti let in). */
  policy(): UploadPolicy {
    return {
      on: this.on && this.letIn(),
      maxBytes: this.deps.maxBytes ?? UPLOAD_MAX_BYTES,
      reserveBytes: UPLOAD_RESERVE_BYTES,
      slowed: this.deps.onAir(),
    };
  }

  /** Look every 2 s whether the stream went on or off air: the worker is told (its pieces come slower on air). */
  watch(changed: () => void, everyMs = WATCH_MS): void {
    this.wasOnAir = this.deps.onAir();
    this.watching ??= setInterval(() => {
      const now = this.deps.onAir();
      if (now === this.wasOnAir) return;
      this.wasOnAir = now;
      changed();
    }, everyMs);
    this.watching.unref();
  }

  close(): void {
    if (this.watching) clearInterval(this.watching);
    this.watching = null;
  }

  // ---- shared playlists ---------------------------------------------------------------------

  shared(): SharedPlaylist[] {
    return this.deps.playlists.sharedPlaylists();
  }

  /** A shared playlist's items; null when it is not shared (or not there). */
  sharedItems(playlistId: string): PlaylistItemInfo[] | null {
    return this.deps.playlists.isShared(playlistId) ? this.deps.playlists.itemsOf(playlistId) : null;
  }

  // ---- a file a phone added ------------------------------------------------------------------------

  /** Drashti's own name for it, in the uploads folder, and really there: else it is not one of its files. */
  private async ours(file: ArrivedFile): Promise<boolean> {
    if (!UPLOAD_ID_PATTERN.test(file.id) || !/^[a-z0-9]{1,5}$/u.test(file.ext)) return false;
    if (
      resolve(dirname(file.file)) !== resolve(this.deps.dir) ||
      basename(file.file) !== `${file.id}.${file.ext}`
    )
      return false;
    const place = await realPlaceAsync(this.deps.mediaDir, file.file);
    return place?.inside === true;
  }

  /** The playlist a phone's files go into: the one made before, or a new one at the top of the list. */
  private addedPlaylist(): { id: string; name: string } {
    const kept = this.deps.settings.get(ADDED_PLAYLIST_SETTING);
    if (typeof kept === 'string') {
      const row = this.deps.db
        .prepare(
          'SELECT id, name FROM playlists WHERE id = ? AND deleted_at IS NULL AND is_folder = 0 AND is_template = 0',
        )
        .get(kept) as { id: string; name: string } | undefined;
      if (row) return row;
    }
    const name = freeName(this.deps.playlists, ADDED_FROM_PHONES);
    const id = this.deps.playlists.createAtTop(name);
    this.deps.settings.set(ADDED_PLAYLIST_SETTING, id);
    return { id, name };
  }

  /** Until the stream is off air and not recording (at once when it is). */
  private offAir(): Promise<void> {
    if (!this.deps.onAir()) return Promise.resolve();
    return new Promise((resolve) => {
      const look = setInterval(() => {
        if (this.deps.onAir()) return;
        clearInterval(look);
        resolve();
      }, this.deps.waitMs ?? WATCH_MS);
    });
  }

  /**
   * A file a phone sent has all arrived: checked again, imported, named, marked and added to its playlist. What
   * came of it, for the phone. The file sent is removed in every case, once it is known to be Drashti's own. A deck
   * (a PDF, PowerPoint or Keynote file), which the import converts, waits while the stream is on air or recording
   * (Session 50's rule), the phone told why (`note`); a picture, video or sound comes in at once, as a dropped one
   * does (what of it Drashti cannot play is converted afterwards, off air).
   */
  async arrived(
    file: ArrivedFile,
    note: (message: string) => void = () => undefined,
  ): Promise<ArrivedOutcome> {
    const ours = await this.ours(file);
    const refuse = async (message: string): Promise<ArrivedOutcome> => {
      if (ours) await rm(file.file, { force: true }).catch(() => undefined);
      return { ok: false, message };
    };
    if (!ours) {
      this.deps.log('warn', 'Files from phones: a file outside the uploads folder was refused');
      return refuse('Drashti could not keep this file: add it again.');
    }
    if (!this.on) return refuse(ADD_FILES_WORDS.off);
    if (!this.letIn())
      return refuse('Drashti is locked on its computer: add the file again once it is open.');
    const device = this.deps.device(file.deviceId);
    if (device?.kind !== 'remote') return refuse('This phone is no longer paired with Drashti.');
    const what = await whatFileIs(file.file);
    if (what?.ext !== file.ext || what.kind !== file.kind) return refuse(ADD_FILES_WORDS.notTaken);
    if (file.ext === 'ppt') return refuse(ADD_FILES_WORDS.oldPowerPoint);
    try {
      if (DECKS.has(file.kind) && this.deps.onAir()) {
        note(DECK_WAITS);
        await this.offAir();
      }
      return await this.importArrived(file, device.name);
    } finally {
      await rm(file.file, { force: true }).catch(() => undefined);
    }
  }

  private async importArrived(file: ArrivedFile, deviceName: string): Promise<ArrivedOutcome> {
    const result = await this.deps.importFiles([file.file]);
    if (!result.ok) return { ok: false, message: result.message };
    const items = this.deps.report(result.runId)?.items ?? [];
    const item = items.find((i) => i.sourcePath === file.file);
    const made = madeFrom(items, [{ path: file.file, relative: file.id }]).get(file.id);
    if (!made || (made.kind !== 'media' && made.kind !== 'presentation'))
      return {
        ok: false,
        message: item?.message ?? 'The import was stopped on Drashti’s computer: add it again.',
      };
    // New in the library: named as the phone named it, and marked with the device's name. One already there (the
    // same file added before, from anywhere) stays as it was.
    const fresh = item?.outcome === 'imported' || item?.outcome === 'kept-both';
    const renamed: string[] = [];
    const playlist = this.addedPlaylist();
    this.deps.db.transaction(() => {
      if (fresh && made.kind === 'media')
        this.deps.db
          .prepare('UPDATE media SET name = ?, from_device = ? WHERE id = ?')
          .run(file.name, deviceName, made.mediaId);
      if (fresh && made.kind === 'presentation') {
        const row = this.deps.db
          .prepare('SELECT library_id FROM presentations WHERE id = ?')
          .get(made.presentationId) as { library_id: string } | undefined;
        const name = row
          ? this.deps.presentations.uniqueName(row.library_id, nameWithoutExtension(file.name))
          : nameWithoutExtension(file.name);
        this.deps.db
          .prepare('UPDATE presentations SET name = ?, from_device = ? WHERE id = ?')
          .run(name, deviceName, made.presentationId);
        this.deps.search.update(made.presentationId);
        renamed.push(made.presentationId);
      }
      const already = this.deps.db
        .prepare(
          'SELECT 1 FROM playlist_items WHERE playlist_id = ? AND deleted_at IS NULL AND (media_id = ? OR presentation_id = ?)',
        )
        .get(
          playlist.id,
          made.kind === 'media' ? made.mediaId : null,
          made.kind === 'presentation' ? made.presentationId : null,
        );
      if (!already) this.deps.playlists.addItems(playlist.id, null, [made]);
    })();
    this.deps.changed(renamed);
    const word = plainWord(file.kind);
    this.deps.log('info', `Files from phones: “${deviceName}” added a ${word}`);
    if (!this.deps.simpleMode())
      this.deps.notice(`A ${word} from “${deviceName}” is in the playlist “${playlist.name}”.`);
    const where = made.kind === 'media' ? 'Media' : 'the library';
    const converting = item?.issues.some((i) => i.code === 'converting-media') === true;
    return {
      ok: true,
      message: fresh
        ? `Added to Drashti, in ${where} and the playlist “${playlist.name}”.${converting ? ' Drashti makes a copy it can play first.' : ''}`
        : `Drashti has this file already: it is in the playlist “${playlist.name}”.`,
    };
  }
}
