import { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideEditorWindow } from '../library/slide-editor-window';
import { LowerThirdsStudio } from '../lower-thirds/studio-window';

/*
 * After a refused quit (bughunt S3-2): the slide editor and the Lower Thirds studio were told the quit had begun, so
 * their windows would close without their page's "Save changes?". The quit did not go ahead (a source that would not
 * stop in time), so each is told it is off: a window with changes not saved asks again before it closes, as before
 * the quit. A stand-in for Electron's windows (a close asks its 'close' listeners, then goes unless one prevented it).
 */

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static all: Window[] = [];
    destroyed = false;
    asked: string[] = [];
    webContents = Object.assign(new EventEmitter(), {
      id: 200 + Window.all.length,
      isDestroyed: () => this.destroyed,
      send: (channel: string) => {
        this.asked.push(channel);
      },
    });
    constructor(_options: unknown) {
      super();
      Window.all.push(this);
    }
    static getAllWindows() {
      return Window.all.filter((win) => !win.destroyed);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return false;
    }
    restore() {
      this.emit('restore');
    }
    focus() {
      this.emit('focus');
    }
    show() {
      this.emit('show');
    }
    close() {
      let prevented = false;
      const isPrevented = (): boolean => prevented;
      this.emit('close', {
        preventDefault: () => {
          prevented = true;
        },
      });
      if (!isPrevented()) this.destroy();
    }
    destroy() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
  }
  return { BrowserWindow: Window };
});
vi.mock('../ipc/handle', () => ({ handle: () => undefined }));
vi.mock('../windows/app-icon', () => ({ windowIcon: () => ({}) }));
vi.mock('../windows/renderer', () => ({ loadPage: () => Promise.resolve() }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));
afterEach(() => {
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
});

const deps = () => ({
  workArea: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
  background: () => '#202020',
  track: () => undefined,
  log: () => undefined,
});

/** The newest window made. */
function newest(): BrowserWindow {
  const win = BrowserWindow.getAllWindows().at(-1);
  if (!win) throw new Error('No window was made.');
  return win;
}

const editors = [
  {
    name: 'the slide editor',
    make: () => {
      const editor = new SlideEditorWindow(deps());
      editor.open({ presentationId: 'Placeholder presentation', slideId: null });
      return editor;
    },
  },
  {
    name: 'the Lower Thirds studio',
    make: () => {
      const studio = new LowerThirdsStudio(deps());
      studio.open(null);
      return studio;
    },
  },
];

describe('after a refused quit, an editor with changes not saved asks again before it closes (bughunt S3-2)', () => {
  for (const { name, make } of editors) {
    it(`${name}: as the quit goes ahead it closes without asking; told it is off, it asks again`, () => {
      const going = make();
      const goingWin = newest();
      going.setDirty(true);
      going.quitting();
      goingWin.close();
      expect(goingWin.isDestroyed(), 'a quit going ahead closes it without its question').toBe(true);

      const editor = make();
      const win = newest();
      editor.setDirty(true);
      editor.quitting();
      editor.cancelQuitting();
      win.close();
      expect(win.isDestroyed(), 'a refused quit leaves its changes not saved asked about').toBe(false);
      expect((win as unknown as { asked: string[] }).asked).toHaveLength(1);
      // Its page answered (saved, or Don't save): it closes then.
      editor.closeAsked();
      expect(win.isDestroyed()).toBe(true);
    });
  }
});
