import type { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ImportItemReport, ImportOptions } from '../../shared/import';
import type { NewItem, SmartPlaylistView } from '../../shared/playlists';
import { SMART_MAX_FILES } from '../../shared/playlists';
import type { Db } from '../db/database';
import type { PlaylistRepo } from '../db/playlists';
import { formatOf } from '../import/scan';
import { addToFolderParts, folderItems, freeName, madeFrom, type FolderFile } from './folder-playlist';

/*
 * A smart playlist follows a folder on the computer (Session 26c; PLAN §7):
 * what Drashti imports as media or pictures there (videos, pictures,
 * sounds, PowerPoint, Keynote and PDF decks), in its subfolders too, joins
 * the playlist by itself, in the folder's order (shared/folder-order.ts),
 * with a header before each subfolder's part.
 *
 * - Drashti looks at the folder while it runs: file-system events where they
 *   work, and a light scan every 10 s. Starting, it catches up on what
 *   changed while it was closed.
 * - A new file waits until its size has held still for 3 s, then is
 *   imported (the same rules as a file dropped on Drashti) and joins at the
 *   end of its folder's part, so items moved by hand stay put.
 * - A file that is gone shows as missing (its item stays); one button takes
 *   the missing out. A file whose size or time changed is imported again:
 *   when its bytes differ, it replaces its item in place.
 * - A folder that is gone (a USB stick taken out) is said so; the playlist
 *   keeps its items, and carries on when the folder is back.
 * - Nothing it does touches what is on the screens: the screens keep what
 *   they show until it is taken down.
 * - At most SMART_MAX_FILES files: past that it says so, and adds or marks
 *   nothing until some go.
 */

export interface SmartFolderDeps {
  db: Db;
  playlists: PlaylistRepo;
  /** The normal import. Resolves when it has ended. */
  importFiles(
    paths: string[],
    options: ImportOptions,
  ): Promise<{ ok: true; runId: string } | { ok: false; message: string }>;
  /** What an import run did, file by file. */
  report(runId: string): { items: ImportItemReport[] } | null;
  /** A smart playlist's items changed: the window, the engine and the remote hear of it. */
  changed(playlistId: string): void;
  /** How the following goes changed (for the window). */
  views(views: SmartPlaylistView[]): void;
  log(level: 'info' | 'warn', message: string): void;
  now(): number;
  /** How often to scan (10 s; tests set it shorter). */
  scanMs: number;
  /** How long a new or changed file's size must hold still (3 s; tests set it shorter). */
  settleMs: number;
  /** Watching a folder and its subfolders for changes; null where it cannot (the scan still runs). */
  watch?(dir: string, changed: () => void): (() => void) | null;
  /** The most files a smart playlist follows (SMART_MAX_FILES; tests set fewer). */
  maxFiles?: number;
  /** Run `run` after `delayMs`, and a way to cancel it (setTimeout when left out; tests look by hand). */
  schedule?: (delayMs: number, run: () => void) => () => void;
}

/** A file's size and time, as seen. */
interface Found {
  size: number;
  mtimeMs: number;
}

/** A new or changed file waiting for its size to hold still. */
interface Seen extends Found {
  /** When it was first seen at this size and time. */
  since: number;
}

/** A file the playlist follows, as remembered (smart_files). */
interface Row {
  relative: string;
  size: number;
  mtime_ms: number;
  item_id: string | null;
  state: 'ok' | 'missing' | 'removed' | 'failed';
}

interface Followed {
  folder: string;
  /** New or changed files waiting for their size to hold still, by path inside the folder. */
  pending: Map<string, Seen>;
  view: SmartPlaylistView;
  /** The look going, if one is. */
  running: Promise<void> | null;
  /** One more look, asked for while one was going: it runs after it, and those who asked wait for it. */
  again: Promise<void> | null;
  /** A look again soon (a file event, or a file settling), and how to cancel it. */
  soon: (() => void) | null;
  stopWatching: (() => void) | null;
}

/** Folders operating systems leave, never followed. */
const SKIPPED_DIRS = new Set(['__macosx', '$recycle.bin', 'system volume information', '.trashes']);

/**
 * The files in a folder and its subfolders that a smart playlist takes, by "/"-separated path inside it;
 * null when the folder is not there. `tooMany` when there are more than `max`.
 */
export async function filesIn(
  folder: string,
  max: number,
): Promise<{ files: Map<string, Found>; tooMany: boolean } | null> {
  const top = await stat(folder).catch(() => null);
  if (!top?.isDirectory()) return null;
  const files = new Map<string, Found>();
  let tooMany = false;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (tooMany) return;
      if (e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      const relative = prefix === '' ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIPPED_DIRS.has(e.name.toLowerCase())) await walk(full, relative);
        continue;
      }
      const format = e.isFile() ? formatOf(e.name) : 'unknown';
      if (format !== 'media' && format !== 'pictures') continue;
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (files.size >= max) {
        tooMany = true;
        return;
      }
      files.set(relative, { size: s.size, mtimeMs: Math.round(s.mtimeMs) });
    }
  };
  await walk(folder, '');
  return { files, tooMany };
}

/** The folder a smart playlist's settings name, or null. */
export function folderOfSettings(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { folder?: unknown };
    return typeof v.folder === 'string' && v.folder !== '' ? v.folder : null;
  } catch {
    return null;
  }
}

const many = (n: number) => n.toLocaleString('en');

export class SmartFolders {
  private readonly followed = new Map<string, Followed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly max: number;

  constructor(private readonly deps: SmartFolderDeps) {
    this.max = deps.maxFiles ?? SMART_MAX_FILES;
  }

  /**
   * Follow every smart playlist. Drashti starting, it catches up on what changed while it was closed:
   * resolves after that first look.
   */
  start(): Promise<void> {
    for (const r of this.smartPlaylists()) this.follow(r.id, r.folder);
    this.timer = setInterval(() => {
      void this.scanAll();
    }, this.deps.scanMs);
    this.timer.unref();
    return this.scanAll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const f of this.followed.values()) this.unfollow(f);
    this.followed.clear();
  }

  /** A new smart playlist following `folder`, named after it, at the top of the list; it fills itself. */
  async create(folder: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
    const found = await filesIn(folder, this.max);
    if (!found) return { ok: false, message: 'That folder is not there any more.' };
    if (found.tooMany)
      return {
        ok: false,
        message: `That folder holds more than ${many(this.max)} videos, pictures, sounds and decks, and a smart playlist follows at most ${many(this.max)}. Choose a smaller folder.`,
      };
    const id = this.deps.playlists.createSmart(freeName(this.deps.playlists, basename(folder)), folder);
    this.deps.log(
      'info',
      `Smart playlists: one made, following a folder of ${String(found.files.size)} file(s)`,
    );
    this.follow(id, folder);
    this.deps.changed(id);
    this.deps.views(this.views());
    // The first look only notes the files (none has held still yet): quick, even for a large folder.
    await this.scan(id);
    return { ok: true, id };
  }

  /** How each smart playlist's following goes, for the window. */
  views(): SmartPlaylistView[] {
    return [...this.followed.values()].map((f) => f.view);
  }

  /**
   * Take out the items whose files are gone (the one button), as removing items does: Undo brings them back
   * (itemsRestored). A file of the same name later is a new one. The items taken out.
   */
  removeMissing(playlistId: string): string[] {
    const ids = (
      this.deps.db
        .prepare(
          "SELECT item_id FROM smart_files WHERE playlist_id = ? AND state = 'missing' AND item_id IS NOT NULL",
        )
        .all(playlistId) as { item_id: string }[]
    ).map((r) => r.item_id);
    const removed = this.deps.db.transaction(() => {
      const out = this.deps.playlists.removeItems(ids);
      this.deps.db
        .prepare("UPDATE smart_files SET state = 'removed' WHERE playlist_id = ? AND state = 'missing'")
        .run(playlistId);
      return out;
    })();
    const f = this.followed.get(playlistId);
    if (f) this.setView(f, { missing: 0 });
    if (removed.length > 0) this.deps.changed(playlistId);
    return removed;
  }

  /** Items brought back (Undo): those taken out as missing are missing again, until their files are back. */
  itemsRestored(itemIds: readonly string[]): void {
    const back = this.deps.db.prepare(
      "UPDATE smart_files SET state = 'missing' WHERE item_id = ? AND state = 'removed' RETURNING playlist_id",
    );
    const playlists = new Set<string>();
    for (const id of itemIds)
      for (const r of back.all(id) as { playlist_id: string }[]) playlists.add(r.playlist_id);
    for (const id of playlists) {
      const f = this.followed.get(id);
      if (f) this.setView(f, { missing: this.missingCount(id) });
      void this.scan(id);
    }
  }

  /** Playlists were deleted or brought back: stop or start following them. Resolves after a first look. */
  async refresh(): Promise<void> {
    const now = this.smartPlaylists();
    const ids = new Set(now.map((r) => r.id));
    for (const [id, f] of this.followed)
      if (!ids.has(id)) {
        this.unfollow(f);
        this.followed.delete(id);
      }
    const back = now.filter((r) => !this.followed.has(r.id));
    for (const r of back) this.follow(r.id, r.folder);
    this.deps.views(this.views());
    for (const r of back) await this.scan(r.id);
  }

  /**
   * Look at a playlist's folder: what is new and settled is imported, what is gone is marked. Asked while
   * a look is going, it looks once more after it (however many ask meanwhile), and resolves after that.
   */
  scan(playlistId: string): Promise<void> {
    const f = this.followed.get(playlistId);
    if (!f || this.stopped) return Promise.resolve();
    if (f.running) {
      f.again ??= f.running.then(() => {
        f.again = null;
        return this.scan(playlistId);
      });
      return f.again;
    }
    const look = async () => {
      try {
        await this.scanOnce(playlistId, f);
      } catch (error) {
        this.deps.log(
          'warn',
          `Smart playlists: a followed folder could not be read (${(error as Error).name})`,
        );
      } finally {
        f.running = null;
      }
      // Files waiting to settle: look again once they could have (unless it was stopped or deleted meanwhile).
      if (f.pending.size > 0 && this.followed.get(playlistId) === f)
        this.soon(playlistId, f, this.deps.settleMs);
    };
    f.running = look();
    return f.running;
  }

  private smartPlaylists(): { id: string; folder: string }[] {
    const rows = this.deps.db
      .prepare("SELECT id, settings FROM playlists WHERE kind = 'smart' AND deleted_at IS NULL")
      .all() as { id: string; settings: string | null }[];
    return rows.flatMap((r) => {
      const folder = folderOfSettings(r.settings);
      return folder ? [{ id: r.id, folder }] : [];
    });
  }

  private follow(playlistId: string, folder: string): void {
    const f: Followed = {
      folder,
      pending: new Map(),
      running: null,
      again: null,
      soon: null,
      stopWatching: null,
      view: { playlistId, folder, state: 'following', adding: 0, missing: this.missingCount(playlistId) },
    };
    this.followed.set(playlistId, f);
    this.watchFolder(playlistId, f);
  }

  private unfollow(f: Followed): void {
    f.stopWatching?.();
    f.stopWatching = null;
    f.soon?.();
    f.soon = null;
  }

  /** File-system events (where they work) bring the next look sooner. */
  private watchFolder(playlistId: string, f: Followed): void {
    f.stopWatching?.();
    f.stopWatching =
      this.deps.watch?.(f.folder, () => {
        this.soon(playlistId, f, 300);
      }) ?? null;
  }

  private soon(playlistId: string, f: Followed, ms: number): void {
    if (f.soon) return;
    const run = () => {
      f.soon = null;
      void this.scan(playlistId);
    };
    const schedule =
      this.deps.schedule ??
      ((delayMs: number, then: () => void) => {
        const t = setTimeout(then, delayMs);
        t.unref();
        return () => {
          clearTimeout(t);
        };
      });
    f.soon = schedule(ms, run);
  }

  private setView(f: Followed, change: Partial<SmartPlaylistView>): void {
    const next = { ...f.view, ...change };
    if (JSON.stringify(next) === JSON.stringify(f.view)) return;
    f.view = next;
    this.deps.views(this.views());
  }

  private async scanAll(): Promise<void> {
    for (const id of [...this.followed.keys()]) await this.scan(id);
  }

  private rows(playlistId: string): Map<string, Row> {
    const rows = this.deps.db
      .prepare('SELECT relative, size, mtime_ms, item_id, state FROM smart_files WHERE playlist_id = ?')
      .all(playlistId) as Row[];
    return new Map(rows.map((r) => [r.relative, r]));
  }

  private missingCount(playlistId: string): number {
    return (
      this.deps.db
        .prepare("SELECT COUNT(*) AS n FROM smart_files WHERE playlist_id = ? AND state = 'missing'")
        .get(playlistId) as { n: number }
    ).n;
  }

  private setState(playlistId: string, relative: string, state: Row['state']): void {
    this.deps.db
      .prepare('UPDATE smart_files SET state = ? WHERE playlist_id = ? AND relative = ?')
      .run(state, playlistId, relative);
  }

  private async scanOnce(playlistId: string, f: Followed): Promise<void> {
    const found = await filesIn(f.folder, this.max);
    if (!found) {
      // Not there (a USB stick taken out): keep everything as it is, and look again later.
      if (f.view.state !== 'folder-gone')
        this.deps.log('info', 'Smart playlists: a followed folder is not there');
      f.pending.clear();
      this.setView(f, { state: 'folder-gone', adding: 0 });
      return;
    }
    if (f.view.state === 'folder-gone') {
      this.deps.log('info', 'Smart playlists: a followed folder is back');
      // A folder taken away and back is a new folder to the system: watch it again.
      this.watchFolder(playlistId, f);
    }
    if (found.tooMany) {
      // Which files are past the limit is anyone's guess: add and mark nothing until some go.
      f.pending.clear();
      this.setView(f, { state: 'too-many', adding: 0 });
      return;
    }
    const rows = this.rows(playlistId);
    const now = this.deps.now();
    let marked = false;
    // Gone: marked missing; the item stays until the button takes it out.
    for (const r of rows.values())
      if (r.state === 'ok' && !found.files.has(r.relative)) {
        this.setState(playlistId, r.relative, 'missing');
        marked = true;
      }
    const ready: string[] = [];
    for (const [relative, s] of found.files) {
      // Its missing item was taken out: back, it is a new file.
      const r = rows.get(relative)?.state === 'removed' ? undefined : rows.get(relative);
      if (r?.size === s.size && r.mtime_ms === s.mtimeMs) {
        // As it was imported. Back again after it was gone: no longer missing.
        if (r.state === 'missing') {
          this.setState(playlistId, relative, 'ok');
          marked = true;
        }
        f.pending.delete(relative);
        continue;
      }
      // New, or changed: ready once its size has held still for the settle time.
      const seen = f.pending.get(relative);
      if (seen?.size !== s.size || seen.mtimeMs !== s.mtimeMs) {
        f.pending.set(relative, { size: s.size, mtimeMs: s.mtimeMs, since: now });
        continue;
      }
      if (now - seen.since >= this.deps.settleMs) ready.push(relative);
    }
    for (const relative of f.pending.keys()) if (!found.files.has(relative)) f.pending.delete(relative);
    this.setView(f, { state: 'following', adding: f.pending.size, missing: this.missingCount(playlistId) });
    if (marked) this.deps.changed(playlistId);
    if (ready.length > 0) await this.importReady(playlistId, f, ready, found.files, rows);
  }

  private async importReady(
    playlistId: string,
    f: Followed,
    ready: readonly string[],
    files: ReadonlyMap<string, Found>,
    rows: ReadonlyMap<string, Row>,
  ): Promise<void> {
    const given: FolderFile[] = ready.map((relative) => ({
      path: join(f.folder, ...relative.split('/')),
      relative,
    }));
    // A changed file replaces what it was in the library: the folder is the playlist's own.
    const result = await this.deps.importFiles(
      given.map((g) => g.path),
      { onConflict: 'replace' },
    );
    for (const g of given) f.pending.delete(g.relative);
    if (!result.ok) {
      this.deps.log('warn', 'Smart playlists: files from a followed folder could not be imported');
      this.setView(f, { adding: f.pending.size });
      return;
    }
    // The playlist was deleted meanwhile: nothing to add them to.
    if (this.followed.get(playlistId) !== f) return;
    const items = this.deps.report(result.runId)?.items ?? [];
    const made = madeFrom(items, given);
    // Files with an item already (changed, or back changed) are replaced in place; the rest join.
    const known = (g: FolderFile) => {
      const r = rows.get(g.relative);
      return r !== undefined && r.item_id !== null && r.state !== 'removed';
    };
    const fresh = given.filter((g) => !known(g));
    const changed = given.filter(known);
    const before = this.deps.playlists.itemsOf(playlistId);
    const had = new Set(before.map((i) => i.id));
    const freshMade = new Map(
      fresh.flatMap((g) => {
        const m = made.get(g.relative);
        return m ? [[g.relative, m] as const] : [];
      }),
    );
    if (before.length === 0) {
      // An empty playlist (just made): everything in the folder's order, headers and all.
      const ordered = folderItems(freshMade);
      if (ordered.length > 0) this.deps.playlists.addItems(playlistId, null, ordered);
    } else if (freshMade.size > 0) addToFolderParts(this.deps.playlists, playlistId, items, fresh);
    // Each file remembers its item: the new items, matched by what they point at.
    const added = this.deps.playlists.itemsOf(playlistId).filter((i) => !had.has(i.id));
    const itemFor = (m: NewItem | undefined): string | null => {
      if (!m) return null;
      const at = added.findIndex(
        (i) =>
          (m.kind === 'presentation' && i.kind === 'presentation' && i.presentationId === m.presentationId) ||
          (m.kind === 'media' && i.kind === 'media' && i.mediaId === m.mediaId),
      );
      if (at < 0) return null;
      const [hit] = added.splice(at, 1);
      return hit?.id ?? null;
    };
    const save = this.deps.db.prepare(
      `INSERT INTO smart_files (playlist_id, relative, size, mtime_ms, item_id, state) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (playlist_id, relative) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms,
         item_id = excluded.item_id, state = excluded.state`,
    );
    this.deps.db.transaction(() => {
      for (const g of fresh) {
        const s = files.get(g.relative);
        const itemId = itemFor(made.get(g.relative));
        save.run(playlistId, g.relative, s?.size ?? 0, s?.mtimeMs ?? 0, itemId, itemId ? 'ok' : 'failed');
      }
      // A changed file: its item now points at what the file became (a replaced deck keeps its own id).
      for (const g of changed) {
        const s = files.get(g.relative);
        const itemId = rows.get(g.relative)?.item_id ?? null;
        const m = made.get(g.relative);
        if (itemId && m) this.deps.playlists.retarget(itemId, m);
        save.run(playlistId, g.relative, s?.size ?? 0, s?.mtimeMs ?? 0, itemId, 'ok');
      }
    })();
    this.deps.log(
      'info',
      `Smart playlists: ${String(fresh.length)} new and ${String(changed.length)} changed file(s) from a followed folder`,
    );
    this.setView(f, { adding: f.pending.size, missing: this.missingCount(playlistId) });
    this.deps.changed(playlistId);
  }
}

/** Watching with Node's fs.watch: a folder and its subfolders, on macOS and Windows. */
export function nodeWatch(dir: string, changed: () => void): (() => void) | null {
  let watcher: FSWatcher;
  try {
    watcher = watch(dir, { recursive: true, persistent: false }, () => {
      changed();
    });
  } catch {
    return null;
  }
  // A folder taken away ends its watch; the scan carries on.
  watcher.on('error', () => {
    watcher.close();
  });
  return () => {
    watcher.close();
  };
}
