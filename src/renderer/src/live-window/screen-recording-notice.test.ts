import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SCREEN_RECORDING_STEPS, SCREEN_RECORDING_WHY } from '../../../shared/live-window';
import { ScreenRecordingNotice } from './ScreenRecordingNotice';

/*
 * The box that asks for macOS's Screen Recording (Show a Window…, and Picture in Picture…'s window choice), as it
 * renders on each computer. QA24-SCREENREC-1 (the owner's report): after an update, macOS listed Drashti turned on
 * under Screen & System Audio Recording, and still Show a Window said to allow it. Drashti is signed ad hoc, so macOS
 * ties the switch to the build before: on a Mac the box says what to do then, in the words below. Windows and Linux
 * never say it (nothing is asked there).
 */

/** The Mac's words for Drashti already on in the list, as given for QA24-SCREENREC-1. */
const AFTER_UPDATE =
  'Already on in the list? After an update macOS needs it again: select Drashti, press −, then Open System Settings and turn it on.';

const render = (platform: string) =>
  renderToStaticMarkup(
    createElement(ScreenRecordingNotice, {
      message: SCREEN_RECORDING_WHY,
      platform,
      testId: 'window-permission',
      openTestId: 'window-open-settings',
      onOpen: () => undefined,
      onAgain: () => undefined,
    }),
  );

/** The after-update line's own words, or null when the box has none. */
const afterUpdateIn = (html: string): string | null =>
  /data-testid="screen-recording-after-update"[^>]*>([^<]*)</u.exec(html)?.[1] ?? null;

/** The box's buttons, by their words. */
const buttonsIn = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/button>/gu)].map((m) =>
    (m[1] ?? '').trim(),
  );

describe('the box asking for Screen Recording', () => {
  it('on a Mac says why, what to do, and what to do when Drashti is already on in the list after an update', () => {
    const html = render('darwin');
    expect(html).toContain('data-testid="window-permission"');
    expect(html).toContain('Let Drashti see other apps’ windows');
    expect(html).toContain(SCREEN_RECORDING_WHY);
    expect(html).toContain(SCREEN_RECORDING_STEPS);
    expect(afterUpdateIn(html)).toBe(AFTER_UPDATE);
    // It comes after the steps it adds to.
    expect(html.indexOf(AFTER_UPDATE)).toBeGreaterThan(html.indexOf(SCREEN_RECORDING_STEPS));
    expect(buttonsIn(html)).toEqual(['Open System Settings', 'Look again']);
    expect(html).toContain('data-testid="window-open-settings"');
  });

  it('on Windows and Linux never says it: the rest of the box is the same', () => {
    for (const platform of ['win32', 'linux']) {
      const html = render(platform);
      expect(afterUpdateIn(html), platform).toBeNull();
      expect(html, platform).not.toContain('After an update');
      expect(html, platform).toContain(SCREEN_RECORDING_STEPS);
      expect(buttonsIn(html), platform).toEqual(['Open System Settings', 'Look again']);
    }
  });

  it('says it plainly: the button it names is the box’s own, the − as macOS draws it, no signing words', () => {
    const words = afterUpdateIn(render('darwin')) ?? '';
    // The step it names is a button the box offers, by its words.
    expect(words).toContain('Open System Settings');
    expect(buttonsIn(render('darwin'))).toContain('Open System Settings');
    // System Settings' remove button under the list is a minus sign (U+2212), never a hyphen.
    expect(words).toContain('press −,');
    expect(words).not.toMatch(/ - |press -/u);
    // What an operator does, never why in code-signing words.
    expect(words).not.toMatch(
      /ad hoc|adhoc|signed|signature|certificate|cdhash|hash|tccutil|\bTCC\b|Terminal/iu,
    );
    expect(words).not.toMatch(/\p{L}'\p{L}/u);
    // One short line: it fits the box at CI's 1024 × 645 with the why and the steps.
    expect(words.length).toBeLessThanOrEqual(140);
  });
});
