import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EXAMPLE_TEMPLATES } from '../../src/main/db/seed';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, openLibrary, operatorPage, operatorReady, type PageGlobals } from './helpers';

/** A library as an operator's starts (Session 50): without the tests' placeholder presentations (as helpers.ts's NO_PLACEHOLDERS). */
const NO_PLACEHOLDERS = { DRASHTI_TEST_SEED_PLACEHOLDERS: '' } as const;

test('a new library starts with no presentations: the example sabha templates only, in a database in userData', async () => {
  const { app, userData } = await launchApp(NO_PLACEHOLDERS);
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);
  const seeded = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return {
      presentations: (await d.library.listPresentations()).map((p) => p.name),
      templates: (await d.playlists.templates()).map((t) => t.name).sort(),
    };
  });
  // Session 50: no “Language test slides” or “Sample kirtan (placeholder)” to find and delete on a new laptop. (The
  // built-in themes are in it still, unseen since Session 55 took Themes out of the window: db/seed.test.ts.)
  expect(seeded).toEqual({
    presentations: [],
    templates: EXAMPLE_TEMPLATES.map((t) => t.name).sort(),
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

test('the messages list follows changes made elsewhere, with no reload (the props and themes lists did too, until Session 55 took them out)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const made = await win.evaluate(async () => {
    const message = await (globalThis as PageGlobals).drashti.messages.create({
      name: 'Placeholder notice',
      template: 'Placeholder notice words',
      fields: {},
    });
    if (!message.ok) throw new Error('could not make the placeholder');
    return message.id;
  });
  const message = win.getByTestId('messages').getByTestId('message-row');
  await expect(message.filter({ hasText: 'Placeholder notice' })).toBeVisible();
  // Removing it elsewhere takes it out of the list too.
  await win.evaluate((id) => (globalThis as PageGlobals).drashti.messages.remove(id), made);
  await expect(message).toHaveCount(0);
  await app.close();
});
