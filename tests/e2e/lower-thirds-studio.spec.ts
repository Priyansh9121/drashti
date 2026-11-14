import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { animationById, animationLength } from '../../src/shared/lower-third-animations';
import { DESIGN_MOTIONS, isDesignMotion } from '../../src/shared/lower-third-design-motions';
import { OFFERED_LIST } from '../../src/shared/lower-third-studio';
import { MOTION_NAMES, STYLE_NAMES } from '../../src/shared/lower-third-styles';
import type { LowerThirdTemplate } from '../../src/shared/lower-third-templates';
import { BEST_LOWER_THIRD_TEMPLATES, LOWER_THIRD_TEMPLATES } from '../../src/shared/lower-third-templates';
import type { LowerThird, LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import { isExpectedStudioDiscardClose } from './expected-studio-close';
import { expectFits } from './fit';
import type { PageGlobals } from './helpers';
import {
  launchApp,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  windowShowing,
} from './helpers';
import { holdClock } from './placeholder-slides';
import { CI_WINDOW } from './window-size';

/*
 * The Lower Thirds studio (Session 55, Part 16): Lower Thirds opens a window of its own with a live preview, where
 * a lower third is made from a template (placeholder words only) or from nothing: its words, the style they sit
 * in, its colours, font, place, how it comes in and goes out, a moving background, and whether it hides itself
 * after the seconds chosen (R). Saved, it is in the operator window's panel too; shown from the studio, it is on a
 * placeholder hall screen as made, and it goes out the way chosen. One set to 5 seconds goes by itself. The window
 * at CI's 1024 × 645 and at 1280 × 720: everything in reach. A lower third made before the studio draws as it did.
 * Placeholder words only.
 */

const isStudio = (p: Page) => p.url().includes('lower-thirds.html');
const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

async function start(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; win: Page; out: Page }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', ...env });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  await setUpScreen(win, 'Main Hall', 0);
  const out = await outputPage(app);
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
  return { app, win, out };
}

/** The studio, opened from the Lower Thirds panel as the operator would (More tools). */
async function openStudio(app: ElectronApplication, win: Page): Promise<Page> {
  await openMoreTools(win);
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  const button = panel.getByTestId('lower-third-studio');
  await expect(button).toBeVisible();
  await button.click();
  const studio = await windowShowing(app, isStudio, 'the Lower Thirds studio');
  await expect(studio).toHaveTitle('Drashti Lower Thirds');
  await expect(studio.getByTestId('lt-studio')).toBeVisible({ timeout: 30_000 });
  return studio;
}

async function tab(studio: Page, name: string): Promise<void> {
  await studio.getByRole('tab', { name }).click();
  await expect(studio.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

async function sizeStudio(app: ElectronApplication, studio: Page, size: { width: number; height: number }) {
  await app.evaluate(({ BrowserWindow }, want) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
      ?.setContentSize(want.width, want.height);
  }, size);
  await studio.setViewportSize(size);
  await expect
    .poll(() => studio.evaluate(() => [innerWidth, innerHeight]))
    .toEqual([size.width, size.height]);
}

/** Wholly inside the window, and not under another of these. */
async function expectInView(locator: Locator, what: string): Promise<void> {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  const size = await locator.page().evaluate(() => [innerWidth, innerHeight]);
  expect(box, what).not.toBeNull();
  const b = box ?? { x: -1, y: -1, width: 0, height: 0 };
  expect(b.x, what).toBeGreaterThanOrEqual(-0.5);
  expect(b.y, what).toBeGreaterThanOrEqual(-0.5);
  expect(b.x + b.width, what).toBeLessThanOrEqual((size[0] ?? 0) + 0.5);
  expect(b.y + b.height, what).toBeLessThanOrEqual((size[1] ?? 0) + 0.5);
}

test('Lower Thirds opens the studio, a window of its own with a live preview: one made from a template, its style, background, font, in and out chosen, saved, and shown from the studio as made; axe passes', async () => {
  test.setTimeout(180_000);
  const { app, win, out } = await start();
  const studio = await openStudio(app, win);
  await expectNoSeriousA11yIssues(studio, 'the studio, with no lower thirds yet');

  // From a template with a style of its own: placeholder words, its look, its animation; the live preview plays it.
  // (What is chosen here is read from what the studio offers: a row the Performance run leaves out changes nothing.)
  await studio.getByTestId('studio-templates').click();
  const template = studio.locator('[data-testid="studio-template"]:not([data-style="box"])').first();
  const templateStyle = (await template.getAttribute('data-style')) ?? '';
  await template.click();
  const preview = studio.getByTestId('lower-third-preview');
  const drawn = preview.getByTestId('lower-third-layer');
  await expect(drawn).toHaveAttribute('data-lt-style', templateStyle);
  await expect(drawn).toContainText(/Placeholder|નમૂના|नमूना/u);
  await tab(studio, 'Words');
  const lines = studio.getByTestId('lower-third-line');
  await lines.nth(0).fill('Placeholder speaker');
  await lines.nth(1).fill('Placeholder title');
  await expect(drawn).toContainText('Placeholder speaker');
  await studio.getByTestId('lower-third-where').locator('[data-choice="hall"]').click();

  // Another style, and a font of the studio's: the preview follows at once.
  await tab(studio, 'Style');
  const otherStyle = studio
    .getByTestId('lower-third-style')
    .locator('[data-choice]:not([aria-checked="true"])')
    .first();
  const style = (await otherStyle.getAttribute('data-choice')) ?? '';
  await otherStyle.click();
  await expect(drawn).toHaveAttribute('data-lt-style', style);
  await studio.getByTestId('lower-third-font').selectOption('Mukta');
  await expect(drawn).toHaveAttribute('data-lt-font', 'Mukta');
  await studio.getByTestId('lower-third-align').locator('[data-choice="centre"]').click();
  await expectNoSeriousA11yIssues(studio, 'the studio: Style');

  // In and out, found by their words in the one box where they are chosen.
  await tab(studio, 'Animation');
  const find = studio.getByTestId('lower-third-search');
  await find.fill('from left');
  const inItem = studio.getByTestId('lower-third-animation').nth(1);
  const inId = (await inItem.getAttribute('data-id')) ?? '';
  const inName = (await inItem.textContent()) ?? '';
  expect(inName).toMatch(/left/iu);
  await inItem.click();
  await expect(studio.getByTestId('lower-third-animation-chosen')).toHaveText(inName);
  await expect(preview).toHaveAttribute('data-playing', 'true');
  await find.fill('right');
  // The way in stays chosen while the box finds the ways out.
  await expect(studio.getByTestId('lower-third-animation-chosen')).toHaveText(inName);
  const outItem = studio.locator('[data-testid="lower-third-out-animation"]:not([data-id=""])').first();
  const outId = (await outItem.getAttribute('data-id')) ?? '';
  const outLabel = (await outItem.textContent()) ?? '';
  expect(outLabel).toMatch(/right/iu);
  await outItem.click();
  await expect(studio.getByTestId('lower-third-out-chosen')).toHaveText(outLabel);
  await expectNoSeriousA11yIssues(studio, 'the studio: Animation');

  // A moving background: it moves in the preview while the lower third is up.
  await tab(studio, 'Background');
  const moving = studio
    .getByTestId('lower-third-motion')
    .locator('[data-choice]:not([data-choice="none"])')
    .first();
  const motion = (await moving.getAttribute('data-choice')) ?? '';
  await moving.click();
  await expect(drawn).toHaveAttribute('data-lt-motion', motion);

  await studio.getByTestId('lower-third-save').click();
  const row = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder speaker' });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-saved', 'true');
  // The operator window's panel lists it too.
  const panelRow = win.getByTestId('lower-third-row').filter({ hasText: 'Placeholder speaker' });
  await expect(panelRow).toHaveCount(1);

  // Shown from the studio: on the hall's screen as made, the panel's button saying Hide.
  await studio.getByTestId('studio-show').click();
  const onScreen = out.getByTestId('lower-third-layer');
  await expect(onScreen).toContainText('Placeholder speaker');
  await expect(onScreen).toHaveAttribute('data-lt-style', style);
  await expect(onScreen).toHaveAttribute('data-lt-motion', motion);
  await expect(onScreen).toHaveAttribute('data-lt-animation', inId);
  expect(
    await onScreen
      .locator('[data-lt-line]')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toMatch(/^"?Mukta"?, "?Mukta Vaani"?/u);
  await expect(panelRow.getByTestId('lower-third-show')).toHaveText('Hide');
  await expect(studio.getByTestId('studio-show')).toHaveText('Hide');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  // Its moving background runs while it is up.
  const movedAt = await onScreen.getAttribute('data-lt-motion-at');
  await expect.poll(() => onScreen.getAttribute('data-lt-motion-at')).not.toBe(movedAt);

  // Hidden from the studio: it goes out as chosen, then it is gone.
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-animation', outId);
  await expect(onScreen).toHaveCount(0);
  expect((await snapshot(win)).state.layers.lowerThird).toBeNull();
  await expect(panelRow.getByTestId('lower-third-show')).toHaveText('Show');
  await app.close();
});

test('the template picker plays one preview, finds templates by their words and keeps favourites and recent choices', async () => {
  const { app, win } = await start();
  const studio = await openStudio(app, win);
  await sizeStudio(app, studio, CI_WINDOW);
  const trigger = studio.getByTestId('studio-templates');
  const picker = studio.getByRole('dialog', { name: 'Lower third templates' });
  const search = picker.getByRole('searchbox', { name: 'Find a template' });
  const tile = picker.getByRole('button', { name: 'News band', exact: true });
  const favourite = picker.getByRole('button', { name: 'Favourite News band' });
  const tiles = picker.getByTestId('studio-template');

  await trigger.click();
  await expect(search).toBeFocused();
  const bigPreview = studio.getByTestId('lower-third-preview');
  await expect(bigPreview).not.toHaveAttribute('data-playing', 'true');
  await expect(bigPreview.getByTestId('lower-third-layer')).toHaveAttribute('data-lt-phase', 'still');
  await expect(tile).toHaveAccessibleDescription(/From the left/u);
  await expectInView(picker, 'the template picker at the CI window size');
  await expect(picker.getByRole('button', { name: 'Best 20' })).toHaveAttribute('aria-pressed', 'true');
  expect(await tiles.count()).toBeGreaterThan(1);
  await expectNoSeriousA11yIssues(studio, 'the template picker');

  const picture = tile.getByTestId('lower-third-layer');
  await expect(picture).toHaveAttribute('data-lt-phase', 'still');
  const watchEntrance = () =>
    tile.evaluate((el) => {
      const button = el as HTMLElement;
      delete button.dataset['sawTemplateEntrance'];
      const observer = new MutationObserver(() => {
        if (!button.querySelector('[data-lt-phase="in"]')) return;
        button.dataset['sawTemplateEntrance'] = 'true';
        observer.disconnect();
      });
      observer.observe(button, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-lt-phase'],
      });
    });
  await picker.evaluate((el) => {
    const gallery = el as HTMLElement;
    const observer = new MutationObserver(() => {
      const active = gallery.querySelectorAll('[data-preview-playing="true"]').length;
      const previous = Number(gallery.dataset['maxActivePreviews'] ?? 0);
      gallery.dataset['maxActivePreviews'] = String(Math.max(previous, active));
    });
    observer.observe(gallery, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-preview-playing'],
    });
  });
  await watchEntrance();
  await tile.hover();
  await expect(tile).toHaveAttribute('data-saw-template-entrance', 'true');
  await expect(picker).toHaveAttribute('data-max-active-previews', '1');
  await tile.evaluate((el) => {
    const button = el as HTMLElement;
    const preview = button.querySelector('[data-template-preview]');
    const observer = new MutationObserver(() => {
      if (button.querySelector('[data-template-preview]') !== preview)
        button.dataset['previewRestarted'] = 'true';
    });
    observer.observe(button, { childList: true, subtree: true });
  });
  await favourite.hover();
  await tile.hover();
  await expect(tile).not.toHaveAttribute('data-preview-restarted', 'true');
  await search.hover();
  await expect(picker.locator('[data-preview-playing="true"]')).toHaveCount(0);

  await picker.getByRole('button', { name: 'All templates' }).click();
  await search.fill('NEWS BAND');
  await expect(tiles).toHaveCount(1);
  // No filter panel: the box understands its direction, kind, feel and speed as words.
  await expect(picker.getByRole('combobox')).toHaveCount(0);
  const tags = await tile.evaluate((el) => {
    const data = (el as HTMLElement).dataset;
    return { direction: data['direction'], kind: data['kind'], feel: data['feel'], speed: data['speed'] };
  });
  const wrongDirection = (['left', 'right', 'up', 'down', 'centre'] as const).find(
    (d) => d !== tags.direction,
  );
  expect(wrongDirection).toBeDefined();
  await search.fill(`news band ${wrongDirection ?? ''}`);
  await expect(tiles).toHaveCount(0);
  for (const value of Object.values(tags)) expect(value).toBeTruthy();
  await search.fill(
    `news band ${tags.direction ?? ''} ${tags.kind ?? ''} ${tags.feel ?? ''} ${tags.speed ?? ''}`.toUpperCase(),
  );
  await expect(tiles).toHaveCount(1);
  await expect(tile).toBeVisible();
  await favourite.click();
  await expect(favourite).toHaveAttribute('aria-pressed', 'true');

  await studio.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await studio.reload();
  await trigger.click();
  const favouritesButton = picker.getByRole('button', { name: 'Favourites', exact: true });
  await favouritesButton.click();
  await expect(tiles).toHaveCount(1);
  await expect(favourite).toHaveAttribute('aria-pressed', 'true');
  await favourite.click();
  await expect(tiles).toHaveCount(0);
  await expect(favouritesButton).toBeFocused();
  await picker.getByRole('button', { name: 'All templates' }).click();
  await search.fill('News band');

  await watchEntrance();
  await tile.focus();
  await studio.keyboard.press('Shift+Tab');
  await studio.keyboard.press('Tab');
  await expect(tile).toBeFocused();
  await expect(tile).toHaveAttribute('data-saw-template-entrance', 'true');
  await tile.press('Enter');
  await expect(picker).toHaveCount(0);
  await expect(studio.getByTestId('lower-third-line').first()).toHaveValue('Placeholder name');
  await trigger.click();
  await picker.getByRole('button', { name: 'Recently used', exact: true }).click();
  await expect(tiles).toHaveCount(1);
  await expect(tile).toBeVisible();
  await app.close();
});

test('one search box where an animation is chosen: it finds the ways in and out together by plain words, its quick words put their word in the box, Esc empties it, nothing found has a way back, the keyboard goes from the box into the lists; Templates has the same one box, its filters folded into words; all at CI’s 1024 × 645', async () => {
  test.setTimeout(150_000);
  const { app, win } = await start();
  const studio = await openStudio(app, win);
  await sizeStudio(app, studio, CI_WINDOW);
  await tab(studio, 'Animation');
  const panel = studio.getByRole('tabpanel');
  const at = 'at 1024 × 645';

  // One box, at the top of the place the animation is chosen, for the ways in and the ways out together.
  await expect(panel.getByRole('searchbox')).toHaveCount(1);
  const box = panel.getByRole('searchbox', { name: 'Find an animation' });
  const quick = panel.getByRole('toolbar', { name: 'Quick words' });
  const status = studio.getByTestId('lower-third-search-status');
  const ins = studio.getByTestId('lower-third-animation');
  const outs = studio.locator('[data-testid="lower-third-out-animation"]:not([data-id=""])');
  const ids = (rows: Locator) => rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-id') ?? ''));
  await expectInView(box, `the box ${at}`);
  await expectInView(quick, `its quick words ${at}`);
  await expectInView(ins.first(), `the first way in ${at}`);
  await expectInView(outs.first(), `the first way out ${at}`);
  const every = OFFERED_LIST.length;
  await expect(ins).toHaveCount(every);
  await expect(outs).toHaveCount(every);
  await expect(status).toHaveText(`${String(every)} ways in, ${String(every)} ways out`);

  // Plain words together, as typed: a kind, a direction and a speed; both lists at once.
  await box.fill('slide up slow');
  for (const rows of [ins, outs]) {
    const found = await ids(rows);
    expect(found).toContain('slide-up-slow');
    expect(found).not.toContain('slide-left-slow');
    expect(found.every((id) => id.endsWith('-slow'))).toBe(true);
  }
  // Their other words too: fast is quick, below is up, soft finds the calm ones.
  await box.fill('fast from below');
  expect(await ids(ins)).toContain('slide-up-quick');
  expect((await ids(ins)).every((id) => id.endsWith('-quick'))).toBe(true);
  await box.fill('soft');
  expect(await ids(ins)).toEqual(expect.arrayContaining(['fade-steady', 'softwipe-left-steady']));

  // A quick word puts its word in the box (another of its kind takes the place of the one there), again takes it out.
  await box.fill('');
  const letters = quick.getByRole('button', { name: 'Letters', exact: true });
  await letters.click();
  await expect(letters).toHaveAttribute('aria-pressed', 'true');
  await expect(box).toHaveValue('letters');
  for (const name of await ins.allTextContents()) expect(name).toMatch(/letter by letter/u);
  await quick.getByRole('button', { name: 'Slow', exact: true }).click();
  await expect(box).toHaveValue('letters slow');
  await quick.getByRole('button', { name: 'Quick', exact: true }).click();
  await expect(box).toHaveValue('letters quick');
  await expect(quick.getByRole('button', { name: 'Slow', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect((await ids(ins)).every((id) => id.startsWith('letter-') && id.endsWith('-quick'))).toBe(true);
  await letters.click();
  await expect(box).toHaveValue('quick');
  await expect(letters).toHaveAttribute('aria-pressed', 'false');
  await expectNoSeriousA11yIssues(studio, `the one search ${at}`);

  // Esc empties the box: every one is back.
  await box.press('Escape');
  await expect(box).toHaveValue('');
  await expect(ins).toHaveCount(every);

  // Nothing found says so, with the way back.
  await box.fill('zzzqqq');
  await expect(status).toHaveText('Nothing matches “zzzqqq”.');
  await expect(ins).toHaveCount(0);
  await expect(outs).toHaveCount(0);
  await expectNoSeriousA11yIssues(studio, `the one search, nothing found ${at}`);
  await panel.getByRole('button', { name: 'Clear the search' }).click();
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  await expect(ins).toHaveCount(every);

  // The keyboard: down from the box into what it found, along it with the arrows, Enter chooses, up from the first
  // back to the box; one Tab stop for each list.
  await box.fill('slide up');
  const found = await ids(ins);
  await box.press('ArrowDown');
  await expect(ins.and(studio.locator(`[data-id="${found[0] ?? ''}"]`))).toBeFocused();
  await studio.keyboard.press('ArrowDown');
  const second = ins.and(studio.locator(`[data-id="${found[1] ?? ''}"]`));
  await expect(second).toBeFocused();
  await studio.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(studio.getByTestId('lower-third-animation-chosen')).toHaveText(
    (await second.textContent()) ?? '',
  );
  await studio.keyboard.press('Tab');
  await expect(studio.getByTestId('lower-third-out-animations').locator(':focus')).toHaveCount(1);
  await studio.keyboard.press('Shift+Tab');
  await expect(second).toBeFocused();
  await studio.keyboard.press('ArrowUp');
  await studio.keyboard.press('ArrowUp');
  await expect(box).toBeFocused();

  // Templates: the same one box, its four filters folded into the words it understands, with quick words under it.
  await studio.getByTestId('studio-templates').click();
  const picker = studio.getByRole('dialog', { name: 'Lower third templates' });
  const find = picker.getByRole('searchbox', { name: 'Find a template' });
  await expect(find).toBeFocused();
  await expect(picker.getByRole('searchbox')).toHaveCount(1);
  await expect(picker.getByRole('combobox')).toHaveCount(0);
  const words = picker.getByRole('toolbar', { name: 'Quick words' });
  await expectInView(words, `the templates’ quick words ${at}`);
  const tiles = picker.getByTestId('studio-template');
  const tag = (name: string) => tiles.evaluateAll((els, n) => els.map((el) => el.getAttribute(n)), name);
  await picker.getByRole('button', { name: 'All templates', exact: true }).click();
  await expect(tiles).toHaveCount(LOWER_THIRD_TEMPLATES.length);
  await find.fill('from below');
  await expect(tiles).toHaveCount(LOWER_THIRD_TEMPLATES.filter((t) => t.direction === 'up').length);
  expect((await tag('data-direction')).every((d) => d === 'up')).toBe(true);
  await find.fill('fast');
  expect(await tiles.count()).toBeGreaterThan(0);
  expect(
    await tiles.evaluateAll((els) =>
      els.every(
        (el) => el.getAttribute('data-speed') === 'quick' || el.getAttribute('data-feel') === 'quick',
      ),
    ),
  ).toBe(true);
  await find.fill('');
  const elegant = words.getByRole('button', { name: 'Elegant', exact: true });
  await elegant.click();
  await expect(find).toHaveValue('elegant');
  expect((await tag('data-feel')).every((f) => f === 'elegant')).toBe(true);
  await words.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(find).toHaveValue('bold');
  await expect(elegant).toHaveAttribute('aria-pressed', 'false');
  expect(await tiles.count()).toBeGreaterThan(0);
  expect((await tag('data-feel')).every((f) => f === 'bold')).toBe(true);
  await find.press('ArrowDown');
  await expect(tiles.first()).toBeFocused();
  await expectNoSeriousA11yIssues(studio, `the templates’ one search ${at}`);

  // Nothing found in Best 20 that All has (the first word of a template only All has, a word no template in Best 20
  // has): a way to look there, and the way back.
  const best = new Set(BEST_LOWER_THIRD_TEMPLATES.map((t) => t.id));
  const nameWords = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z]+/u)
      .filter((w) => w !== '');
  const taken = [
    ...BEST_LOWER_THIRD_TEMPLATES.flatMap((t) => [
      ...nameWords(t.name),
      ...nameWords(animationById(t.input.animation).name),
    ]),
    ...Object.values(STYLE_NAMES).flatMap(nameWords),
    ...Object.values(MOTION_NAMES).flatMap(nameWords),
  ];
  const elsewhere = LOWER_THIRD_TEMPLATES.find((t) => {
    const first = nameWords(t.name)[0] ?? '';
    return !best.has(t.id) && first.length > 2 && !taken.some((w) => w.startsWith(first));
  });
  expect(elsewhere, 'a template only All has').toBeDefined();
  const word = nameWords(elsewhere?.name ?? '')[0] ?? '';
  await picker.getByRole('button', { name: 'Best 20' }).click();
  await find.fill(word);
  await expect(tiles).toHaveCount(0);
  await expect(picker.getByTestId('studio-template-status')).toContainText(`Nothing matches “${word}”`);
  await picker.getByRole('button', { name: 'Look in All templates' }).click();
  await expect(picker.getByRole('button', { name: 'All templates', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(picker.getByRole('button', { name: elsewhere?.name ?? '', exact: true })).toBeVisible();
  await find.fill('zzzqqq');
  await expect(picker.getByTestId('studio-template-status')).toContainText('Nothing matches “zzzqqq”');
  await picker.getByRole('button', { name: 'Clear the search' }).click();
  await expect(find).toHaveValue('');
  await expect(find).toBeFocused();
  await expect(tiles).toHaveCount(LOWER_THIRD_TEMPLATES.length);

  // Esc empties the box and leaves the picker open; empty, Esc closes it.
  await find.fill('bold');
  await find.press('Escape');
  await expect(find).toHaveValue('');
  await expect(picker).toBeVisible();
  await find.press('Escape');
  await expect(picker).toHaveCount(0);
  await app.close();
});

test('a name and role design saves, draws its parts in order and hides at the exact end of its exit', async () => {
  const { app, win, out } = await start({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  const studio = await openStudio(app, win);
  await studio.getByTestId('studio-templates').click();
  await studio.getByRole('button', { name: 'Gold underline', exact: true }).click();
  await expect(studio.getByTestId('lower-third-line').nth(1)).toHaveValue('Placeholder role');
  await studio.getByTestId('lower-third-save').click();
  await expect(studio.getByTestId('studio-row').filter({ hasText: 'Placeholder name' })).toHaveAttribute(
    'data-saved',
    'true',
  );
  await studio.getByTestId('studio-show').click();
  const animation = animationById('design-draw-rise');
  const length = animationLength(animation, 'in', 2);
  await expect.poll(async () => (await snapshot(win)).state.layers.lowerThird?.animation).toBe(animation.id);
  const shown = (await snapshot(win)).state.layers.lowerThird;
  const shownAt = shown?.shownAt ?? 0;
  const onScreen = out.getByTestId('lower-third-layer');
  const accent = onScreen.locator('[data-lt-accent]');
  const lines = onScreen.locator('[data-lt-unit]');
  const first = Math.round(length * 0.15);
  await holdClock(app, shownAt + first);
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'in');
  await expect(onScreen).toHaveAttribute('data-lt-at', String(first));
  await expect(accent).toHaveCSS('opacity', '1');
  await expect(accent).not.toHaveCSS('transform', 'none');
  await expect(lines.nth(0)).toHaveCSS('opacity', '0');
  await expect(lines.nth(1)).toHaveCSS('opacity', '0');
  const middle = Math.round(length * 0.5);
  await holdClock(app, shownAt + middle);
  await expect(onScreen).toHaveAttribute('data-lt-at', String(middle));
  await expect(lines.nth(0)).not.toHaveCSS('opacity', '0');
  await expect(lines.nth(1)).toHaveCSS('opacity', '0');
  await holdClock(app, shownAt + length);
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  await expect(lines.nth(1)).toHaveCSS('opacity', '1');
  await holdClock(app, null);

  await studio.getByTestId('studio-show').click();
  await expect.poll(async () => (await snapshot(win)).state.lowerThirdOff?.at ?? 0).toBeGreaterThan(0);
  const hiddenAt = (await snapshot(win)).state.lowerThirdOff?.at ?? 0;
  const outLength = animationLength(animation, 'out', 2);
  await holdClock(app, hiddenAt + Math.round(outLength * 0.5));
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'out');
  await expect(lines.nth(1)).toHaveCSS('opacity', '0');
  await holdClock(app, hiddenAt + outLength - 1);
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'out');
  await expect(onScreen).toHaveAttribute('data-lt-at', String(outLength - 1));
  await holdClock(app, hiddenAt + outLength);
  await expect(onScreen).toHaveCount(0);
  await holdClock(app, null);

  // A plain fade out keeps the long name wrapped exactly as it was while shown.
  await studio
    .getByTestId('lower-third-line')
    .first()
    .fill('Placeholder ' + 'Sample'.repeat(17));
  await tab(studio, 'Animation');
  await studio.getByTestId('lower-third-search').fill('fade');
  const fade = studio.locator('[data-testid="lower-third-out-animation"][data-id="fade-quick"]');
  await fade.click();
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  const firstLine = onScreen.locator('[data-lt-line]').first();
  const height = async () => (await firstLine.boundingBox())?.height ?? 0;
  const wrappedHeight = await height();
  expect(wrappedHeight).toBeGreaterThan(0);
  await studio.getByTestId('studio-show').click();
  await expect.poll(async () => (await snapshot(win)).state.lowerThirdOff?.at ?? 0).toBeGreaterThan(hiddenAt);
  const fadeAt = (await snapshot(win)).state.lowerThirdOff?.at ?? 0;
  await holdClock(app, fadeAt + 1);
  await expect(onScreen).toHaveAttribute('data-lt-at', '1');
  await expect(onScreen).toHaveAttribute('data-lt-animation', 'fade-quick');
  expect(await height()).toBeCloseTo(wrappedHeight, 1);
  await holdClock(app, null);
  await app.close();
});

/** The first design offered (one the Performance run leaves out is not) that `fits` picks. */
function offeredDesign(
  what: string,
  fits: (
    template: LowerThirdTemplate,
    motion: (typeof DESIGN_MOTIONS)[keyof typeof DESIGN_MOTIONS],
  ) => boolean,
): LowerThirdTemplate {
  const found = LOWER_THIRD_TEMPLATES.find(
    (t) => isDesignMotion(t.input.animation) && fits(t, DESIGN_MOTIONS[t.input.animation]),
  );
  if (!found) throw new Error(`No design is offered ${what}`);
  return found;
}

/** A design's line on the screen, as drawn now: its words and the box that lets them rise from behind the line. */
interface WordsInTheirBox {
  text: string;
  /** The box cuts off what reaches past it. */
  overflow: string;
  /** The box's room past the words' line box on each side, in ems of the line's own size. */
  room: { top: number; bottom: number; left: number; right: number };
  /** How far the words are past the box's bottom edge (on their way up) and past its top edge (on their way down). */
  below: number;
  above: number;
}

const wordsInTheirBoxes = (out: Page): Promise<WordsInTheirBox[]> =>
  out.getByTestId('lower-third-layer').evaluate((root) => {
    // The screen's canvas is scaled to its window (the layer is the canvas's width): an em in the window's pixels.
    const scale = root.getBoundingClientRect().width / (root as HTMLElement).offsetWidth;
    return [...root.querySelectorAll<HTMLElement>('[data-lt-unit]')].map((words) => {
      const box = words.parentElement ?? words;
      const b = box.getBoundingClientRect();
      const w = words.getBoundingClientRect();
      const em = parseFloat(getComputedStyle(box).fontSize) * scale;
      const ems = (px: number) => Math.round((px / em) * 1000) / 1000;
      return {
        text: words.textContent,
        overflow: getComputedStyle(box).overflow,
        room: {
          top: ems(w.top - b.top),
          bottom: ems(b.bottom - w.bottom),
          left: ems(w.left - b.left),
          right: ems(b.right - w.right),
        },
        below: ems(w.top - b.bottom),
        above: ems(b.top - w.bottom),
      };
    });
  });

/**
 * Where the band, its accent, its panel, its lines' blocks and its words are drawn (window pixels): as drawn, and with
 * the words' boxes given no room. The same both ways when the room moves nothing.
 */
const drawnWithAndWithoutRoom = (out: Page): Promise<{ drawn: number[]; withoutRoom: number[] }> =>
  out.getByTestId('lower-third-layer').evaluate((root) => {
    const parts = () =>
      [
        ...root.querySelectorAll(
          '[data-lt-band], [data-lt-accent], [data-lt-design-panel], [data-lt-design-line], [data-lt-unit]',
        ),
      ].flatMap((part) => {
        const r = part.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height];
      });
    const boxes = [...root.querySelectorAll<HTMLElement>('[data-lt-unit]')].map((w) => w.parentElement ?? w);
    const kept = boxes.map((box) => box.getAttribute('style') ?? '');
    const drawn = parts();
    for (const box of boxes) {
      box.style.padding = '0';
      box.style.margin = '0';
    }
    const withoutRoom = parts();
    boxes.forEach((box, i) => {
      box.setAttribute('style', kept[i] ?? '');
    });
    return { drawn, withoutRoom };
  });

test('a design’s words keep the marks above and below their letters: their box has room past them on every side, nothing moves for it, and rising or dropping words still start hidden behind its edge (Gujarati and Hindi placeholders)', async () => {
  test.setTimeout(150_000);
  const { app, win, out } = await start({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  const onScreen = out.getByTestId('lower-third-layer');
  // A line box is 1.25 em of the design's Latin font, and Gujarati and Hindi vowel signs (ૈ ે િ ી above, ુ ૂ ु ू below)
  // reach up to about 0.19 em past it: the box keeps 0.3 em at least past the words, and the words' first visible
  // moment on their way up or down is 0.15 em at least past its edge. Placeholder words only.
  const designs = [
    {
      design: offeredDesign(
        'in Oswald whose name rises',
        (t, m) => t.input.look.font === 'Oswald' && m.nameFrom === 'up',
      ),
      lines: ['નમૂના નામ', 'नमूना भूमिका'],
    },
    {
      design: offeredDesign(
        'in Hind whose name rises',
        (t, m) => t.input.look.font === 'Hind' && m.nameFrom === 'up',
      ),
      lines: ['નમૂના નામ', 'નમૂના ભૂમિકા'],
    },
    {
      design: offeredDesign('with stacked labels', (t) => t.input.look.style === 'stacked'),
      lines: ['નમૂના નામ', 'नमूना भूमिका'],
    },
    {
      design: offeredDesign(
        'in Noto Serif whose name drops',
        (t, m) => t.input.look.font === 'Noto Serif' && m.nameFrom === 'down',
      ),
      lines: ['नमूना नाम', 'નમૂના ભૂમિકા'],
    },
    {
      design: offeredDesign('in the words style (its dark halo)', (t) => t.input.look.style === 'words'),
      lines: ['નમૂના નામ', 'नमूना भूमिका'],
    },
  ];
  for (const [n, { design, lines }] of designs.entries()) {
    const animation = animationById(design.input.animation);
    const motion = DESIGN_MOTIONS[design.input.animation as keyof typeof DESIGN_MOTIONS];
    const lowerThird: LowerThird = {
      id: `placeholder-design-${String(n)}`,
      lines: [...lines, ''],
      look: design.input.look,
      where: 'hall',
      animation: animation.id,
    };
    const shown = await win.evaluate(
      (l) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'showLowerThird', lowerThird: l }),
      lowerThird,
    );
    expect(shown, design.name).toMatchObject({ ok: true });
    const shownAt = (await snapshot(win)).state.layers.lowerThird?.shownAt ?? 0;
    await expect(onScreen).toHaveAttribute('data-lt-id', lowerThird.id);

    // Each line on its way up or down, at its first visible moment: wholly past its box's edge, marks and all.
    const timing = animation.timing;
    const starts = timing.box * 0.5 + (timing.lead ?? 0);
    for (const [i, from] of [motion.nameFrom, motion.roleFrom].entries()) {
      if (from !== 'up' && from !== 'down') continue;
      const at = Math.round(starts + i * (timing.stagger ?? 0)) + 1;
      await holdClock(app, shownAt + at);
      await expect(onScreen).toHaveAttribute('data-lt-at', String(at));
      const line = (await wordsInTheirBoxes(out))[i];
      const what = `${design.name}, line ${String(i + 1)} (${line?.text ?? ''}) coming ${from} at ${String(at)} ms`;
      console.info(what, JSON.stringify(line));
      expect
        .soft(from === 'up' ? line?.below : line?.above, `${what}: past its box’s edge (ems)`)
        .toBeGreaterThanOrEqual(0.15);
    }

    // At rest: room past the words on every side, and nothing drawn anywhere else for it.
    const inLength = animationLength(animation, 'in', 2);
    await holdClock(app, shownAt + inLength);
    await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
    const rows = await wordsInTheirBoxes(out);
    console.info(`${design.name} (${design.input.look.font}) at rest`, JSON.stringify(rows));
    expect(rows, design.name).toHaveLength(2);
    for (const [i, line] of rows.entries()) {
      const what = `${design.name}, line ${String(i + 1)} (${line.text})`;
      expect.soft(line.overflow, what).toBe('hidden');
      for (const side of ['top', 'bottom', 'left', 'right'] as const)
        expect
          .soft(line.room[side], `${what}: room past the words, ${side} (ems)`)
          .toBeGreaterThanOrEqual(0.3);
    }
    const { drawn, withoutRoom } = await drawnWithAndWithoutRoom(out);
    expect(withoutRoom, design.name).toHaveLength(drawn.length);
    const moved = Math.max(
      ...drawn.map((v, i) => Math.abs(v - (withoutRoom[i] ?? Number.POSITIVE_INFINITY))),
    );
    expect.soft(moved, `${design.name}: what moves for the room (window pixels)`).toBeLessThan(0.05);

    await holdClock(app, null);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'hideLowerThird' }));
    const off = (await snapshot(win)).state.lowerThirdOff?.at ?? 0;
    await holdClock(app, off + animationLength(animation, 'out', 2));
    await expect(onScreen).toHaveCount(0);
    await holdClock(app, null);
  }
  await app.close();
});

test('R: one set to hide itself after 5 seconds goes by itself, playing its out; one made before the studio shows as it did, a box going out the way it came', async () => {
  test.setTimeout(150_000);
  const { app, win, out } = await start();
  const studio = await openStudio(app, win);
  await studio.getByTestId('studio-new').click();
  await tab(studio, 'Words');
  await studio.getByTestId('lower-third-line').nth(0).fill('Placeholder for five seconds');
  await studio.getByTestId('lower-third-where').locator('[data-choice="hall"]').click();
  await tab(studio, 'Timing');
  await studio.getByTestId('lower-third-stays').locator('[data-choice="seconds"]').click();
  await studio.getByTestId('lower-third-seconds').fill('5');
  await studio.getByTestId('lower-third-seconds').blur();
  await studio.getByTestId('lower-third-save').click();
  const row = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder for five seconds' });
  await expect(row).toHaveAttribute('data-saved', 'true');
  await expect(row).toContainText('5 s');

  await studio.getByTestId('studio-show').click();
  const onScreen = out.getByTestId('lower-third-layer');
  await expect(onScreen).toContainText('Placeholder for five seconds');
  const shownAt = (await snapshot(win)).state.layers.lowerThird?.shownAt ?? 0;
  expect((await snapshot(win)).state.layers.lowerThird?.seconds).toBe(5);
  // By itself, 5 s after it went up: its out from then, by the engine's clock.
  await expect(onScreen).toHaveCount(0, { timeout: 15_000 });
  const off = (await snapshot(win)).state.lowerThirdOff;
  expect(off?.at).toBe(shownAt + 5000);
  await expect(studio.getByTestId('studio-show')).toHaveText('Show');

  // One kept before the studio: no style, no seconds, its out its in backwards.
  const made = await win.evaluate(async (look) => {
    const input: LowerThirdInput = {
      lines: ['Placeholder older', 'Placeholder title', ''],
      look,
      where: 'hall',
      animation: 'slide-left-steady',
    };
    const r = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, input);
    if (!r.ok) throw new Error(r.message);
    return r.id;
  }, DEFAULT_LOWER_THIRD_LOOK);
  const older = studio.getByTestId('studio-row').filter({ hasText: 'Placeholder older' });
  await expect(older).toHaveCount(1);
  await older.getByRole('button').first().click();
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-id', made);
  await expect(onScreen).toHaveAttribute('data-lt-style', 'box');
  await expect(onScreen).toHaveAttribute('data-lt-motion', 'none');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  const band = onScreen.locator('[data-lt-shape]');
  expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(16, 24, 40, 0.85)');
  await studio.getByTestId('studio-show').click();
  await expect(onScreen).toHaveAttribute('data-lt-animation', 'slide-left-steady');
  await expect(onScreen).toHaveCount(0);
  await app.close();
});

test('the studio at CI’s 1024 × 645 and at 1280 × 720: the preview, every tab’s controls and Save in reach, nothing sideways, axe passes; closed with changes not saved, it asks first', async () => {
  test.setTimeout(180_000);
  const { app, win } = await start();
  const studio = await openStudio(app, win);
  await studio.getByTestId('studio-templates').click();
  await studio.locator('[data-testid="studio-template"]').first().click();
  for (const size of [CI_WINDOW, { width: 1280, height: 720 }]) {
    const what = `the studio at ${String(size.width)} × ${String(size.height)}`;
    await sizeStudio(app, studio, size);
    expect(await studio.evaluate(() => document.documentElement.scrollWidth <= innerWidth), what).toBe(true);
    await expectFits(studio.getByTestId('lt-studio'), what);
    await expectInView(studio.getByTestId('lower-third-preview'), `${what}: the preview`);
    const box = await studio.getByTestId('lower-third-preview').boundingBox();
    expect(Math.abs((box?.width ?? 0) / (box?.height ?? 1) - 16 / 9), `${what}: 16:9`).toBeLessThan(0.02);
    expect(box?.width ?? 0, `${what}: the preview big enough to see`).toBeGreaterThanOrEqual(400);
    await expectInView(studio.getByTestId('lower-third-save'), `${what}: Save`);
    await expectInView(studio.getByTestId('studio-show'), `${what}: Show`);
    await expectInView(studio.getByTestId('studio-list'), `${what}: the list`);
    // Each tab: its last control reached (scrolled to within its panel when it must be), nothing cut off sideways.
    const last: Record<string, string> = {
      Words: 'lower-third-where',
      Style: 'lower-third-bottom',
      Animation: 'lower-third-out-animations',
      Background: 'lower-third-motion',
      Timing: 'lower-third-stays',
    };
    for (const [name, testId] of Object.entries(last)) {
      await tab(studio, name);
      // The Background tab's list is long (thirty backgrounds): its last choice is reached by scrolling the panel.
      const control =
        name === 'Background'
          ? studio.getByTestId(testId).locator('[data-choice]').last()
          : studio.getByTestId(testId);
      await control.scrollIntoViewIfNeeded();
      await expectInView(control, `${what}: ${name}`);
      expect(
        await studio.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${what}: ${name}`,
      ).toBe(true);
      await expectNoSeriousA11yIssues(studio, `${what}: ${name}`);
    }
  }
  // Its window closed with changes not saved (the template, never saved) asks first: Keep editing keeps it open,
  // Throw them away closes it.
  const closeIt = () =>
    app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('lower-thirds.html'))
        ?.close();
    });
  await closeIt();
  const ask = studio.getByTestId('keep-changes');
  await expect(ask).toBeVisible();
  await expectNoSeriousA11yIssues(studio, 'the studio asking before it closes');
  await ask.getByRole('button', { name: 'Keep editing' }).click();
  await expect(ask).toHaveCount(0);
  expect(app.windows().some(isStudio)).toBe(true);
  // Diagnostic only: preserve the original real click and its error while recording whether only the studio closed.
  const discardEvents: string[] = [];
  const discardFlags = {
    studioClosed: false,
    studioCrashed: false,
    operatorClosed: false,
    operatorCrashed: false,
    appClosed: false,
    mainExited: false,
  };
  const mark = (name: keyof typeof discardFlags) => () => {
    discardFlags[name] = true;
    discardEvents.push(name);
  };
  const studioClosed = mark('studioClosed');
  const studioCrashed = mark('studioCrashed');
  const operatorClosed = mark('operatorClosed');
  const operatorCrashed = mark('operatorCrashed');
  const appClosed = mark('appClosed');
  const mainExited = mark('mainExited');
  const main = app.process();
  studio.once('close', studioClosed);
  studio.once('crash', studioCrashed);
  win.once('close', operatorClosed);
  win.once('crash', operatorCrashed);
  app.once('close', appClosed);
  main.once('exit', mainExited);
  const parentAlive = () =>
    !win.isClosed() &&
    !discardFlags.operatorCrashed &&
    !discardFlags.appClosed &&
    main.exitCode === null &&
    main.signalCode === null;
  const sayDiscard = (phase: 'before-click' | 'after-click-or-error') => {
    console.log(
      'Studio discard diagnostic',
      JSON.stringify({
        phase,
        ...discardFlags,
        studioIsClosed: studio.isClosed(),
        operatorIsClosed: win.isClosed(),
        studioStillListed: app.windows().some(isStudio),
        parentAlive: parentAlive(),
        events: discardEvents,
      }),
    );
  };
  try {
    await closeIt();
    sayDiscard('before-click');
    expect(parentAlive(), 'the operator and Main are alive before discarding').toBe(true);
    try {
      await studio
        .getByTestId('keep-changes')
        .getByRole('button', { name: 'Throw them away' })
        .click({ noWaitAfter: true });
    } catch (error) {
      // The intended window can close before Electron acknowledges its own final input action.
      // Accept only that exact action/error and the observed Studio-only close, never another failure.
      const expectedClose = isExpectedStudioDiscardClose(error, {
        ...discardFlags,
        studioIsClosed: studio.isClosed(),
        studioStillListed: app.windows().some(isStudio),
        parentAlive: parentAlive(),
      });
      if (!expectedClose) throw error;
      console.log('Studio discard acknowledgement ended at its verified close');
    } finally {
      sayDiscard('after-click-or-error');
    }
    await expect.poll(() => app.windows().some(isStudio)).toBe(false);
    expect(parentAlive(), 'discarding closes the studio, leaving the operator and Main alive').toBe(true);
  } finally {
    studio.off('close', studioClosed);
    studio.off('crash', studioCrashed);
    win.off('close', operatorClosed);
    win.off('crash', operatorCrashed);
    app.off('close', appClosed);
    main.off('exit', mainExited);
  }
  await app.close();
});
