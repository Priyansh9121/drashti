import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, type PageGlobals } from './helpers';

test('a new install has the placeholder presentations in a database in userData', async () => {
  const { app, userData } = await launchApp();
  const win = await app.firstWindow();
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
