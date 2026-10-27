import { describe, expect, it } from 'vitest';
import { emptyLayers, initialEngineState } from '../../../../shared/engine/state';
import { KEY_GROUPS } from '../../../../shared/keymap';
import { LAYER_CLEARS } from '../../operator/layer-clears';
import { remoteClears } from './remote-clears';

/*
 * The phone's clears (Session 54, D5) are the operator window's bottom bar: in its order, left to right, each with
 * the key the window answers now, lit while its layer has something up, Put it back in Clear all's place while it
 * is offered.
 */

const words = (list: ReturnType<typeof remoteClears>) => list.map((c) => `${c.words} ${c.key}`.trim());

describe('the phone’s clears', () => {
  it('are the desktop’s, in its order, with its keys', () => {
    const state = initialEngineState();
    expect(words(remoteClears(state, { platform: 'darwin', singleKeys: true }))).toEqual([
      'Clear all F1',
      'Slide F2',
      'Background F3',
      'Props F4',
      'Audio F5',
      'Messages F6',
      'Ticker F7',
      'Masks F8',
      'Logo F12',
      'Black-out B',
    ]);
    // On Windows the same keys, written the same way.
    expect(words(remoteClears(state, { platform: 'win32', singleKeys: true }))).toEqual(
      words(remoteClears(state, { platform: 'darwin', singleKeys: true })),
    );
  });

  it('follow the layer bar’s clears and the keys sheet’s, so neither can drift from them', () => {
    const list = remoteClears(initialEngineState(), { platform: 'darwin', singleKeys: true });
    expect(list.slice(1, 8).map((c) => c.action)).toEqual(LAYER_CLEARS.map((c) => c.action));
    const clearing = KEY_GROUPS.find((g) => g.title === 'Clearing the screens')?.actions ?? [];
    expect(list.slice(0, 8).map((c) => c.action)).toEqual([...clearing]);
  });

  it('name no key the window no longer answers: with the single-letter keys off, Black-out has none', () => {
    const list = remoteClears(initialEngineState(), { platform: 'darwin', singleKeys: false });
    expect(words(list).slice(-2)).toEqual(['Logo F12', 'Black-out']);
    // Before the phone knows, the keys the window starts with.
    expect(words(remoteClears(initialEngineState(), null)).slice(-2)).toEqual(['Logo F12', 'Black-out B']);
  });

  it('are lit while their layer has something up, and say so in words when Black-out or the Logo is on', () => {
    const state = initialEngineState();
    state.layers = {
      ...emptyLayers(),
      props: [{ id: 'p', name: 'Placeholder prop', elements: [] }],
      ticker: { items: [{ id: 't', text: 'Placeholder ticker' }], startedAt: 0 },
    };
    state.blackout = true;
    state.logo = { id: 'logo', name: 'Placeholder logo', elements: [] };
    const list = remoteClears(state, { platform: 'darwin', singleKeys: true });
    expect(list.filter((c) => c.lit).map((c) => c.action)).toEqual([
      'clearAll',
      'clearProps',
      'clearTicker',
      'toggleLogo',
      'toggleBlackout',
    ]);
    expect(words(list).slice(-2)).toEqual(['Logo is on F12', 'Black-out is on B']);
  });

  it('offer Put it back in Clear all’s place while it can be, with no key, as the layer bar does', () => {
    const state = initialEngineState();
    state.canPutBack = true;
    const list = remoteClears(state, { platform: 'darwin', singleKeys: true });
    expect(list[0]).toMatchObject({ action: 'putBack', words: 'Put it back', key: '', lit: true });
    expect(list).toHaveLength(10);
  });
});
