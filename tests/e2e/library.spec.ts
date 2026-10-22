import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLE_TEMPLATES } from '../../src/main/db/seed';
import { BUILTIN_THEMES } from '../../src/shared/builtin-themes';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';

/** A library as an operator's starts (Session 50): without the tests' placeholder presentations (as helpers.ts's NO_PLACEHOLDERS). */
const NO_PLACEHOLDERS = { DRASHTI_TEST_SEED_PLACEHOLDERS: '' } as const;

test('a new library starts with no presentations: the example sabha templates and the built-in themes only, in a database in userData', async () => {
  const { app, userData } = await launchApp(NO_PLACEHOLDERS);
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);
  const seeded = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      presentations: (await d.library.listPresentations()).map((p) => p.name),
      templates: (await d.playlists.templates()).map((t) => t.name).sort(),
      themes: (await d.themes.list()).themes.length,
    };
  });
  // Session 50: no “Language test slides” or “Sample kirtan (placeholder)” to find and delete on a new laptop.
  expect(seeded).toEqual({
    presentations: [],
    templates: EXAMPLE_TEMPLATES.map((t) => t.name).sort(),
    themes: 1 + BUILTIN_THEMES.length,
  });
  // Nothing open in the middle: its three steps lead. The library's sheet says it is empty.
  await expect(win.getByTestId('start-here')).toBeVisible();
  const sheet = await openLibrary(win);
  await expect(sheet.getByText('The library is empty')).toBeVisible();
  await expect(sheet.getByTestId('presentation-row')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'a new library, empty');
  await app.close();
});

test('the tests’ new library has the two placeholder presentations (DRASHTI_TEST_SEED_PLACEHOLDERS, set by launchApp), and the engine reads their slides from the database', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await openLibrary(win);
  await expect(win.getByTestId('presentation-list').getByTestId('presentation-row')).toHaveCount(2);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);

  const list = await win.evaluate(() => (globalThis as PageGlobals).drashti.library.listPresentations());
  expect(list.map((p) => p.name)).toEqual(['Language test slides', 'Sample kirtan (placeholder)']);
  expect(list.find((p) => p.kirtanTracks)?.kirtanTracks).toEqual(['en', 'gu', 'hi', 'translit']);

  // The engine reads slides from the database.
  const id = list[0]?.id ?? '';
  const result = await win.evaluate(
    (presentationId) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'goLive', presentationId, slideIndex: 0 }),
    id,
  );
  expect(result).toMatchObject({ ok: true, changed: true });
  const doc = await win.evaluate(
    (pid) => (globalThis as PageGlobals).drashti.library.getPresentation(pid),
    id,
  );
  expect(doc?.groups[0]?.slides).toHaveLength(3);
  expect(
    await win.evaluate(() => (globalThis as PageGlobals).drashti.library.getPresentation('')),
  ).toBeNull();
  await app.close();
});

test('the props, messages and themes lists follow changes made elsewhere, with no reload', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.getByRole('button', { name: 'Themes', exact: true }).click();
  const themes = win.getByTestId('themes-panel').getByTestId('theme-item');
  // Drashti default and the built-in themes (Session 26).
  await expect(themes).toHaveCount(1 + BUILTIN_THEMES.length);
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const message = await d.messages.create({
      name: 'Placeholder notice',
      template: 'Placeholder notice words',
      fields: {},
    });
    const prop = await d.props.save(null, {
      name: 'Placeholder corner words',
      width: 1920,
      height: 1080,
      elements: [
        {
          id: 'placeholder-corner',
          kind: 'text',
          frame: { x: 40, y: 40, width: 600, height: 100 },
          text: 'Placeholder corner words',
          lang: 'en',
          style: {
            fontFamily: null,
            fontSize: 48,
            fontWeight: 400,
            color: '#ffffff',
            align: 'left',
            verticalAlign: 'top',
            lineHeight: 1.2,
            shadow: false,
          },
        },
      ],
    });
    const { themes, defaultId } = await d.themes.list();
    const base = themes.find((t) => t.id === defaultId);
    if (!base || !message.ok || !prop.ok) throw new Error('could not make the placeholders');
    const { id: _id, ...fields } = base;
    const theme = await d.themes.save(null, { ...fields, name: 'Placeholder evening theme' });
    if (!theme.ok) throw new Error(theme.message);
    return { messageId: message.id, propId: prop.id };
  });
  await expect(themes.filter({ hasText: 'Placeholder evening theme' })).toBeVisible();
  await win.getByRole('button', { name: 'Close themes' }).click();
  const message = win.getByTestId('messages').getByTestId('message-row');
  await expect(message.filter({ hasText: 'Placeholder notice' })).toBeVisible();
  await expect(win.getByTestId('props').getByTestId('prop-row')).toHaveText(/Placeholder corner words/);
  // Removing them elsewhere takes them out of the lists too.
  await win.evaluate(async ({ messageId, propId }) => {
    const d = (globalThis as PageGlobals).drashti;
    await d.messages.remove(messageId);
    await d.props.remove(propId);
  }, made);
  await expect(message).toHaveCount(0);
  await expect(win.getByTestId('props').getByTestId('prop-row')).toHaveCount(0);
  await app.close();
});
