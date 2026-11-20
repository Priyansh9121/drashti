import type { BrowserWindow } from 'electron';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadPage, type RendererPage } from './renderer';

/*
 * The Wallpaper's picture drawn late, a test seam (Q60-31 (3), wallpaper-until-first-frame.spec.ts): every page is
 * given it only unpackaged and only when DRASHTI_TEST_WALLPAPER_LATE_MS is set; a packaged Drashti never passes it.
 */

const settings = vi.hoisted(() => ({ packaged: false, asked: false }));
vi.mock('electron', () => ({ app: { runningUnderARM64Translation: false } }));
vi.mock('../switches', () => ({
  packaged: () => settings.packaged,
  sw: (name: string) => (name === 'DRASHTI_TEST_WALLPAPER_LATE_MS' && settings.asked ? '600' : undefined),
}));

beforeEach(() => {
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
});

it.each([
  ['output', false, true, true],
  ['stream', false, true, true],
  ['index', false, true, true],
  ['output', false, false, false],
  ['output', true, true, false],
  ['stream', true, true, false],
  ['index', true, true, false],
] as const)(
  'the Wallpaper drawn late: page=%s packaged=%s asked=%s given=%s',
  async (page: RendererPage, packaged, asked, given) => {
    settings.packaged = packaged;
    settings.asked = asked;
    const loadFile = vi.fn(() => Promise.resolve());
    const win = { loadFile } as unknown as BrowserWindow;
    await loadPage(win, page);
    expect(loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: given ? { wallpaperLate: '600' } : {},
    });
  },
);
