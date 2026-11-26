import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { expectPhoneRefuses } from './phone-refuses';
import { setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage } from './test-media';

/*
 * The wallpapers and a phone (Session 55, Part 9, from Part 6; alpha.23, QA23-PHONE-1, the owner: "no video access in
 * either of simple or pro mode in phone, they cant change videos, only ppts an pdfs"): a paired phone may no longer
 * list, choose, rename, delete or bring back a wallpaper, each refused in words (403) with nothing changed. What the
 * phone did moved to the operator window (its Playlists panel, as wallpapers.spec.ts walks it): one click chooses one
 * (what the screens show whenever nothing is up), a click on the chosen one chooses none, its right-click menu
 * renames it and deletes it with Undo. Placeholder pictures only (generated).
 */

const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.wallpapers.view());

/** A wallpaper's tile in the operator window's Playlists panel. */
const tile = (win: Page, name: string) =>
  win.getByTestId('wallpapers').getByTestId('wallpaper-tile').filter({ hasText: name });

test('the wallpapers from a phone are refused in words, listed, chosen, renamed, deleted or brought back; the window chooses one with a click, none with a click on the chosen one, and renames or deletes it with Undo (Safari’s engine)', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const show = await setUpPlaceholderShow(win);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-wallpapers-'));
  const [dusk = ''] = await importAndGetIds(win, [
    await makeTestImage(win, join(dir, 'Placeholder dusk.png'), {
      width: 320,
      height: 180,
      color: '#5b2a86',
    }),
  ]);
  // Two wallpapers, made in the window: the placeholder backdrop and a dusk; none chosen.
  await win.evaluate(
    async (ids) => {
      const d = (globalThis as PageGlobals).drashti;
      for (const id of ids) {
        const added = await d.wallpapers.add([id], null);
        if (!added.ok) throw new Error(added.message);
      }
    },
    [show.pictureMediaId, dusk].filter((id) => id !== ''),
  );
  const { base } = await networkOn(win);
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await p.setViewportSize({ width: 375, height: 812 });
    await pairByQr(p, base, code, '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The phone's own requests, with the token its page keeps; the wallpapers as the window has them stay the same.
    const fromPhone = { win, page: p };
    const desk = () => view(win);

    // Listed: in the window's Playlists panel; refused to the phone (it was under the phone's playlist).
    await expectPhoneRefuses(fromPhone, 'GET', '/api/v1/wallpapers', undefined, 'media', desk);
    await expect(win.getByTestId('wallpapers').getByTestId('wallpaper-tile')).toHaveCount(2);
    await expect(tile(win, 'Placeholder dusk')).toHaveAttribute('aria-pressed', 'false');
    const duskId = (await view(win)).wallpapers.find((w) => w.name === 'Placeholder dusk')?.id ?? '';
    expect(duskId).not.toBe('');

    // Moved to the window (was the phone's tap): one click chooses it. The phone's choice is refused.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/wallpapers/choose',
      { wallpaperId: duskId },
      'media',
      desk,
    );
    await tile(win, 'Placeholder dusk').click();
    await expect.poll(async () => (await view(win)).chosenId).not.toBeNull();
    const now = await view(win);
    expect(now.wallpapers.find((w) => w.id === now.chosenId)?.name).toBe('Placeholder dusk');
    await expect(tile(win, 'Placeholder dusk')).toHaveAttribute('aria-pressed', 'true');
    // Another chosen (through the window's bridge): the dusk's tile follows.
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const other = (await d.wallpapers.view()).wallpapers.find((w) => w.name !== 'Placeholder dusk');
      if (other) await d.wallpapers.choose(other.id);
    });
    await expect(tile(win, 'Placeholder dusk')).toHaveAttribute('aria-pressed', 'false');
    // Moved to the window (was the phone's tap on the chosen one): a click on the chosen one chooses none (black).
    // The phone's "none" is refused, the other still chosen.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      '/api/v1/wallpapers/choose',
      { wallpaperId: null },
      'media',
      desk,
    );
    await win
      .getByTestId('wallpapers')
      .locator('[data-testid="wallpaper-tile"][aria-pressed="true"]')
      .click();
    await expect.poll(async () => (await view(win)).chosenId).toBeNull();
    // Nothing serious for a screen reader, where the wallpapers now are.
    await expectNoSeriousA11yIssues(
      win,
      'the wallpapers in the operator window',
      '[data-testid="wallpapers"]',
    );

    // Moved to the window (was the phone's long press): Rename…, through the tile's right-click menu. The phone's
    // rename is refused.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/wallpapers/${duskId}/rename`,
      { name: 'Placeholder evening sky' },
      'media',
      desk,
    );
    await tile(win, 'Placeholder dusk').click({ button: 'right' });
    await win.getByRole('menu').getByRole('menuitem', { name: 'Rename…' }).click();
    await win.getByTestId('rename-field').fill('Placeholder evening sky');
    await win.getByTestId('rename-save').click();
    await expect(tile(win, 'Placeholder evening sky')).toBeVisible();
    await expect
      .poll(async () => (await view(win)).wallpapers.map((w) => w.name).sort())
      .toContain('Placeholder evening sky');
    // Moved to the window: Delete (not chosen: at once), and Undo brings it back. The phone's delete and its Undo
    // are refused.
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/wallpapers/${duskId}/delete`,
      undefined,
      'media',
      desk,
    );
    await tile(win, 'Placeholder evening sky').click({ button: 'right' });
    await win.getByRole('menu').getByRole('menuitem', { name: 'Delete…' }).click();
    await expect(tile(win, 'Placeholder evening sky')).toHaveCount(0);
    await expect.poll(async () => (await view(win)).wallpapers.length).toBe(1);
    await expectPhoneRefuses(
      fromPhone,
      'POST',
      `/api/v1/wallpapers/${duskId}/restore`,
      undefined,
      'media',
      desk,
    );
    await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
    await expect(tile(win, 'Placeholder evening sky')).toBeVisible();
    await expect.poll(async () => (await view(win)).wallpapers.length).toBe(2);
  } finally {
    await phone.close();
    await app.close();
  }
});
