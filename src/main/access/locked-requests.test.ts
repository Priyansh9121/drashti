import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { mayRunWhileLocked } from './locked-requests';

/*
 * The requests that run while this computer is not let in (Session 54, locked-requests.ts): the lock screen's and
 * Quit from any page; Drashti's own screens' reads and reports, which decide nothing; nothing else, and never the
 * operator window's, whatever page it shows.
 */

const page = (name: string) =>
  `file:///Applications/Drashti.app/Contents/Resources/app.asar/out/renderer/${name}`;

describe('requests while not let in (Session 54)', () => {
  it('lets the lock screen and Quit run from any page', () => {
    for (const channel of [IPC.access.view, IPC.access.redeem, IPC.access.quit, IPC.app.getInfo])
      for (const url of [page('lock.html'), page('index.html')])
        expect(mayRunWhileLocked(channel, { url, operatorWindow: url.includes('index') }), channel).toBe(
          true,
        );
  });

  it('refuses every control, the operator window’s above all, whatever page it shows', () => {
    for (const channel of [IPC.engine.command, IPC.library.listPresentations, IPC.screens.createGroup]) {
      expect(mayRunWhileLocked(channel, { url: page('index.html'), operatorWindow: true })).toBe(false);
      // Even had it been made to show a screen's page.
      expect(mayRunWhileLocked(channel, { url: page('output.html'), operatorWindow: true })).toBe(false);
      expect(mayRunWhileLocked(channel, { url: page('lock.html'), operatorWindow: false })).toBe(false);
      expect(mayRunWhileLocked(channel, { url: page('gallery.html'), operatorWindow: false })).toBe(false);
    }
  });

  it('lets Drashti’s own screens keep drawing and reporting, but never answer the operator’s questions', () => {
    for (const name of ['output.html', 'audio.html', 'stream.html', 'zoom.html'])
      expect(mayRunWhileLocked(IPC.engine.snapshot, { url: page(name), operatorWindow: false }), name).toBe(
        true,
      );
    expect(mayRunWhileLocked(IPC.output.report, { url: page('output.html'), operatorWindow: false })).toBe(
      true,
    );
    for (const channel of [IPC.output.switchAnswer, IPC.output.keepAnswer])
      expect(mayRunWhileLocked(channel, { url: page('output.html'), operatorWindow: false })).toBe(false);
    // A page that is not Drashti's: nothing.
    expect(
      mayRunWhileLocked(IPC.engine.snapshot, { url: 'https://example.com/', operatorWindow: false }),
    ).toBe(false);
  });
});
