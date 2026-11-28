import type { BrowserWindow } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadPage, type RendererPage } from './renderer';

/*
 * The Undo line's test clock (QA23-UNDOLINE-1): only the operator window is told to hold it, only under
 * DRASHTI_TEST_UNDO_LINE, and never when Drashti is packaged.
 */

const settings = vi.hoisted(() => ({ packaged: false, asked: false }));
vi.mock('electron', () => ({ app: { runningUnderARM64Translation: false } }));
vi.mock('../switches', () => ({
  packaged: () => settings.packaged,
  sw: (name: string) => (name === 'DRASHTI_TEST_UNDO_LINE' && settings.asked ? '1' : undefined),
}));

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
});

it.each([
  ['index', false, true, true],
  ['index', false, false, false],
  ['index', true, true, false],
  ['slide-editor', false, true, false],
  ['output', false, true, false],
] as const)(
  'Undo line test clock gate: page=%s packaged=%s asked=%s enabled=%s',
  async (page: RendererPage, packaged, asked, enabled) => {
    settings.packaged = packaged;
    settings.asked = asked;
    const loadFile = vi.fn(() => Promise.resolve());
    const win = { loadFile, webContents: {} } as unknown as BrowserWindow;
    await loadPage(win, page);
    expect(loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: enabled ? { undoLineTest: '1' } : {},
    });
  },
);
