import { longPress } from './phone-gestures';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { device, networkOn, NETWORK_ENV, pairByQr, pairingCode } from './devices';
import { importAndGetIds, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { setUpPlaceholderShow } from './placeholder-show';
import { makeTestImage } from './test-media';

/*
 * The wallpapers on a phone (Session 55, Part 9, from Part 6): listed under the playlist's rows as the window has them
 * under its playlists, each a small picture with its name; one tap chooses one (what the screens show whenever nothing
 * is up), a tap on the chosen one chooses none; a long press opens its menu: Use as the wallpaper, Rename…, and Delete
 * with Undo. Every control a thumb's size. Placeholder pictures only (generated).
 */

const view = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.wallpapers.view());

test('the wallpapers on a phone: listed under the playlist, one tap chooses one, a long press renames or deletes it with Undo (Safari’s engine)', async () => {
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
    await p.getByTestId('remote-tab-playlist').click();
    const section = p.getByTestId('remote-wallpapers');
    const tile = (name: string) => section.getByTestId('remote-wallpaper').filter({ hasText: name });
    // The preview is lazy: scrolling it into view starts its real image request. A phone taps the
    // settled picture, rather than a mouse clicking its replaceable waiting DIV while that arrives.
    const tapTile = async (target: Locator) => {
      await target.scrollIntoViewIfNeeded();
      const picture = target.locator('img[data-preview="shown"]');
      await expect(picture).toBeVisible();
      await expect
        .poll(() =>
          picture.evaluate(
            (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await target.tap();
    };
    await expect(section.getByTestId('remote-wallpaper')).toHaveCount(2);
    await expect(tile('Placeholder dusk')).toHaveAttribute('aria-pressed', 'false');

    // One tap chooses it, as the window's one click does; the window hears of it.
    await tapTile(tile('Placeholder dusk'));
    await expect.poll(async () => (await view(win)).chosenId).not.toBeNull();
    const now = await view(win);
    expect(now.wallpapers.find((w) => w.id === now.chosenId)?.name).toBe('Placeholder dusk');
    await expect(tile('Placeholder dusk')).toHaveAttribute('aria-pressed', 'true');
    // Chosen in the window: the phone follows.
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const other = (await d.wallpapers.view()).wallpapers.find((w) => w.name !== 'Placeholder dusk');
      if (other) await d.wallpapers.choose(other.id);
    });
    await expect(tile('Placeholder dusk')).toHaveAttribute('aria-pressed', 'false');
    // A tap on the chosen one chooses none (black).
    const other = section.locator('[data-testid="remote-wallpaper"][aria-pressed="true"]');
    await tapTile(other);
    await expect.poll(async () => (await view(win)).chosenId).toBeNull();

    // Every tile a thumb's size, and nothing serious for a screen reader.
    const small = await section.evaluate(
      (root) =>
        [...root.querySelectorAll<HTMLElement>('button')]
          .map((b) => b.getBoundingClientRect())
          .filter((r) => r.width < 44 || r.height < 44).length,
    );
    expect(small).toBe(0);
    await expectNoSeriousA11yIssues(p, 'the wallpapers on a phone');

    // A long press: its menu. Rename…
    const menu = p.getByTestId('remote-row-menu');
    await longPress(tile('Placeholder dusk'));
    await expect(menu.getByTestId('remote-menu-choose')).toBeVisible();
    await menu.getByTestId('remote-menu-rename').click();
    await p.getByTestId('remote-rename').getByRole('textbox').fill('Placeholder evening sky');
    await p.getByTestId('remote-rename-save').click();
    await expect(tile('Placeholder evening sky')).toBeVisible();
    await expect
      .poll(async () => (await view(win)).wallpapers.map((w) => w.name).sort())
      .toContain('Placeholder evening sky');
    // Delete, and Undo brings it back.
    await longPress(tile('Placeholder evening sky'));
    await menu.getByTestId('remote-menu-remove').click();
    await expect(tile('Placeholder evening sky')).toHaveCount(0);
    await expect.poll(async () => (await view(win)).wallpapers.length).toBe(1);
    await p.getByTestId('remote-wallpapers-undo').click();
    await expect(tile('Placeholder evening sky')).toBeVisible();
    await expect.poll(async () => (await view(win)).wallpapers.length).toBe(2);
  } finally {
    await phone.close();
    await app.close();
  }
});
