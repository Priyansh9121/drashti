import type { IpcMainInvokeEvent } from 'electron';
import { IPC, type InvokeChannel, type InvokeResult } from '../../shared/ipc';
import {
  MAX_DRAFT_SOURCE,
  type TranslationEngineStatus,
  type TranslationLanguage,
} from '../../shared/prepared-translations';
import { HelperError } from './translation-helper';

/*
 * Prepare translations (alpha.22, a22-mt): the Translation… dialog's requests, from the operator window or the slide
 * editor's, in Pro Mode only (Simple Mode's lock refuses them first: main/simple-mode.ts) and off air only: the
 * engine starts nothing while the stream is on air or recording (as Edit slides' PDF work), and what is under way
 * stops when it goes on air. A draft goes back to the dialog only; it shows nowhere until a named reader checks it.
 */

export interface TranslationIpcDeps {
  handle: <C extends InvokeChannel>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => InvokeResult<C> | Promise<InvokeResult<C>>,
  ) => void;
  /** The sender may change slides now (Pro Mode, the operator's or the editor's window). */
  mayDraft: (event: IpcMainInvokeEvent) => boolean;
  /** The stream is on air or recording. */
  onAir: () => boolean;
  engine: {
    installed(): boolean;
    available(from: TranslationLanguage, to: TranslationLanguage): boolean;
    translate(source: string, from: TranslationLanguage, to: TranslationLanguage): Promise<string>;
    cancel(): void;
  };
}

const LANGUAGES: readonly TranslationLanguage[] = ['gu', 'hi', 'en'];
const isLanguage = (value: unknown): value is TranslationLanguage =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);

export const ON_AIR =
  'Prepare translations waits while the stream is on air or recording. Prepare them once it is off air.';
export const NOT_INSTALLED = 'This copy of Drashti has no translation engine.';
export const NO_MODEL =
  'Prepare translations needs the offline translation model pack for this direction: ask the admin to import it (Help › Caption and Translation Models…).';
export const NOT_HERE = 'Translations are prepared in Pro Mode, from the Translation… dialog.';
export const READY =
  'Prepare translations fills each empty translation with a draft from the offline engine. A named reader checks every draft before it can show.';

export function translationStatus(
  d: Pick<TranslationIpcDeps, 'engine' | 'onAir'>,
  from: TranslationLanguage,
  to: TranslationLanguage,
): TranslationEngineStatus {
  const installed = d.engine.installed();
  const available = installed && from !== to && d.engine.available(from, to);
  return {
    installed,
    available,
    message: !installed ? NOT_INSTALLED : !available ? NO_MODEL : d.onAir() ? ON_AIR : READY,
  };
}

export function handleTranslation(d: TranslationIpcDeps): void {
  d.handle(IPC.slideEditor.translationStatus, (e, from, to) =>
    d.mayDraft(e) && isLanguage(from) && isLanguage(to)
      ? translationStatus(d, from, to)
      : { installed: false, available: false, message: NOT_HERE },
  );
  d.handle(IPC.slideEditor.translationDraft, async (e, request) => {
    if (!d.mayDraft(e)) return { ok: false, message: NOT_HERE };
    const r = request as { source?: unknown; from?: unknown; to?: unknown } | null;
    if (
      typeof r !== 'object' ||
      r === null ||
      typeof r.source !== 'string' ||
      r.source.length > MAX_DRAFT_SOURCE ||
      !isLanguage(r.from) ||
      !isLanguage(r.to) ||
      r.from === r.to
    )
      return { ok: false, message: 'Choose a text box’s source language and a different target.' };
    if (d.onAir()) return { ok: false, message: ON_AIR };
    if (!d.engine.installed()) return { ok: false, message: NOT_INSTALLED };
    if (!d.engine.available(r.from, r.to)) return { ok: false, message: NO_MODEL };
    try {
      return { ok: true, text: await d.engine.translate(r.source, r.from, r.to) };
    } catch (error) {
      if (!(error instanceof HelperError))
        return { ok: false, message: 'The translation engine could not draft this text.' };
      const thisBoxOnly = error.code === 'too-long' || error.code === 'special-token';
      return thisBoxOnly
        ? { ok: false, message: error.message, thisBoxOnly }
        : { ok: false, message: error.message };
    }
  });
  d.handle(IPC.slideEditor.translationCancel, (e) => {
    if (!d.mayDraft(e)) return false;
    d.engine.cancel();
    return true;
  });
}
