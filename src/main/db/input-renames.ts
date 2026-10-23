import { cueInputName } from '../../shared/slide-edit';
import { namesInput } from '../../shared/video-inputs';
import type { Db } from './database';

/*
 * A video input renamed in Media (Session 52). The library names an input by its own name alone (Session 51:
 * shared/video-inputs.ts inputNamed), so the playlist items and slides' background cues that named it by its old
 * name take its new one, in one write; before, each said Not on this computer from then on. Every one that names it
 * as Media tells names apart (any letter case, any Unicode form): removed ones too, so Undo brings them back as
 * they are now, templates, and what is in the bin. One naming another input is left as it is (another computer's
 * input may have that name), and so is a picture's or a video's cue, whatever its settings hold. Not on the
 * library's Undo: the input's own name is not undone there, and renaming it back carries them back.
 */

export interface InputCarried {
  /** The playlist items that named it, by id. */
  items: string[];
  /** The slides' background cues that named it, by id. */
  cues: string[];
  /** The presentations those cues are in: their slides must be read again. */
  presentations: string[];
}

/**
 * A cue's settings (as stored, JSON) naming the input `to` where they named `from`, everything else in them as it
 * was; null when the cue names another input, or none.
 */
export function cuePropsRenamed(
  cue: { kind: string; mediaId: string | null; props: string },
  from: string,
  to: string,
): string | null {
  const named = cueInputName(cue);
  if (named === null || !namesInput(named, from)) return null;
  // An input's cue (cueInputName) has settings that read as an object.
  return JSON.stringify({ ...(JSON.parse(cue.props) as Record<string, unknown>), input: to });
}

/** Carry every playlist item and slide's background cue naming the input `from` to its new name `to` (one write). */
export function carryInputName(db: Db, from: string, to: string): InputCarried {
  return db.transaction((): InputCarried => {
    // Its label is the input's name as it was added (no one gives an input item another): it follows too. Each
    // item changed moves its playlist's time (migration 30's triggers), so the nodes see the playlist changed.
    const items = (
      db.prepare("SELECT id, input_name, label FROM playlist_items WHERE kind = 'input'").all() as {
        id: string;
        input_name: string | null;
        label: string;
      }[]
    ).filter((r) => r.input_name !== null && namesInput(r.input_name, from));
    const item = db.prepare('UPDATE playlist_items SET input_name = ?, label = ? WHERE id = ?');
    for (const r of items) item.run(to, namesInput(r.label, from) ? to : r.label, r.id);
    const rows = db
      .prepare(
        `SELECT c.id, c.kind, c.media_id, c.props, g.presentation_id
           FROM slide_cues c JOIN slides s ON s.id = c.slide_id JOIN slide_groups g ON g.id = s.group_id
          WHERE c.kind = 'background' AND c.media_id IS NULL AND json_type(c.props, '$.input') = 'text'`,
      )
      .all() as { id: string; kind: string; media_id: null; props: string; presentation_id: string }[];
    const cue = db.prepare('UPDATE slide_cues SET props = ? WHERE id = ?');
    const cues: string[] = [];
    const presentations = new Set<string>();
    for (const r of rows) {
      const props = cuePropsRenamed({ kind: r.kind, mediaId: r.media_id, props: r.props }, from, to);
      if (props === null) continue;
      cue.run(props, r.id);
      cues.push(r.id);
      presentations.add(r.presentation_id);
    }
    // Their content was written: the slide editor's stamp moves on with it (migration 44), so an editor opened
    // before saves over the new name only when asked to.
    const touch = db.prepare(
      `UPDATE presentations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), content_rev = content_rev + 1
        WHERE id = ?`,
    );
    for (const id of presentations) touch.run(id);
    return { items: items.map((r) => r.id), cues, presentations: [...presentations] };
  })();
}
