import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOPPED_REFUSAL } from '../../shared/access';
import { IPC } from '../../shared/ipc';
import { gateChannels, handle } from './handle';

/*
 * Every request from a window passes through handle() (Session 54, access by Gmail): while this computer is not let
 * in, only what the gate allows runs (the lock screen's, Quit, and a self-test's own pages but the operator window),
 * and anything else is refused with plain words before its handler runs, whatever page sent it and whatever devtools
 * typed into it. Electron's ipcMain is stood in for; the page is one of Drashti's own.
 */

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    },
    on: () => undefined,
  },
  app: { isPackaged: false, getPath: () => '/tmp' },
}));
vi.mock('../windows/renderer', () => ({
  devServerUrl: () => undefined,
  rendererDir: () => '/app/out/renderer',
}));

const from = (page: string, id = 1) =>
  ({
    senderFrame: { url: `file:///app/out/renderer/${page}` },
    sender: { id },
  }) as unknown as IpcMainInvokeEvent;

afterEach(() => {
  gateChannels(null);
});

describe('the gate before every request (Session 54)', () => {
  it('refuses a request the gate does not allow, before its handler runs, with plain words', async () => {
    const ran: string[] = [];
    handle(IPC.engine.command, () => {
      ran.push('command');
      return { ok: true, changed: true, rev: 1 };
    });
    handle(IPC.access.view, () => {
      ran.push('view');
      return null as never;
    });
    const letIn = { now: false };
    gateChannels((channel) => letIn.now || channel === IPC.access.view);
    const command = handlers.get(IPC.engine.command);
    const view = handlers.get(IPC.access.view);
    expect(() => command?.(from('index.html'), { type: 'toggleBlackout' })).toThrow(STOPPED_REFUSAL);
    await view?.(from('index.html'));
    expect(ran).toEqual(['view']);
    letIn.now = true;
    await command?.(from('index.html'), { type: 'toggleBlackout' });
    expect(ran).toEqual(['view', 'command']);
  });

  it('asks the gate with the request’s own channel and page', () => {
    const asked: [string, number][] = [];
    handle(IPC.library.listPresentations, () => []);
    gateChannels((channel, event) => {
      asked.push([channel, event.sender.id]);
      return false;
    });
    expect(() => handlers.get(IPC.library.listPresentations)?.(from('output.html', 7))).toThrow(
      STOPPED_REFUSAL,
    );
    expect(asked).toEqual([[IPC.library.listPresentations, 7]]);
  });

  it('still refuses a page that is not Drashti’s own first, whatever the gate says', () => {
    handle(IPC.app.getInfo, () => null as never);
    gateChannels(() => true);
    const strange = {
      senderFrame: { url: 'https://example.com/' },
      sender: { id: 2 },
    } as unknown as IpcMainInvokeEvent;
    expect(() => handlers.get(IPC.app.getInfo)?.(strange)).toThrow(/Refused/u);
  });
});
