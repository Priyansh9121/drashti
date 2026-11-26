import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../../shared/engine/state';
import type { PresentationDoc } from '../../../../shared/library';
import type { RemoteSimple } from '../../../../shared/network-phone';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { deckLiveIn, focusesShow, focusWatch, phoneControls } from './phone-mode';

/*
 * What a paired phone shows and may do, by the computer's mode (alpha.23, QA23-PHONE-1; the owner's words: "no video
 * access in either of simple or pro mode in phone, they cant change videos, only ppts an pdfs, that also in pro mode,
 * in simple mode only show the flow, whats running in live, and chat. pro contains more features than simple", then
 * "Only PPT and PDF"). Placeholder names and made-up ids only.
 */

const SIMPLE: RemoteSimple = { playlistId: 'one', words: 'Placeholder words', features: [] };

const doc = (id: string, more: Partial<PresentationDoc> = {}): PresentationDoc => ({
  id,
  name: `Placeholder ${id}`,
  width: 1920,
  height: 1080,
  groups: [],
  arrangements: [],
  selectedArrangementId: null,
  transition: null,
  loop: false,
  kirtan: null,
  source: null,
  ...more,
});

const PDF = doc('deck', { source: { kind: 'pictures', path: null, ref: null, importedAt: null } });
const KIRTAN = doc('kirtan', { source: { kind: 'pp6', path: null, ref: null, importedAt: null } });

const live = (presentationId: string | null, itemId: string | null = null): EngineState => {
  const state = initialEngineState();
  return {
    ...state,
    live: {
      ...state.live,
      presentationId,
      playlist: itemId ? { playlistId: 'one', itemId } : null,
    },
  };
};

const row = (id: string, presentationId: string, phonePlays: boolean): PlaylistItemInfo => ({
  id,
  kind: 'presentation',
  label: `Placeholder ${presentationId}`,
  presentationId,
  presentationName: `Placeholder ${presentationId}`,
  order: { mode: 'presentation' },
  arrangementName: null,
  timers: [],
  phonePlays,
});

describe('a phone in Simple Mode (QA23-PHONE-1)', () => {
  it('shows the Show tab (what is live, the flow) and the Chat; nothing else, and no control at all', () => {
    for (const deckLive of [false, true]) {
      expect(phoneControls(SIMPLE, deckLive)).toEqual({
        tabs: ['show', 'chat'],
        // A tablet held sideways: the chat beside what is live; upright, the chat beside the show.
        panelTabs: ['chat'],
        sides: ['chat'],
        backNext: false,
        swipes: false,
        clearSlide: false,
        slides: false,
      });
    }
    // Whatever Simple Mode Features has: the flow is the Show tab's, never a choice (the owner's Q3 "Always").
    expect(phoneControls({ ...SIMPLE, features: ['sabha-flow'] }, false)).toEqual(
      phoneControls(SIMPLE, false),
    );
    expect(phoneControls({ playlistId: null, words: 'Placeholder words' }, false)).toEqual(
      phoneControls(SIMPLE, false),
    );
  });
});

describe('a phone in Pro Mode (QA23-PHONE-1)', () => {
  it('has the Playlist too (its PowerPoint and PDF rows), and a PowerPoint’s or a PDF’s slides to put up', () => {
    expect(phoneControls(null, false)).toEqual({
      tabs: ['show', 'playlist', 'chat'],
      panelTabs: ['show', 'playlist', 'chat'],
      sides: ['playlist', 'chat'],
      backNext: false,
      swipes: false,
      clearSlide: false,
      slides: true,
    });
  });

  it('has Back and Next (the buttons and a swipe on the live picture) and Clear slide only while one is live', () => {
    expect(phoneControls(null, true)).toMatchObject({ backNext: true, swipes: true, clearSlide: true });
  });

  it('never the library, More, the quick bar or the other clears, in either mode', () => {
    for (const simple of [null, SIMPLE])
      for (const deckLive of [false, true]) {
        const controls = phoneControls(simple, deckLive);
        expect(controls.tabs).not.toContain('library');
        expect(controls.tabs).not.toContain('more');
        expect(controls.panelTabs).not.toContain('library');
        expect(controls.panelTabs).not.toContain('more');
        expect(controls.sides).not.toContain('library');
      }
  });
});

describe('a PowerPoint or a PDF live, as a phone tells it', () => {
  it('is live when the live presentation is one: by its playlist row’s mark, or by its own slides once read', () => {
    // Its row marked by Drashti (phonePlays), before its slides are read.
    expect(deckLiveIn(live('deck', 'i-deck'), null, [row('i-deck', 'deck', true)])).toBe(true);
    // Read: a PDF's pages.
    expect(deckLiveIn(live('deck'), PDF, null)).toBe(true);
  });

  it('is not live while a timer is shown alone in the slide’s place over it (Drashti refuses a phone’s deck commands then)', () => {
    const state = live('deck', 'i-deck');
    const timerAlone: EngineState = {
      ...state,
      layers: {
        ...state.layers,
        slide: { timer: { name: 'Placeholder timer' } } as unknown as EngineState['layers']['slide'],
      },
    };
    expect(deckLiveIn(timerAlone, PDF, [row('i-deck', 'deck', true)])).toBe(false);
  });

  it('is not live for a kirtan, words, nothing live, or a PDF read that is not the live one', () => {
    expect(deckLiveIn(live('kirtan', 'i-kirtan'), KIRTAN, [row('i-kirtan', 'kirtan', false)])).toBe(false);
    expect(deckLiveIn(live(null), PDF, [row('i-deck', 'deck', true)])).toBe(false);
    expect(deckLiveIn(live('kirtan'), PDF, null)).toBe(false);
    expect(deckLiveIn(null, PDF, null)).toBe(false);
    // Another row of a PowerPoint marked: not the live one.
    expect(deckLiveIn(live('kirtan', 'i-kirtan'), null, [row('i-deck', 'deck', true)])).toBe(false);
  });
});

describe('the focus when Simple Mode comes on (a23-review-phoneui LOW-3, QA24-PHONE-B)', () => {
  it('goes to Show only when Simple Mode comes on over Pro Mode’s controls, never as a page opens in Simple Mode', () => {
    // Before: Simple Mode as the page last knew it (null: no hall heard yet on this page); now: as the hall says. The
    // element that had the focus went with Pro Mode's controls.
    expect(focusesShow(false, true, true)).toBe(true);
    expect(focusesShow(null, true, true)).toBe(false);
    expect(focusesShow(true, true, true)).toBe(false);
    expect(focusesShow(false, false, true)).toBe(false);
    expect(focusesShow(true, false, true)).toBe(false);
    expect(focusesShow(null, false, true)).toBe(false);
  });

  it('moves nothing when no element had the focus (a tap on an iPhone focuses no button: VoiceOver stays put)', () => {
    // QA24-PHONE-B (a23-review-phonelows LOW-B): iOS Safari leaves the focus on the page itself after a tap, so a
    // switch to Simple Mode took nothing away; moving the focus to Show made VoiceOver's cursor jump there each time.
    expect(focusesShow(false, true, false)).toBe(false);
    expect(focusesShow(null, true, false)).toBe(false);
    expect(focusesShow(true, true, false)).toBe(false);
  });
});

describe('which element had the focus, and whether it went from the page (QA24-PHONE-B)', () => {
  // Stand-ins for the page's elements: only whether each is still on the page matters.
  const el = () => ({ isConnected: true });

  it('says nothing went when nothing ever had the focus', () => {
    const watch = focusWatch();
    expect(watch.wentAway()).toBe(false);
  });

  it('says it went when the focused element leaves the page, whether or not the browser said it lost the focus', () => {
    const next = el();
    const quiet = focusWatch();
    quiet.took(next);
    next.isConnected = false; // Pro Mode's Next taken off the page, no focusout (as Chrome and Safari do it)
    expect(quiet.wentAway()).toBe(true);

    const back = el();
    const told = focusWatch();
    told.took(back);
    back.isConnected = false;
    told.left(back); // a focusout as it left: still the one that went
    expect(told.wentAway()).toBe(true);
  });

  it('says nothing went when the focus was let go on the page or moved to an element that stays', () => {
    const row = el();
    const blurred = focusWatch();
    blurred.took(row);
    blurred.left(row); // a tap on the page's blank part: nothing has the focus, and the row stays
    row.isConnected = false; // later gone with Pro Mode: it no longer had the focus
    expect(blurred.wentAway()).toBe(false);

    const next = el();
    const tab = el();
    const moved = focusWatch();
    moved.took(next);
    moved.left(next);
    moved.took(tab); // the focus went to the Chat tab, which stays
    next.isConnected = false;
    expect(moved.wentAway()).toBe(false);
  });

  it('forgets an element once another one takes the focus (focusin before the old focusout is read)', () => {
    const tile = el();
    const chat = el();
    const watch = focusWatch();
    watch.took(tile);
    watch.took(chat);
    watch.left(tile); // the old element's focusout, after the new one's focusin: changes nothing
    tile.isConnected = false;
    expect(watch.wentAway()).toBe(false);
  });
});
