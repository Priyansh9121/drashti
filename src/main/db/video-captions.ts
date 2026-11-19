import type { Db } from './database';
import {
  MAX_CAPTION_CUES,
  MAX_CAPTION_TRACKS,
  type VideoCaptionChoice,
  type VideoCaptionCue,
  type VideoCaptionTrack,
} from '../../shared/video-captions';

interface TrackRow {
  id: string;
  language: string;
  automatic: number;
  name: string;
}

/** Only parsed, plain caption words live here. The off switch starts as NULL on every video. */
export class VideoCaptionsRepo {
  private readonly cached = new Map<string, { key: string; track: VideoCaptionTrack | null }>();
  constructor(private readonly db: Db) {}

  view(mediaId: string): VideoCaptionChoice {
    const tracks = (
      this.db
        .prepare(
          'SELECT id, language, automatic, name FROM video_caption_tracks WHERE media_id = ? ORDER BY language, automatic, name',
        )
        .all(mediaId) as TrackRow[]
    ).map((row) => ({ ...row, automatic: row.automatic === 1 }));
    const row = this.db
      .prepare("SELECT caption_choice FROM media WHERE id = ? AND kind = 'video' AND deleted_at IS NULL")
      .get(mediaId) as { caption_choice: string | null } | undefined;
    const selected = tracks.some((t) => t.id === row?.caption_choice) ? (row?.caption_choice ?? null) : null;
    return { tracks, selected };
  }

  put(mediaId: string, tracks: readonly VideoCaptionTrack[]): boolean {
    return this.db.transaction(() => {
      if (
        !this.db
          .prepare("SELECT 1 FROM media WHERE id = ? AND kind = 'video' AND deleted_at IS NULL")
          .get(mediaId)
      )
        return false;
      const ids = new Set(this.view(mediaId).tracks.map((t) => t.id));
      for (const track of tracks) ids.add(track.id);
      if (ids.size > MAX_CAPTION_TRACKS) return false;
      const put = this.db
        .prepare(`INSERT INTO video_caption_tracks (media_id, id, language, automatic, name, cues) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id, id) DO UPDATE SET language = excluded.language, automatic = excluded.automatic,
          name = excluded.name, cues = excluded.cues, revision = video_caption_tracks.revision + 1
        WHERE video_caption_tracks.cues <> excluded.cues OR video_caption_tracks.name <> excluded.name`);
      for (const t of tracks)
        put.run(mediaId, t.id, t.language, t.automatic ? 1 : 0, t.name, JSON.stringify(t.cues));
      this.cached.delete(mediaId);
      return true;
    })();
  }

  select(mediaId: string, trackId: string | null): boolean {
    if (
      trackId !== null &&
      !this.db
        .prepare('SELECT 1 FROM video_caption_tracks WHERE media_id = ? AND id = ?')
        .get(mediaId, trackId)
    )
      return false;
    return (
      this.db
        .prepare("UPDATE media SET caption_choice = ? WHERE id = ? AND kind = 'video' AND deleted_at IS NULL")
        .run(trackId, mediaId).changes === 1
    );
  }

  /** Metadata is small; JSON is read and checked only when the selected track or its revision changes. */
  chosen(mediaId: string): VideoCaptionTrack | null {
    const row = this.db
      .prepare(
        `SELECT t.id, t.revision FROM media m JOIN video_caption_tracks t ON t.media_id = m.id AND t.id = m.caption_choice
      WHERE m.id = ? AND m.kind = 'video' AND m.deleted_at IS NULL`,
      )
      .get(mediaId) as { id: string; revision: number } | undefined;
    if (!row) return null;
    const key = `${row.id}/${String(row.revision)}`;
    const cached = this.cached.get(mediaId);
    if (cached?.key === key) return cached.track;
    const stored = this.db
      .prepare(
        'SELECT id, language, automatic, name, cues FROM video_caption_tracks WHERE media_id = ? AND id = ?',
      )
      .get(mediaId, row.id) as (TrackRow & { cues: string }) | undefined;
    let track: VideoCaptionTrack | null = null;
    if (stored) {
      try {
        const cues: unknown = JSON.parse(stored.cues);
        let end = -1;
        if (
          Array.isArray(cues) &&
          cues.length <= MAX_CAPTION_CUES * 2 &&
          cues.every((c: unknown) => {
            if (!c || typeof c !== 'object') return false;
            const item = c as VideoCaptionCue;
            const valid =
              Number.isFinite(item.startMs) &&
              Number.isFinite(item.endMs) &&
              item.startMs >= end &&
              item.endMs > item.startMs &&
              typeof item.text === 'string' &&
              item.text.length <= 8192;
            end = item.endMs;
            return valid;
          })
        )
          track = {
            id: stored.id,
            language: stored.language,
            automatic: stored.automatic === 1,
            name: stored.name,
            cues: cues as VideoCaptionCue[],
          };
      } catch {
        /* A damaged library track never prevents its video playing. */
      }
    }
    this.cached.set(mediaId, { key, track });
    return track;
  }
}
