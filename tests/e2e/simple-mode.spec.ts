import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { RECOVERY_MAX_AGE_MS } from '../../src/shared/recovery';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  relaunchApp,
  setUpScreen,
} from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

/*
 * Simple Mode, run with the keys only (the ones a presentation clicker sends
 * included): a short sabha with a welcome slide, a kirtan whose chorus comes
 * three times, a video, black-out and back, the Wallpaper and back, and putting
 * things right after Clear all, checking the audience and stage screens at
 * each step. Nothing that can change the library, the screens or the sound
 * can be reached, and after a forced stop Drashti comes back in Simple Mode (a clean start is Pro Mode).
 * Since Session 55 (Part 18) Simple Mode is Pro Mode's window with only what a one-projector sabha needs (its own
 * spec: simple-sabha.spec.ts), on the playlist open when Drashti switched to it; leaving it is a double-click on
 * Pro Mode, nothing typed (the owner's answer to question 12, changed on 29 Oct 2026).
 */

/** Open the placeholder sabha's playlist in Pro Mode: Simple Mode takes the playlist open when it switches. */
async function openTheSabha(win: Page): Promise<void> {
  await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
  await expect(win.getByTestId('playlist-title')).toHaveText(PLAYLIST);
}

const outputs = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);
const modeOf = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode());

/** The run named in one of the restart-recovery files, or null. */
function sessionIn(userData: string, file: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(userData, file), 'utf8')) as { session?: string }).session ?? null;
  } catch {
    return null;
  }
}

/**
 * Wait until this run has saved the show under its own name, as every run does from its start
 * (Session 20): only then does a stop dead count as this run's. `lastRun` is the run before it, when
 * that one stopped dead too.
 */
async function thisRunSaved(userData: string, lastRun: string | null = null): Promise<void> {
  const before = [null, lastRun, sessionIn(userData, 'live-state.clean')];
  await expect.poll(() => before.includes(sessionIn(userData, 'live-state.json'))).toBe(false);
}

/** Move the saved show's time back, as a run that stopped dead `ms` before the next start leaves it. */
function stoppedAgo(userData: string, ms: number): void {
  const file = join(userData, 'live-state.json');
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(file, JSON.stringify({ ...saved, savedAt: new Date(Date.now() - ms).toISOString() }));
}

/** The audience and stage output pages. */
async function screens(app: ElectronApplication): Promise<{ audience: Page; stage: Page }> {
  await expect.poll(() => outputPages(app).length).toBe(2);
  const pages = outputPages(app);
  const rolesNow = () =>
    Promise.all(pages.map((p) => p.getByTestId('output-root').getAttribute('data-role')));
  // A screen learns its role a moment after its group's role changes.
  await expect.poll(async () => (await rolesNow()).sort().join(', ')).toBe('audience, stage');
  const roles = await rolesNow();
  const audience = pages[roles.indexOf('audience')];
  const stage = pages[roles.indexOf('stage')];
  if (!audience || !stage) throw new Error(`roles: ${roles.join(', ')}`);
  return { audience, stage };
}

/** Two screens (audience and stage), and the placeholder sabha with a video. */
async function setUp(win: Page) {
  const show = await setUpPlaceholderShow(win, { video: true });
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const snapshot = await d.screens.get();
    const stage = snapshot.groups.find((g) => g.name === 'Stage');
    if (stage) await d.screens.setGroupRole(stage.id, 'stage');
  });
  return show;
}

test('a short sabha in Simple Mode with the keys only, and nothing can be broken', async () => {
  const first = await launchApp(outputs);
  const win = await operatorPage(first.app);
  const show = await setUp(win);
  const { audience, stage } = await screens(first.app);
  const words = audience.locator('[data-layer="slide"]');
  const now = stage.getByTestId('stage-current');

  // Into Simple Mode from the View menu, on the playlist open in Pro Mode: its four items (and two headers).
  await openTheSabha(win);
  await chooseMenuItem(first.app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(
    win.getByTestId('playlist-items').locator('[data-testid="playlist-item"]:not([data-kind="header"])'),
  ).toHaveCount(4);

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
  // The video's length, learned from playback, reaches the layer once a screen has read it: wait for it, so
  // the comparisons below see the layer as it stays (Session 38; once on the dev Mac it came between them).
  await expect
    .poll(async () => {
      const background = (await state(win)).layers.background;
      return background?.kind === 'media' && background.mediaId === show.videoMediaId
        ? (background.durationMs ?? 0)
        : 0;
    })
    .toBeGreaterThan(0);
  const playing = (await state(win)).layers.background;
  expect(playing).toMatchObject({ kind: 'media', mediaId: show.videoMediaId });

  // Black-out (the clicker's "." key) and back: exactly what was there, the stage carrying on. One
  // spelling in every mode, and its state in words, said once (Session 25).
  await win.keyboard.press('.');
  await expect(audience.getByTestId('blackout')).toBeVisible();
  // Its words, then its key (Session 51: Simple Mode's big buttons show their keys).
  await expect(win.getByTestId('simple-blackout')).toHaveAccessibleName(/^Black-out is on/u);
  await expect(win.getByTestId('simple-blackout')).not.toHaveAttribute('aria-pressed');
  await expect(stage.getByTestId('stage-view')).toContainText('AUDIENCE SCREENS BLACK');
  await win.keyboard.press('b');
  await expect(audience.getByTestId('blackout')).toHaveCount(0);
  expect((await state(win)).layers.background).toEqual(playing);

  // The Wallpaper (F12, the Logo's key as the operators press it: Session 55, Part 13) and back; L does nothing.
  await win.keyboard.press('F12');
  await expect(audience.getByTestId('wallpaper')).toBeVisible();
  await expect(win.getByTestId('simple-wallpaper')).toHaveText(/Wallpaper is on/u);
  await expect(stage.getByTestId('stage-view')).toContainText('WALLPAPER ON THE AUDIENCE SCREENS');
  await win.keyboard.press('l');
  await expect(audience.getByTestId('wallpaper')).toBeVisible();
  await win.keyboard.press('F12');
  await expect(audience.getByTestId('wallpaper')).toHaveCount(0);
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

  // Nothing that can change the library, the screens or the sound is in the window (bringing things into its one
  // playlist and the wallpapers' Import…, and a row's Rename and Delete in its right-click menu, are Simple Mode's
  // since Session 55, Part 18; Pro Mode's Audio, and a row's Trim, When it ends and Edit slides… since Session 56)...
  for (const name of [
    'Edit words',
    'Edit slides',
    'Remove',
    'Themes',
    'Screens',
    'New…',
    'New prop',
    'New message',
    'New timer',
  ])
    await expect(win.getByRole('button', { name, exact: true })).toHaveCount(0);
  // No trash button anywhere (Session 26a's visible deletes are Pro Mode's; Simple Mode's Delete is in the menu).
  await expect(win.getByTestId('row-delete')).toHaveCount(0);
  await expect(win.getByRole('button', { name: /^(Delete|Remove) / })).toHaveCount(0);
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
      // Import from a Link (Session 25b): never in Simple Mode.
      link: m?.getMenuItemById('import-from-link') ?? null,
      switchLabel: m?.getMenuItemById('switch-mode')?.label ?? '',
    };
  });
  expect(menu).toEqual({ backup: null, restore: null, link: null, switchLabel: 'Switch to Pro Mode' });
  // ...and the main process refuses it even if asked directly.
  const refused = await win.evaluate(
    async ({ welcomeId }) => {
      const d = (globalThis as PageGlobals).drashti;
      const sound = await d.audio.getOutput();
      return {
        remove: await d.library.removePresentations([welcomeId]),
        words: await d.library.saveWords(welcomeId, 'Placeholder changed'),
        // The slide editor's save (Session 7) of a presentation no playlist holds (Simple Mode's Edit slides edits its
        // playlist's own since Session 56), and the default transition, every presentation's.
        slides: await (async () => {
          const other = (await d.library.listPresentations()).find((p) => p.name === 'Language test slides');
          if (!other) return { ok: true, message: 'no placeholder presentation' };
          const opened = await d.library.slidesForEdit(other.id);
          if (!opened.ok) return { ok: true, message: opened.message };
          return d.library.saveSlides(other.id, { ...opened.doc, loop: true }, opened.stamp, true);
        })(),
        transition: await d.library.setDefaultTransition({ kind: 'dissolve', durationMs: 500 }),
        // A playlist's Duplicate (Session 56: making, renaming and deleting one is Simple Mode's, as Pro Mode's left
        // column offers them; a copy is Pro Mode's).
        playlist: await d.playlists.duplicate(
          (await d.playlists.tree()).find((n) => !n.isFolder)?.id ?? 'placeholder-none',
        ),
        timer: await d.timers.create({
          name: 'x',
          kind: 'countup',
          durationMs: 0,
          targetTime: null,
          allowsOverrun: false,
        }),
        screens: await d.screens.createGroup('Placeholder group'),
        sound: (await d.audio.setOutput({ id: 'x', label: 'Placeholder' })).chosen === sound.chosen,
        names: (await d.library.listPresentations()).length,
        // Session 8: kirtans, screens' languages, templates and the setup wizard.
        tracks: await d.kirtans.saveTracks(welcomeId, [{ slideId: 'x', lang: 'en', lines: ['x'] }]),
        kirtan: await d.kirtans.setDetails(welcomeId, null),
        translit: await d.kirtans.makeTransliteration(welcomeId, 'plain', 'replace'),
        translitStyle: await d.kirtans.setTranslitStyle('iso'),
        category: await d.kirtans.addCategory('Placeholder category'),
        languages: await d.screens.setGroupLanguages('x', ['gu']),
        template: await d.playlists.saveAsTemplate('x', { name: 'Placeholder', slots: [] }),
        fromTemplate: await d.playlists.newFromTemplate('x', 'Placeholder', null),
        slot: await d.playlists.addSlot('x', null, { label: 'Placeholder', category: null }),
        setup: await d.setup.finish({ outputs: [], sound: 'skip' }),
        // Session 25c: the highest video quality, an admin's setting (From a Link… itself is Simple Mode's since
        // Part 18, into its one playlist: simple-sabha.spec.ts, through a local stand-in).
        linkQuality: await d.links.setMaxHeight(2160),
        // Rows of what is no playlist (Session 56: a playlist's rows are Simple Mode's in any playlist, never a
        // template's or a folder's).
        otherRows: await d.playlists.addItems('placeholder-other-playlist', null, [
          { kind: 'presentation', presentationId: welcomeId },
        ]),
      };
    },
    { welcomeId: show.welcomeId },
  );
  const no = { ok: false, message: SIMPLE_MODE_REFUSAL };
  expect(refused).toMatchObject({
    remove: no,
    words: no,
    slides: no,
    transition: no,
    playlist: no,
    timer: no,
    screens: no,
    sound: true,
    tracks: no,
    kirtan: no,
    translit: no,
    translitStyle: no,
    category: no,
    languages: no,
    template: no,
    fromTemplate: no,
    slot: no,
    setup: no,
    linkQuality: no,
    otherRows: no,
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

test('leaving Simple Mode asks nothing (Session 55, Part 18): the View menu’s Switch to Pro Mode goes at once; Simple Mode passes the accessibility checks', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await setUpPlaceholderShow(win);
  await openTheSabha(win);
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expectNoSeriousA11yIssues(win, 'Simple Mode');

  // The View menu leads out at once: no question, no word.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.getByRole('button', { name: 'Screens', exact: true })).toBeVisible();
  await app.close();
});

test('Simple Mode fits a 1280 x 720 operator display, its way out at the top, far from the show’s controls', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await setUpPlaceholderShow(win);
  await openTheSabha(win);
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await win.keyboard.press('ArrowRight');
  await win.keyboard.press('PageDown');
  await expect(win.getByTestId('live-text')).toContainText('slide 1 of 5');
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (document.documentElement.scrollWidth > vw) out.push('the page scrolls sideways');
    if (document.documentElement.scrollHeight > vh) out.push('the page scrolls down');
    // The show's controls: the bar along the bottom (Clear all, the Wallpaper, Black-out), and Next and Back.
    const buttons = [
      ...document.querySelectorAll('[data-testid="simple-buttons"] button'),
      ...document.querySelectorAll('[data-testid="show-next"], [data-testid="show-back"]'),
    ];
    const boxes = buttons.map((el) => ({ el, r: el.getBoundingClientRect() }));
    for (const { el, r } of boxes) {
      const name = el.textContent.trim();
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) out.push(`${name} is cut off`);
      if (r.height < 28) out.push(`${name} is too small (${r.height} px)`);
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
    if (!live || live.bottom > vh || live.width < 280) out.push('the live picture does not fit');
    // Session 20: the way out, at the top, well away from the show's controls (Session 55: Pro Mode, double-clicked).
    const leave = document.querySelector('[data-testid="simple-leave"]');
    const lr = leave?.getBoundingClientRect();
    const barTop = Math.min(
      ...[...document.querySelectorAll('[data-testid="simple-buttons"] button')].map(
        (el) => el.getBoundingClientRect().top,
      ),
    );
    if (!leave || !lr || lr.left < 0 || lr.top < 0 || lr.right > vw) out.push('Pro Mode is cut off');
    else if (lr.bottom > barTop - 100) out.push('Pro Mode is near the bar of clears');
    else if (lr.bottom > 80) out.push('Pro Mode is not at the top');
    if (leave && leave.scrollWidth > leave.clientWidth + 1) out.push('Pro Mode: its words do not fit');
    return out;
  });
  expect(problems).toEqual([]);
  await app.close();
});

test('Drashti starts in Pro Mode after a clean quit, comes back in Simple Mode after a crash in it, and in Pro Mode after a crash 3 hours or more before', async () => {
  test.setTimeout(240_000);
  // Simple Mode, then a clean quit: the next start is in Pro Mode (Session 20).
  const first = await launchApp();
  let win = await operatorPage(first.app);
  await operatorReady(win);
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await first.app.close();
  let run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);

  // Simple Mode, then a crash with nothing on the screens: back in Simple Mode. How the last run ended
  // decides, not whether anything was live.
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await thisRunSaved(first.userData);
  const crashedRun = sessionIn(first.userData, 'live-state.json');
  await killApp(run.app);
  run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await modeOf(win)).toBe('simple');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('recovery-notice')).toHaveCount(0);

  // A crash in Simple Mode 3 hours or more before the start counts like a clean quit (Session 21):
  // restart recovery's own limit, for the mode too.
  await thisRunSaved(first.userData, crashedRun);
  await killApp(run.app);
  stoppedAgo(first.userData, RECOVERY_MAX_AGE_MS + 60_000);
  run = await relaunchApp(first.userData);
  win = await operatorPage(run.app);
  await operatorReady(win);
  expect(await modeOf(win)).toBe('pro');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  await expect(win.getByTestId('recovery-notice')).toHaveCount(0);
  await run.app.close();
});

test('Pro Mode on Simple Mode’s own screen, by keyboard alone: one press of Enter stays (saying to press again), two go', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const leave = win.getByTestId('simple-leave');

  // Tab to it, Enter: it says to press again, and stays (nothing typed, no question).
  for (let i = 0; i < 60 && !(await leave.evaluate((el) => el === document.activeElement)); i++)
    await win.keyboard.press('Tab');
  await expect(leave).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('operator-notice')).toContainText('again');
  expect(await modeOf(win)).toBe('simple');
  await expect(win.locator('[aria-modal="true"]')).toHaveCount(0);
  // Enter again, straight after: Pro Mode.
  await win.keyboard.press('Enter');
  await expect(win.getByTestId('simple-mode')).toHaveCount(0);
  expect(await modeOf(win)).toBe('pro');
  await app.close();
});
