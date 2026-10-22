import { describe, expect, it } from 'vitest';
import type { TimerElement } from '../../shared/model';
import { BUILT_IN_TIMER_LOOK, timerElement, timerLayoutElements } from '../../shared/timer-slides';
import type { Theme } from '../../shared/themes';
import { DEFAULT_THEME } from '../../shared/themes';
import { readContent } from '../db/content';
import { openDatabase } from '../db/database';
import { elementFromRow, PresentationRepo } from '../db/presentations';
import { applyTheme } from './themes';

/*
 * A Timer follows its presentation's theme (Session 50): a theme applied gives its digits the theme's words
 * (font, weight, colour, shadow), as New Timer Slide… made them; its size, place and own settings stay.
 */

const theme: Theme = {
  id: 'theme-1',
  ...DEFAULT_THEME,
  name: 'Placeholder theme',
  langs: {
    ...DEFAULT_THEME.langs,
    en: { font: 'Placeholder Sans', size: 72, weight: 700, color: '#ffee00', shadow: false },
  },
};

describe('a Timer when a theme is applied', () => {
  it('takes the theme’s words, keeping its size, its place, its last minute and its zero', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    const frame = { x: 384, y: 378, width: 1152, height: 324 };
    const timer: TimerElement = {
      ...timerElement('timer', 't1', frame, BUILT_IN_TIMER_LOOK, 216, 'middle'),
      lastMinute: { color: '#f5a524' },
      atZero: 'next',
    };
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder',
      groups: [{ name: '', slides: [{ elements: [timer] }] }],
    });
    const rows = readContent(db, id);
    if (!rows) throw new Error('no content');
    const themed = applyTheme(rows, theme);
    const row = themed.elements[0];
    const el = row ? elementFromRow(row) : null;
    expect(el).toMatchObject({
      kind: 'timer',
      timerId: 't1',
      frame,
      lastMinute: { color: '#f5a524' },
      atZero: 'next',
      style: {
        fontFamily: 'Placeholder Sans',
        fontWeight: 700,
        color: '#ffee00',
        shadow: false,
        fontSize: 216,
        align: 'center',
        verticalAlign: 'middle',
      },
    });
  });

  // Section 7's review (Session 50): applying a theme moved "Starting in" into the theme's box for the words, across
  // the time. On a slide with a Timer the words keep their place; they take the theme's look as all words do.
  it('keeps Timer with words in its layout: the line of words stays above the time', () => {
    const db = openDatabase(':memory:');
    const repo = new PresentationRepo(db);
    let n = 0;
    const made = timerLayoutElements(
      'words',
      't1',
      BUILT_IN_TIMER_LOOK,
      { width: 1920, height: 1080 },
      () => {
        n += 1;
        return `e${String(n)}`;
      },
    );
    const id = repo.insert({
      libraryId: repo.ensureLibrary('Default'),
      name: 'Placeholder',
      groups: [{ name: '', slides: [{ elements: made }] }],
    });
    const rows = readContent(db, id);
    if (!rows) throw new Error('no content');
    const before = rows.elements.map((e) => [e.x, e.y, e.width, e.height]);
    const themed = applyTheme(rows, theme);
    expect(themed.elements.map((e) => [e.x, e.y, e.width, e.height])).toEqual(before);
    const words = themed.elements.map((e) => elementFromRow(e)).find((e) => e?.kind === 'text');
    expect(words).toMatchObject({ style: { fontFamily: 'Placeholder Sans', color: '#ffee00' } });
  });
});
