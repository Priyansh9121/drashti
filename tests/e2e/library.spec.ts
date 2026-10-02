import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, operatorPage, type PageGlobals } from './helpers';

test('a new install has the placeholder presentations in a database in userData', async () => {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await expect(win.getByTestId('presentation-list').getByRole('button')).toHaveCount(2);
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
  await expect(themes).toHaveCount(1);
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
