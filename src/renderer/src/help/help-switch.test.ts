import type { ReactNode } from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { OperatorMode } from '../../../shared/mode';
import { endWindow, freshWindow } from './fresh-window';

/*
 * The status bar's Help switch (alpha.24, the owner's "too congusted all around"): where the bar's ? was, a button named
 * Help that says whether it is on (aria-pressed), in Pro and Simple Mode; on, every ? and the buttons' keys show
 * (what-is-this.test.ts, help-store.test.ts). Drawn to markup: unit tests run without a page.
 */

/** The switch as a new start of the window draws it, in this mode, Help on or off, with the bar's own ? if given. */
async function toggle(mode: OperatorMode, helpOn: boolean, ask: ReactNode = null): Promise<string> {
  freshWindow(mode, helpOn);
  const { HelpSwitch } = await import('./HelpSwitch');
  return renderToStaticMarkup(createElement(HelpSwitch, { platform: 'darwin', ask }));
}

afterEach(endWindow);

describe('the status bar’s Help switch', () => {
  it('is a button named Help that says whether it is pressed, in Pro and Simple Mode', async () => {
    for (const mode of ['pro', 'simple'] as const) {
      const off = await toggle(mode, false);
      expect(off).toContain('data-testid="help-toggle"');
      expect(off).toContain('aria-pressed="false"');
      expect(off).toMatch(/>Help<\/span><\/button>/u);
      // Its ? is a picture of the word, never read out twice.
      expect(off).toMatch(/<span aria-hidden="true"[^>]*>\?<\/span>/u);
      expect(await toggle(mode, true)).toContain('aria-pressed="true"');
    }
  });

  it('is the round ? alone below 1280 px, 24 px square as the ? it replaced, its word kept for screen readers', async () => {
    // CI's Windows, 1024 × 645, uihelp's first ask: with the captions' warning in it, the status bar ran past the
    // window by the word's width (the page scrolled sideways), so a narrow window keeps the ?'s own room.
    const off = await toggle('pro', false);
    const button = /<button[^>]*class="([^"]*)"/u.exec(off)?.[1]?.split(' ') ?? [];
    expect(button).toEqual(expect.arrayContaining(['max-[1280px]:w-6', 'max-[1280px]:px-0', 'min-h-6']));
    const word = /<span class="([^"]*)">Help<\/span>/u.exec(off)?.[1]?.split(' ') ?? [];
    expect(word).toEqual(['max-[1280px]:sr-only']);
  });

  it('has the status bar’s own ? after it, gone below 1280 px as the header’s are, so a narrow bar is as full as before', async () => {
    const ask = createElement('button', { 'data-testid': 'what-is-this-statusbar' }, '?');
    const on = await toggle('pro', true, ask);
    expect(on).toMatch(
      /Help<\/span><\/button><\/span><span class="flex max-\[1280px\]:hidden"><button data-testid="what-is-this-statusbar">\?<\/button><\/span>$/u,
    );
    // None (Help off, or Simple Mode): nothing after the switch.
    expect(await toggle('pro', false, null)).toMatch(/Help<\/span><\/button><\/span>$/u);
  });

  it('says in its tooltip words what it shows, with the Mac’s Option and Windows’ Alt', async () => {
    const { helpTip } = await import('./HelpSwitch');
    // Named first, as it is the ? alone in a narrow window.
    expect(helpTip('darwin', false)).toBe(
      'Help: the ? beside each part and the keys on the buttons. Hold Option to see the keys; let go of Option, then press one.',
    );
    expect(helpTip('win32', false)).toBe(
      'Help: the ? beside each part and the keys on the buttons. Hold Alt to see the keys; let go of Alt, then press one.',
    );
    expect(helpTip('win32', true)).toBe(
      'Help: the keys on the buttons. Hold Alt to see them; let go of Alt, then press one.',
    );
  });
});
