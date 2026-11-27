import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeFor } from '../../preload/page-groups';
import { IPC } from '../../shared/ipc';
import { gateChannels, handle, handleSync, lockChannels, tellRequests } from '../ipc/handle';
import { loadPage, rendererDir } from '../windows/renderer';

type Request = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type SyncRequest = (event: IpcMainEvent, ...args: unknown[]) => void;
const callbacks = vi.hoisted(() => ({
  invoke: new Map<string, Request>(),
  sync: new Map<string, SyncRequest>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, callback: Request) => callbacks.invoke.set(channel, callback),
    on: (channel: string, callback: SyncRequest) => callbacks.sync.set(channel, callback),
  },
  app: { runningUnderARM64Translation: false },
}));
vi.mock('../switches', () => ({ packaged: () => true, sw: () => undefined }));

let nextId = 100;
/** Main assigns a role through its actual loadPage; a page cannot assign itself a role. */
function windowFixture() {
  const frame = { url: 'about:blank' };
  const contents = Object.assign(new EventEmitter(), {
    id: nextId++,
    mainFrame: frame,
    getURL: () => frame.url,
    isDestroyed: () => false,
  });
  const window = {
    webContents: contents,
    isDestroyed: () => false,
    loadFile: (file: string) => {
      frame.url = pathToFileURL(file).href;
      return Promise.resolve();
    },
    loadURL: (url: string) => {
      frame.url = url;
      return Promise.resolve();
    },
  } as unknown as BrowserWindow;
  const event = () => ({ sender: contents, senderFrame: frame }) as unknown as IpcMainInvokeEvent;
  return { window, contents, frame, event };
}

function request(channel: string, event: IpcMainInvokeEvent): unknown {
  const callback = callbacks.invoke.get(channel);
  if (!callback) throw new Error('The test did not register its handler.');
  return callback(event);
}

afterEach(() => {
  callbacks.invoke.clear();
  callbacks.sync.clear();
  gateChannels(null);
  lockChannels(() => false, new Map());
  tellRequests(null);
});

describe('alpha.24 IPC authority', () => {
  it('keeps an assigned operator main frame working', async () => {
    const operator = windowFixture();
    await loadPage(operator.window, 'index');
    const quit = vi.fn();
    handle(IPC.access.quit, () => {
      quit();
      return null;
    });
    expect(request(IPC.access.quit, operator.event())).toBeNull();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('refuses an unregistered contents object even when its URL names the operator page', () => {
    const stranger = windowFixture();
    stranger.frame.url = pathToFileURL(join(rendererDir(), 'index.html')).href;
    const quit = vi.fn();
    handle(IPC.access.quit, () => {
      quit();
      return null;
    });
    expect(() => request(IPC.access.quit, stranger.event())).toThrow(/Refused/u);
    expect(quit).not.toHaveBeenCalled();
  });

  it('refuses an own-page child frame inside the assigned operator window', async () => {
    const operator = windowFixture();
    await loadPage(operator.window, 'index');
    const child = { ...operator.event(), senderFrame: { url: operator.frame.url } };
    const quit = vi.fn();
    handle(IPC.access.quit, () => {
      quit();
      return null;
    });
    expect(() => request(IPC.access.quit, child as IpcMainInvokeEvent)).toThrow(/Refused/u);
    expect(quit).not.toHaveBeenCalled();
  });

  it('refuses an operator channel from an assigned output window', async () => {
    const output = windowFixture();
    await loadPage(output.window, 'output');
    const quit = vi.fn();
    handle(IPC.access.quit, () => {
      quit();
      return null;
    });
    expect(() => request(IPC.access.quit, output.event())).toThrow(/Refused/u);
    expect(quit).not.toHaveBeenCalled();
  });

  it('does not promote an output to operator when that renderer changes to index.html', async () => {
    const output = windowFixture();
    await loadPage(output.window, 'output');
    // secureWebContents currently permits navigation between the app's own pages.
    output.frame.url = pathToFileURL(join(rendererDir(), 'index.html')).href;
    const quit = vi.fn();
    handle(IPC.access.quit, () => {
      quit();
      return null;
    });
    expect(() => request(IPC.access.quit, output.event())).toThrow(/Refused/u);
    expect(quit).not.toHaveBeenCalled();
  });

  it('answers synchronous IPC only to an assigned main frame', async () => {
    const operator = windowFixture();
    await loadPage(operator.window, 'index');
    const answer = vi.fn(() => ({ id: 'placeholder' }));
    handleSync(IPC.appearance.now, answer);
    const callback = callbacks.sync.get(IPC.appearance.now);
    if (!callback) throw new Error('The test did not register its sync handler.');
    const own = { ...operator.event(), returnValue: undefined } as unknown as IpcMainEvent;
    callback(own);
    expect(own.returnValue).toEqual({ id: 'placeholder' });
    const child = {
      ...operator.event(),
      senderFrame: { url: operator.frame.url },
      returnValue: undefined,
    } as unknown as IpcMainEvent;
    callback(child);
    expect(child.returnValue).toBeNull();
    expect(answer).toHaveBeenCalledOnce();
  });

  it('does not let main accidentally reassign an existing output to operator', async () => {
    const output = windowFixture();
    await loadPage(output.window, 'output');
    expect(() => loadPage(output.window, 'index')).toThrow(/Refused/u);
  });

  it('fails closed for an unlisted synchronous channel even from an assigned operator', async () => {
    const operator = windowFixture();
    await loadPage(operator.window, 'index');
    const answer = vi.fn(() => 'placeholder');
    const channel = 'placeholder:unlisted';
    handleSync(channel, answer);
    const callback = callbacks.sync.get(channel);
    if (!callback) throw new Error('The test did not register its sync handler.');
    const event = { ...operator.event(), returnValue: undefined } as unknown as IpcMainEvent;
    callback(event);
    expect(event.returnValue).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it('never includes an untrusted URL credential in a refusal error', () => {
    const stranger = windowFixture();
    const marker = 'placeholder-credential-only';
    stranger.frame.url = `https://example.invalid/index.html?token=${marker}`;
    handle(IPC.access.quit, () => null);
    let failure: unknown;
    try {
      request(IPC.access.quit, stranger.event());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/Refused/u);
    expect(String(failure)).not.toContain(marker);
    expect(String(failure)).not.toContain('example.invalid');
  });
});

describe('alpha.24 preload least authority', () => {
  it('keeps a display read API while withholding operator mutations in the same group', () => {
    const looks = vi.fn();
    const remove = vi.fn();
    const setPlayback = vi.fn();
    const bridge = bridgeFor({ media: { looks, remove, setPlayback } }, 'output');
    expect(bridge.media?.looks).toBe(looks);
    expect(bridge.media).not.toHaveProperty('remove');
    expect(bridge.media).not.toHaveProperty('setPlayback');
  });
});
