import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage } from './helpers';

/*
 * The design system: the component gallery (Diagnostics > Component Gallery)
 * shows every shared component, and none of them has a serious or critical
 * accessibility finding.
 */

test('the component gallery opens from the Diagnostics menu and passes the accessibility checks', async () => {
  const { app } = await launchApp({ DRASHTI_DIAGNOSTICS: '1' });
  // The menu is in place once the operator window is.
  await expect((await operatorPage(app)).getByTestId('live-status')).toBeVisible();
  const opened = app.waitForEvent('window', { predicate: (w) => w.url().includes('gallery.html') });
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('component-gallery')?.click();
  });
  const gallery = await opened;
  await expect(gallery.getByTestId('gallery')).toBeVisible();
  await expect(gallery.getByRole('heading', { name: 'Component gallery' })).toBeVisible();
  await gallery.evaluate(() => document.fonts.ready);
  await expectNoSeriousA11yIssues(gallery, 'the component gallery');

  // A dialog keeps the keyboard inside it and closes with Esc, giving the focus back.
  const opener = gallery.getByRole('button', { name: 'Open a dialog' });
  await opener.click();
  const dialog = gallery.getByRole('dialog', { name: 'Words of “Placeholder Kirtan”' });
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yIssues(gallery, 'a dialog');
  for (let i = 0; i < 5; i++) {
    await gallery.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await gallery.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  // A confirmation has the harmless choice focused.
  await gallery.getByRole('button', { name: 'Ask before removing' }).click();
  const confirm = gallery.getByRole('alertdialog', { name: 'Remove “Placeholder Kirtan”?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expectNoSeriousA11yIssues(gallery, 'a confirmation');
  await gallery.keyboard.press('Escape');

  // The splitter moves with the keyboard.
  const handle = gallery.getByRole('separator', { name: 'Resize the example panel' });
  await handle.focus();
  await gallery.keyboard.press('ArrowRight');
  await expect(handle).toHaveAttribute('aria-valuenow', '256');
  await gallery.keyboard.press('Enter');
  await expect(handle).toHaveAttribute('aria-valuenow', '240');

  // DRASHTI_GALLERY_SHOTS=<folder>: a picture of each section, to look at by hand.
  const shots = process.env['DRASHTI_GALLERY_SHOTS'];
  if (shots)
    for (const section of await gallery.locator('main section[id]').all())
      await section.screenshot({ path: `${shots}/gallery-${(await section.getAttribute('id')) ?? ''}.png` });
  await app.close();
});
