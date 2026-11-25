import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import type { OrderedSlide } from '../../../../shared/order';
import { backgroundShowing } from '../../../../shared/picture-look';
import { DeckStepDrawn } from './DeckStepPage';
import { ViewerView } from './DeviceViewer';
import { picturePage, screensPage } from './pages';
import type { ViewerPage } from './viewer-store';

/*
 * Look closer on a phone is a view only (alpha.23, QA23-PHONE-1, the owner's Q8 "View only (Recommended)": "Look closer
 * stays as a view; no zoom on the screens; Save picture removed"; and "no video access in either of simple or pro mode
 * in phone"): zoomed on the phone alone, never put on the screens or taken back to whole there, nothing saved, and a
 * deck's click shown at its last frame, never its clip played. Placeholder names and made-up ids only.
 */

/** A picture as the background, zoomed on the screens by the operator. */
function zoomedOnScreens(): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'm-bg',
        media: 'image',
        fit: 'fit',
        loop: false,
        startedAt: 7000,
      },
    },
    liveZoom: { mediaId: 'm-bg', showing: backgroundShowing(7000), zoom: 2, x: 0.25, y: 0.25 },
  } as EngineState;
}

/** The viewer open on these pages, as the phone draws it with the show as given. */
const viewer = (pages: ViewerPage[], state: EngineState | null) =>
  renderToStaticMarkup(
    createElement(ViewerView, { pages, index: 0, of: null, sizes: {}, state, notice: null }),
  );

describe('Look closer on a phone (QA23-PHONE-1, the owner’s Q8)', () => {
  it('zooms on the phone alone: never a zoom on the screens, nor Back to Whole there', () => {
    const html = viewer([screensPage()], zoomedOnScreens());
    expect(html).toContain('data-testid="viewer"');
    // This device's own zoom stays.
    expect(html).toContain('data-testid="viewer-zoom-in"');
    for (const id of ['viewer-screens', 'viewer-show-zoom', 'viewer-whole'])
      expect(html, id).not.toContain(`data-testid="${id}"`);
  });

  it('saves nothing: no Save picture on a picture or on the screens', () => {
    for (const page of [picturePage('m-bg', 'Placeholder picture'), screensPage()])
      expect(viewer([page], zoomedOnScreens()), page.key).not.toContain('data-testid="viewer-save"');
  });
});

describe('a deck’s click looked through on a phone (QA23-PHONE-1)', () => {
  it('shows its last frame at once: no clip asked for or played', () => {
    const s = {
      position: 0,
      group: { id: 'g1', name: 'Placeholder', color: null },
      slide: {
        id: 's1',
        index: 0,
        label: '',
        notes: '',
        cues: [],
        transition: null,
        autoAdvanceMs: null,
        macroId: null,
        slide: {
          id: 's1',
          width: 1920,
          height: 1080,
          background: '#000000',
          elements: [
            {
              id: 'deck-picture',
              kind: 'image',
              mediaId: 'm-step-0',
              fit: 'fit',
              frame: { x: 0, y: 0, width: 1920, height: 1080 },
            },
          ],
          // A deck's slide whose clicks were made as clips (Session 54, C2), each ending on a still.
          deck: {
            steps: [
              { clipId: 'm-clip-0', clipMs: 800, lastId: 'm-step-0' },
              { clipId: 'm-clip-1', clipMs: 800, lastId: 'm-step-1' },
            ],
          },
        },
      },
    } as unknown as OrderedSlide;
    const html = renderToStaticMarkup(createElement(DeckStepDrawn, { s, index: 1 }));
    expect(html).toContain('data-phase="held"');
    expect(html).not.toContain('<video');
  });
});
