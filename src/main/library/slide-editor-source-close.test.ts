import { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedSource } from '../../shared/editable-source';
import { SourceReaderQueue } from '../documents/source-reader-queue';
import { SlideEditorWindow } from './slide-editor-window';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    static all: Window[] = [];
    destroyed = false;
    webContents = Object.assign(new EventEmitter(), {
      id: 100 + Window.all.length,
      isDestroyed: () => this.destroyed,
      send: () => undefined,
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

describe('ordinary editor close and source work', () => {
  it('keeps work during a dirty close question, then cancels it when the real editor actually closes', async () => {
    // Lifecycle fake only: real parsing/fidelity remains covered by native/source tests.
    const owner = new AbortController();
    let runningSignal: AbortSignal | undefined;
    const queue = new SourceReaderQueue(
      (request) =>
        new Promise<PreparedSource>((resolve) => {
          runningSignal = request.signal;
          request.signal.addEventListener(
            'abort',
            () => resolve({ ok: false, message: 'Placeholder stopped' }),
            { once: true },
          );
        }),
    );
    const pending = queue.read({
      ext: 'pptx',
      file: '/Placeholder/source.pptx',
      outDir: '/Placeholder/output',
      sourcePages: [0],
      signal: owner.signal,
      checkpoint: () => Promise.resolve(true),
    });
    try {
      await vi.waitFor(() => expect(runningSignal).toBeDefined(), { interval: 1 });
      // No missing proposed method: the current constructor accepts this object,
      // but old behavior simply ignores the extra callback, yielding a state RED.
      const deps = Object.assign(
        {
          workArea: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
          background: () => '#202020',
          track: () => undefined,
          log: () => undefined,
        },
        { closed: () => owner.abort() },
      );
      const editor = new SlideEditorWindow(deps);
      editor.open({ presentationId: 'Placeholder presentation', slideId: null });
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) throw new Error('The real editor class did not create its window.');
      editor.setDirty(true);
      win.close();
      expect(win.isDestroyed()).toBe(false);
      expect(runningSignal?.aborted, 'a cancelled close question must not stop source work').toBe(false);
      editor.closeAsked();
      expect(win.isDestroyed()).toBe(true);
      expect(runningSignal?.aborted, 'closing the editor must abort its active source generation').toBe(true);
      expect((await pending).ok).toBe(false);
    } finally {
      owner.abort();
      await pending;
      await queue.stop();
    }
  });
});
