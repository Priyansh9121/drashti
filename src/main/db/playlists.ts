import { randomUUID } from 'node:crypto';
import type { ImportSource } from '../../shared/library';
import type { Db } from './database';

/*
 * Playlists (and folders of playlists) as imported. Drashti's own playlist
 * editing comes later; until then an imported playlist is replaced as a
 * whole when its file changes.
 */

export type NewPlaylistItem =
  /** arrangementRef: the source file's id of the arrangement the item plays its presentation in. */
  | { kind: 'presentation'; presentationId: string; label: string; arrangementRef?: string | null }
  | { kind: 'media'; mediaId: string; label: string }
  | { kind: 'header'; label: string; color: string | null }
  | { kind: 'placeholder'; label: string; hint: string | null };

export interface NewPlaylist {
  name: string;
  isFolder: boolean;
  /** The playlist's own id in the source file. */
  ref: string | null;
  items: NewPlaylistItem[];
  children: NewPlaylist[];
}

export interface PlaylistCounts {
  playlists: number;
  items: number;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  isFolder: boolean;
  parentId: string | null;
  itemCount: number;
}

export class PlaylistRepo {
  constructor(private readonly db: Db) {}

  /** Top-level playlists imported from this file, with the hash they were imported with. */
  findImported(
    kind: ImportSource['kind'],
    path: string,
  ): { id: string; name: string; hash: string | null }[] {
    return (
      this.db
        .prepare(
          'SELECT id, name, source_hash FROM playlists WHERE source_kind = ? AND source_path = ? AND parent_id IS NULL ORDER BY position',
        )
        .all(kind, path) as { id: string; name: string; source_hash: string | null }[]
    ).map((r) => ({ id: r.id, name: r.name, hash: r.source_hash }));
  }

  /** Remove the playlists imported from this file (their items and sub-playlists go with them). */
  removeImported(kind: ImportSource['kind'], path: string): number {
    return this.db
      .prepare('DELETE FROM playlists WHERE source_kind = ? AND source_path = ? AND parent_id IS NULL')
      .run(kind, path).changes;
  }

  /** Insert a tree of playlists at the top level, after the ones already there. */
  insertTree(
    playlists: readonly NewPlaylist[],
    source: ImportSource,
    hash: string | null,
  ): PlaylistCounts & { ids: string[] } {
    const counts = { playlists: 0, items: 0, ids: [] as string[] };
    const insertPlaylist = this.db.prepare(
      `INSERT INTO playlists (id, parent_id, name, is_folder, position, source_kind, source_path, source_ref, source_imported_at, source_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = this.db.prepare(
      `INSERT INTO playlist_items (id, playlist_id, position, kind, presentation_id, media_id, label, color, hint, arrangement_id, order_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // The arrangement a playlist item names, found by its id in the source file.
    const arrangementByRef = this.db.prepare(
      'SELECT id FROM arrangements WHERE presentation_id = ? AND source_ref = ? ORDER BY position LIMIT 1',
    );
    const top = (
      this.db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlists WHERE parent_id IS NULL')
        .get() as {
        next: number;
      }
    ).next;
    const write = (list: NewPlaylist, parentId: string | null, position: number) => {
      const id = randomUUID();
      insertPlaylist.run(
        id,
        parentId,
        list.name,
        list.isFolder ? 1 : 0,
        position,
        source.kind,
        source.path,
        list.ref,
        source.importedAt,
        parentId === null ? hash : null,
      );
      counts.playlists++;
      if (parentId === null) counts.ids.push(id);
      list.items.forEach((item, i) => {
        const arrangement =
          item.kind === 'presentation' && item.arrangementRef
            ? (arrangementByRef.get(item.presentationId, item.arrangementRef) as { id: string } | undefined)
            : undefined;
        insertItem.run(
          randomUUID(),
          id,
          i,
          item.kind,
          item.kind === 'presentation' ? item.presentationId : null,
          item.kind === 'media' ? item.mediaId : null,
          item.label,
          item.kind === 'header' ? item.color : null,
          item.kind === 'placeholder' ? item.hint : null,
          arrangement?.id ?? null,
          arrangement ? 'arrangement' : 'presentation',
        );
        counts.items++;
      });
      list.children.forEach((child, i) => {
        write(child, id, i);
      });
    };
    playlists.forEach((list, i) => {
      write(list, null, top + i);
    });
    return counts;
  }

  /** Every playlist and folder, parents before children. */
  list(): PlaylistSummary[] {
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.is_folder, p.parent_id,
                  (SELECT COUNT(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS item_count
             FROM playlists p ORDER BY p.parent_id IS NOT NULL, p.position, p.rowid`,
        )
        .all() as {
        id: string;
        name: string;
        is_folder: number;
        parent_id: string | null;
        item_count: number;
      }[]
    ).map((r) => ({
      id: r.id,
      name: r.name,
      isFolder: r.is_folder === 1,
      parentId: r.parent_id,
      itemCount: r.item_count,
    }));
  }

  /** The items of a playlist, in order. */
  items(
    playlistId: string,
  ): { kind: string; label: string; presentationId: string | null; mediaId: string | null }[] {
    return (
      this.db
        .prepare(
          'SELECT kind, label, presentation_id, media_id FROM playlist_items WHERE playlist_id = ? ORDER BY position',
        )
        .all(playlistId) as {
        kind: string;
        label: string;
        presentation_id: string | null;
        media_id: string | null;
      }[]
    ).map((r) => ({ kind: r.kind, label: r.label, presentationId: r.presentation_id, mediaId: r.media_id }));
  }
}
