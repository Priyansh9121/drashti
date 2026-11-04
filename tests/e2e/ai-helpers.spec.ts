import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CalendarFile } from '../../src/shared/calendar';
import { CalendarRepo } from '../../src/main/db/calendar';
import { PlaylistRepo } from '../../src/main/db/playlists';
import { SettingsRepo } from '../../src/main/db/settings';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  chooseMenuItem,
  closeLibrary,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
} from './helpers';
import { sizeOperatorWindow } from './window-size';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/examples/placeholder-ai.json'), 'utf8'),
) as {
  library: { key: string; name: string; text: string }[];
  queries: { meaning: string; typo: string; romanGuTypo: string };
  lyrics: { gu: string };
  calendar: CalendarFile;
  pastSabhas: { name: string; items: string[] }[];
};
const env = {
  DRASHTI_TEST_SEED_PLACEHOLDERS: '0',
  DRASHTI_TEST_AI_ASSETS: join(process.cwd(), 'test-results/ai-assets'),
};
async function start(size: { width: number; height: number }, enabled = true) {
  const initial = await launchApp(env);
  let app = initial.app;
  try {
    let win = await operatorPage(app);
    await operatorReady(win);
    const folder = mkdtempSync(join(tmpdir(), 'drashti-ai-placeholders-'));
    const files = fixture.library.map((item) => {
      const file = join(folder, item.name + '.txt');
      writeFileSync(file, item.text);
      return file;
    });
    const ids = await importAndGetIds(win, files);
    expect(ids).not.toContain('');
    const byKey = new Map(fixture.library.map((item, i) => [item.key, ids[i]]));
    await app.close();
    // Only the stopped, generated profile: older builds ignore this new setting.
    const db = new Database(join(initial.userData, 'drashti.sqlite'));
    try {
      if (enabled) new SettingsRepo(db).set('ai.helpers', { search: true, tidy: true, playlist: true });
      new CalendarRepo(db).load(fixture.calendar, { path: null, hash: null });
      const playlists = new PlaylistRepo(db);
      for (const past of fixture.pastSabhas) {
        const id = playlists.create(past.name, null, false);
        if (!id) throw new Error('Generated past playlist was not created');
        playlists.addItems(
          id,
          null,
          past.items.map((key) => {
            const presentationId = byKey.get(key);
            if (!presentationId) throw new Error('Missing placeholder source');
            return { kind: 'presentation' as const, presentationId };
          }),
        );
      }
    } finally {
      db.close();
    }
    app = (await launchApp(env, initial.userData)).app;
    win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, size);
    return { app, win, userData: initial.userData };
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}
for (const size of [
  { width: 1024, height: 645 },
  { width: 1280, height: 720 },
]) {
  test(`offline helper switches start off and remain an operator choice at ${size.width}`, async () => {
    const s = await start(size, false);
    try {
      await chooseMenuItem(s.app, 'ai-helpers');
      const dialog = s.win.getByRole('dialog', { name: 'AI helpers' });
      await expect(dialog).toBeVisible();
      for (const name of ['Meaning and spelling search', 'Import suggestions', 'Playlist suggestions'])
        await expect(dialog.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
      await expectNoSeriousA11yIssues(s.win, `AI settings ${size.width}`);
    } finally {
      await s.app.close();
    }
  });
  test(`meaning, spelling and Roman Gujarati search suggest exact library sources without going live at ${size.width}`, async () => {
    const s = await start(size);
    try {
      await openLibrary(s.win);
      const live = await s.win.getByTestId('live-text').textContent();
      const ask = s.win.getByRole('button', { name: 'Find by meaning', exact: true });
      await expect(ask).toBeVisible();
      for (const [query, name] of [
        [fixture.queries.meaning, fixture.library[0]?.name],
        [fixture.queries.typo, fixture.library[0]?.name],
        [fixture.queries.romanGuTypo, fixture.library[3]?.name],
      ]) {
        if (!query || !name) throw new Error('Missing search placeholder');
        await s.win.getByTestId('library-search').fill(query);
        await ask.click();
        await expect(s.win.getByTestId('search-hit').filter({ hasText: name })).toBeVisible({
          timeout: 20_000,
        });
        await expect(s.win.getByTestId('live-text')).toHaveText(live ?? '');
      }
      await expectNoSeriousA11yIssues(s.win, `AI search ${size.width}`);
    } finally {
      await s.app.close();
    }
  });
  test(`lyric split and transliteration proposals need approval and have Undo at ${size.width}`, async () => {
    const s = await start(size);
    try {
      await openLibrary(s.win);
      await s.win.getByRole('button', { name: 'New…' }).click();
      const editor = s.win.getByTestId('words-editor');
      const input = editor.getByTestId('words-text');
      await input.fill(fixture.lyrics.gu);
      const live = await s.win.getByTestId('live-text').textContent();
      const suggest = editor.getByRole('button', { name: 'Suggest slide breaks', exact: true });
      await expect(suggest).toBeVisible();
      await suggest.click();
      const proposals = editor.getByTestId('lyric-suggestions');
      await expect(proposals).toContainText('Gujarati');
      await expect(input).toHaveValue(fixture.lyrics.gu);
      await proposals.getByRole('checkbox').first().check();
      await proposals.getByRole('button', { name: 'Apply selected changes' }).click();
      await expect(editor.getByTestId('words-count')).toHaveText('1 group · 2 slides');
      await editor.getByRole('button', { name: 'Undo suggestion', exact: true }).click();
      await expect(input).toHaveValue(fixture.lyrics.gu);
      await editor.getByRole('button', { name: 'Suggest transliteration', exact: true }).click();
      await expect(proposals.getByRole('checkbox').first()).toBeVisible();
      await expect(input).toHaveValue(fixture.lyrics.gu);
      await proposals.getByRole('checkbox').first().check();
      await proposals.getByRole('button', { name: 'Apply selected changes' }).click();
      await expect(input).not.toHaveValue(fixture.lyrics.gu);
      await expect(input).toHaveValue(new RegExp(fixture.lyrics.gu.split('\n')[0] ?? ''));
      await editor.getByRole('button', { name: 'Undo suggestion', exact: true }).click();
      await expect(input).toHaveValue(fixture.lyrics.gu);
      await expect(s.win.getByTestId('live-text')).toHaveText(live ?? '');
      await expectNoSeriousA11yIssues(s.win, `AI lyric review ${size.width}`);
    } finally {
      await s.app.close();
    }
  });
  test(`a coming sabha playlist is an editable proposal before approval at ${size.width}`, async () => {
    const s = await start(size);
    try {
      await closeLibrary(s.win);
      const live = await s.win.getByTestId('live-text').textContent();
      const db = new Database(join(s.userData, 'drashti.sqlite'), { readonly: true });
      const count = () =>
        (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE deleted_at IS NULL').get() as { n: number }).n;
      try {
        const before = count();
        const suggest = s.win.getByRole('button', { name: 'Suggest a playlist', exact: true });
        await expect(suggest).toBeVisible();
        await suggest.click();
        const dialog = s.win.getByRole('dialog', { name: 'Playlist suggestions' });
        await dialog.getByLabel('Sabha date').fill('2026-12-06');
        for (const past of fixture.pastSabhas)
          await dialog.getByRole('checkbox', { name: past.name, exact: true }).check();
        await dialog.getByRole('button', { name: 'Suggest playlist', exact: true }).click();
        await expect(dialog.getByTestId('playlist-suggestion-row').first()).toBeVisible({ timeout: 20_000 });
        expect(count()).toBe(before);
        await expect(s.win.getByTestId('live-text')).toHaveText(live ?? '');
        const rows = dialog.getByTestId('playlist-suggestion-row');
        const n = await rows.count();
        expect(n).toBeGreaterThan(1);
        await rows.last().getByRole('button', { name: 'Remove suggestion', exact: true }).click();
        await expect(rows).toHaveCount(n - 1);
        expect(count()).toBe(before);
        await expectNoSeriousA11yIssues(s.win, `AI playlist review ${size.width}`);
        await dialog.getByRole('button', { name: 'Make playlist', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(count()).toBe(before + 1);
        await expect(s.win.getByTestId('live-text')).toHaveText(live ?? '');
      } finally {
        db.close();
      }
    } finally {
      await s.app.close();
    }
  });
}
