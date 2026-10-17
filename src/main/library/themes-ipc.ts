import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { idSchema } from '../../shared/model-schema';
import type { ApplyThemeResult, ThemeResult } from '../../shared/themes';
import type { ThemeSlide } from '../../shared/slide-edit';
import { themeFieldsSchema } from '../../shared/themes';
import { themeSlideSchema } from '../../shared/slide-edit';
import type { ContentRows } from '../db/content';
import type { PresentationRepo } from '../db/presentations';
import type { ThemeRepo } from '../db/themes';
import { handle } from '../ipc/handle';
import type { Revisions } from './revisions';
import { applyTheme, themeFromContent } from './themes';
import { themeContract } from '../../shared/theme-contract';

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
  /** A theme was made, changed or removed: the operator's list of them reloads. */
  themesChanged: () => void;
}

const onlyOperator = { ok: false as const, message: 'Only the operator window can change themes.' };
const ids = z.array(idSchema).min(1).max(10_000);

/** A copy's name: "(copy)" after the built-in theme's own, then "(copy 2)" and on, away from those taken. */
function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const tail = n === 1 ? ' (copy)' : ` (copy ${String(n)})`;
    const made = `${name.slice(0, 80 - tail.length)}${tail}`;
    if (!taken.has(made)) return made;
  }
}

/**
 * Save a theme: a new one (id null) or one of the library's in place. Saving one of Drashti's built-in
 * themes makes a copy (Session 26), named after it unless it was renamed; the built-in stays as it was.
 */
export function saveTheme(themes: ThemeRepo, themeId: unknown, fields: unknown): ThemeResult {
  const f = themeFieldsSchema.safeParse(fields);
  if (!f.success)
    return { ok: false, message: 'That theme is not complete: check its sizes, colours and box.' };
  // What it misses of the theme contract (Sessions 31–36, SLD-4): said, never refused.
  const missed = themeContract(f.data);
  const warned = missed.length > 0 ? { warnings: missed } : {};
  if (themeId === null)
    return { ok: true, id: themes.create(f.data, { kind: 'drashti', path: null }), ...warned };
  const id = idSchema.safeParse(themeId);
  const was = id.success ? themes.get(id.data) : null;
  if (!was) return { ok: false, message: 'That theme no longer exists.' };
  if (was.builtIn) {
    const taken = new Set(themes.list().map((t) => t.name));
    const name = f.data.name === was.name ? copyName(was.name, taken) : f.data.name;
    return { ok: true, id: themes.create({ ...f.data, name }, { kind: 'drashti', path: null }), ...warned };
  }
  return themes.update(was.id, f.data)
    ? { ok: true, id: was.id, ...warned }
    : { ok: false, message: 'That theme no longer exists.' };
}

export function registerThemesIpc({
  themes,
  presentations,
  revisions,
  fromOperator,
  changed,
  themesChanged,
}: ThemesIpcDeps): void {
  handle(IPC.themes.list, () => ({ themes: themes.list(), defaultId: themes.defaultId() }));

  handle(IPC.themes.save, (e, themeId, fields): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const saved = saveTheme(themes, themeId, fields);
    if (saved.ok) themesChanged();
    return saved;
  });

  // The default for new presentations (Session 26: in the Themes window too, not only the setup wizard).
  handle(IPC.themes.setDefault, (e, themeId): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(themeId);
    if (!id.success || !themes.setDefault(id.data))
      return { ok: false, message: 'That theme no longer exists.' };
    themesChanged();
    return { ok: true, id: id.data };
  });

  handle(IPC.themes.remove, (e, themeId): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const id = idSchema.safeParse(themeId);
    if (!id.success) return { ok: false, message: 'That theme no longer exists.' };
    if (id.data === themes.defaultId())
      return { ok: false, message: 'The default theme stays; change it instead.' };
    if (!themes.remove(id.data)) return { ok: false, message: 'That theme no longer exists.' };
    themesChanged();
    return { ok: true, id: id.data };
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
    const made = themes.create(fields, { kind: 'drashti', path: null });
    themesChanged();
    return { ok: true, id: made };
  });

  handle(IPC.themes.fromSlide, (e, name, slide): ThemeResult => {
    if (!fromOperator(e)) return onlyOperator;
    const n = z.string().trim().min(1).max(80).safeParse(name);
    const s = themeSlideSchema.safeParse(slide);
    if (!n.success || !s.success) return { ok: false, message: 'A theme cannot be made from that slide.' };
    const fields = themeFromContent(slideRows(s.data), n.data);
    if (!fields) return { ok: false, message: 'That slide has no words to make a theme from.' };
    const made = themes.create(fields, { kind: 'drashti', path: null });
    themesChanged();
    return { ok: true, id: made };
  });
}

/** A slide as the rows of a one-slide presentation, so a theme can be made from it as from a template. */
function slideRows(slide: ThemeSlide): ContentRows {
  return {
    presentationId: 'slide',
    width: slide.width,
    height: slide.height,
    selectedArrangementId: null,
    themeId: null,
    transition: null,
    loop: 0,
    groups: [{ id: 'g', name: '', color: null, position: 0 }],
    slides: [
      {
        id: 's',
        group_id: 'g',
        position: 0,
        label: '',
        notes: '',
        background: slide.background,
        transition: null,
        auto_advance_ms: null,
        enabled: 1,
        macro_id: null,
      },
    ],
    elements: slide.elements.map((el, position) => {
      const { id, kind, frame, rotation, ...props } = el;
      return {
        id,
        slide_id: 's',
        position,
        kind,
        x: frame.x,
        y: frame.y,
        width: frame.width,
        height: frame.height,
        rotation: rotation ?? 0,
        props: JSON.stringify(props),
      };
    }),
    cues: slide.cues.map((c, position) => ({
      id: c.id,
      slide_id: 's',
      position,
      kind: c.kind,
      label: c.label,
      media_id: c.mediaId,
      props: c.props,
    })),
    arrangements: [],
    arrangementEntries: [],
    kirtan: null,
    autoLines: [],
  };
}
