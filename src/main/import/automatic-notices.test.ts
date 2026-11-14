import { describe, expect, it, vi } from 'vitest';
import { automaticImportNotices, loadsOperatorPageAgain } from './automatic-notices';

it('keeps a notice when the old operator page goes away before it can receive it', () => {
  const send = vi.fn(() => false);
  const notices = automaticImportNotices(send);
  expect(notices.take()).toEqual([]);
  const notice = { runId: 'placeholder-import' };
  notices.publish(notice);
  expect(send).toHaveBeenCalledOnce();
  expect(notices.take()).toEqual([notice]);
  expect(notices.take()).toEqual([]);
});

it('delivers notices produced during a reload once the new page asks', () => {
  const send = vi.fn(() => true);
  const notices = automaticImportNotices(send);
  const before = { runId: 'placeholder-before-reload' };
  const during = { runId: 'placeholder-during-reload' };
  const after = { runId: 'placeholder-after-reload' };
  expect(notices.take()).toEqual([]);
  notices.publish(before);
  expect(send).toHaveBeenCalledWith(before);
  notices.pause();
  notices.publish(during);
  expect(send).toHaveBeenCalledTimes(1);
  expect(notices.take()).toEqual([during]);
  notices.publish(after);
  expect(send).toHaveBeenNthCalledWith(2, after);
  expect(notices.take()).toEqual([]);
});

it('keeps the newest 50 notices until the operator page is ready', () => {
  const send = vi.fn(() => true);
  const notices = automaticImportNotices(send);
  const all = Array.from({ length: 55 }, (_, i) => ({ runId: 'placeholder-' + String(i) }));
  for (const notice of all) notices.publish(notice);
  expect(send).not.toHaveBeenCalled();
  expect(notices.take()).toEqual(all.slice(-50));
});

/*
 * When the operator window starts loading a page, its automatic notices wait for the new page's ask (Session 57, IM-3)
 * only when that page is Drashti's own, loaded again (a reload, or the watchdog's after a crash): as the window's
 * navigation guard tells (windows/navigation.ts). A navigation within the page, a frame's, or one to any other address
 * leaves them going: the guard blocks such an address, the page stays, and no new page ever asks (the review of 13 Nov,
 * L1: it held every automatic notice until the next reload). The hook in index.ts asks this, and nothing else.
 */
describe('which navigation of the operator window holds its automatic notices', () => {
  const mac = { rendererDir: '/Applications/Drashti.app/Contents/Resources/app.asar/out/renderer' };
  const win = { rendererDir: 'C:\\Program Files\\Drashti\\resources\\app.asar\\out\\renderer' };
  const dev = { ...mac, devServerUrl: 'http://localhost:5173' };
  const page = (url: string, more: { isMainFrame?: boolean; isSameDocument?: boolean } = {}) => ({
    url,
    isMainFrame: more.isMainFrame ?? true,
    isSameDocument: more.isSameDocument ?? false,
  });
  const built = 'file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/index.html';

  it('the window’s own page loading again: the built page on the Mac and on Windows, and the dev server’s', () => {
    expect(loadsOperatorPageAgain(page(built), mac)).toBe(true);
    expect(
      loadsOperatorPageAgain(
        page('file:///C:/Program%20Files/Drashti/resources/app.asar/out/renderer/index.html'),
        win,
      ),
    ).toBe(true);
    expect(loadsOperatorPageAgain(page('http://localhost:5173/'), dev)).toBe(true);
  });

  it('never an address the guard blocks, a file outside Drashti, a move within the page or a frame’s', () => {
    expect(loadsOperatorPageAgain(page('https://example.com/'), mac)).toBe(false);
    expect(loadsOperatorPageAgain(page('https://example.com/'), dev)).toBe(false);
    expect(loadsOperatorPageAgain(page('file:///Users/placeholder/Desktop/Placeholder.html'), mac)).toBe(
      false,
    );
    expect(loadsOperatorPageAgain(page('http://localhost:5173/'), mac)).toBe(false);
    expect(loadsOperatorPageAgain(page(`${built}#media`, { isSameDocument: true }), mac)).toBe(false);
    expect(loadsOperatorPageAgain(page(built, { isMainFrame: false }), mac)).toBe(false);
    expect(loadsOperatorPageAgain(page('not an address'), mac)).toBe(false);
  });

  it('a blocked navigation leaves the notices going; a reload holds them for the new page', () => {
    const send = vi.fn(() => true);
    const notices = automaticImportNotices(send);
    const navigate = (url: string) => {
      if (loadsOperatorPageAgain(page(url), mac)) notices.pause();
    };
    const blocked = { runId: 'placeholder-after-a-blocked-address' };
    const reloading = { runId: 'placeholder-during-a-reload' };
    expect(notices.take()).toEqual([]);
    navigate('https://example.com/');
    notices.publish(blocked);
    expect(send).toHaveBeenCalledWith(blocked);
    navigate(built);
    notices.publish(reloading);
    expect(send).toHaveBeenCalledTimes(1);
    expect(notices.take()).toEqual([reloading]);
  });
});
