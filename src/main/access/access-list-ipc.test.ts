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
      return { people: [], updatedAt: 1, listTime: 2, problem: null };
    },
    refresh: () => {
      asked.push('refresh');
      return Promise.resolve(NO_VIEW);
    },
    add: (f: { gmail: string; length: unknown }) => done(`add ${f.gmail} ${String(f.length)}`),
    approve: (t: string, l: unknown) => done(`approve ${t} ${String(l)}`),
    reject: (t: string) => done(`reject ${t}`),
    revoke: (t: string) => done(`revoke ${t}`),
    regrant: (t: string, l: unknown) => done(`regrant ${t} ${String(l)}`),
    changeLength: (t: string, l: unknown) => done(`length ${t} ${String(l)}`),
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
    expect(call(IPC.accessList.view, PAGE)).toEqual({ people: [], updatedAt: 1, listTime: 2, problem: null });
    await call(IPC.accessList.refresh, PAGE);
    await call(IPC.accessList.add, PAGE, { gmail: PERSON, name: '', note: '', approve: false, length: 30 });
    await call(IPC.accessList.approve, PAGE, PERSON, 'unlimited');
    await call(IPC.accessList.reject, PAGE, PERSON);
    await call(IPC.accessList.revoke, PAGE, PERSON);
    await call(IPC.accessList.regrant, PAGE, PERSON, 7);
    await call(IPC.accessList.changeLength, PAGE, PERSON, 730);
    await call(IPC.accessList.note, PAGE, PERSON, 'Placeholder note');
    await call(IPC.accessList.exportCsv, PAGE, [PERSON]);
    expect(asked).toEqual([
      'view',
      'refresh',
      `add ${PERSON} 30`,
      `approve ${PERSON} unlimited`,
      `reject ${PERSON}`,
      `revoke ${PERSON}`,
      `regrant ${PERSON} 7`,
      `length ${PERSON} 730`,
      `note ${PERSON} Placeholder note`,
      `csv ${PERSON}`,
    ]);
  });

  it('refuse every other page, asking the Access List nothing', async () => {
    const { asked, call } = setUp();
    expect(call(IPC.accessList.view, OPERATOR)).toEqual(NO_VIEW);
    expect(call(IPC.accessList.refresh, OPERATOR)).toEqual(NO_VIEW);
    expect(
      await call(IPC.accessList.add, OPERATOR, {
        gmail: PERSON,
        name: '',
        note: '',
        approve: true,
        length: 'unlimited',
      }),
    ).toEqual(refused);
    for (const channel of [
      IPC.accessList.approve,
      IPC.accessList.reject,
      IPC.accessList.revoke,
      IPC.accessList.regrant,
      IPC.accessList.changeLength,
    ])
      expect(await call(channel, OPERATOR, PERSON, 'unlimited'), channel).toEqual(refused);
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
    // A length the list does not give, or none at all, is never sent on.
    for (const length of [0, 731, 2.5, 'Unlimited', '30', null, undefined]) {
      expect(await call(IPC.accessList.approve, PAGE, PERSON, length)).toEqual(refused);
      expect(await call(IPC.accessList.regrant, PAGE, PERSON, length)).toEqual(refused);
      expect(await call(IPC.accessList.changeLength, PAGE, PERSON, length)).toEqual(refused);
      expect(
        await call(IPC.accessList.add, PAGE, { gmail: PERSON, name: '', note: '', approve: true, length }),
      ).toEqual(refused);
    }
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
