import { extname, isAbsolute, join } from 'node:path';
import { MEDIA_ID_PATTERN } from '../../shared/media';
import { isInside } from '../media/media-protocol';
import type { EngineState } from '../../shared/engine/state';
import type { MediaWant } from '../../shared/nodes';
import { MEDIA_EXT_PATTERN } from '../../shared/nodes';
import { mediaInState } from '../../shared/node-media';
import type { Db } from '../db/database';

/*
 * What each node should have copies of, in order (Session 13):
 *   1. what is on the screens now, and what Next would bring;
 *   2. the live playlist's items;
 *   3. playlists made, changed or opened on Main in the last 7 days (the
 *      week's sabhas; opened counts since Session 14);
 *   4. props (the logo among them) and the idle rotation's pictures;
 *   5. with "Get everything ready", every picture and video in the library.
 * Pictures and videos only: sound is never needed on a node. Files that are
 * missing, or that Drashti cannot play, are left out. Everything but the
 * first part changes only with the library, so it is kept until then.
 */

export const RECENT_DAYS = 7;

/** Every `mediaId` in a JSON value (props are stored as JSON). */
function mediaIdsIn(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) for (const v of value) mediaIdsIn(v, out);
  else if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === 'mediaId' && typeof v === 'string') out.add(v);
      else mediaIdsIn(v, out);
    }
}

export class WantedMedia {
  /** Files by media id (null: not a picture or video that can be copied). */
  private readonly files = new Map<string, MediaWant | null>();
  private base: { live: string | null; ids: string[] } | null = null;
  private everythingIds: string[] | null = null;

  constructor(
    private readonly db: Db,
    private readonly extra: () => string[] = () => [],
    private readonly now: () => number = Date.now,
  ) {}

  /** The library changed (presentations, playlists, media, props, settings): read it again when next asked. */
  invalidate(): void {
    this.files.clear();
    this.base = null;
    this.everythingIds = null;
  }

  private file(id: string): MediaWant | null {
    if (this.files.has(id)) return this.files.get(id) ?? null;
    const row = this.db
      .prepare(
        `SELECT id, path, sha256, bytes FROM media
          WHERE id = ? AND kind IN ('image', 'video') AND missing = 0 AND sha256 IS NOT NULL
            AND (playable IS NULL OR playable = 1)`,
      )
      .get(id) as { id: string; path: string; sha256: string; bytes: number | null } | undefined;
    const ext = row ? extname(row.path).slice(1).toLowerCase() : '';
    const want =
      row && /^[0-9a-f]{64}$/u.test(row.sha256) && MEDIA_EXT_PATTERN.test(ext)
        ? { id: row.id, sha256: row.sha256, bytes: row.bytes ?? 0, ext }
        : null;
    this.files.set(id, want);
    return want;
  }

  /** A file a node asked for: where it is on Main (inside the media folder), its hash, size and extension. */
  source(
    mediaId: string,
    mediaDir: string,
  ): { path: string; sha256: string; bytes: number; ext: string } | null {
    if (!MEDIA_ID_PATTERN.test(mediaId)) return null;
    const want = this.file(mediaId);
    const row = want
      ? (this.db.prepare('SELECT path FROM media WHERE id = ?').get(mediaId) as { path: string } | undefined)
      : undefined;
    if (!want || !row || row.path === '' || isAbsolute(row.path)) return null;
    const path = join(mediaDir, row.path);
    return isInside(mediaDir, path) ? { path, sha256: want.sha256, bytes: want.bytes, ext: want.ext } : null;
  }

  private presentation(presentationId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT json_extract(e.props, '$.mediaId') AS id, g.position AS gp, s.position AS sp, e.position AS ep
           FROM slide_groups g JOIN slides s ON s.group_id = g.id JOIN elements e ON e.slide_id = s.id
          WHERE g.presentation_id = ? AND e.kind IN ('image', 'video')
         UNION ALL
         SELECT c.media_id AS id, g.position, s.position, -1 - c.position
           FROM slide_groups g JOIN slides s ON s.group_id = g.id JOIN slide_cues c ON c.slide_id = s.id
          WHERE g.presentation_id = ? AND c.kind IN ('background', 'media') AND c.media_id IS NOT NULL
         ORDER BY 2, 3, 4`,
      )
      .all(presentationId, presentationId) as { id: string | null }[];
    return rows.flatMap((r) => (typeof r.id === 'string' ? [r.id] : []));
  }

  private playlist(playlistId: string): string[] {
    const items = this.db
      .prepare(
        `SELECT kind, presentation_id, media_id FROM playlist_items
          WHERE playlist_id = ? AND deleted_at IS NULL ORDER BY position, rowid`,
      )
      .all(playlistId) as { kind: string; presentation_id: string | null; media_id: string | null }[];
    return items.flatMap((i) =>
      i.kind === 'presentation' && i.presentation_id
        ? this.presentation(i.presentation_id)
        : i.kind === 'media' && i.media_id
          ? [i.media_id]
          : [],
    );
  }

  private recentPlaylists(livePlaylistId: string | null): string[] {
    const since = new Date(this.now() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();
    return (
      this.db
        .prepare(
          `SELECT id FROM playlists
            WHERE is_folder = 0 AND is_template = 0 AND deleted_at IS NULL
              AND (updated_at >= ? OR created_at >= ? OR opened_at >= ?)
            ORDER BY max(created_at, coalesce(updated_at, ''), coalesce(opened_at, '')) DESC`,
        )
        .all(since, since, since) as { id: string }[]
    )
      .map((r) => r.id)
      .filter((id) => id !== livePlaylistId);
  }

  private props(): string[] {
    const out = new Set<string>();
    for (const row of this.db.prepare('SELECT definition FROM props').all() as { definition: string }[]) {
      try {
        mediaIdsIn(JSON.parse(row.definition), out);
      } catch {
        // Not JSON: nothing to copy.
      }
    }
    return [...out];
  }

  private everything(): string[] {
    this.everythingIds ??= (
      this.db
        .prepare(
          `SELECT id FROM media WHERE kind IN ('image', 'video') AND missing = 0 AND sha256 IS NOT NULL
            ORDER BY created_at DESC`,
        )
        .all() as { id: string }[]
    ).map((r) => r.id);
    return this.everythingIds;
  }

  /** What a node should have, in order, each file once. */
  list(state: EngineState | null, everything: boolean): MediaWant[] {
    const live = state?.live.playlist?.playlistId ?? null;
    if (this.base?.live !== live) {
      const ids: string[] = [];
      if (live) ids.push(...this.playlist(live));
      for (const id of this.recentPlaylists(live)) ids.push(...this.playlist(id));
      ids.push(...this.props(), ...this.extra());
      this.base = { live, ids };
    }
    const shown = state ? mediaInState(state) : { now: [], next: [] };
    const order = [...shown.now, ...shown.next, ...this.base.ids, ...(everything ? this.everything() : [])];
    const out: MediaWant[] = [];
    const seen = new Set<string>();
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const want = this.file(id);
      if (want) out.push(want);
    }
    return out;
  }
}
