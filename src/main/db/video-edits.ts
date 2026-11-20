import type { Db } from './database';
import type {
  SaveVideoEdit,
  VideoEditResult,
  VideoEditSnapshot,
  VideoEditRecipe,
} from '../../shared/video-edit';
import {
  PLAIN_VIDEO_EDIT,
  saveVideoEditSchema,
  videoEditRecipeSchema,
  videoEditNeedsCopy,
} from '../../shared/video-edit';

interface EditRow {
  id: string;
  video_edit: string | null;
  video_edit_revision: number;
  video_edit_ready_revision: number;
  video_edit_copy_id: string | null;
  video_edit_error: string | null;
}

/** The source's media row and bytes are never replaced by a prepared rendition. */
export class VideoEditsRepo {
  constructor(private readonly db: Db) {}

  /** Resolve a prepared immutable file back to its source when its editor is opened from a playlist. */
  sourceId(mediaId: string): string {
    const row = this.db.prepare('SELECT source_id FROM video_edit_copies WHERE copy_id = ?').get(mediaId) as
      { source_id: string } | undefined;
    return row?.source_id ?? mediaId;
  }

  read(mediaId: string): VideoEditSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT id,video_edit,video_edit_revision,video_edit_ready_revision,video_edit_copy_id,video_edit_error
      FROM media WHERE id=? AND kind='video' AND missing=0 AND deleted_at IS NULL AND coalesce(playable,1)=1`,
      )
      .get(this.sourceId(mediaId)) as EditRow | undefined;
    if (!row) return null;
    const recipe =
      row.video_edit === null
        ? structuredClone(PLAIN_VIDEO_EDIT)
        : videoEditRecipeSchema.parse(JSON.parse(row.video_edit));
    const ready = row.video_edit_ready_revision === row.video_edit_revision;
    return {
      mediaId: row.id,
      revision: row.video_edit_revision,
      recipe,
      state: row.video_edit_error !== null ? 'failed' : ready ? 'ready' : 'preparing',
      readyMediaId: ready ? (row.video_edit_copy_id ?? row.id) : null,
      message: row.video_edit_error,
    };
  }

  save(request: SaveVideoEdit): VideoEditResult {
    const parsed = saveVideoEditSchema.safeParse(request);
    if (!parsed.success)
      return {
        ok: false,
        message:
          'Those video edits could not be kept. Check the time and picture fields, then try Save again.',
      };
    return this.db.transaction((): VideoEditResult => {
      const current = this.read(parsed.data.mediaId);
      if (!current)
        return {
          ok: false,
          message:
            'That video is not ready in Media. Check that its file is available, then open Edit Video… again.',
        };
      if (current.revision !== parsed.data.revision)
        return {
          ok: false,
          message: 'This video changed in another editor. Close and reopen Edit Video… before saving again.',
        };
      const revision = current.revision + 1;
      const recipe = parsed.data.recipe;
      const jpeg = parsed.data.thumbnailJpeg;
      if (recipe.thumbnailMs !== null && recipe.thumbnailMs !== current.recipe.thumbnailMs && !jpeg)
        return {
          ok: false,
          message:
            'The chosen thumbnail frame is missing. Choose that frame in the preview again, then Save.',
        };
      const needsCopy = videoEditNeedsCopy(recipe);
      this.db
        .prepare(
          `UPDATE media SET video_edit=?,video_edit_revision=?,video_edit_ready_revision=?,video_edit_copy_id=NULL,video_edit_error=NULL,
        video_edit_thumbnail=CASE WHEN ? THEN ? ELSE video_edit_thumbnail END WHERE id=? AND video_edit_revision=?`,
        )
        .run(
          JSON.stringify(recipe),
          revision,
          needsCopy ? -1 : revision,
          recipe.thumbnailMs === null || jpeg ? 1 : 0,
          recipe.thumbnailMs === null || !jpeg ? null : Buffer.from(jpeg),
          current.mediaId,
          current.revision,
        );
      return {
        ok: true,
        edit: {
          mediaId: current.mediaId,
          revision,
          recipe,
          state: needsCopy ? 'preparing' : 'ready',
          readyMediaId: needsCopy ? null : current.mediaId,
          message: null,
        },
      };
    })();
  }

  /** The deliberate library thumbnail lives in the backed-up database; the default still and video bytes stay intact. */
  thumbnailOf(mediaId: string): Uint8Array | null {
    const row = this.db
      .prepare('SELECT video_edit_thumbnail FROM media WHERE id=? AND deleted_at IS NULL')
      .get(this.sourceId(mediaId)) as { video_edit_thumbnail: Buffer | null } | undefined;
    return row?.video_edit_thumbnail ?? null;
  }

  renditionOf(copyId: string): { sourceId: string; revision: number; recipe: VideoEditRecipe } | null {
    const row = this.db
      .prepare('SELECT source_id,revision,recipe FROM video_edit_copies WHERE copy_id=?')
      .get(copyId) as { source_id: string; revision: number; recipe: string } | undefined;
    return row
      ? {
          sourceId: row.source_id,
          revision: row.revision,
          recipe: videoEditRecipeSchema.parse(JSON.parse(row.recipe)),
        }
      : null;
  }

  complete(mediaId: string, revision: number, copyId: string): boolean {
    return this.db.transaction(() => {
      const source = this.read(mediaId);
      if (source?.revision !== revision || source.state === 'ready') return false;
      const copy = this.db
        .prepare("SELECT id FROM media WHERE id=? AND kind='video' AND missing=0 AND deleted_at IS NULL")
        .get(copyId);
      if (!copy || copyId === source.mediaId) return false;
      this.db
        .prepare('INSERT INTO video_edit_copies (source_id,revision,copy_id,recipe) VALUES (?,?,?,?)')
        .run(source.mediaId, revision, copyId, JSON.stringify(source.recipe));
      return (
        this.db
          .prepare(
            'UPDATE media SET video_edit_ready_revision=?,video_edit_copy_id=?,video_edit_error=NULL WHERE id=? AND video_edit_revision=?',
          )
          .run(revision, copyId, source.mediaId, revision).changes === 1
      );
    })();
  }

  failed(mediaId: string, revision: number, message: string): void {
    this.db
      .prepare(
        'UPDATE media SET video_edit_error=? WHERE id=? AND video_edit_revision=? AND video_edit_ready_revision<>?',
      )
      .run(message, mediaId, revision, revision);
  }

  waiting(): { mediaId: string; revision: number; recipe: VideoEditRecipe }[] {
    const rows = this.db
      .prepare(
        "SELECT id FROM media WHERE kind='video' AND deleted_at IS NULL AND missing=0 AND video_edit_revision<>video_edit_ready_revision AND video_edit_error IS NULL",
      )
      .all() as { id: string }[];
    return rows.flatMap(({ id }) => {
      const edit = this.read(id);
      return edit ? [{ mediaId: id, revision: edit.revision, recipe: edit.recipe }] : [];
    });
  }
}
