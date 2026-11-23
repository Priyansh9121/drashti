import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { cleanNameSchema } from '../../shared/rename-name';
import { IPC } from '../../shared/ipc';
import type { NewFromWordsResult, RevisionResult, SaveWordsResult, WordsResult } from '../../shared/library';
import { idSchema } from '../../shared/model-schema';
import type { PresentationRepo } from '../db/presentations';
import type { Db } from '../db/database';
import { handle } from '../ipc/handle';
import { log } from '../log';
import type { Revisions } from './revisions';
import type { NewSlideLook } from './words';
import { applyWords, legacyFonts, presentationFromWords, wordsOf } from './words';
import { nfc } from '../../shared/nfc';

/*
 * The words editor's requests: anyone of Drashti's pages may read words;
 * only the operator window may change them.
 */

export interface WordsIpcDeps {
  db: Db;
  presentations: PresentationRepo;
  revisions: Revisions;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** How slides look in a group that has none yet: the presentation's theme, for its size. */
  lookFor: (themeId: string | null, size: { width: number; height: number }) => NewSlideLook;
  /** A presentation's content changed: refresh caches, the live slide and the operator's list. */
  changed: (presentationIds: string[]) => void;
  /** A presentation was just made in Drashti: give it the default theme (backgrounds included). */
  styleNew: (presentationId: string) => void;
}

const wordsSchema = z.string().max(200_000);
/** A new presentation's name: cleaned as Rename… cleans a name, the window's and a phone's alike (C15, FT-1). */
const nameSchema = cleanNameSchema(200);
const onlyOperator = { ok: false as const, message: 'Only the operator window can change presentations.' };

/** A full drive must answer the editor, leaving its words and Save button available. */
function writeWords<T>(save: () => T): T | { ok: false; message: string } {
  try {
    return save();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code !== 'SQLITE_FULL' && code !== 'ENOSPC') throw error;
    log.error('Could not save presentation words: drive full.', error);
    return {
      ok: false,
      message: 'This computer’s drive is full: free some space on it, then try again.',
    };
  }
}

export function registerWordsIpc({
  db,
  presentations,
  revisions,
  fromOperator,
  lookFor,
  changed,
  styleNew,
}: WordsIpcDeps): { newFromWords(name: unknown, text: unknown): NewFromWordsResult } {
  handle(IPC.library.words, (_e, presentationId): WordsResult => {
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    if (!rows) return { ok: false, message: 'That presentation is no longer in the library.' };
    return { ok: true, text: wordsOf(rows), legacyFonts: legacyFonts(rows) };
  });

  handle(IPC.library.saveWords, (e, presentationId, text): SaveWordsResult =>
    writeWords<SaveWordsResult>(() => {
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
      // In one form, NFC (Sessions 31–36, I18N-6): text enters the library here.
      const change = applyWords(before, nfc(words.data), lookFor(before.themeId, before));
      if (!change) return { ok: false, message: 'There are no words to make slides from.' };
      presentations.setContent(change.rows);
      const revisionId = revisions.keep([before]);
      changed([id.data]);
      const { kept, changed: edited, added, removed } = change;
      return { ok: true, revisionId, kept, changed: edited, added, removed };
    }),
  );

  // A new presentation from words, the operator window's and a phone's alike (Session 54, the phone as a full Drashti).
  const newFromWords = (name: unknown, text: unknown): NewFromWordsResult =>
    writeWords<NewFromWordsResult>(() => {
      const n = nameSchema.safeParse(name);
      const words = wordsSchema.safeParse(text);
      if (!n.success) return { ok: false, message: 'Give the presentation a name.' };
      if (!words.success) return { ok: false, message: 'Those words cannot be saved.' };
      // Inserting and applying the default look are one save: neither may be left
      // behind when the other runs out of space (or the app quits between them).
      const id = db.transaction(() => {
        const libraryId = presentations.ensureLibrary('Default');
        const size = { width: 1920, height: 1080 };
        const input = presentationFromWords(
          libraryId,
          presentations.uniqueName(libraryId, nfc(n.data)),
          nfc(words.data),
          lookFor(null, size),
          size,
        );
        if (!input) return null;
        const id = presentations.insert(input);
        styleNew(id);
        return id;
      })();
      if (id === null) return { ok: false, message: 'Paste or type the words first.' };
      changed([id]);
      return { ok: true, id };
    });
  handle(IPC.library.newFromWords, (e, name, text): NewFromWordsResult =>
    fromOperator(e) ? newFromWords(name, text) : onlyOperator,
  );

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
  return { newFromWords };
}
