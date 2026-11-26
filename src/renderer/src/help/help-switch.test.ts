import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useMode } from '../operator/mode-store';
import { HelpSwitch } from './HelpSwitch';
import { setHelp } from './help-store';

/*
 * The status bar's Help switch (alpha.24, the owner's "too congusted all around"): where the bar's ? was, a button named
 * Help that says whether it is on (aria-pressed), in Pro and Simple Mode; on, every ? and the buttons' keys show
 * (what-is-this.test.ts, help-store.test.ts). Drawn to markup: unit tests run without a page.
 */

const toggle = (platform = 'darwin') => renderToStaticMarkup(createElement(HelpSwitch, { platform }));

afterEach(() => {
  setHelp(false);
  useMode.setState({ mode: null });
});

describe('the status bar’s Help switch', () => {
  it('is a button named Help that says whether it is pressed, in Pro and Simple Mode', () => {
    for (const mode of ['pro', 'simple'] as const) {
      useMode.setState({ mode });
      setHelp(false);
      const off = toggle();
      expect(off).toContain('data-testid="help-toggle"');
      expect(off).toContain('aria-pressed="false"');
      expect(off).toMatch(/>Help<\/button>/u);
      // Its ? is a picture of the word, never read out twice.
      expect(off).toMatch(/<span aria-hidden="true"[^>]*>\?<\/span>/u);
      setHelp(true);
      expect(toggle()).toContain('aria-pressed="true"');
    }
  });

  it('says in its tooltip words what it shows, with the Mac’s Option and Windows’ Alt', async () => {
    const { helpTip } = await import('./HelpSwitch');
    expect(helpTip('darwin', false)).toBe(
      'Shows the ? beside each part and the keys on the buttons. Hold Option to see the keys for a moment.',
    );
    expect(helpTip('win32', false)).toBe(
      'Shows the ? beside each part and the keys on the buttons. Hold Alt to see the keys for a moment.',
    );
    expect(helpTip('win32', true)).toBe('Shows the keys on the buttons. Hold Alt to see them for a moment.');
  });
});
