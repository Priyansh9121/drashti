import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { killApp, launchApp, operatorPage, outputPages, relaunchApp, setUpScreen } from './helpers';
import { LOGO, setUpPlaceholderShow } from './placeholder-show';

/*
 * Simple Mode, run with the keys only (the ones a presentation clicker sends
 * included): a short sabha with a welcome slide, a kirtan whose chorus comes
 * three times, a video, black-out and back, the logo and back, and putting
 * things right after Clear all, checking the audience and stage screens at
 * each step. Nothing that can change the library, the screens or the sound
 * can be reached, and after a forced stop Drashti comes back in Simple Mode.
 */

const outputs = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The audience and stage output pages. */
async function screens(app: ElectronApplication): Promise<{ audience: Page; stage: Page }> {
  await expect.poll(() => outputPages(app).length).toBe(2);
  const pages = outputPages(app);
  const roles = await Promise.all(pages.map((p) => p.getByTestId('output-root').getAttribute('data-role')));
  const audience = pages[roles.indexOf('audience')];
  const stage = pages[roles.indexOf('stage')];
  if (!audience || !stage) throw new Error(`roles: ${roles.join(', ')}`);
  return { audience, stage };
}

/** Two screens (audience and stage), the placeholder sabha with a video, and its logo marked. */
async function setUp(win: Page) {
  const show = await setUpPlaceholderShow(win, { video: true });
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (logoId) => {
    const d = (globalThis as PageGlobals).drashti;
    const snapshot = await d.screens.get();
    const stage = snapshot.groups.find((g) => g.name === 'Stage');
    if (stage) await d.screens.setGroupRole(stage.id, 'stage');
    const marked = await d.props.setLogo(logoId);
    if (!marked.ok) throw new Error(marked.message);
  }, show.logoPropId);
  return show;
}

test('a short sabha in Simple Mode with the keys only, and nothing can be broken', async () => {
  const first = await launchApp(outputs);
  const win = await operatorPage(first.app);
  const show = await setUp(win);
  const { audience, stage } = await screens(first.app);
  const words = audience.locator('[data-layer="slide"]');
  const now = stage.getByTestId('stage-current');

  // Into Simple Mode from the View menu.
  await first.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('switch-mode')?.click();
  });
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('simple-items').getByTestId('simple-item')).toHaveCount(4);

  // Next starts the playlist: the welcome slide, on both screens.
  await win.keyboard.press('ArrowRight');
  await expect(words).toContainText('Placeholder welcome to the sabha');
  await expect(now).toContainText('Placeholder welcome to the sabha');

  // The kirtan, with the clicker's Page Down: chorus, verse, chorus, verse, chorus.
  const kirtan = [
    'Placeholder chorus line',
    'Placeholder first verse',
    'Placeholder chorus line',
    'Placeholder second verse',
    'Placeholder chorus line',
  ];
  for (const [i, line] of kirtan.entries()) {
    await win.keyboard.press('PageDown');
    await expect(win.getByTestId('live-text')).toContainText(`slide ${i + 1} of 5`);
    await expect(words).toContainText(line);
    await expect(now).toContainText(line);
  }
  // The stage screen shows what comes next.
  await expect(stage.getByTestId('stage-next')).toContainText('Video');

  // The video: it takes the words off and plays as the background.
  await win.keyboard.press('PageDown');
  const video = audience.locator('[data-layer="background"] video');
  await expect(video).toHaveCount(1);
  await expect(words).toHaveCount(0);
  await expect(now).toContainText('Video on the screens');

  // One Next too many can be undone: Back (Page Up) brings back the last chorus without the video.
  await win.keyboard.press('PageUp');
  await expect(words).toContainText('Placeholder chorus line');
  await expect(video).toHaveCount(0);
  await expect(win.getByTestId('live-text')).toContainText('slide 5 of 5');
  await win.keyboard.press('PageDown');
  await expect(video).toHaveCount(1);
  const playing = (await state(win)).layers.background;
  expect(playing).toMatchObject({ kind: 'media', mediaId: show.videoMediaId });

  // Black out (the clicker's "." key) and back: exactly what was there, the stage carrying on.
  await win.keyboard.press('.');
  await expect(audience.getByTestId('blackout')).toBeVisible();
  await expect(win.getByTestId('simple-blackout')).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.getByTestId('stage-view')).toContainText('AUDIENCE SCREENS BLACK');
  await win.keyboard.press('b');
  await expect(audience.getByTestId('blackout')).toHaveCount(0);
  expect((await state(win)).layers.background).toEqual(playing);

  // The logo and back.
  await win.keyboard.press('l');
  await expect(audience.getByTestId('logo')).toContainText(LOGO);
  await expect(win.getByTestId('simple-logo')).toHaveText(/Logo is on/u);
  await expect(stage.getByTestId('stage-view')).toContainText('LOGO ON THE AUDIENCE SCREENS');
  await win.keyboard.press('l');
  await expect(audience.getByTestId('logo')).toHaveCount(0);
  expect((await state(win)).layers.background).toEqual(playing);
  await expect(video).toHaveCount(1);

  // Clear all by mistake (F1), then put it right (Cmd/Ctrl+Z, or the big Put it back).
  await win.keyboard.press('F1');
  await expect(video).toHaveCount(0);
  await expect(win.getByTestId('simple-put-back')).toBeVisible();
  await win.keyboard.press(`${mod}+z`);
  await expect(video).toHaveCount(1);
  // The same video, carrying on from its start rather than starting again.
  expect((await state(win)).layers.background).toEqual(playing);
  await expect(win.getByTestId('simple-put-back')).toHaveCount(0);
  await win.keyboard.press('F1');
  await win.getByTestId('simple-put-back').click();
  expect((await state(win)).layers.background).toEqual(playing);
  await expect(stage.getByTestId('stage-view')).toBeVisible();

  // Nothing that can change the library, the screens or the sound is in the window...
  for (const name of [
    'Import…',
    'Edit words',
    'Remove',
    'Themes',
    'Screens',
    'New…',
    'New prop',
    'New message',
    'New timer',
  ])
    await expect(win.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(win.getByRole('textbox', { name: 'Search presentations' })).toHaveCount(0);
  // ...or on a key...
  await win.keyboard.press(`${mod}+Shift+s`);
  await win.keyboard.press('Delete');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  // ...or in the menu...
  const menu = await first.app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu();
    return {
      backup: m?.getMenuItemById('backup-library') ?? null,
      restore: m?.getMenuItemById('restore-library') ?? null,
      switchLabel: m?.getMenuItemById('switch-mode')?.label ?? '',
    };
  });
  expect(menu).toEqual({ backup: null, restore: null, switchLabel: 'Switch to Pro Mode…' });
  // ...and the main process refuses it even if asked directly.
  const refused = await win.evaluate(
    async ({ welcomeId, logoId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const sound = await d.audio.getOutput();
      return {
        remove: await d.library.removePresentations([welcomeId]),
        words: await d.library.saveWords(welcomeId, 'Placeholder changed'),
        import: await d.library.importPaths(['/placeholder.txt']),
        playlist: await d.playlists.create('Placeholder new', null, false),
        prop: await d.props.remove(logoId),
        timer: await d.timers.create({
          name: 'x',
          kind: 'countup',
          durationMs: 0,
          targetTime: null,
          allowsOverrun: false,
        }),
        theme: await d.themes.remove('x'),
        screens: await d.screens.createGroup('Placeholder group'),
        sound: (await d.audio.setOutput({ id: 'x', label: 'Placeholder' })).chosen === sound.chosen,
        names: (await d.library.listPresentations()).length,
      };
    },
    { welcomeId: show.welcomeId, logoId: show.logoPropId },
  );
  const no = { ok: false, message: SIMPLE_MODE_REFUSAL };
  expect(refused).toMatchObject({
    remove: no,
    words: no,
    import: no,
    playlist: no,
    prop: no,
    timer: no,
    theme: no,
    screens: no,
    sound: true,
  });

  // A forced stop: Drashti comes back in Simple Mode, with the show put back.
  // What is live is saved within a quarter of a second of a change: wait for it, then stop dead.
  await expect
    .poll(() => {
      try {
        return readFileSync(join(first.userData, 'live-state.json'), 'utf8');
      } catch {
        return '';
      }
    })
    .toContain(`"mediaId":"${show.videoMediaId ?? ''}"`);
  await killApp(first.app);
  const second = await relaunchApp(first.userData, outputs);
  const win2 = await operatorPage(second.app);
  await expect(win2.getByTestId('simple-mode')).toBeVisible();
  await expect(win2.getByTestId('recovery-notice')).toContainText('the background');
  const { audience: audience2 } = await screens(second.app);
  await expect(audience2.locator('[data-layer="background"] video')).toHaveCount(1);
  // Next carries on from the video item into the picture.
  await win2.getByTestId('recovery-notice').getByRole('button', { name: 'OK' }).click();
  await win2.keyboard.press('ArrowRight');
  await expect(audience2.locator('[data-layer="background"] img')).toHaveCount(1);
  await second.app.close();
});

test('leaving Simple Mode takes the word typed on purpose', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Simple Mode');

  // Only the View menu leads out, and it asks for the word.
  const ask = () =>
    app.evaluate(({ Menu }) => {
      Menu.getApplicationMenu()?.getMenuItemById('switch-mode')?.click();
    });
  await ask();
  const dialog = win.getByTestId('leave-simple');
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'the Switch to Pro Mode question');
  // Enter on its own, or the wrong word, changes nothing.
  await win.keyboard.press('Enter');
  await win.keyboard.type('yes');
  await win.keyboard.press('Enter');
  await expect(dialog).toContainText('Type pro to switch to Pro Mode.');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // Esc stays in Simple Mode, and so does a direct request without the word.
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'))).toMatchObject({
    ok: false,
  });
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // The word: back to Pro Mode.
  await ask();
  await dialog.getByRole('textbox').fill('PRO');
  await dialog.getByRole('button', { name: 'Switch to Pro Mode' }).click();
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(win.getByRole('button', { name: 'Screens', exact: true })).toBeVisible();
  await app.close();
});

test('Simple Mode fits a 1280 x 720 operator display', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('PageDown');
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 5');
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
    if (document.documentElement.scrollHeight > vh) out.push('the page scrolls down');
    const buttons = [...document.querySelectorAll('[data-testid="simple-buttons"] button')];
    const boxes = buttons.map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of boxes) {
      const name = el.textContent.trim();
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) out.push(`${name} is cut off`);
      if (r.height < 56) out.push(`${name} is not big (${r.height} px)`);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${name}: its words do not fit`);
    }
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) {
        const overlap =
          Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left) > 1 &&
          Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top) > 1;
        if (overlap) out.push(`${a.el.textContent.trim()} overlaps ${b.el.textContent.trim()}`);
      }
    });
    const live = document.querySelector('[data-testid="live-preview"]')?.getBoundingClientRect();
    if (!live || live.bottom > vh || live.width < 320) out.push('the live picture does not fit');
    return out;
  });
  expect(problems).toEqual([]);
  await app.close();
});
