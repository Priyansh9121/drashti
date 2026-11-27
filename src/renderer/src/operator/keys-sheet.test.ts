import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { keyGroups, KEYMAP, SIMPLE_KEYMAP, withoutSingleKeys } from '../../../shared/keymap';
import { KeysList } from './KeysSheet';

/*
 * The keys sheet's list (Session 25; Help › Keyboard Shortcuts…, or ?), as each mode draws it. Pro Mode's: every key,
 * with the switch for the single-letter keys at its top. Simple Mode's (a25 item 3, in alpha.24 by the owner's 48-item
 * list): only the keys that act there, and no switch (Pro Mode's setting). Both name the key held to see the buttons'
 * keys (a25 item 24: Alt, Option ⌥ on a Mac), from WINDOW_KEYS' own entry.
 */

const draw = (platform: string, simple: boolean, singleOn = true) => {
  const keymap = simple ? SIMPLE_KEYMAP : KEYMAP;
  return renderToStaticMarkup(
    createElement(KeysList, {
      platform,
      simple,
      keymap: singleOn ? keymap : withoutSingleKeys(keymap),
      singleOn,
    }),
  );
};

/** The words in an element with this test id (its first), tags taken out. */
const wordsOf = (html: string, testId: string) => {
  const at = html.indexOf(`data-testid="${testId}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf('<', at);
  const tag = /^<([a-z0-9]+)/u.exec(html.slice(start))?.[1] ?? 'div';
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gu');
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] === '/' ? -1 : 1;
    if (depth === 0)
      return html
        .slice(start, m.index + m[0].length)
        .replace(/<[^>]+>/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
  }
  return null;
};

const count = (html: string, testId: string) => html.split(`data-testid="${testId}"`).length - 1;

describe('the keys sheet’s list', () => {
  it.each([
    ['darwin', '⌥'],
    ['win32', 'Alt'],
  ] as const)('names the key held to see the buttons’ keys, in both modes (%s)', (platform, key) => {
    for (const simple of [false, true]) {
      const hold = wordsOf(draw(platform, simple), 'keys-hold');
      expect(hold, `simple ${String(simple)}`).toContain('See the buttons’ keys while you hold it');
      expect(hold).toContain(key);
      // And that it is let go of before a key is pressed: a key pressed with it held is another key.
      expect(hold).toContain('let go of it, then press the key');
    }
  });

  it('lists every key in Pro Mode, with the single-letter keys’ switch', () => {
    const html = draw('win32', false);
    expect(count(html, 'keys-single')).toBe(1);
    expect(count(html, 'keys-group')).toBe(keyGroups(false).length);
    for (const b of KEYMAP) expect(html).toContain(b.label);
  });

  it('lists only the keys that act in Simple Mode, with no switch', () => {
    const html = draw('win32', true);
    expect(count(html, 'keys-single')).toBe(0);
    expect(count(html, 'keys-group')).toBe(keyGroups(true).length);
    for (const words of [
      'Next slide',
      'Previous slide',
      'Clear all',
      'Black-out',
      'Wallpaper',
      'Oops',
      'Undo',
    ])
      expect(html, words).toContain(words);
    expect(html).toContain('Audience on');
    expect(html).not.toContain('Audience on or off');
    for (const words of ['Search', '>Screens<', 'The quick bar’s pins', 'Move up', 'Remove'])
      expect(html, words).not.toContain(words);
    // It says which keys these are: Simple Mode's.
    expect(wordsOf(html, 'keys-simple')).toContain('Simple Mode');
  });

  it('says Off beside Black-out and ? in Simple Mode while the single-letter keys are off, as Pro Mode’s does', () => {
    const html = draw('darwin', true, false);
    expect(count(html, 'keys-off')).toBe(2);
    expect(count(html, 'keys-single')).toBe(0);
    expect(count(html, 'keys-single-off')).toBe(0);
  });
});
