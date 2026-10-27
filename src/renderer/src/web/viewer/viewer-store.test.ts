import { afterEach, describe, expect, it } from 'vitest';
import { initialEngineState } from '../../../../shared/engine/state';
import { useEngine } from '../../engine/engine-store';
import { closeOnStop, openViewer, turnPage, useViewer, type ViewerPage } from './viewer-store';

/*
 * The viewer on a phone (Session 54, D1/D2 review): it closes the moment its Drashti stops (access by Gmail), so a
 * video or a sound playing on the phone stops with it, under the page saying why; and it says how each page was
 * come to, so a deck's step come to by Previous shows still. Made-up pages only.
 */

const page = (key: string): ViewerPage => ({
  key,
  title: key,
  size: { width: 16, height: 9 },
  draw: () => null,
});

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  useEngine.setState({ state: null, rev: -1 });
  useViewer.setState({ pages: [], index: 0, of: null, sizes: {}, movedBy: 0 });
});

describe('the viewer on a phone (Session 54, D1/D2 review)', () => {
  it('closes when Drashti stops, and stays closed when it is let in again', () => {
    stop = closeOnStop();
    useEngine.setState({ state: initialEngineState(), rev: 1 });
    openViewer([page('video:clip')]);
    useEngine.setState({ state: { ...initialEngineState(), stopped: null }, rev: 2 });
    expect(useViewer.getState().pages).toHaveLength(1);
    useEngine.setState({ state: { ...initialEngineState(), stopped: { at: 1_000 } }, rev: 3 });
    expect(useViewer.getState().pages).toEqual([]);
    useEngine.setState({ state: initialEngineState(), rev: 4 });
    expect(useViewer.getState().pages).toEqual([]);
  });

  it('says how the page shown was come to: opened, Next or Previous', () => {
    openViewer([page('a'), page('b'), page('c')], 1);
    expect(useViewer.getState().movedBy).toBe(0);
    turnPage(1);
    expect(useViewer.getState()).toMatchObject({ index: 2, movedBy: 1 });
    turnPage(-1);
    expect(useViewer.getState()).toMatchObject({ index: 1, movedBy: -1 });
  });
});
