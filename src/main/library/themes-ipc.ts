import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { idSchema } from '../../shared/model-schema';
import type { ApplyThemeResult, ThemeResult } from '../../shared/themes';
import { themeFieldsSchema } from '../../shared/themes';
import type { ContentRows } from '../db/content';
import type { PresentationRepo } from '../db/presentations';
import type { ThemeRepo } from '../db/themes';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import { applyTheme, themeFromContent } from './themes';

/*
 * The themes' requests: anyone of Drashti's pages may list them; only the
 * operator window may change or apply them.
 */

export interface ThemesIpcDeps {
  themes: ThemeRepo;
  presentations: PresentationRepo;
  revisions: Revisions;
  fromOperator: (event: IpcMainInvokeEvent) => boolean;
  /** Presentations' content changed: refresh caches, the live slide and the operator's list. */
  changed: (presentationIds: string[]) => void;
}

const onlyOperator = { ok: false as const, message: 'Only the operator window can change themes.' };
const ids = z.array(idSchema).min(1).max(10_000);

export function registerThemesIpc({
  themes,
  presentations,
  revisions,
  fromOperator,
  changed,
}: ThemesIpcDeps): void {
  handle(IPC.themes.list, () => ({ themes: themes.list(), defaultId: themes.defaultId() }));

  handle(IPC.themes.save, (e, themeId, fields): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const f = themeFieldsSchema.safeParse(fields);
    if (!f.success)
      return { ok: false, message: 'That theme is not complete: check its sizes, colours and box.' };
    if (themeId === null) return { ok: true, id: themes.create(f.data, { kind: 'drashti', path: null }) };
    const id = idSchema.safeParse(themeId);
    return id.success && themes.update(id.data, f.data)
      ? { ok: true, id: id.data }
      : { ok: false, message: 'That theme no longer exists.' };
  });

  handle(IPC.themes.remove, (e, themeId): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(themeId);
    if (!id.success) return { ok: false, message: 'That theme no longer exists.' };
    if (id.data === themes.defaultId())
      return { ok: false, message: 'The default theme stays; change it instead.' };
    return themes.remove(id.data)
      ? { ok: true, id: id.data }
      : { ok: false, message: 'That theme no longer exists.' };
  });

  handle(IPC.themes.apply, (e, themeId, presentationIds): ApplyThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(themeId);
    const list = ids.safeParse(presentationIds);
    const theme = id.success ? themes.get(id.data) : null;
    if (!theme || !list.success)
      return { ok: false, message: 'Choose a theme and the presentations to apply it to.' };
    const before: ContentRows[] = [];
    for (const pid of new Set(list.data)) {
      const rows = presentations.content(pid);
      if (!rows) continue;
      before.push(rows);
      presentations.setContent(applyTheme(rows, theme));
    }
    if (before.length === 0)
      return { ok: false, message: 'Those presentations are no longer in the library.' };
    const revisionId = revisions.keep(before);
    changed(before.map((r) => r.presentationId));
    return { ok: true, revisionId, count: before.length };
  });

  handle(IPC.themes.fromPresentation, (e, presentationId): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(presentationId);
    const rows = id.success ? presentations.content(id.data) : null;
    const name = rows ? presentations.list().find((p) => p.id === rows.presentationId)?.name : undefined;
    const fields = rows ? themeFromContent(rows, (name ?? 'Theme').slice(0, 80)) : null;
    if (!fields) return { ok: false, message: 'That presentation has no text box to make a theme from.' };
    return { ok: true, id: themes.create(fields, { kind: 'drashti', path: null }) };
  });
}
