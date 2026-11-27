import { describe, expect, it } from 'vitest';
import { screenOfPage } from './output-of-page';

/*
 * The screen whose open output shows a page (S1-1, the alpha.24 bug hunt): the watchdog's, the heartbeat's and the
 * keeps-failing word for a window goes to that window's own screen. Until then it went by the window's name, the first
 * screen of that name: two TVs of one model share their display's name, and a screen removed and made again keeps its
 * name, so the healthy one was Stopped, the black one said Showing, and the wrong one reloaded.
 */

/** An output window as Main keeps it: alive or closed, and its page. */
const output = (page: object) => {
  const w = { webContents: page, closed: false, isDestroyed: () => w.closed };
  return w;
};

describe('the screen of an output’s page (S1-1)', () => {
  it('two open outputs of one name: each page is its own screen’s', () => {
    const left = {};
    const right = {};
    const windows = new Map([
      ['screen-left', output(left)],
      ['screen-right', output(right)],
    ]);
    expect(screenOfPage(windows, right)).toBe('screen-right');
    expect(screenOfPage(windows, left)).toBe('screen-left');
  });

  it('a screen removed and made again: the new page is the new screen’s, and nothing of the removed one is left', () => {
    const removed = {};
    const made = {};
    const windows = new Map([['screen-old', output(removed)]]);
    // Its window closed: no longer kept.
    windows.delete('screen-old');
    windows.set('screen-new', output(made));
    expect(screenOfPage(windows, made)).toBe('screen-new');
    expect(screenOfPage(windows, removed)).toBeUndefined();
  });

  it('a window made again for the same screen: the old page, still closing, is no screen’s', () => {
    const old = {};
    const made = {};
    const windows = new Map([['screen-hall', output(old)]]);
    windows.set('screen-hall', output(made));
    expect(screenOfPage(windows, old)).toBeUndefined();
    expect(screenOfPage(windows, made)).toBe('screen-hall');
  });

  it('a closed window is no screen’s, and neither is a page that is not an output’s (LIVE, the sound player)', () => {
    const page = {};
    const w = output(page);
    const windows = new Map([['screen-hall', w]]);
    w.closed = true;
    expect(screenOfPage(windows, page)).toBeUndefined();
    expect(screenOfPage(windows, {})).toBeUndefined();
  });
});
