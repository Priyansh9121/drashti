import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import type { NewFromWordsResult, RevisionResult, SaveWordsResult, WordsResult } from '../../shared/library';
import { idSchema } from '../../shared/model-schema';
import type { PresentationRepo } from '../db/presentations';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import type { NewSlideLook } from './words';
import { applyWords, legacyFonts, presentationFromWords, wordsOf } from './words';

/*
 * The words editor's requests: anyone of Drashti's pages may read words;
 * only the operator window may change them.
 */

export interface WordsIpcDeps {
  presentations: PresentationRepo;
  revisions: Revisions;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** How slides look in a group that has none yet: the presentation's theme, for its size. */
  lookFor: (themeId: string | null, size: { width: number; height: number }) => NewSlideLook;
  /** A presentation's content changed: refresh caches, the live slide and the operator's list. */
  changed: (presentationIds: string[]) => void;
}

const wordsSchema = z.string().max(200_000);
const nameSchema = z.string().trim().min(1).max(200);
const onlyOperator = { ok: false as const, message: 'Only the operator window can change presentations.' };

export function registerWordsIpc({
  presentations,
  revisions,
  fromOperator,
  lookFor,
  changed,
}: WordsIpcDeps): void {
  handle(IPC.library.words, (_e, presentationId): WordsResult => {
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    if (!rows) return { ok: false, message: 'That presentation is no longer in the library.' };
    return { ok: true, text: wordsOf(rows), legacyFonts: legacyFonts(rows) };
  });

  handle(IPC.library.saveWords, (e, presentationId, text): SaveWordsResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const words = wordsSchema.safeParse(text);
    if (!id.success || !words.success) return { ok: false, message: 'Those words cannot be saved.' };
    const before = presentations.content(id.data);
    if (!before) return { ok: false, message: 'That presentation is no longer in the library.' };
    const fonts = legacyFonts(before);
    // Never write over text in a legacy font: it would come out garbled.
    if (fonts.length > 0)
      return {
        ok: false,
        message: `This presentation has text in a legacy font (${fonts.join(', ')}), which cannot be edited as plain text yet.`,
      };
    const change = applyWords(before, words.data, lookFor(before.themeId, before));
    if (!change) return { ok: false, message: 'There are no words to make slides from.' };
    presentations.setContent(change.rows);
    const revisionId = revisions.keep([before]);
    changed([id.data]);
    const { kept, changed: edited, added, removed } = change;
    return { ok: true, revisionId, kept, changed: edited, added, removed };
  });

  handle(IPC.library.newFromWords, (e, name, text): NewFromWordsResult => {
    if (!fromOperator(e)) return onlyOperator;
    const n = nameSchema.safeParse(name);
    const words = wordsSchema.safeParse(text);
    if (!n.success) return { ok: false, message: 'Give the presentation a name.' };
    if (!words.success) return { ok: false, message: 'Those words cannot be saved.' };
    const libraryId = presentations.ensureLibrary('Default');
    const size = { width: 1920, height: 1080 };
    const input = presentationFromWords(
      libraryId,
      presentations.uniqueName(libraryId, n.data),
      words.data,
      lookFor(null, size),
      size,
    );
    if (!input) return { ok: false, message: 'Paste or type the words first.' };
    const id = presentations.insert(input);
    changed([id]);
    return { ok: true, id };
  });

  handle(IPC.library.restoreRevision, (e, revisionId): RevisionResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = z.string().min(1).max(64).safeParse(revisionId);
    const rows = id.success ? revisions.take(id.data) : null;
    if (!rows) return { ok: false, message: 'There is nothing to undo there any more.' };
    const back = rows.filter((r) => presentations.content(r.presentationId) !== null);
    for (const r of back) presentations.setContent(r);
    changed(back.map((r) => r.presentationId));
    const first = back[0];
    return first
      ? { ok: true, presentationId: first.presentationId }
      : { ok: false, message: 'That presentation is no longer in the library.' };
  });
}
