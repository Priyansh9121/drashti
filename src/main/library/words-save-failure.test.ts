import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { DEFAULT_THEME } from '../../shared/themes';
import { openDatabase, type Db } from '../db/database';
import { PresentationRepo } from '../db/presentations';
import { textSlide } from '../engine/testing';
import { Revisions } from './revisions';
import { themeLook } from './themes';
import { registerWordsIpc } from './words-ipc';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
}));

let db: Db | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  handlers.clear();
  db?.close();
});

function setup() {
  db = openDatabase(':memory:');
  const presentations = new PresentationRepo(db);
  const libraryId = presentations.ensureLibrary('Default');
  const id = presentations.insert({
    libraryId,
    name: 'Placeholder existing',
    groups: [{ name: 'Verse', slides: [{ elements: textSlide('s1', 'Placeholder kept').elements }] }],
  });
  const changed = vi.fn();
  const styleNew = vi.fn();
  registerWordsIpc({
    db,
    presentations,
    revisions: new Revisions(),
    fromOperator: () => true,
    lookFor: (_theme, size) => themeLook({ ...DEFAULT_THEME }, size.width, size.height),
    changed,
    styleNew,
  });
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)?.({}, ...args);
  return { db, presentations, id, call, changed, styleNew };
}

describe('words saved when the drive fills', () => {
  it('returns a full-drive refusal for new words instead of rejecting the editor request', () => {
    const t = setup();
    vi.spyOn(t.presentations, 'insert').mockImplementation(() => {
      throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    });
    expect(t.call(IPC.library.newFromWords, 'Placeholder new', 'Placeholder words')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/drive.*full|space/iu) as unknown,
    });
    expect(t.changed).not.toHaveBeenCalled();
    expect(t.styleNew).not.toHaveBeenCalled();
  });

  it('refuses edited words without losing the old content or announcing a change', () => {
    const t = setup();
    const before = t.presentations.content(t.id);
    vi.spyOn(t.presentations, 'setContent').mockImplementation(() => {
      throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    });
    expect(t.call(IPC.library.saveWords, t.id, 'Placeholder replacement')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/drive.*full|space/iu) as unknown,
    });
    expect(t.presentations.content(t.id)).toEqual(before);
    expect(t.changed).not.toHaveBeenCalled();
  });

  it('rolls back a new presentation if the drive fills while its look is saved', () => {
    const t = setup();
    const count = () => (t.db.prepare('SELECT count(*) AS n FROM presentations').get() as { n: number }).n;
    const before = count();
    t.styleNew.mockImplementation(() => {
      throw Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
    });
    let result: unknown;
    try {
      result = t.call(IPC.library.newFromWords, 'Placeholder new', 'Placeholder words');
    } catch {
      // The old handler rejects too; the row count independently proves the partial save.
    }
    expect(count(), 'an unsuccessful save must not leave a second presentation to duplicate on retry').toBe(
      before,
    );
    expect(result).toMatchObject({ ok: false });
    expect(t.changed).not.toHaveBeenCalled();
    t.styleNew.mockReset();
    expect(t.call(IPC.library.newFromWords, 'Placeholder new', 'Placeholder words')).toMatchObject({
      ok: true,
    });
    expect(count()).toBe(before + 1);
    expect(t.changed).toHaveBeenCalledOnce();
  });
});
