import { randomUUID } from 'node:crypto';
import type { MediaMarkers, PlaybackMarker } from '../../shared/markers';
import { mediaMarkersSchema, NO_MARKERS } from '../../shared/markers';
import type { RowTrimView } from '../../shared/trim';
import type { Db } from './database';
import type { MediaRepo } from './media';
import type { PlaylistRepo } from './playlists';

interface TrimSource {
  itemId: string;
  mediaId: string;
  sourceId: string;
  sourcePath: string;
  sourceName: string;
  sourceFormat: string | null;
  cutStartMs: number | null;
  cutEndMs: number | null;
  sourceMarkers: string | null;
}

export interface TrimMarkerEdits {
  removed: string[];
  changed: PlaybackMarker[];
}

interface TrimmedFile {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  format: string;
}

/** Keep the copy and its source together, then replace only the row that asked for it. */
export class TrimmedVideos {
  constructor(
    private readonly db: Db,
    private readonly media: Pick<MediaRepo, 'markersOf' | 'setMarkers'>,
    private readonly playlists: Pick<PlaylistRepo, 'retarget'>,
  ) {}

  row(itemId: string): TrimSource | null {
    return (
      this.db
        .prepare<[string], TrimSource>(
          `SELECT i.id AS itemId, i.media_id AS mediaId, original.id AS sourceId,
                  original.path AS sourcePath, original.name AS sourceName, original.format AS sourceFormat,
                  t.start_ms AS cutStartMs, t.end_ms AS cutEndMs, t.source_markers AS sourceMarkers
             FROM playlist_items i
             JOIN playlists p ON p.id = i.playlist_id AND p.deleted_at IS NULL
             JOIN media m ON m.id = i.media_id AND m.kind = 'video' AND m.deleted_at IS NULL
             LEFT JOIN trimmed_videos t ON t.media_id = m.id
             JOIN media original ON original.id = coalesce(t.original_id, m.id)
            WHERE i.id = ? AND i.kind = 'media' AND i.deleted_at IS NULL
              AND original.deleted_at IS NULL AND original.missing = 0 AND original.path <> ''`,
        )
        .get(itemId) ?? null
    );
  }

  view(itemId: string): RowTrimView | null {
    const row = this.row(itemId);
    if (!row) return null;
    const original = this.media.markersOf(row.sourceId) ?? NO_MARKERS;
    const full = this.playsFull(itemId, row.mediaId, original);
    const start = row.cutStartMs;
    const end = row.cutEndMs;
    const markers =
      start !== null && end !== null
        ? this.sourceMarkers(row, original, start, end)
        : full
          ? { ...original, startMs: null, endMs: null }
          : original;
    return {
      itemId,
      mediaId: row.mediaId,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      canReset: row.mediaId !== row.sourceId || markers.startMs !== null || markers.endMs !== null,
      markers,
    };
  }

  private sourceMarkers(row: TrimSource, original: MediaMarkers, start: number, end: number): MediaMarkers {
    const copy = this.media.markersOf(row.mediaId) ?? NO_MARKERS;
    const kept = copy.markers.map((m) => ({ ...m, atMs: m.atMs + start }));
    const outside = rememberedMarkers(row.sourceMarkers, original).markers.filter(
      (m) => (m.atMs < start || m.atMs >= end) && !kept.some((k) => k.id === m.id),
    );
    return {
      startMs: start === 0 ? null : start,
      endMs: end,
      markers: [...kept, ...outside].slice(0, 50).sort((a, b) => a.atMs - b.atMs),
    };
  }

  /** A job may finish after the playlist was edited or the file relinked. */
  current(row: TrimSource): boolean {
    const now = this.row(row.itemId);
    return now?.mediaId === row.mediaId && now.sourceId === row.sourceId && now.sourcePath === row.sourcePath;
  }

  playsFull(itemId: string, mediaId: string, marks: MediaMarkers): boolean {
    if (marks.startMs === null && marks.endMs === null) return false;
    return (
      this.db
        .prepare(
          'SELECT 1 FROM playlist_trim_resets WHERE item_id = ? AND original_id = ? AND start_ms IS ? AND end_ms IS ?',
        )
        .get(itemId, mediaId, marks.startMs, marks.endMs) !== undefined
    );
  }

  keepMarkers(row: TrimSource, markers: MediaMarkers): boolean {
    if (row.cutStartMs === null || row.cutEndMs === null) {
      const previous = this.media.markersOf(row.mediaId) ?? NO_MARKERS;
      return this.media.setMarkers(
        row.mediaId,
        this.playsFull(row.itemId, row.mediaId, previous)
          ? { ...previous, markers: markers.markers }
          : markers,
      );
    }
    const start = row.cutStartMs;
    const end = row.cutEndMs;
    return this.db
      .transaction(() => {
        if (!this.current(row)) return false;
        const existing = this.media.markersOf(row.mediaId) ?? NO_MARKERS;
        if (!this.media.setMarkers(row.mediaId, { ...existing, markers: markersInCut(markers, start, end) }))
          return false;
        this.db
          .prepare('UPDATE trimmed_videos SET source_markers = ? WHERE media_id = ?')
          .run(JSON.stringify(markers), row.mediaId);
        return true;
      })
      .immediate();
  }

  adopt(
    row: TrimSource,
    file: TrimmedFile,
    startMs: number,
    endMs: number,
    markers: MediaMarkers,
  ): string | null {
    return this.db
      .transaction(() => {
        if (!this.current(row)) return null;
        const id = randomUUID();
        const points: MediaMarkers = { ...NO_MARKERS, markers: markersInCut(markers, startMs, endMs) };
        this.db
          .prepare(
            `INSERT INTO media (id, kind, name, path, sha256, bytes, duration_ms, width, height, playable,
                              format, source_kind, markers, even_loudness)
           VALUES (@id, 'video', @name, @path, @sha256, @bytes, @durationMs, @width, @height, 1,
                   @format, 'drashti', @markers, (SELECT even_loudness FROM media WHERE id = @was))`,
          )
          .run({ ...file, id, was: row.mediaId, markers: JSON.stringify(points) });
        this.db
          .prepare(
            'INSERT INTO trimmed_videos (media_id, original_id, start_ms, end_ms, source_markers) VALUES (?, ?, ?, ?, ?)',
          )
          .run(id, row.sourceId, startMs, endMs, JSON.stringify(markers));
        if (!this.playlists.retarget(row.itemId, { kind: 'media', mediaId: id })) {
          throw new Error('The playlist video could not be replaced');
        }
        this.db.prepare('DELETE FROM playlist_trim_resets WHERE item_id = ?').run(row.itemId);
        return id;
      })
      .immediate();
  }

  reset(row: TrimSource, edits?: TrimMarkerEdits): 'reset' | 'changed' | 'too-many-markers' {
    return this.db
      .transaction(() => {
        if (!this.current(row)) return 'changed' as const;
        const original = this.media.markersOf(row.sourceId) ?? NO_MARKERS;
        const { startMs, endMs } = original;
        const markers = edits ? editMarkers(original.markers, edits) : null;
        if (markers && markers.length > 50) return 'too-many-markers' as const;
        if (row.mediaId === row.sourceId) {
          if ((startMs === null && endMs === null) || this.playsFull(row.itemId, row.mediaId, original))
            return 'changed' as const;
        } else if (!this.playlists.retarget(row.itemId, { kind: 'media', mediaId: row.sourceId }))
          return 'changed' as const;
        if (markers && !this.media.setMarkers(row.sourceId, { ...original, markers }))
          throw new Error('The original video is missing.');
        this.db.prepare('DELETE FROM playlist_trim_resets WHERE item_id = ?').run(row.itemId);
        if (startMs !== null || endMs !== null)
          this.db
            .prepare(
              'INSERT INTO playlist_trim_resets (item_id, original_id, start_ms, end_ms) VALUES (?, ?, ?, ?)',
            )
            .run(row.itemId, row.sourceId, startMs, endMs);
        return 'reset' as const;
      })
      .immediate();
  }
}

function editMarkers(markers: PlaybackMarker[], { removed, changed }: TrimMarkerEdits): PlaybackMarker[] {
  const edited = new Map(markers.map((marker) => [marker.id, marker]));
  for (const id of removed) edited.delete(id);
  for (const marker of changed) edited.set(marker.id, marker);
  return [...edited.values()].sort((a, b) => a.atMs - b.atMs);
}

function markersInCut(points: MediaMarkers, startMs: number, endMs: number) {
  return points.markers
    .filter((m) => m.atMs >= startMs && m.atMs < endMs)
    .map((m) => ({ ...m, atMs: m.atMs - startMs }));
}

function rememberedMarkers(json: string | null, original: MediaMarkers): MediaMarkers {
  if (!json) return original;
  const parsed = mediaMarkersSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : original;
}
