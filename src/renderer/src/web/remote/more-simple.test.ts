import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RemoteSimple } from '../../../../shared/network-phone';
import { MoreColumns } from './RemoteApp';

/*
 * A phone's More tab while Drashti's computer is in Simple Mode (a22-review-flow M6): the Sabha flow is there exactly
 * while it is chosen in Simple Mode Features (QA23-FLOWP-1 A), as in Pro Mode it always is. Placeholder words only.
 */

const simple = (features: RemoteSimple['features']): RemoteSimple => ({
  playlistId: null,
  words: 'Placeholder Simple Mode words',
  ...(features ? { features } : {}),
});
const more = (s: RemoteSimple | null) => renderToStaticMarkup(createElement(MoreColumns, { simple: s }));

describe('a phone’s More in Simple Mode', () => {
  it('has the Sabha flow while it is chosen in Simple Mode Features, and not otherwise', () => {
    expect(more(simple(['sabha-flow']))).toContain('data-testid="remote-flow"');
    expect(more(simple(['timers', 'sabha-flow']))).toContain('data-testid="remote-flow"');
    expect(more(simple([]))).not.toContain('data-testid="remote-flow"');
    expect(more(simple(['timers']))).not.toContain('data-testid="remote-flow"');
    expect(more(simple(undefined))).not.toContain('data-testid="remote-flow"');
  });

  it('has it in Pro Mode as before', () => {
    expect(more(null)).toContain('data-testid="remote-flow"');
  });
});
