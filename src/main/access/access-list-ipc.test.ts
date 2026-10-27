import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { NO_VIEW } from '../../shared/access-list';
import { ACCESS_ERROR_TEXT } from '../../shared/access-protocol';
import { IPC } from '../../shared/ipc';
import type { AccessList } from './access-list';
import { handleAccessList } from './access-list-ipc';

/*
 * The Access List's channels (Session 54, E4): only its own page is answered, and only with arguments of the
 * right shape. A request from any other page (the operator window, say) is refused before the Access List is
 * asked anything, so nothing reaches the list. The handlers are stood in for Electron's ipcMain.
 */

const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));

const PAGE = 7;
const OPERATOR = 1;
const from = (id: number) => ({ sender: { id } }) as unknown as IpcMainInvokeEvent;
const PERSON = 'placeholder.user@example.com';

function setUp() {
  handlers.clear();
  const asked: string[] = [];
  const done = (what: string) => {
    asked.push(what);
    return Promise.resolve({ ok: true, message: 'Done', view: NO_VIEW });
  };
  const list = {
    view: () => {
      asked.push('view');
      return { people: [], updatedAt: 1, problem: null };
    },
    refresh: () => {
      asked.push('refresh');
      return Promise.resolve(NO_VIEW);
    },
    add: (f: { gmail: string }) => done(`add ${f.gmail}`),
    approve: (t: string) => done(`approve ${t}`),
    reject: (t: string) => done(`reject ${t}`),
    revoke: (t: string) => done(`revoke ${t}`),
    regrant: (t: string) => done(`regrant ${t}`),
    note: (t: string, n: string) => done(`note ${t} ${n}`),
    exportCsv: (g: string[]) => {
      asked.push(`csv ${g.join(' ')}`);
      return Promise.resolve({ ok: true, message: 'Saved' });
    },
  } as unknown as AccessList;
  handleAccessList({ list, isPage: (e) => e.sender.id === PAGE });
  const call = (channel: string, id: number, ...args: unknown[]) =>
    handlers.get(channel)?.(from(id), ...args);
  return { asked, call };
}

const refused = { ok: false, message: ACCESS_ERROR_TEXT['not-owner'], view: NO_VIEW };

describe('the Access List’s channels', () => {
  it('answer its own page', async () => {
    const { asked, call } = setUp();
    expect(call(IPC.accessList.view, PAGE)).toEqual({ people: [], updatedAt: 1, problem: null });
    await call(IPC.accessList.refresh, PAGE);
    await call(IPC.accessList.add, PAGE, { gmail: PERSON, name: '', note: '', approve: false });
    await call(IPC.accessList.approve, PAGE, PERSON);
    await call(IPC.accessList.reject, PAGE, PERSON);
    await call(IPC.accessList.revoke, PAGE, PERSON);
    await call(IPC.accessList.regrant, PAGE, PERSON);
    await call(IPC.accessList.note, PAGE, PERSON, 'Placeholder note');
    await call(IPC.accessList.exportCsv, PAGE, [PERSON]);
    expect(asked).toEqual([
      'view',
      'refresh',
      `add ${PERSON}`,
      `approve ${PERSON}`,
      `reject ${PERSON}`,
      `revoke ${PERSON}`,
      `regrant ${PERSON}`,
      `note ${PERSON} Placeholder note`,
      `csv ${PERSON}`,
    ]);
  });

  it('refuse every other page, asking the Access List nothing', async () => {
    const { asked, call } = setUp();
    expect(call(IPC.accessList.view, OPERATOR)).toEqual(NO_VIEW);
    expect(call(IPC.accessList.refresh, OPERATOR)).toEqual(NO_VIEW);
    expect(
      await call(IPC.accessList.add, OPERATOR, { gmail: PERSON, name: '', note: '', approve: true }),
    ).toEqual(refused);
    for (const channel of [
      IPC.accessList.approve,
      IPC.accessList.reject,
      IPC.accessList.revoke,
      IPC.accessList.regrant,
    ])
      expect(await call(channel, OPERATOR, PERSON), channel).toEqual(refused);
    expect(await call(IPC.accessList.note, OPERATOR, PERSON, 'Placeholder note')).toEqual(refused);
    expect(await call(IPC.accessList.exportCsv, OPERATOR, [PERSON])).toEqual({
      ok: false,
      message: ACCESS_ERROR_TEXT['not-owner'],
    });
    expect(asked).toEqual([]);
  });

  it('refuse arguments of any other shape, from its own page too', async () => {
    const { asked, call } = setUp();
    expect(await call(IPC.accessList.add, PAGE, { gmail: PERSON })).toEqual(refused);
    expect(await call(IPC.accessList.add, PAGE, 'placeholder')).toEqual(refused);
    expect(await call(IPC.accessList.revoke, PAGE, { gmail: PERSON })).toEqual(refused);
    expect(await call(IPC.accessList.revoke, PAGE, 'x'.repeat(400))).toEqual(refused);
    expect(await call(IPC.accessList.note, PAGE, PERSON, 42)).toEqual(refused);
    expect(await call(IPC.accessList.exportCsv, PAGE, PERSON)).toMatchObject({ ok: false });
    expect(asked).toEqual([]);
  });

  it('are every channel of the Access List', () => {
    setUp();
    expect([...handlers.keys()].sort()).toEqual(
      Object.values(IPC.accessList)
        .filter((c) => c !== IPC.accessList.changed)
        .sort(),
    );
  });
});
