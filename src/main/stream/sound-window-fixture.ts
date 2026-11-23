import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { vi } from 'vitest';

/** A separate generated sound page, loaded after Main has attached its lifecycle listeners. */
export function soundWindowFixture(): BrowserWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id: 999,
    isDestroyed: () => false,
    postMessage: vi.fn(),
    send: vi.fn(),
  });
  const win = Object.assign(new EventEmitter(), {
    webContents,
    getContentSize: () => [1920, 1080],
    isDestroyed: () => false,
    destroy: vi.fn(),
  });
  queueMicrotask(() => webContents.emit('did-finish-load'));
  return win as unknown as BrowserWindow;
}
