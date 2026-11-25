import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import type { PresentationDoc } from '../../../../shared/library';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { PlaylistItemInfo, PlaylistNode } from '../../../../shared/playlists';
import { phoneControls } from './phone-mode';
import { PlaylistTabView } from './PlaylistTab';
import { BackNext, ShowColumn, SlidesView, type SlidesShown } from './RemoteApp';

/*
 * A paired phone's page by the computer's mode, drawn (alpha.23, QA23-PHONE-1; the owner's words: "no video access in
 * either of simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode, in simple
 * mode only show the flow, whats running in live, and chat. pro contains more features than simple", then "Only PPT and
 * PDF"). Simple Mode: what is live as a view, its lines, the notes, what comes next and the Sabha flow; no control.
 * Pro Mode: that, the playlist's PowerPoint and PDF rows, their slides to put up, and Back, Next and Clear slide while
 * one is live. Never the quick bar, the other clears, the time bar, what plays, a background's or a box's clear.
 * Placeholder names and made-up ids only.
 */

const SIMPLE: RemoteSimple = { playlistId: 'one', words: 'Placeholder words', features: [] };

const slide = (id: string, index: number): PresentationDoc['groups'][number]['slides'][number] => ({
  id,
  index,
  label: '',
  notes: '',
  slide: {
    id,
    width: 1920,
    height: 1080,
    background: '#000000',
    elements: [
      {
        id: `${id}-page`,
        kind: 'image',
        mediaId: `m-${id}`,
        fit: 'fit',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ],
  },
  cues: [],
  transition: null,
  autoAdvanceMs: null,
  macroId: null,
});

/** A PDF's two pages. */
const PDF: PresentationDoc = {
  id: 'deck',
  name: 'Placeholder deck',
  width: 1920,
  height: 1080,
  groups: [{ id: 'g1', name: 'Placeholder pages', color: null, slides: [slide('p1', 0), slide('p2', 1)] }],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: { kind: 'pictures', path: null, ref: null, importedAt: null },
};

const KIRTAN: PresentationDoc = {
  ...PDF,
  id: 'kirtan',
  name: 'Placeholder kirtan',
  source: { kind: 'pp6', path: null, ref: null, importedAt: null },
};

const presentationRow = (id: string, doc: PresentationDoc, phonePlays: boolean): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: doc.name,
  presentationId: doc.id,
  presentationName: doc.name,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  phonePlays,
});

const ITEMS: PlaylistItemInfo[] = [
  { id: 'i-header', kind: 'header', label: 'Placeholder heading', color: null },
  presentationRow('i-deck', PDF, true),
  presentationRow('i-kirtan', KIRTAN, false),
  {
    id: 'i-video',
    kind: 'media',
    label: 'Placeholder video',
    mediaId: 'm-video',
    media: 'video',
    missing: false,
    unplayable: null,
    timers: [],
  },
];

const PLAYLIST: PlaylistNode = {
  id: 'one',
  name: 'Placeholder playlist',
  isFolder: false,
  kind: 'normal',
  parentId: null,
  itemCount: ITEMS.length,
  placeholders: 0,
  imported: false,
  template: false,
};

/**
 * The show as the engine has it: the deck's (or the kirtan's) first slide up from its row, with a window as the
 * background, a picture in picture box and Repeat Slides going round, each with a clear of its own on the phone before.
 */
function showing(presentationId: 'deck' | 'kirtan'): EngineState {
  const state = initialEngineState();
  const doc = presentationId === 'deck' ? PDF : KIRTAN;
  const first = doc.groups[0]?.slides[0];
  if (!first) throw new Error('no slide');
  return {
    ...state,
    live: {
      ...state.live,
      presentationId,
      slideIndex: 0,
      playlist: { playlistId: 'one', itemId: presentationId === 'deck' ? 'i-deck' : 'i-kirtan' },
    },
    layers: {
      ...state.layers,
      slide: { presentationId, slideIndex: 0, shownAt: 1000, notes: '', slide: first.slide },
      background: { kind: 'window', sourceId: 'window:1:0', name: 'Placeholder window', startedAt: 900 },
      pip: {
        source: { kind: 'window', sourceId: 'window:2:0', name: 'Placeholder box' },
        place: { corner: 'top-right', size: 0.3 },
        swapped: false,
        shownAt: 950,
      } as unknown as EngineState['layers']['pip'],
    },
    repeat: { playlistId: 'two', name: 'Placeholder going round' },
  };
}

/** The slides the phone shows: the live row's presentation (the remote follows what goes live). */
const slidesOf = (presentationId: 'deck' | 'kirtan'): SlidesShown => {
  const state = showing(presentationId);
  const itemId = presentationId === 'deck' ? 'i-deck' : 'i-kirtan';
  return {
    viewing: { presentationId, item: { playlistId: 'one', itemId, order: { mode: 'presentation' } } },
    doc: presentationId === 'deck' ? PDF : KIRTAN,
    items: ITEMS,
    focusSlideId: null,
    live: state.live,
    shownIndex: 0,
    timerAlone: false,
  };
};

/** Each page tile: whether it may be tapped, and whether it is marked as on the screens. */
const tiles = (html: string) =>
  [...html.matchAll(/<button[^>]*data-testid="remote-slide"[^>]*>/gu)].map((m) => ({
    tappable: !/\sdisabled=""/u.test(m[0]),
    live: /data-live="true"/u.test(m[0]),
  }));

const show = (state: EngineState, simple: RemoteSimple | null, deckLive: boolean) =>
  renderToStaticMarkup(
    createElement(ShowColumn, { state, simple, controls: phoneControls(simple, deckLive), withSlides: true }),
  );

const has = (html: string, id: string) => html.includes(`data-testid="${id}"`);

/** Nothing of what a phone no longer does, whatever the mode. */
const NEVER = [
  'remote-quick-bar',
  'remote-time-bars',
  'remote-playing',
  'remote-clear-all',
  'remote-put-back',
  'remote-wallpaper',
  'remote-blackout',
  'remote-clear-background',
  'remote-clear-audio',
  'remote-clear-messages',
  'remote-clear-ticker',
  'remote-window-clear',
  'remote-pip-take-off',
  'remote-repeat-stop',
  'remote-timer-clear',
  'remote-audience-timer-hide',
  'remote-desktop',
  'remote-music',
  'remote-messages',
  'remote-shastra',
];

describe('a phone’s Show tab in Simple Mode (QA23-PHONE-1)', () => {
  it('shows what is live as a view, its lines, the notes, what comes next and the Sabha flow; no control', () => {
    for (const live of ['deck', 'kirtan'] as const) {
      const html = show(showing(live), SIMPLE, live === 'deck');
      for (const id of [
        'remote-live',
        'remote-look-closer',
        'remote-notes-section',
        'remote-next',
        'remote-flow',
      ])
        expect(has(html, id), `${live} ${id}`).toBe(true);
      // What is behind and over the slide is said, never cleared from here.
      expect(html).toContain('Placeholder window');
      expect(html).toContain('Placeholder going round');
      for (const id of [
        ...NEVER,
        'remote-clear-slide',
        'remote-slides',
        'remote-start-item',
        'remote-look-through',
      ])
        expect(has(html, id), `${live} ${id}`).toBe(false);
    }
  });
});

describe('a phone’s Show tab in Pro Mode (QA23-PHONE-1)', () => {
  it('a PowerPoint or a PDF live: the same, and Clear slide alone of the clears', () => {
    const html = show(showing('deck'), null, true);
    for (const id of [
      'remote-live',
      'remote-look-closer',
      'remote-notes-section',
      'remote-next',
      'remote-flow',
      'remote-clear-slide',
    ])
      expect(has(html, id), id).toBe(true);
    for (const id of NEVER) expect(has(html, id), id).toBe(false);
  });

  it('a kirtan live: no Clear slide; what is live still shown', () => {
    const html = show(showing('kirtan'), null, false);
    for (const id of ['remote-live', 'remote-notes-section', 'remote-next', 'remote-flow'])
      expect(has(html, id), id).toBe(true);
    for (const id of [...NEVER, 'remote-clear-slide']) expect(has(html, id), id).toBe(false);
  });

  it('while a timer is shown alone over the PDF: no tile tapped, no Start this item, and it says why (a23-review-phoneui MUST-2a)', () => {
    const shown = slidesOf('deck');
    const html = renderToStaticMarkup(
      createElement(SlidesView, {
        ...shown,
        viewing: shown.viewing
          ? { ...shown.viewing, item: { ...shown.viewing.item!, itemId: 'i-other' } }
          : null,
        shownIndex: null,
        timerAlone: true,
      }),
    );
    expect(tiles(html).map((t) => t.tappable)).toEqual([false, false]);
    expect(has(html, 'remote-start-item')).toBe(false);
    expect(html).toContain('A timer is on the screens: the computer takes it off.');
  });

  it('a PDF up from the computer but not from this playlist’s row: its page marked live, no tile tapped, and no “Not on the screens” (a23-review-phoneui MUST-2b, 2c)', () => {
    const shown = slidesOf('deck');
    // b: from the library, in no playlist; c: from another playlist than the one this phone has open.
    for (const playlist of [null, { playlistId: 'other', itemId: 'i-elsewhere' }]) {
      const live = shown.live ? { ...shown.live, playlist } : null;
      const html = renderToStaticMarkup(
        createElement(SlidesView, {
          ...shown,
          viewing: { presentationId: 'deck', item: null },
          live,
          shownIndex: 1,
        }),
      );
      expect(tiles(html), JSON.stringify(playlist)).toEqual([
        { tappable: false, live: false },
        { tappable: false, live: true },
      ]);
      expect(html, JSON.stringify(playlist)).not.toContain('Not on the screens');
      expect(html).toContain(
        'Put up on the computer, not from this phone’s playlist: Back and Next go through it here.',
      );
    }
  });

  it('shows a PowerPoint’s or a PDF’s slides to put up, and never a kirtan’s', () => {
    const deck = renderToStaticMarkup(createElement(SlidesView, slidesOf('deck')));
    expect(has(deck, 'remote-slides')).toBe(true);
    expect(has(deck, 'remote-look-through')).toBe(true);
    expect(deck.match(/data-testid="remote-slide"/gu)).toHaveLength(2);
    const kirtan = renderToStaticMarkup(createElement(SlidesView, slidesOf('kirtan')));
    for (const id of ['remote-slides', 'remote-slide', 'remote-start-item', 'remote-look-through'])
      expect(has(kirtan, id), id).toBe(false);
    expect(has(kirtan, 'remote-slides-none')).toBe(true);
    // Nothing live: said where one is put up.
    const none = renderToStaticMarkup(
      createElement(SlidesView, { ...slidesOf('deck'), viewing: null, doc: null }),
    );
    expect(has(none, 'remote-slides-none')).toBe(true);
    expect(none).toContain('No PowerPoint or PDF is on the screens: put one up from the playlist first.');
  });
});

describe('Back, Next and the tabs (QA23-PHONE-1)', () => {
  const bar = (simple: RemoteSimple | null, deckLive: boolean) =>
    renderToStaticMarkup(
      createElement(BackNext, { layout: 'phone', controls: phoneControls(simple, deckLive) }),
    );

  it('Simple Mode: Show and Chat, and never Back or Next', () => {
    for (const deckLive of [false, true]) {
      const html = bar(SIMPLE, deckLive);
      expect(has(html, 'remote-tab-show')).toBe(true);
      expect(has(html, 'remote-tab-chat')).toBe(true);
      for (const id of [
        'remote-tab-playlist',
        'remote-tab-library',
        'remote-tab-more',
        'remote-back',
        'remote-next-button',
      ])
        expect(has(html, id), id).toBe(false);
    }
  });

  it('Pro Mode: Show, Playlist and Chat; Back and Next only while a PowerPoint or a PDF is live', () => {
    const none = bar(null, false);
    for (const id of ['remote-tab-show', 'remote-tab-playlist', 'remote-tab-chat'])
      expect(has(none, id), id).toBe(true);
    for (const id of ['remote-tab-library', 'remote-tab-more', 'remote-back', 'remote-next-button'])
      expect(has(none, id), id).toBe(false);
    const deck = bar(null, true);
    expect(has(deck, 'remote-back')).toBe(true);
    expect(has(deck, 'remote-next-button')).toBe(true);
  });
});

describe('the Playlist tab in Pro Mode (QA23-PHONE-1)', () => {
  const tab = (items: PlaylistItemInfo[], timerAlone = false) =>
    renderToStaticMarkup(
      createElement(PlaylistTabView, {
        playlists: [PLAYLIST],
        playlistId: 'one',
        items,
        docs: new Map([['deck', PDF]]),
        folded: [],
        timerAlone,
      }),
    );

  it('while a timer is shown alone over the PDF, its page rows are not tapped and it says why (a23-review-phoneui MUST-2)', () => {
    const rows = (html: string) =>
      [...html.matchAll(/<button[^>]*data-testid="remote-row"[^>]*>/gu)].map(
        (m) => !/\sdisabled=""/u.test(m[0]),
      );
    expect(rows(tab(ITEMS))).toEqual([true, true]);
    const alone = tab(ITEMS, true);
    expect(rows(alone)).toEqual([false, false]);
    expect(alone).toContain('A timer is on the screens: the computer takes it off.');
  });

  it('lists the open playlist’s PowerPoint and PDF rows only, with nothing to manage, pin, or choose a wallpaper from', () => {
    const html = tab(ITEMS);
    expect(has(html, 'remote-playlist')).toBe(true);
    expect(html).toContain('Placeholder deck');
    for (const words of ['Placeholder kirtan', 'Placeholder video', 'Placeholder heading'])
      expect(html, words).not.toContain(words);
    for (const id of [
      'remote-open-playlists',
      'remote-wallpapers',
      'remote-going-round',
      'remote-rows-undo',
      'remote-item-look',
      'remote-playlist-folder',
    ])
      expect(has(html, id), id).toBe(false);
  });

  it('says so when the playlist has no PowerPoint or PDF', () => {
    const html = tab(ITEMS.filter((i) => i.id !== 'i-deck'));
    expect(html).toContain('No PowerPoint or PDF in this playlist: only those go up from a phone.');
    expect(html).not.toContain('Placeholder kirtan');
  });
});
