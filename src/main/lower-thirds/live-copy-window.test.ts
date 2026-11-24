import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVE_COPY_FPS, LIVE_COPY_QUERY } from './live-copy';
import { createLiveCopyWindow } from './live-copy-window';

/*
 * Live's copy's window (alpha.23): the screens' page off screen, muted, drawn once a second, each picture kept for
 * Live's next still; its page gone, Live is told; closed, it is gone at once.
 */

const { made, loads } = vi.hoisted(() => ({
  made: [] as {
    options: { webPreferences?: { offscreen?: unknown } };
    muted: boolean;
    frameRate: number | null;
    destroyed: boolean;
    listeners: Map<string, (...args: unknown[]) => void>;
  }[],
  loads: [] as { page: string; query: Record<string, string> }[],
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function Window(options: { webPreferences?: { offscreen?: unknown } }) {
    const win = {
      options,
      muted: false,
      frameRate: null as number | null,
      destroyed: false,
      listeners: new Map<string, (...args: unknown[]) => void>(),
    };
    made.push(win);
    return {
      isDestroyed: () => win.destroyed,
      destroy: () => {
        win.destroyed = true;
      },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        win.listeners.set(`window:${event}`, listener);
      },
      webContents: {
        setAudioMuted: (muted: boolean) => {
          win.muted = muted;
        },
        setFrameRate: (fps: number) => {
          win.frameRate = fps;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          win.listeners.set(event, listener);
        },
      },
    };
  }),
}));
vi.mock('../windows/renderer', () => ({
  loadPage: (_win: unknown, page: string, query: Record<string, string>) => {
    loads.push({ page, query });
    return Promise.resolve();
  },
}));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({ sandbox: true }) }));

const picture = (empty: boolean) => ({
  isEmpty: () => empty,
  getSize: () => ({ width: 960, height: 540 }),
  resize: () => picture(empty),
  toJPEG: () => Buffer.from('x'),
});

describe('Live’s copy’s window', () => {
  beforeEach(() => {
    made.length = 0;
    loads.length = 0;
  });

  it('is the screens’ page off screen, muted, drawn once a second, without a warm-up', () => {
    const { copy } = createLiveCopyWindow(() => undefined);
    expect(made).toHaveLength(1);
    const w = made[0];
    expect(w?.options.webPreferences?.offscreen).toBe(true);
    expect(w?.muted).toBe(true);
    expect(w?.frameRate).toBe(LIVE_COPY_FPS);
    expect(loads).toEqual([{ page: 'output', query: { [LIVE_COPY_QUERY]: '1', warmUp: 'skip' } }]);
    expect(copy.isDestroyed()).toBe(false);
  });

  it('keeps its last picture drawn (none before the first, an empty one is none)', () => {
    const { copy } = createLiveCopyWindow(() => undefined);
    const paint = made[0]?.listeners.get('paint');
    expect(paint).toBeDefined();
    expect(copy.latest()).toBeNull();
    const first = picture(false);
    paint?.({}, { x: 0, y: 0, width: 960, height: 540 }, first);
    expect(copy.latest()).toBe(first);
    paint?.({}, { x: 0, y: 0, width: 10, height: 10 }, picture(true));
    expect(copy.latest()).toBe(first);
    const next = picture(false);
    paint?.({}, { x: 0, y: 0, width: 960, height: 540 }, next);
    expect(copy.latest()).toBe(next);
  });

  it('its page gone: Live is told; closed: gone at once, and its last picture with it', () => {
    const gone = vi.fn();
    const { copy } = createLiveCopyWindow(gone);
    made[0]?.listeners.get('render-process-gone')?.({}, { reason: 'crashed' });
    expect(gone).toHaveBeenCalledTimes(1);
    made[0]?.listeners.get('paint')?.({}, { x: 0, y: 0, width: 960, height: 540 }, picture(false));
    copy.close();
    expect(made[0]?.destroyed).toBe(true);
    expect(copy.isDestroyed()).toBe(true);
    expect(copy.latest()).toBeNull();
    // Closed twice is nothing more.
    copy.close();
  });
});
