import { describe, expect, it } from 'vitest';
import type { Layers } from '../../shared/engine/state';
import type { ScreenConfig, ScreenGroupConfig } from '../../shared/screens';
import {
  LIVE_COPY_FPS,
  LIVE_COPY_QUERY,
  LIVE_COPY_SCREEN_ID,
  LIVE_COPY_SIZE,
  LiveCopy,
  type LiveCopyWindow,
  liveCopyContext,
  liveCopyOptions,
  liveCopyQuery,
  unseenInCopy,
} from './live-copy';
import type { CapturedImage } from './studio-live';

/*
 * Live's copy (alpha.23, lead 2's choice A for the owner's Live with no hall screen): with no audience screen showing
 * on this computer, Live's still comes from the screens' own page drawn off screen, 960 x 540, about once a second,
 * muted; opened only when a still is asked for (Live chosen, the studio in sight) and closed on every other change.
 * It is no screen: never counted, never reporting, never reaching a node, never warming up for long.
 */

const image = (width = 960): CapturedImage => ({
  isEmpty: () => false,
  getSize: () => ({ width, height: Math.round((width * 9) / 16) }),
  resize: () => image(width),
  toJPEG: () => Buffer.from('jpeg'),
});

function fakeWindows() {
  const made: { drawn: CapturedImage | null; closed: boolean; gone: () => void }[] = [];
  let quitting = false;
  const lines: string[] = [];
  const copy = new LiveCopy({
    open: (gone) => {
      if (quitting) return null;
      const w = { drawn: null as CapturedImage | null, closed: false, gone };
      made.push(w);
      const win: LiveCopyWindow = {
        latest: () => w.drawn,
        isDestroyed: () => w.closed,
        close: () => {
          w.closed = true;
        },
      };
      return win;
    },
    log: (l) => lines.push(l),
  });
  return {
    copy,
    made,
    lines,
    quit: () => {
      quitting = true;
    },
  };
}

describe('LiveCopy', () => {
  it('opens nothing until a still is asked for; then one window, its last picture each time after; closed, it opens again only when asked', () => {
    const { copy, made, lines } = fakeWindows();
    expect(made).toHaveLength(0);
    expect(copy.isOpen).toBe(false);

    // Asked: opened, nothing drawn yet.
    expect(copy.still()).toBeNull();
    expect(made).toHaveLength(1);
    expect(copy.isOpen).toBe(true);
    expect(lines.join('\n')).toMatch(/no hall screen/i);

    // Drawn: its last picture, the same window.
    const first = image();
    const w = made[0];
    if (!w) throw new Error('no window');
    w.drawn = first;
    expect(copy.still()).toBe(first);
    const second = image(1920);
    w.drawn = second;
    expect(copy.still()).toBe(second);
    expect(made).toHaveLength(1);

    // Closed (Live not chosen, the studio minimized or closed, a hall screen showing): the window goes.
    copy.close();
    expect(w.closed).toBe(true);
    expect(copy.isOpen).toBe(false);
    expect(made).toHaveLength(1);
    // Closed twice is nothing more.
    const said = lines.length;
    copy.close();
    expect(lines).toHaveLength(said);

    // Asked again: a new window.
    expect(copy.still()).toBeNull();
    expect(made).toHaveLength(2);
    expect(copy.isOpen).toBe(true);
  });

  it('never opens a window as Drashti quits', () => {
    const { copy, made, quit } = fakeWindows();
    quit();
    expect(copy.still()).toBeNull();
    expect(copy.still()).toBeNull();
    expect(made).toHaveLength(0);
    expect(copy.isOpen).toBe(false);
  });

  it('its page gone (a crash): closed, and never opened again each second after; only once closed and asked again', () => {
    const { copy, made, lines } = fakeWindows();
    copy.still();
    const w = made[0];
    if (!w) throw new Error('no window');
    w.drawn = image();
    w.gone();
    expect(w.closed).toBe(true);
    expect(copy.isOpen).toBe(false);
    expect(lines.join('\n')).toMatch(/stopped/i);
    for (let i = 0; i < 5; i++) expect(copy.still()).toBeNull();
    expect(made).toHaveLength(1);
    // Live chosen again (or the studio back): a new one.
    copy.close();
    copy.still();
    expect(made).toHaveLength(2);
    // A gone signal from the old window changes nothing for the new one.
    w.gone();
    expect(copy.isOpen).toBe(true);
    expect(made[1]?.closed).toBe(false);
  });

  it('a window closed by something else is opened again at the next still', () => {
    const { copy, made } = fakeWindows();
    copy.still();
    const w = made[0];
    if (!w) throw new Error('no window');
    w.closed = true;
    expect(copy.isOpen).toBe(false);
    copy.still();
    expect(made).toHaveLength(2);
  });
});

const screen = (id: string, groupId: string, more: Partial<ScreenConfig> = {}): ScreenConfig => ({
  id,
  groupId,
  name: `Placeholder ${id}`,
  displayKey: null,
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled: true,
  feed: null,
  nodeId: null,
  ...more,
});

describe('the copy’s context', () => {
  const groups: ScreenGroupConfig[] = [
    { id: 'g-stage', name: 'Placeholder stage', role: 'stage', screens: [screen('s1', 'g-stage')] },
    {
      id: 'g-hall',
      name: 'Placeholder hall',
      role: 'audience',
      screens: [
        screen('s2', 'g-hall', {
          canvasWidth: 1280,
          canvasHeight: 720,
          scaling: 'fill',
          nodeId: 'node-1',
          geometry: { zoom: 1.1 } as never,
        }),
        screen('s3', 'g-hall'),
      ],
    },
    { id: 'g-hall-2', name: 'Placeholder hall 2', role: 'audience', screens: [screen('s4', 'g-hall-2')] },
  ];

  it('is no screen: an id no screen has, no display, Main’s own clock; the first audience group’s look and its first screen’s canvas, unwarped', () => {
    const clockStyle = { hour12: false } as never;
    const c = liveCopyContext(groups, clockStyle);
    expect(c.screenId).toBe(LIVE_COPY_SCREEN_ID);
    for (const g of groups) for (const s of g.screens) expect(c.screenId).not.toBe(s.id);
    expect(c.role).toBe('audience');
    expect(c.groupId).toBe('g-hall');
    expect(c.groupName).toBe('Placeholder hall');
    expect(c.feed).toBeNull();
    expect(c.display).toBeNull();
    expect(c).toMatchObject({ canvasWidth: 1280, canvasHeight: 720, scaling: 'fill' });
    // Drawn plainly (no screen's warp or grid), on Main's clock (a node's screen carries an offset), with Main's style.
    expect(c.geometry ?? null).toBeNull();
    expect(c.grid).toBeUndefined();
    expect(c.clockOffsetMs).toBeUndefined();
    expect(c.clockStyle).toBe(clockStyle);
  });

  it('with no audience group: the default canvas, 1920 x 1080, fitted', () => {
    const c = liveCopyContext(groups.filter((g) => g.role !== 'audience'));
    expect(c).toMatchObject({
      screenId: LIVE_COPY_SCREEN_ID,
      role: 'audience',
      groupId: '',
      canvasWidth: 1920,
      canvasHeight: 1080,
      scaling: 'fit',
    });
  });
});

describe('what the copy cannot draw', () => {
  const layers = (more: Partial<Pick<Layers, 'background' | 'pip'>>): Pick<Layers, 'background' | 'pip'> => ({
    background: null,
    pip: null,
    ...more,
  });
  const pip = (source: NonNullable<Layers['pip']>['source']) =>
    ({ source, place: {}, swapped: false, shownAt: 0 }) as unknown as NonNullable<Layers['pip']>;

  it('a video input or another app’s window, as the background or in the picture-in-picture box; nothing else', () => {
    expect(unseenInCopy(layers({}))).toEqual([]);
    expect(unseenInCopy(layers({ background: { kind: 'color', color: '#000000' } }))).toEqual([]);
    expect(
      unseenInCopy(
        layers({
          background: { kind: 'media', mediaId: 'm', media: 'video', fit: 'fill', loop: true, startedAt: 0 },
        }),
      ),
    ).toEqual([]);
    expect(
      unseenInCopy(layers({ background: { kind: 'link', linkId: 'l', name: 'Placeholder link', startedAt: 0 } })),
    ).toEqual([]);
    expect(
      unseenInCopy(
        layers({
          background: {
            kind: 'input',
            inputId: 'i',
            name: 'Input 1',
            device: 'fake',
            fit: 'fit',
            startedAt: 0,
          },
        }),
      ),
    ).toEqual(['input']);
    expect(
      unseenInCopy(
        layers({ background: { kind: 'window', sourceId: 'window:1:0', name: 'Placeholder app', startedAt: 0 } }),
      ),
    ).toEqual(['window']);
    expect(unseenInCopy(layers({ pip: pip({ kind: 'slides' }) }))).toEqual([]);
    expect(unseenInCopy(layers({ pip: pip({ kind: 'media', mediaId: 'm', media: 'image' }) }))).toEqual([]);
    expect(
      unseenInCopy(layers({ pip: pip({ kind: 'input', inputId: 'i', name: 'Input 1', device: 'fake' }) })),
    ).toEqual(['input']);
    expect(
      unseenInCopy(
        layers({
          background: { kind: 'window', sourceId: 'window:1:0', name: 'Placeholder app', startedAt: 0 },
          pip: pip({ kind: 'input', inputId: 'i', name: 'Input 1', device: 'fake' }),
        }),
      ),
    ).toEqual(['window', 'input']);
    expect(
      unseenInCopy(
        layers({
          background: { kind: 'window', sourceId: 'window:1:0', name: 'Placeholder app', startedAt: 0 },
          pip: pip({ kind: 'window', sourceId: 'window:2:0', name: 'Placeholder app 2' }),
        }),
      ),
    ).toEqual(['window']);
  });
});

describe('the copy’s window', () => {
  it('is drawn off screen, never shown, never focusable, not in the taskbar; 960 x 540 inside', () => {
    expect(LIVE_COPY_SIZE).toEqual({ width: 960, height: 540 });
    expect(LIVE_COPY_FPS).toBe(1);
    const o = liveCopyOptions() as {
      show?: boolean;
      width?: number;
      height?: number;
      useContentSize?: boolean;
      focusable?: boolean;
      skipTaskbar?: boolean;
      webPreferences?: { offscreen?: unknown; backgroundThrottling?: boolean; sandbox?: boolean };
    };
    // As every Drashti window: isolated, sandboxed, no Node.
    expect(o.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(o.show).toBe(false);
    expect(o.focusable).toBe(false);
    expect(o.skipTaskbar).toBe(true);
    expect(o).toMatchObject({ width: 960, height: 540, useContentSize: true });
    // Off screen, its pictures handed to the main process (no shared texture), never slowed while unseen.
    expect(o.webPreferences?.offscreen).toBe(true);
    expect(o.webPreferences?.backgroundThrottling).toBe(false);
  });

  it('loads the screens’ page as Live’s copy, without a warm-up', () => {
    expect(liveCopyQuery()).toEqual({ [LIVE_COPY_QUERY]: '1', warmUp: 'skip' });
  });
});
