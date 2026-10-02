import type { IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../shared/ipc';
import type { KirtanResult, MakeTranslitResult, TracksResult } from '../../shared/kirtans';
import { cleanDetails, kirtanDetailsSchema, trackEditsSchema } from '../../shared/kirtans';
import { idSchema } from '../../shared/model-schema';
import type { SlideLook } from '../../shared/slide-edit';
import { TRANSLIT_STYLES, type TranslitStyle } from '../../shared/translit';
import { z } from 'zod';
import type { SettingsRepo } from '../db/settings';
import { kirtanLangs } from '../db/content';
import type { PresentationRepo } from '../db/presentations';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import { applyTrackEdits, detailsOf, trackSlidesOf, withDetails } from './tracks';
import { planTransliteration } from './make-translit';

/*
 * The kirtan requests: anyone of Drashti's pages may read a kirtan's words
 * by language; only the operator window may change them or its details.
 * Each change is kept for Undo, and the screens show the live slide's new
 * words at once.
 */

export interface KirtansIpcDeps {
  presentations: PresentationRepo;
  revisions: Revisions;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** How new text looks in a presentation: its theme, for its size. */
  lookFor: (themeId: string | null, size: { width: number; height: number }) => SlideLook;
  /** A presentation's content changed: refresh caches, the live slide and the operator's list. */
  changed: (presentationIds: string[]) => void;
  /** Is there a media item with this id (a kirtan's recording)? */
  mediaExists: (mediaId: string) => boolean;
  settings: SettingsRepo;
}

const TRANSLIT_STYLE = 'translitStyle';
const styleSchema = z.enum(TRANSLIT_STYLES);

/** How transliteration is made: plain letters until the operator chooses accent marks. */
export function translitStyle(settings: SettingsRepo): TranslitStyle {
  const stored = styleSchema.safeParse(settings.get(TRANSLIT_STYLE));
  return stored.success ? stored.data : 'plain';
}

const onlyOperator = { ok: false as const, message: 'Only the operator window can change kirtans.' };
const gone = { ok: false as const, message: 'That presentation is no longer in the library.' };

export function registerKirtansIpc({
  presentations,
  revisions,
  fromOperator,
  lookFor,
  changed,
  mediaExists,
  settings,
}: KirtansIpcDeps): void {
  handle(IPC.kirtans.tracks, (_e, presentationId): TracksResult => {
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    const name = id.success ? presentations.get(id.data)?.name : undefined;
    if (!rows || name === undefined) return gone;
    const details = detailsOf(rows);
    const { slides, order } = trackSlidesOf(rows);
    return {
      ok: true,
      name,
      kirtan: details ? { ...details, tracks: kirtanLangs(rows) } : null,
      order,
      slides,
    };
  });

  handle(IPC.kirtans.saveTracks, (e, presentationId, edits): KirtanResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const list = trackEditsSchema.safeParse(edits);
    if (!id.success || !list.success) return { ok: false, message: 'Those words cannot be saved.' };
    const before = presentations.content(id.data);
    if (!before) return gone;
    const { rows, changed: count } = applyTrackEdits(before, list.data, lookFor(before.themeId, before));
    if (count === 0) return { ok: true, revisionId: null, changed: 0 };
    presentations.setContent(rows);
    const revisionId = revisions.keep([before]);
    changed([id.data]);
    return { ok: true, revisionId, changed: count };
  });

  handle(IPC.kirtans.setDetails, (e, presentationId, details): KirtanResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const parsed = details === null ? null : kirtanDetailsSchema.safeParse(details);
    if (!id.success || (parsed !== null && !parsed.success))
      return { ok: false, message: 'Those kirtan details cannot be saved.' };
    const clean = parsed ? cleanDetails(parsed.data) : null;
    if (clean?.audioMediaId && !mediaExists(clean.audioMediaId))
      return { ok: false, message: 'That recording is no longer in the media library.' };
    const before = presentations.content(id.data);
    if (!before) return gone;
    presentations.setContent(withDetails(before, clean));
    const revisionId = revisions.keep([before]);
    changed([id.data]);
    return { ok: true, revisionId, changed: 0 };
  });

  handle(IPC.kirtans.getTranslitStyle, () => translitStyle(settings));

  handle(IPC.kirtans.setTranslitStyle, (e, style) => {
    if (!fromOperator(e)) return onlyOperator;
    const parsed = styleSchema.safeParse(style);
    if (!parsed.success) return { ok: false as const, message: 'That is not a transliteration style.' };
    settings.set(TRANSLIT_STYLE, parsed.data);
    return { ok: true as const, style: parsed.data };
  });

  handle(IPC.kirtans.makeTransliteration, (e, presentationId, style, manual): MakeTranslitResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const s = styleSchema.safeParse(style);
    const m = z.enum(['ask', 'keep', 'replace']).safeParse(manual);
    if (!id.success || !s.success || !m.success)
      return { ok: false, message: 'The transliteration cannot be made like that.' };
    const before = presentations.content(id.data);
    if (!before) return gone;
    if (!before.kirtan) return { ok: false, message: 'Only a kirtan has a transliteration track.' };
    settings.set(TRANSLIT_STYLE, s.data);
    const plan = planTransliteration(before, s.data, m.data === 'replace');
    // Lines changed by hand are never replaced without asking first.
    if (m.data === 'ask' && plan.manual.length > 0)
      return {
        ok: false,
        message: 'Some transliteration lines were changed by hand.',
        ask: {
          count: plan.manual.length,
          examples: plan.manual.slice(0, 3).map(({ number, now, made }) => ({ number, now, made })),
        },
      };
    const replaced = m.data === 'replace' ? plan.manual.length : 0;
    const counts = {
      added: plan.added,
      renewed: plan.renewed,
      same: plan.same,
      kept: plan.manual.length - replaced,
      replaced,
      noSource: plan.noSource,
    };
    const { rows } = applyTrackEdits(before, plan.edits, lookFor(before.themeId, before));
    const after = { ...rows, autoLines: plan.autoLines };
    const sameMarks =
      JSON.stringify(
        [...before.autoLines].sort((a, b) => (a.slide_id + a.lang).localeCompare(b.slide_id + b.lang)),
      ) ===
      JSON.stringify(
        [...plan.autoLines].sort((a, b) => (a.slide_id + a.lang).localeCompare(b.slide_id + b.lang)),
      );
    if (plan.edits.length === 0 && sameMarks) return { ok: true, revisionId: null, ...counts };
    presentations.setContent(after);
    const revisionId = revisions.keep([before]);
    changed([id.data]);
    return { ok: true, revisionId, ...counts };
  });
}
