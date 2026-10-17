import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditSlidesResult, SaveSlidesResult } from '../../shared/slide-edit';
import { DEFAULT_THEME } from '../../shared/themes';
import { openDatabase } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { textSlide } from '../engine/testing';
import { Revisions } from './revisions';
import { registerSlidesIpc } from './slides-ipc';
import { themeLook } from './themes';

/*
 * The slide editor's guard (Sessions 31–36, TST-11's races): the editor saves only over the presentation it
 * opened. Whichever comes first, the editor's save or another change (an import, Edit words, a theme), the
 * later one never quietly undoes the earlier: a save over a presentation changed since the editor opened it
 * is refused (changedElsewhere), even when the other change landed in the same millisecond as the opening.
 * Placeholder words only.
 */

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
}));

const OPERATOR = {} as never;

function setup() {
  const db = openDatabase(':memory:');
  const presentations = new PresentationRepo(db);
  const lib = presentations.ensureLibrary('Placeholder');
  const id = presentations.insert({
    libraryId: lib,
    name: 'Placeholder',
    groups: [{ name: 'Verse', slides: [{ elements: textSlide('s1', 'Placeholder one').elements }] }],
  });
  registerSlidesIpc({
    db,
    presentations,
    revisions: new Revisions(),
    settings: new SettingsRepo(db),
    fromOperator: () => true,
    lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
    changed: () => undefined,
  });
  const call = (channel: string, ...args: unknown[]): unknown => handlers.get(channel)?.(OPERATOR, ...args);
  const open = () => {
    const r = call('library:slides-for-edit', id) as EditSlidesResult;
    if (!r.ok) throw new Error(r.message);
    return r;
  };
  const words = (r: EditSlidesResult & { ok: true }, text: string) => {
    const doc = structuredClone(r.doc);
    const box = doc.groups[0]?.slides[0]?.elements.find((e) => e.kind === 'text');
    if (box?.kind === 'text') {
      box.text = text;
      delete box.runs;
    }
    return doc;
  };
  const save = (r: EditSlidesResult & { ok: true }, text: string) =>
    call('library:save-slides', id, words(r, text), r.stamp) as SaveSlidesResult;
  /** Another change to the presentation (an import, Edit words, a theme): its content written again. */
  const elsewhere = () => {
    const rows = presentations.content(id);
    if (!rows) throw new Error('gone');
    presentations.setContent(rows);
  };
  const stored = () => {
    const r = open();
    const box = r.doc.groups[0]?.slides[0]?.elements.find((e) => e.kind === 'text');
    return box?.kind === 'text' ? box.text : '';
  };
  return { db, id, open, save, elsewhere, stored };
}

beforeEach(() => {
  handlers.clear();
});

describe('the slide editor’s guard', () => {
  it('another change after the editor opened: the editor’s save is refused, and keeps nothing', () => {
    const t = setup();
    const opened = t.open();
    t.elsewhere();
    expect(t.save(opened, 'Placeholder from the editor')).toMatchObject({
      ok: false,
      changedElsewhere: true,
    });
    expect(t.stored()).toBe('Placeholder one');
  });

  it('the editor saving first: its words are kept, and its old stamp is no good after', () => {
    const t = setup();
    const opened = t.open();
    expect(t.save(opened, 'Placeholder from the editor')).toMatchObject({ ok: true });
    t.elsewhere();
    expect(t.stored()).toBe('Placeholder from the editor');
    expect(t.save(opened, 'Placeholder again')).toMatchObject({ ok: false, changedElsewhere: true });
  });

  it('another change in the same millisecond as the opening is still seen', () => {
    const t = setup();
    const opened = t.open();
    const at = (
      t.db.prepare('SELECT updated_at FROM presentations WHERE id = ?').get(t.id) as { updated_at: string }
    ).updated_at;
    t.elsewhere();
    // As if both landed in the same millisecond: the time the stamp was taken at is the time it says again.
    t.db.prepare('UPDATE presentations SET updated_at = ? WHERE id = ?').run(at, t.id);
    expect(t.save(opened, 'Placeholder from the editor')).toMatchObject({
      ok: false,
      changedElsewhere: true,
    });
  });
});
