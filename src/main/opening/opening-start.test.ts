import { describe, expect, it } from 'vitest';
import { OPENING_LATEST_MS, type OpeningStartFacts, OpeningKeys, openingAtStart } from './opening-start';

/*
 * Whether the opening plays as Drashti starts (Session 55, the owner's brief of 3 Nov 2026): once, when a person
 * starts Drashti, on Main's operator window; never after a crash or the watchdog's restart, a restore or an update's
 * first start, on a node, in a self-test or a test that does not ask for it, nor with the first start's welcome; and
 * the keys it takes: any key ends it, and neither the page nor the menu ever hears that key.
 */

const usual: OpeningStartFacts = {
  node: false,
  selfTest: false,
  testNotAsking: false,
  cleanQuit: true,
  restored: false,
  lastVersion: '1.0.0-alpha.14',
  version: '1.0.0-alpha.14',
  welcome: false,
  on: true,
  pageAgain: false,
  asked: false,
  sinceWindow: 400,
};

describe('whether it plays', () => {
  it('plays when a person starts Drashti, the same version as last time, quit on purpose', () => {
    expect(openingAtStart(usual)).toEqual({ play: true });
  });

  it.each([
    [{ node: true }, 'on a node'],
    [{ selfTest: true }, 'in a self-test'],
    [{ testNotAsking: true }, 'in a test that does not ask for it'],
    [{ asked: true }, 'it has played already at this start'],
    [{ pageAgain: true }, 'the operator window was loaded again'],
    [{ cleanQuit: false }, 'after an unexpected stop'],
    [{ restored: true }, 'after a restore'],
    [{ lastVersion: '1.0.0-alpha.13' }, 'at the first start of 1.0.0-alpha.14'],
    [{ lastVersion: null }, 'at the first start of 1.0.0-alpha.14'],
    [{ welcome: true }, 'the first start’s welcome comes instead'],
    [{ on: false }, 'turned off in File › Opening…'],
    [{ sinceWindow: OPENING_LATEST_MS + 1 }, 'asked for too long after the start'],
  ] as [Partial<OpeningStartFacts>, string][])('never %o: %s', (facts, why) => {
    expect(openingAtStart({ ...usual, ...facts })).toEqual({ play: false, why });
  });

  it('a crash wins over everything a person could change (the show comes back first)', () => {
    expect(openingAtStart({ ...usual, cleanQuit: false, welcome: true, on: false })).toEqual({
      play: false,
      why: 'after an unexpected stop',
    });
  });
});

describe('the keys while it plays', () => {
  const down = (code: string, isAutoRepeat = false) => ({ type: 'keyDown', code, key: code, isAutoRepeat });
  const up = (code: string) => ({ type: 'keyUp', code, key: code, isAutoRepeat: false });

  it('any key ends it, and that key is kept from the page and the menu, its repeats and its release too', () => {
    const ended: string[] = [];
    const keys = new OpeningKeys(() => ended.push('key'));
    expect(keys.take(down('Space'))).toBe(false);
    keys.start();
    expect(keys.take(down('Space'))).toBe(true);
    expect(ended).toEqual(['key']);
    // Held: its repeats and its release never reach the show.
    expect(keys.take(down('Space', true))).toBe(true);
    expect(keys.take(up('Space'))).toBe(true);
    // The next press is the show's.
    expect(keys.take(down('Space'))).toBe(false);
    expect(keys.take(up('Space'))).toBe(false);
    expect(ended).toEqual(['key']);
  });

  it('a modifier, F5 or Enter ends it the same way; a key pressed after it ended by itself is the show’s', () => {
    for (const code of ['MetaLeft', 'F5', 'Enter', 'ArrowRight']) {
      const ended: string[] = [];
      const keys = new OpeningKeys(() => ended.push(code));
      keys.start();
      expect(keys.take(down(code))).toBe(true);
      expect(ended).toEqual([code]);
    }
    const keys = new OpeningKeys(() => undefined);
    keys.start();
    keys.stop();
    expect(keys.take(down('Space'))).toBe(false);
  });

  it('a page loaded again forgets a key held', () => {
    const keys = new OpeningKeys(() => undefined);
    keys.start();
    expect(keys.take(down('KeyB'))).toBe(true);
    keys.reset();
    expect(keys.take(down('KeyB', true))).toBe(false);
  });
});
