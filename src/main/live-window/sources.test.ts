import { describe, expect, it } from 'vitest';
import { othersWindows, windowKey } from './sources';

/*
 * Show a Window… (Session 48): the picker lists other apps' open windows only, never a whole display and
 * never one of Drashti's own (the operator window, the window for Zoom, a hall screen's window).
 */

const zoom = { id: 'window:4021:0', name: 'Zoom Meeting' };
const notes = { id: 'window:77:0', name: 'Placeholder notes' };

describe('the windows Show a Window… offers', () => {
  it('never offers a whole display, whatever its name', () => {
    const offered = othersWindows(
      [
        { id: 'screen:0:0', name: 'Entire screen' },
        { id: 'screen:1:0', name: 'Screen 2' },
        { id: 'screen:69733632:0', name: 'Zoom Meeting' },
        zoom,
      ],
      new Set(),
    );
    expect(offered.map((w) => w.id)).toEqual([zoom.id]);
  });

  it('never offers one of Drashti’s own windows', () => {
    const own = new Set(['window:12:0', 'window:13:0', 'window:14:0']);
    const offered = othersWindows(
      [
        { id: 'window:12:0', name: 'Drashti' },
        { id: 'window:13:0', name: 'Drashti for Zoom' },
        // The same window seen again with another number at its end is still Drashti's.
        { id: 'window:14:1', name: 'Drashti Output' },
        zoom,
        notes,
      ],
      own,
    );
    expect(offered).toEqual([zoom, notes]);
  });

  it('offers only windows it can name, from ids it knows the shape of', () => {
    const offered = othersWindows(
      [
        { id: 'window:5:0', name: '   ' },
        { id: 'window:6:0', name: '' },
        { id: 'web-contents-media-stream://4:1', name: 'A page' },
        { id: 'window:abc:0', name: 'Odd' },
        { id: 'window:9', name: 'Short' },
        notes,
      ],
      new Set(),
    );
    expect(offered).toEqual([notes]);
  });

  it('knows a window by its number, whatever comes after it', () => {
    expect(windowKey('window:4021:0')).toBe('window:4021');
    expect(windowKey('window:4021:3')).toBe('window:4021');
    expect(windowKey('screen:0:0')).toBeNull();
    expect(windowKey('window:x:0')).toBeNull();
  });
});
