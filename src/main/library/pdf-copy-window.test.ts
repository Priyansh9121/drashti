import type { Rectangle } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { createPdfCopyWindow } from './pdf-copy-window';

const { makeWindow, primary, getAllDisplays, getDisplayMatching } = vi.hoisted(() => {
  const primary = {
    id: 1,
    bounds: { x: 24, y: -96, width: 1366, height: 768 },
    scaleFactor: 1,
  };
  return {
    makeWindow: vi.fn(function Window() {
      return { webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() } };
    }),
    primary,
    getAllDisplays: vi.fn(() => [primary]),
    getDisplayMatching: vi.fn((_rectangle: Rectangle) => primary),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: makeWindow,
  screen: { getPrimaryDisplay: () => primary, getAllDisplays, getDisplayMatching },
}));
vi.mock('../windows/renderer', () => ({ loadPage: vi.fn() }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));

beforeEach(() => {
  makeWindow.mockClear();
  getAllDisplays.mockReset().mockReturnValue([primary]);
  getDisplayMatching.mockReset().mockReturnValue(primary);
});

it('anchors the hidden capture at the display’s top-left before the window grows', () => {
  createPdfCopyWindow();
  expect(makeWindow).toHaveBeenCalledWith(
    expect.objectContaining({ x: 24, y: -96, width: 320, height: 200, show: false }),
  );
});

const openForPhone: (slide: { width: number; height: number }) => void = createPdfCopyWindow;

it('uses the stable display scale for a 4:3 phone capture on a laptop above a 2× TV', () => {
  const tv = {
    id: 2,
    bounds: { x: 24, y: 672, width: 1920, height: 1080 },
    scaleFactor: 2,
  };
  getAllDisplays.mockReturnValue([primary, tv]);
  const overlap = (a: Rectangle, b: Rectangle) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  getDisplayMatching.mockImplementation((rect) =>
    overlap(rect, primary.bounds) >= overlap(rect, tv.bounds) ? primary : tv,
  );

  openForPhone({ width: 960, height: 720 });
  expect(makeWindow).toHaveBeenCalledWith(
    expect.objectContaining({ x: tv.bounds.x, y: tv.bounds.y, width: 320, height: 200, show: false }),
  );
});

it('keeps the original top-left when neither display keeps its scale on growth', () => {
  const tv = { id: 2, bounds: { x: 24, y: 672, width: 1920, height: 1080 }, scaleFactor: 2 };
  getAllDisplays.mockReturnValue([primary, tv]);
  getDisplayMatching.mockImplementation((rect) => (rect.y === primary.bounds.y ? tv : primary));
  openForPhone({ width: 960, height: 720 });
  expect(makeWindow).toHaveBeenCalledWith(
    expect.objectContaining({ x: primary.bounds.x, y: primary.bounds.y, show: false }),
  );
});
