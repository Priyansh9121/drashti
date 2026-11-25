import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RemoteSimple } from '../../../../shared/network-phone';
import { phoneControls } from './phone-mode';
import { ShowColumn } from './RemoteApp';

/*
 * The Sabha flow on a phone while Drashti's computer is in Simple Mode (alpha.23). Until QA23-PHONE-1 it was in More
 * exactly while chosen in Simple Mode Features (a22-review-flow M6, QA23-FLOWP-1 A). The owner's Q3, "Always
 * (Recommended)": a Simple Mode phone always shows the flow, on its Show tab with what is live, whatever Simple Mode
 * Features has; there is no More tab any more. Placeholder words only.
 */

const simple = (features: RemoteSimple['features']): RemoteSimple => ({
  playlistId: null,
  words: 'Placeholder Simple Mode words',
  ...(features ? { features } : {}),
});
const shown = (s: RemoteSimple | null) =>
  renderToStaticMarkup(
    createElement(ShowColumn, {
      state: null,
      simple: s,
      controls: phoneControls(s, false),
      withSlides: true,
    }),
  );

describe('the Sabha flow on a phone in Simple Mode', () => {
  it('is on its Show tab whatever Simple Mode Features has (the owner’s Q3: always)', () => {
    for (const features of [['sabha-flow'], ['timers', 'sabha-flow'], [], ['timers'], undefined] as const)
      expect(shown(simple(features ? [...features] : undefined)), JSON.stringify(features)).toContain(
        'data-testid="remote-flow"',
      );
  });

  it('is on it in Pro Mode as before', () => {
    expect(shown(null)).toContain('data-testid="remote-flow"');
  });
});
