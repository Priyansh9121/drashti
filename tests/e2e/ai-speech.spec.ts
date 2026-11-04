import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ShastraRepo } from '../../src/main/db/shastra';
import { SettingsRepo } from '../../src/main/db/settings';
import { readShastraFile } from '../../src/shared/shastra';
import { expectNoSeriousA11yIssues } from './a11y';
import { chooseMenuItem, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';
import { sizeOperatorWindow } from './window-size';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/examples/placeholder-ai-speech.json'), 'utf8'),
) as { book: unknown; meaningQuery: string; heard: string; singing: string };
const env = {
  DRASHTI_TEST_AI_ASSETS:
    process.env['DRASHTI_TEST_AI_ASSETS'] ??
    join(process.cwd(), 'vendor', 'ai', `${process.platform}-${process.arch}`),
};
async function start(size: { width: number; height: number }, kind: 'off' | 'books' | 'verse') {
  const speech = kind === 'verse' ? fixture.singing : fixture.heard;
  const first = await launchApp({ ...env, DRASHTI_TEST_SPEECH: speech });
  let app = first.app;
  try {
    const initial = await operatorPage(app);
    await operatorReady(initial);
    const show = await setUpPlaceholderShow(initial);
    await app.close();
    const db = new Database(join(first.userData, 'drashti.sqlite'));
    try {
      const parsed = readShastraFile(fixture.book);
      if (!parsed.ok) throw new Error(parsed.message);
      new ShastraRepo(db).load(parsed.text, { path: null, hash: 'placeholder-book-v1' }, 'plain');
      if (kind !== 'off')
        new SettingsRepo(db).set('ai.speech', { books: kind === 'books', verse: kind === 'verse' });
    } finally {
      db.close();
    }
    app = (await launchApp({ ...env, DRASHTI_TEST_SPEECH: speech }, first.userData)).app;
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, size);
    return { app, win, show };
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
for (const size of [
  { width: 1024, height: 645 },
  { width: 1280, height: 720 },
]) {
  test(`speech helpers start off and remain Pro-only operator choices at ${size.width}`, async () => {
    const s = await start(size, 'off');
    try {
      await chooseMenuItem(s.app, 'ai-helpers');
      const dialog = s.win.getByRole('dialog', { name: 'AI helpers' });
      await expect(
        dialog.getByRole('checkbox', {
          name: 'Book references (Trial). Can slow the screens while on.',
          exact: true,
        }),
      ).not.toBeChecked();
      await expect(
        dialog.getByRole('checkbox', {
          name: 'Follow singing (Trial). Can slow the screens while on.',
          exact: true,
        }),
      ).not.toBeChecked();
      await expect(s.win.getByRole('region', { name: 'Speech helpers' })).toHaveCount(0);
      expect(
        await s.app.evaluate(
          ({ app }) => app.getAppMetrics().filter((m) => m.name === 'Drashti offline helpers').length,
        ),
      ).toBe(0);
      await expectNoSeriousA11yIssues(s.win, `Speech helper switches ${size.width}`);
    } finally {
      await s.app.close();
    }
  });
  test(`Book meaning and heard words offer only loaded references until a press at ${size.width}`, async () => {
    const s = await start(size, 'books');
    try {
      const panel = s.win.getByRole('region', { name: 'Speech helpers' });
      await expect(panel).toBeVisible();
      const before = await s.win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live,
      );
      await panel.getByRole('textbox', { name: 'Look in loaded Books' }).fill(fixture.meaningQuery);
      await panel.getByRole('button', { name: 'Find in Books', exact: true }).click();
      await expect(panel.getByTestId('ai-book-hit').first()).toContainText(
        'Placeholder Harbour Book Invented Harbour',
        { timeout: 25_000 },
      );
      expect(
        await s.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live,
        ),
      ).toEqual(before);
      // The actual Part 10 stand-in feeds the production hub; no custom helper input endpoint.
      await s.win.evaluate(() => (globalThis as PageGlobals).drashti.captions.setOn(true));
      await expect(panel.getByTestId('ai-book-hit').filter({ hasText: 'The lantern guides' })).toBeVisible({
        timeout: 25_000,
      });
      expect(
        await s.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live,
        ),
      ).toEqual(before);
      await panel
        .getByTestId('ai-book-hit')
        .filter({ hasText: 'The lantern guides' })
        .getByRole('button', { name: /Show passage/u })
        .click();
      await expect
        .poll(() =>
          s.win.evaluate(
            async () =>
              (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.presentationId,
          ),
        )
        .toMatch(/^shastra:/u);
      await expectNoSeriousA11yIssues(s.win, `Book helper ${size.width}`);
    } finally {
      await s.app.close();
    }
  });
  test(`heard singing suggests Next without moving LIVE and stops in Simple Mode at ${size.width}`, async () => {
    const s = await start(size, 'verse');
    try {
      const panel = s.win.getByRole('region', { name: 'Speech helpers' });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Trial');
      await s.win.evaluate(async (id) => {
        const d = (globalThis as PageGlobals).drashti;
        await d.engine.dispatch({ type: 'goLive', presentationId: id, slideIndex: 0 });
        await d.captions.setOn(true);
      }, s.show.kirtanId);
      const next = panel.getByRole('button', { name: 'Next suggested verse', exact: true });
      await expect(next).toBeVisible({ timeout: 25_000 });
      expect(
        await s.win.evaluate(
          async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.slideIndex,
        ),
      ).toBe(0);
      await next.click();
      await expect
        .poll(() =>
          s.win.evaluate(
            async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.slideIndex,
          ),
        )
        .toBe(1);
      await s.win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
      await expect(s.win.getByTestId('simple-mode')).toBeVisible();
      await expect(panel).toHaveCount(0);
      expect(
        await s.win.evaluate(async () => (await (globalThis as PageGlobals).drashti.aiSpeech.get()).ok),
      ).toBe(false);
      await expect
        .poll(() =>
          s.app.evaluate(
            ({ app }) => app.getAppMetrics().filter((m) => m.name === 'Drashti offline helpers').length,
          ),
        )
        .toBe(0);
    } finally {
      await s.app.close();
    }
  });
}
