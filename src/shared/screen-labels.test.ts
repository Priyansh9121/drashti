import { describe, expect, it } from 'vitest';
import { screenLabels } from './screen-labels';

/*
 * Screens are named after their display (S1-1, the alpha.24 bug hunt), so two TVs of one model share a name. The words
 * that name a screen (the red Stopped notice, Screens, the log) tell them apart: the second is "Placeholder TV (2)".
 */

const screen = (id: string, name: string) => ({ id, name });

describe('each screen’s name in words (S1-1)', () => {
  it('names that differ are said as they are', () => {
    const labels = screenLabels([screen('a', 'Main Hall'), screen('b', 'Stage')]);
    expect([...labels]).toEqual([
      ['a', 'Main Hall'],
      ['b', 'Stage'],
    ]);
  });

  it('two or three of one name: the first as it is, the next ones with their number among them, in order', () => {
    const labels = screenLabels([
      screen('a', 'Placeholder TV'),
      screen('b', 'Stage'),
      screen('c', 'Placeholder TV'),
      screen('d', 'Placeholder TV'),
    ]);
    expect([...labels.values()]).toEqual([
      'Placeholder TV',
      'Stage',
      'Placeholder TV (2)',
      'Placeholder TV (3)',
    ]);
  });

  it('never the same words as another screen’s own name', () => {
    const labels = screenLabels([
      screen('a', 'Placeholder TV'),
      screen('b', 'Placeholder TV'),
      screen('c', 'Placeholder TV (2)'),
    ]);
    expect([...labels.values()]).toEqual(['Placeholder TV', 'Placeholder TV (3)', 'Placeholder TV (2)']);
    expect(new Set(labels.values()).size).toBe(3);
  });
});
