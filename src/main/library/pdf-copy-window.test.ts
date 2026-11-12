import { expect, it, vi } from 'vitest';
import { createPdfCopyWindow } from './pdf-copy-window';

const { makeWindow, getPrimaryDisplay } = vi.hoisted(() => ({
  makeWindow: vi.fn(function Window() {
    return { webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() } };
  }),
  getPrimaryDisplay: vi.fn(() => ({
    bounds: { x: 24, y: -96, width: 1366, height: 768 },
    scaleFactor: 1,
  })),
}));

vi.mock('electron', () => ({ BrowserWindow: makeWindow, screen: { getPrimaryDisplay } }));
vi.mock('../windows/renderer', () => ({ loadPage: vi.fn() }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));

it('anchors the hidden capture at the display’s top-left before the window grows', () => {
  createPdfCopyWindow();
  expect(makeWindow).toHaveBeenCalledWith(
    expect.objectContaining({ x: 24, y: -96, width: 320, height: 200, show: false }),
  );
});
