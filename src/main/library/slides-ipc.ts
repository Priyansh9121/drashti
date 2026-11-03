import type { InsertPdfPagesResult, PdfPageSource } from '../../shared/slide-edit';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import { CUT, type Transition } from '../../shared/model';
import { idSchema, transitionSchema } from '../../shared/model-schema';
import type { EditSlidesResult, SaveSlidesResult, SlideLook, SlidesSaved } from '../../shared/slide-edit';
import { editDocSchema } from '../../shared/slide-edit';
import type { Db } from '../db/database';
import type { ContentRows } from '../db/content';
import type { PresentationRepo } from '../db/presentations';
import type { SettingsRepo } from '../db/settings';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import { applySlideEdit, editDocOf, mediaIdsOf } from './slides';
import { nfcEditDoc } from '../../shared/nfc';
import { ImportedSlides } from './imported-slides';
import type { SourceReader } from '../documents/source-reader';
import type { SourceWrite } from '../documents/source-write';
import type { EditDoc } from '../../shared/slide-edit';

/*
 * The slide editor's requests: anyone of Drashti's pages may read a
 * presentation's slides; only the operator window and the slide editor's own window (Session 55, Part 17a) may save
 * them. A save is one change, kept for the operator window's Undo, and the screens show the live slide's new look
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
  /** Slides saved (Session 55, Part 17a: from the slide editor's window): the operator window's Undo puts them back. */
  saved?: (saved: SlidesSaved) => void;
  /** Main selects secure production adapters; omitted readers never fall back to Node canvas. */
  sourceReader?: SourceReader;
  sourceWrite?: SourceWrite;
  /** Main's current Pro/access/sender authority, rechecked throughout preparation. */
  mayPrepareSource?: (event: IpcMainInvokeEvent) => boolean;
}

export interface SlidesIpcController {
  cancelSourcePreparation(presentationId?: string): void;
  /** After admission closes and cancellation is signalled, wait for full Main staging/cache/cleanup chains. */
  drainSourcePreparation(): Promise<void>;
  documentForExport(
    presentationId: string,
    doc: EditDoc,
    stamp: string,
  ): { ok: true; doc: EditDoc } | { ok: false; message: string };
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
  saved,
  sourceReader,
  sourceWrite,
  mayPrepareSource = () => false,
}: SlidesIpcDeps): SlidesIpcController {
  const imported = new ImportedSlides(db, undefined, { sourceReader, sourceWrite });
  const generations = new Map<string, AbortController>();
  // Cancellation removes controllers immediately; these complete chains outlive
  // the reader queue while Main stages assets or removes its private files.
  const preparations = new Set<Promise<unknown>>();
  const insertions = new Map<string, { controller: AbortController; sender: number; stamp: string }>();
  const cancelSourcePreparation = (presentationId?: string) => {
    for (const [id, controller] of generations)
      if (presentationId === undefined || presentationId === id) {
        controller.abort();
        generations.delete(id);
      }
  };
  const drainSourcePreparation = () => Promise.allSettled([...preparations]).then(() => undefined);
  /**
   * When the presentation last changed, and its content revision (Sessions 31–36: every write of its content
   * moves it on, so two writes in one millisecond still differ): the editor saves only over what it opened.
   */
  const stampOf = (id: string) => {
    const row = db
      .prepare('SELECT name, updated_at, content_rev FROM presentations WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { name: string; updated_at: string; content_rev: number } | undefined;
    return row ? { name: row.name, stamp: `${row.updated_at}#${String(row.content_rev)}` } : null;
  };

  handle(IPC.library.slidesForEdit, (e, presentationId): EditSlidesResult | Promise<EditSlidesResult> => {
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    const stamp = id.success ? stampOf(id.data) : null;
    if (!rows || !stamp) return { ok: false, message: 'That presentation is no longer in the library.' };
    const { doc, unreadable } = editDocOf(rows, stamp.name);
    const source = db
      .prepare('SELECT source_kind FROM presentations WHERE id = ?')
      .pluck()
      .get(rows.presentationId);
    if (source === 'pictures' || rows.slides.some((slide) => slide.document_page)) {
      if (!fromOperator(e) || !mayPrepareSource(e))
        return { ok: true, doc, stamp: stamp.stamp, look: lookFor(rows.themeId, rows), unreadable };
      cancelSourcePreparation();
      const controller = new AbortController();
      generations.set(rows.presentationId, controller);
      const allowed = () =>
        !controller.signal.aborted &&
        generations.get(rows.presentationId) === controller &&
        fromOperator(e) &&
        mayPrepareSource(e) &&
        stampOf(rows.presentationId)?.stamp === stamp.stamp;
      const preparing: Promise<EditSlidesResult> = imported
        .prepare(rows, doc, stamp.stamp, { signal: controller.signal, allowed })
        .then((prepared): EditSlidesResult => {
          if (!allowed())
            return {
              ok: false,
              message:
                'This presentation changed while its source pages were being prepared. Reopen the editor.',
            };
          return {
            ok: true,
            doc: prepared.doc,
            stamp: stamp.stamp,
            look: lookFor(rows.themeId, rows),
            unreadable,
            ...(prepared.issues.length ? { sourceIssues: prepared.issues } : {}),
          };
        })
        .catch(() => ({
          ok: false as const,
          message: 'The source pages could not be prepared. The saved presentation is unchanged.',
        }))
        .finally(() => {
          if (generations.get(rows.presentationId) === controller) generations.delete(rows.presentationId);
          preparations.delete(preparing);
        });
      preparations.add(preparing);
      return preparing;
    }
    return { ok: true, doc, stamp: stamp.stamp, look: lookFor(rows.themeId, rows), unreadable };
  });

  handle(IPC.library.pdfPageSources, (e): PdfPageSource[] => {
    if (!fromOperator(e) || !mayPrepareSource(e)) return [];
    return db
      .prepare(
        `
      SELECT p.id, p.name, (SELECT COUNT(*) FROM slides s JOIN slide_groups g ON g.id = s.group_id WHERE g.presentation_id = p.id) AS pages
      FROM presentations p WHERE p.deleted_at IS NULL AND p.source_kind = 'pictures'
        AND lower(p.source_path) LIKE '%.pdf' ORDER BY p.name COLLATE NOCASE, p.id
    `,
      )
      .all() as PdfPageSource[];
  });

  handle(IPC.library.cancelPdfInsertion, (e, rawId, stamp): boolean => {
    const id = idSchema.safeParse(rawId);
    if (!id.success || !fromOperator(e)) return false;
    const current = insertions.get(id.data);
    if (current?.sender !== e.sender.id || current.stamp !== stamp) return false;
    current.controller.abort();
    return true;
  });

  handle(
    IPC.library.insertPdfPages,
    (e, rawId, rawStamp, rawSource): InsertPdfPagesResult | Promise<InsertPdfPagesResult> => {
      if (!fromOperator(e) || !mayPrepareSource(e)) return onlyOperator;
      const id = idSchema.safeParse(rawId),
        sourceId = idSchema.safeParse(rawSource);
      if (
        !id.success ||
        !sourceId.success ||
        id.data === sourceId.data ||
        typeof rawStamp !== 'string' ||
        rawStamp.length > 1024
      )
        return { ok: false, message: 'Choose another PDF in the library, or duplicate this page instead.' };
      const target = presentations.content(id.data),
        source = presentations.content(sourceId.data);
      const targetStamp = stampOf(id.data),
        sourceStamp = stampOf(sourceId.data);
      const sourcePdf = db
        .prepare(
          "SELECT 1 FROM presentations WHERE id = ? AND deleted_at IS NULL AND source_kind = 'pictures' AND lower(source_path) LIKE '%.pdf'",
        )
        .get(sourceId.data);
      if (!target || !source || !targetStamp || !sourceStamp || !sourcePdf || targetStamp.stamp !== rawStamp)
        return {
          ok: false,
          message: 'That PDF or this presentation changed. Reopen the editor and choose the PDF again.',
        };
      cancelSourcePreparation();
      const controller = new AbortController();
      generations.set(id.data, controller);
      insertions.set(id.data, { controller, sender: e.sender.id, stamp: rawStamp });
      const allowed = () =>
        !controller.signal.aborted &&
        generations.get(id.data) === controller &&
        fromOperator(e) &&
        mayPrepareSource(e) &&
        stampOf(id.data)?.stamp === rawStamp &&
        stampOf(sourceId.data)?.stamp === sourceStamp.stamp;
      const preparing: Promise<InsertPdfPagesResult> = imported
        .insertFromPdf(target, targetStamp.name, rawStamp, source, sourceStamp.name, sourceStamp.stamp, {
          signal: controller.signal,
          allowed,
        })
        .catch((): InsertPdfPagesResult =>
          controller.signal.aborted
            ? { ok: false, cancelled: true, message: 'Inserting the PDF pages was cancelled.' }
            : {
                ok: false,
                message: 'Those PDF pages could not be inserted. Reopen the editor and choose the PDF again.',
              },
        )
        .finally(() => {
          if (generations.get(id.data) === controller) generations.delete(id.data);
          if (insertions.get(id.data)?.controller === controller) insertions.delete(id.data);
          preparations.delete(preparing);
        });
      preparations.add(preparing);
      return preparing;
    },
  );

  const validateDocument = (
    presentationId: unknown,
    edited: unknown,
    stamp: unknown,
    force: unknown,
  ):
    | { ok: true; doc: EditDoc; before: ContentRows; now: { name: string; stamp: string }; id: string }
    | Extract<SaveSlidesResult, { ok: false }> => {
    const id = idSchema.safeParse(presentationId);
    const doc = editDocSchema.safeParse(edited);
    if (!id.success || !doc.success || typeof stamp !== 'string' || doc.data.presentationId !== id.data)
      return { ok: false, message: 'Those slides cannot be saved: something in them is not valid.' };
    const before = presentations.content(id.data);
    const now = stampOf(id.data);
    if (!before || !now) return { ok: false, message: 'That presentation is no longer in the library.' };
    if (now.stamp !== stamp && force !== true)
      return {
        ok: false,
        changedElsewhere: true,
        message: 'This presentation was changed somewhere else since the editor opened it (an import, say).',
      };
    if (
      (before.width !== doc.data.width || before.height !== doc.data.height) &&
      before.slides.some((s) => s.deck != null)
    )
      return { ok: false, message: 'An imported deck keeps its original slide size.' };
    const prepared = imported.forSave(before, doc.data, stamp);
    if (!prepared.ok) return prepared;
    // Every picture, video and sound must be in the library.
    const media = mediaIdsOf(prepared.doc);
    if (media.length > 0) {
      const found = db.prepare('SELECT 1 FROM media WHERE id = ?');
      if (media.some((m) => !found.get(m)))
        return {
          ok: false,
          message: 'A picture, video or sound on these slides is no longer in the library.',
        };
    }
    return { ok: true as const, doc: nfcEditDoc(prepared.doc), before, now, id: id.data };
  };

  const documentForExport: SlidesIpcController['documentForExport'] = (presentationId, doc, stamp) => {
    const checked = validateDocument(presentationId, doc, stamp, false);
    return checked.ok ? { ok: true, doc: checked.doc } : { ok: false, message: checked.message };
  };

  handle(IPC.library.saveSlides, (e, presentationId, edited, stamp, force): SaveSlidesResult => {
    if (!fromOperator(e)) return onlyOperator;
    const checked = validateDocument(presentationId, edited, stamp, force);
    if (!checked.ok) return checked;
    // Its words in one form, NFC, exactly as in the validated export document.
    const after = applySlideEdit(checked.before, checked.doc);
    presentations.setContent(after);
    const revisionId = revisions.keep([checked.before]);
    changed([checked.id]);
    saved?.({ presentationId: checked.id, name: checked.now.name, revisionId });
    return { ok: true, revisionId };
  });

  handle(IPC.library.getDefaultTransition, () => defaultTransition(settings));

  handle(IPC.library.setDefaultTransition, (e, transition) => {
    if (!fromOperator(e)) return onlyOperator;
    const t = transitionSchema.safeParse(transition);
    if (!t.success) return { ok: false as const, message: 'That transition is not valid.' };
    // Any kind the editor offers (Session 27: before, every kind but a cut was kept as a fade, though the
    // editor offered them all); a slow zoom's span is the engine's to set, never a default's.
    const kept: Transition =
      t.data.kind === 'cut'
        ? { kind: 'cut', durationMs: 0 }
        : { kind: t.data.kind, durationMs: t.data.durationMs };
    settings.set(DEFAULT_TRANSITION, kept);
    return { ok: true as const, transition: kept };
  });
  return { cancelSourcePreparation, drainSourcePreparation, documentForExport };
}
