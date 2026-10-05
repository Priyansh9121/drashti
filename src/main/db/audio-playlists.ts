import { randomUUID } from 'node:crypto';
import type { MusicPlaylist, MusicTrackInfo } from '../../shared/music';
import type { Db } from './database';

/*
 * Audio playlists in the library (migration 33): a name, whether they go
 * round again and shuffle, and their tracks in order, each a sound from the
 * media library (the same sound can be in one twice).
 */

interface PlaylistRow {
  id: string;
  name: string;
  loop: number;
  shuffle: number;
}

interface TrackRow {
  id: string;
  playlist_id: string;
  media_id: string;
  name: string;
  duration_ms: number | null;
  missing: number;
  playable: number | null;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export class AudioPlaylistRepo {
  constructor(private readonly db: Db) {}

  private tracksOf(ids: readonly string[]): Map<string, MusicTrackInfo[]> {
    const out = new Map<string, MusicTrackInfo[]>();
    if (ids.length === 0) return out;
    const rows = this.db
      .prepare(
        `SELECT t.id, t.playlist_id, t.media_id, m.name, m.duration_ms, m.missing, m.playable
           FROM audio_playlist_tracks t JOIN media m ON m.id = t.media_id
          WHERE t.playlist_id IN (${ids.map(() => '?').join(', ')})
          ORDER BY t.playlist_id, t.position, t.rowid`,
      )
      .all(...ids) as TrackRow[];
    for (const r of rows) {
      const list = out.get(r.playlist_id) ?? [];
      list.push({
        id: r.id,
        mediaId: r.media_id,
        name: r.name,
        durationMs: r.duration_ms !== null && r.duration_ms > 0 ? r.duration_ms : null,
        playable: r.missing === 0 && r.playable !== 0,
      });
      out.set(r.playlist_id, list);
    }
    return out;
  }

  list(): MusicPlaylist[] {
    const rows = this.db
      .prepare('SELECT id, name, loop, shuffle FROM audio_playlists ORDER BY position, rowid')
      .all() as PlaylistRow[];
    const tracks = this.tracksOf(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      loop: r.loop === 1,
      shuffle: r.shuffle === 1,
      tracks: tracks.get(r.id) ?? [],
    }));
  }

  get(id: string): MusicPlaylist | null {
    return this.list().find((p) => p.id === id) ?? null;
  }

  create(name: string): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO audio_playlists (id, name, position)
         VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM audio_playlists))`,
      )
      .run(id, name);
    return id;
  }

  rename(id: string, name: string): boolean {
    return (
      this.db.prepare(`UPDATE audio_playlists SET name = ?, updated_at = ${NOW} WHERE id = ?`).run(name, id)
        .changes === 1
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM audio_playlists WHERE id = ?').run(id).changes === 1;
  }

  setOptions(id: string, options: { loop: boolean; shuffle: boolean }): boolean {
    return (
      this.db
        .prepare(`UPDATE audio_playlists SET loop = ?, shuffle = ?, updated_at = ${NOW} WHERE id = ?`)
        .run(options.loop ? 1 : 0, options.shuffle ? 1 : 0, id).changes === 1
    );
  }

  private order(playlistId: string): string[] {
    return (
      this.db
        .prepare('SELECT id FROM audio_playlist_tracks WHERE playlist_id = ? ORDER BY position, rowid')
        .all(playlistId) as { id: string }[]
    ).map((r) => r.id);
  }

  private renumber(ids: readonly string[]): void {
    const stmt = this.db.prepare('UPDATE audio_playlist_tracks SET position = ? WHERE id = ?');
    ids.forEach((id, i) => stmt.run(i, id));
  }

  /** Add sounds from the library at a place (the end when null); returns how many went in (sounds only). */
  addTracks(playlistId: string, mediaIds: readonly string[], at: number | null): number {
    return this.db.transaction(() => {
      if (!this.db.prepare('SELECT 1 FROM audio_playlists WHERE id = ?').get(playlistId)) return 0;
      const isSound = this.db.prepare("SELECT 1 FROM media WHERE id = ? AND kind = 'audio'");
      const insert = this.db.prepare(
        'INSERT INTO audio_playlist_tracks (id, playlist_id, media_id, position) VALUES (?, ?, ?, 0)',
      );
      const added: string[] = [];
      for (const mediaId of mediaIds) {
        if (!isSound.get(mediaId)) continue;
        const id = randomUUID();
        insert.run(id, playlistId, mediaId);
        added.push(id);
      }
      const current = this.order(playlistId).filter((id) => !added.includes(id));
      const where = at === null ? current.length : Math.max(0, Math.min(at, current.length));
      this.renumber([...current.slice(0, where), ...added, ...current.slice(where)]);
      this.db.prepare(`UPDATE audio_playlists SET updated_at = ${NOW} WHERE id = ?`).run(playlistId);
      return added.length;
    })();
  }

  /** Move a track to a place in its playlist. */
  moveTrack(trackId: string, to: number): boolean {
    return this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT playlist_id FROM audio_playlist_tracks WHERE id = ?')
        .get(trackId) as { playlist_id: string } | undefined;
      if (!row) return false;
      const rest = this.order(row.playlist_id).filter((id) => id !== trackId);
      const where = Math.max(0, Math.min(to, rest.length));
      this.renumber([...rest.slice(0, where), trackId, ...rest.slice(where)]);
      return true;
    })();
  }

  removeTrack(trackId: string): boolean {
    return this.db.prepare('DELETE FROM audio_playlist_tracks WHERE id = ?').run(trackId).changes === 1;
  }
}
