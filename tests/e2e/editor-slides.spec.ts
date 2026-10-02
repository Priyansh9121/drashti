import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageGlobals } from './helpers';
import { importAndGetIds, launchApp, operatorPage } from './helpers';
import { makeTestImage, makeTestVideo } from './test-media';

/*
 * Slides and groups in the slide editor (Session 7): adding, copying,
 * moving and removing slides, groups, labels and notes, a slide's
 * background and sound, its transition and auto-advance, the
 * presentation's transition and loop, one slide's look for every slide
 * (one Undo), and a theme from a slide. Placeholder words and generated
 * media only.
 */

/** The editor's groups and slides as "Group: label label…" ("·" for a slide without a label). */
async function outline(win: Page): Promise<string[]> {
  return win.getByTestId('editor-group').evaluateAll((groups) =>
    groups.map((g) => {
      const slides = [...g.querySelectorAll('[data-testid="editor-slide-thumb"]')].map((t) => {
        const label = (t.getAttribute('aria-label') ?? '').split(': ')[1];
        return label ?? '·';
      });
      return `${g.getAttribute('data-group') ?? ''}: ${slides.join(' ')}`;
    }),
  );
}

test('slides and groups: added, copied, moved and removed; labels, notes, cues, timing; one look for all; a theme', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1600, height: 1000 });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-slides-'));
  const words = join(dir, 'Placeholder Slides Kirtan.txt');
  writeFileSync(words, '[Verse]\nPlaceholder one\n\nPlaceholder two\n\n[Chorus]\nPlaceholder chorus\n');
  const picture = await makeTestImage(win, join(dir, 'Placeholder backdrop.png'), {
    width: 320,
    height: 180,
    color: '#204060',
  });
  const clip = await makeTestVideo(win, join(dir, 'Placeholder tune clip.webm'), {
    seconds: 2,
    width: 320,
    height: 180,
    hue: 200,
  });
  const [id = ''] = await importAndGetIds(win, [words, picture, clip]);
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Placeholder Slides Kirtan/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await expect(editor.getByTestId('slide-panel')).toBeVisible();
  expect(await outline(win)).toEqual(['Verse: · ·', 'Chorus: ·']);

  // Label and notes of the first slide.
  await editor.getByTestId('slide-label').fill('Opening');
  await editor.getByTestId('slide-notes').fill('Placeholder note for the stage');

  // A new slide after it, moved down, and on into the chorus.
  await editor.getByTestId('slide-new').click();
  await editor.getByTestId('slide-label').fill('Added');
  expect(await outline(win)).toEqual(['Verse: Opening Added ·', 'Chorus: ·']);
  await editor.getByTestId('slide-down').click();
  await editor.getByTestId('slide-down').click();
  expect(await outline(win)).toEqual(['Verse: Opening ·', 'Chorus: Added ·']);
  await editor.getByTestId('slide-up').click();
  expect(await outline(win)).toEqual(['Verse: Opening · Added', 'Chorus: ·']);

  // A copy of it, then the copy removed.
  await editor.getByTestId('slide-duplicate').click();
  expect(await outline(win)).toEqual(['Verse: Opening · Added Added', 'Chorus: ·']);
  await editor.getByTestId('slide-delete').click();
  expect(await outline(win)).toEqual(['Verse: Opening · Added', 'Chorus: ·']);

  // A new group, named and coloured, and the added slide moved into it.
  await editor.getByTestId('group-new').click();
  await editor.getByTestId('group-name').fill('Placeholder Bridge');
  await editor.getByRole('radio', { name: 'Colour #8e4ec6' }).click();
  await editor.getByTestId('slide-label').fill('Bridge');
  expect(await outline(win)).toEqual(['Verse: Opening · Added', 'Chorus: ·', 'Placeholder Bridge: Bridge']);
  await editor.getByRole('button', { name: /Slide 3: Added/ }).click();
  await editor.getByTestId('slide-group-choice').selectOption({ label: 'Placeholder Bridge' });
  expect(await outline(win)).toEqual(['Verse: Opening ·', 'Chorus: ·', 'Placeholder Bridge: Bridge Added']);

  // The first slide's background picture, sound, transition and auto-advance.
  await editor.getByRole('button', { name: /Slide 1: Opening/ }).click();
  await editor.getByTestId('choose-background').click();
  await win
    .getByTestId('media-picker')
    .getByRole('button', { name: /Picture: Placeholder backdrop/ })
    .click();
  await expect(editor.getByTestId('background-cue')).toContainText('Placeholder backdrop');
  await editor.getByTestId('choose-sound').click();
  await win
    .getByTestId('media-picker')
    .getByRole('button', { name: /Video: Placeholder tune clip/ })
    .click();
  await expect(editor.getByTestId('sound-cue')).toContainText('Placeholder tune clip');
  await editor.getByTestId('slide-transition').selectOption('dissolve');
  await editor.getByTestId('slide-transition-seconds').fill('1.5');
  await editor.getByTestId('slide-auto').click();
  await editor.getByTestId('slide-auto-seconds').fill('4');
  // The presentation's: a dissolve by default, and looping.
  await editor.getByTestId('presentation-transition').selectOption('dissolve');
  await editor.getByTestId('presentation-transition-seconds').fill('0.6');
  await editor.getByTestId('presentation-loop').click();

  // One slide's look for every slide: a dark box behind the words, given to all.
  await editor.getByTestId('add-shape').click();
  await win.getByRole('menuitem', { name: 'Rounded rectangle' }).click();
  await editor.getByTestId('field-y').fill('700');
  await editor.getByRole('button', { name: 'Send to the back' }).click();
  await win.keyboard.press('Escape');
  await expect(editor.getByTestId('slide-panel')).toBeVisible();
  await editor.getByTestId('apply-look').click();
  await win.getByTestId('apply-look-confirm').getByRole('button', { name: 'Give them this look' }).click();
  const shapes = await editor
    .getByTestId('editor-slide-thumb')
    .evaluateAll((thumbs) => thumbs.map((t) => t.querySelectorAll('svg[data-shape]').length));
  expect(shapes).toEqual([1, 1, 1, 1, 1]);

  // A theme from this slide.
  await editor.getByTestId('theme-from-slide').click();
  await expect(editor.getByTestId('editor-note')).toContainText('Made the theme');

  // Saved: all of it is in the library.
  await editor.getByTestId('save-slides').click();
  await expect(editor).toHaveCount(0);
  const saved = await win.evaluate(async (pid) => {
    const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
    return {
      transition: doc?.transition,
      loop: doc?.loop,
      groups: doc?.groups.map((g) => ({
        name: g.name,
        color: g.color,
        slides: g.slides.map((s) => ({
          label: s.label,
          notes: s.notes,
          transition: s.transition,
          auto: s.autoAdvanceMs,
          cues: s.cues.map((c) => `${c.kind}:${c.name}`),
          shapes: s.slide.elements.filter((e) => e.kind === 'shape').length,
        })),
      })),
    };
  }, id);
  expect(saved).toMatchObject({ transition: { kind: 'dissolve', durationMs: 600 }, loop: true });
  expect(saved.groups?.map((g) => [g.name, g.color, g.slides.map((s) => s.label)])).toEqual([
    ['Verse', '#3e63dd', ['Opening', '']],
    ['Chorus', '#e5484d', ['']],
    ['Placeholder Bridge', '#8e4ec6', ['Bridge', 'Added']],
  ]);
  expect(saved.groups?.[0]?.slides[0]).toEqual({
    label: 'Opening',
    notes: 'Placeholder note for the stage',
    transition: { kind: 'dissolve', durationMs: 1500 },
    auto: 4000,
    cues: ['background:Placeholder backdrop.png', 'audio:Placeholder tune clip.webm'],
    shapes: 1,
  });
  expect(saved.groups?.flatMap((g) => g.slides.map((s) => s.shapes))).toEqual([1, 1, 1, 1, 1]);
  const themes = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.themes.list()).themes,
  );
  expect(themes.map((t) => t.name)).toContain('Placeholder Slides Kirtan: Opening');

  // One Undo puts the whole edit back.
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/ }).click();
  await expect
    .poll(async () =>
      win.evaluate(async (pid) => {
        const doc = await (globalThis as PageGlobals).drashti.library.getPresentation(pid);
        return doc?.groups.map((g) => g.slides.length).join(',');
      }, id),
    )
    .toBe('2,1');
  await app.close();
});

test('Drashti’s own default transition is a cut until it is changed, and stays changed', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.library.getDefaultTransition()),
  ).toEqual({
    kind: 'cut',
    durationMs: 0,
  });
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  await win.getByTestId('edit-slides').click();
  const editor = win.getByTestId('slide-editor');
  await editor.getByTestId('app-transition').selectOption('dissolve');
  await expect
    .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.library.getDefaultTransition()))
    .toEqual({ kind: 'dissolve', durationMs: 800 });
  // A presentation without its own says which default it follows.
  await expect(editor.getByTestId('presentation-transition')).toContainText(
    'Drashti’s default (a dissolve of 0.8 s)',
  );
  await app.close();
});
