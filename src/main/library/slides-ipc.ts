import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import { CUT, type Transition } from '../../shared/model';
import { idSchema, transitionSchema } from '../../shared/model-schema';
import type { EditSlidesResult, SaveSlidesResult, SlideLook } from '../../shared/slide-edit';
import { editDocSchema } from '../../shared/slide-edit';
import type { Db } from '../db/database';
import type { PresentationRepo } from '../db/presentations';
import type { SettingsRepo } from '../db/settings';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import { applySlideEdit, editDocOf, mediaIdsOf } from './slides';

/*
 * The slide editor's requests: anyone of Drashti's pages may read a
 * presentation's slides; only the operator window may save them. A save is
 * one change, kept for Undo, and the screens show the live slide's new look
 * at once.
 */

export interface SlidesIpcDeps {
  db: Db;
  presentations: PresentationRepo;
  revisions: Revisions;
  settings: SettingsRepo;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** How new text looks in a presentation: its theme, for its size. */
  lookFor: (themeId: string | null, size: { width: number; height: number }) => SlideLook;
  /** A presentation's content changed: refresh caches, the live slide and the operator's list. */
  changed: (presentationIds: string[]) => void;
}

const onlyOperator = { ok: false as const, message: 'Only the operator window can change slides.' };
const DEFAULT_TRANSITION = 'defaultTransition';

/** The transition for presentations without their own: a cut until the operator chooses another. */
export function defaultTransition(settings: SettingsRepo): Transition {
  const stored = transitionSchema.safeParse(settings.get(DEFAULT_TRANSITION));
  return stored.success ? stored.data : CUT;
}

export function registerSlidesIpc({
  db,
  presentations,
  revisions,
  settings,
  fromOperator,
  lookFor,
  changed,
}: SlidesIpcDeps): void {
  /** When the presentation last changed (any write of its content updates it). */
  const stampOf = (id: string) =>
    (db.prepare('SELECT name, updated_at FROM presentations WHERE id = ? AND deleted_at IS NULL').get(id) as
      { name: string; updated_at: string } | undefined) ?? null;

  handle(IPC.library.slidesForEdit, (_e, presentationId): EditSlidesResult => {
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    const stamp = id.success ? stampOf(id.data) : null;
    if (!rows || !stamp) return { ok: false, message: 'That presentation is no longer in the library.' };
    const { doc, unreadable } = editDocOf(rows, stamp.name);
    return { ok: true, doc, stamp: stamp.updated_at, look: lookFor(rows.themeId, rows), unreadable };
  });

  handle(IPC.library.saveSlides, (e, presentationId, edited, stamp, force): SaveSlidesResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const doc = editDocSchema.safeParse(edited);
    if (!id.success || !doc.success || typeof stamp !== 'string' || doc.data.presentationId !== id.data)
      return { ok: false, message: 'Those slides cannot be saved: something in them is not valid.' };
    const before = presentations.content(id.data);
    const now = stampOf(id.data);
    if (!before || !now) return { ok: false, message: 'That presentation is no longer in the library.' };
    if (before.width !== doc.data.width || before.height !== doc.data.height)
      return { ok: false, message: 'The presentation’s size changed while it was open: open it again.' };
    if (now.updated_at !== stamp && force !== true)
      return {
        ok: false,
        changedElsewhere: true,
        message:
          'This presentation was changed somewhere else since the editor opened it (an import, Edit words or a theme).',
      };
    // Every picture, video and sound must be in the library.
    const media = mediaIdsOf(doc.data);
    if (media.length > 0) {
      const found = db.prepare('SELECT 1 FROM media WHERE id = ?');
      if (media.some((m) => !found.get(m)))
        return {
          ok: false,
          message: 'A picture, video or sound on these slides is no longer in the library.',
        };
    }
    const after = applySlideEdit(before, doc.data);
    presentations.setContent(after);
    const revisionId = revisions.keep([before]);
    changed([id.data]);
    return { ok: true, revisionId };
  });

  handle(IPC.library.getDefaultTransition, () => defaultTransition(settings));

  handle(IPC.library.setDefaultTransition, (e, transition) => {
    if (!fromOperator(e)) return onlyOperator;
    const t = transitionSchema.safeParse(transition);
    if (!t.success) return { ok: false as const, message: 'That transition is not valid.' };
    const kept: Transition =
      t.data.kind === 'cut'
        ? { kind: 'cut', durationMs: 0 }
        : { kind: 'dissolve', durationMs: t.data.durationMs };
    settings.set(DEFAULT_TRANSITION, kept);
    return { ok: true as const, transition: kept };
  });
}
