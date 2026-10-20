import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  cutIntoUnits,
  animationLength,
  LOWER_THIRD_ANIMATIONS,
} from '../../src/shared/lower-third-animations';
import type { LowerThird, LowerThirdInput } from '../../src/shared/lower-thirds';
import { DEFAULT_LOWER_THIRD_LOOK, shownLines } from '../../src/shared/lower-thirds';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { launchApp, openMoreTools, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';

/*
 * Lower Thirds (Session 44; Priyansh: lower thirds in Macros' place). Made in the panel's editor with up to three
 * lines, a look, where it shows and an animation found by its plain words; Show puts it up on a placeholder hall
 * screen and the same button hides it; Clear all takes it off at once and Put it back brings it back; Black-out
 * covers it; one for the stream never shows in the hall. Every animation in the library is drawn on a hall screen
 * at its first, middle and last frame, in and out, with the screen's clock held there: no error, and it ends
 * where it should. Placeholder words only.
 */

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

const input = (name: string, where: LowerThirdInput['where'] = 'hall'): LowerThirdInput => ({
  lines: [name, 'Placeholder title', ''],
  look: DEFAULT_LOWER_THIRD_LOOK,
  where,
  animation: 'fade-quick',
});

async function make(win: Page, lt: LowerThirdInput): Promise<string> {
  return win.evaluate(async (i) => {
    const made = await (globalThis as PageGlobals).drashti.lowerThirds.save(null, i);
    if (!made.ok) throw new Error(made.message);
    return made.id;
  }, lt);
}

async function start(
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; win: Page; out: Page }> {
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', ...env });
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1440, height: 900 });
  await setUpScreen(win, 'Main Hall', 0);
  const out = await outputPage(app);
  // Its fonts loaded and its GPU warmed up: it draws the show from here.
  await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 30_000 });
  return { app, win, out };
}

test('made in the panel, shown on a placeholder hall screen and hidden with one button; found by their words; many deleted at once with one Undo; axe passes', async () => {
  test.setTimeout(150_000);
  const { app, win, out } = await start();
  await openMoreTools(win);
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toContainText('No lower thirds yet');
  await expectNoSeriousA11yIssues(win, 'the Lower Thirds panel, empty', '[data-testid="lower-thirds-panel"]');

  // Made: three lines, the hall's screens, centred, and an animation found by its words.
  await panel.getByTestId('lower-third-new').click();
  const editor = win.getByTestId('lower-third-editor');
  await expect(editor).toBeVisible();
  const lines = editor.getByTestId('lower-third-line');
  await lines.nth(0).fill('Placeholder name');
  await lines.nth(1).fill('Placeholder title');
  await lines.nth(2).fill('Placeholder place');
  await editor.getByTestId('lower-third-where').locator('[data-choice="hall"]').click();
  await editor.getByTestId('lower-third-align').locator('[data-choice="centre"]').click();
  const search = editor.getByTestId('lower-third-search');
  const listed = () => editor.getByTestId('lower-third-animation').allTextContents();
  await search.fill('fade');
  expect((await listed()).length).toBeGreaterThan(10);
  expect((await listed()).every((n) => /fade/iu.test(n))).toBe(true);
  await search.fill('slide left');
  expect(await listed()).toContain('Slide in from left');
  expect(await listed()).not.toContain('Slide in from right');
  await search.fill('bounce');
  expect(await listed()).toEqual(expect.arrayContaining(['Bounce up', 'Pop in']));
  await search.fill('zzzqqq');
  await expect(editor).toContainText('No animation is called that.');
  await search.fill('pop in');
  // Chosen: it plays in the small picture.
  await editor
    .getByTestId('lower-third-animation')
    .filter({ hasText: /^Pop in$/u })
    .click();
  await expect(editor.getByTestId('lower-third-animation-chosen')).toHaveText('Pop in');
  await expect(editor.getByTestId('lower-third-preview')).toHaveAttribute('data-playing', 'true');
  await expect(editor.getByTestId('lower-third-preview').getByTestId('lower-third-layer')).toContainText(
    'Placeholder name',
  );
  await expectNoSeriousA11yIssues(win, 'the lower third’s editor', '[data-testid="lower-third-editor"]');
  await editor.getByTestId('lower-third-save').click();
  await expect(editor).toHaveCount(0);

  // Show: on the hall's screen and in LIVE; the same button says Hide.
  const row = panel.getByTestId('lower-third-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Placeholder name');
  await row.getByTestId('lower-third-show').click();
  const onScreen = out.getByTestId('lower-third-layer');
  await expect(onScreen).toContainText('Placeholder name');
  await expect(onScreen).toContainText('Placeholder place');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  await expect(win.getByTestId('live-preview').getByTestId('lower-third-layer')).toContainText(
    'Placeholder name',
  );
  await expect(row.getByTestId('lower-third-show')).toHaveText('Hide');
  await expect(row).toHaveAttribute('data-up', 'true');
  await expectNoSeriousA11yIssues(
    win,
    'the Lower Thirds panel, one up',
    '[data-testid="lower-thirds-panel"]',
  );
  // Hide: it goes out the way it came, then it is gone.
  await row.getByTestId('lower-third-show').click();
  await expect(onScreen).toHaveCount(0);
  await expect(row.getByTestId('lower-third-show')).toHaveText('Show');
  expect((await snapshot(win)).state.layers.lowerThird).toBeNull();

  // Two chosen with Cmd-A (Ctrl-A), deleted with Delete; one Undo brings both back.
  await make(win, input('Placeholder second'));
  await expect(row).toHaveCount(2);
  await row.first().getByRole('button').first().click();
  await win.keyboard.press(`${mod}+A`);
  await expect(panel.getByTestId('chosen-bar')).toContainText('2 lower thirds chosen');
  await row.first().getByRole('button').first().press('Delete');
  await expect(row).toHaveCount(0);
  await win.getByTestId('undo-removal').getByRole('button', { name: /Undo/u }).click();
  await expect(row).toHaveCount(2);
  await app.close();
});

test('Clear all takes it off at once, as it takes off the slide, and Put it back brings it back; Black-out covers it; one for the stream never shows in the hall', async () => {
  test.setTimeout(120_000);
  const { app, win, out } = await start();
  await openMoreTools(win);
  await make(win, input('Placeholder hall name'));
  await make(win, input('Placeholder stream name', 'stream'));
  const panel = win.getByTestId('lower-thirds-panel');
  await panel.scrollIntoViewIfNeeded();
  const row = (name: string) => panel.getByTestId('lower-third-row').filter({ hasText: name });
  const onScreen = out.getByTestId('lower-third-layer');

  // For the stream: up, but never on the hall's screen.
  await row('Placeholder stream name').getByTestId('lower-third-show').click();
  await expect.poll(async () => (await snapshot(win)).state.layers.lowerThird?.where).toBe('stream');
  await expect(onScreen).toHaveCount(0);

  // For the hall: up, in its place.
  await row('Placeholder hall name').getByTestId('lower-third-show').click();
  await expect(onScreen).toContainText('Placeholder hall name');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');

  // Black-out covers it and leaves it up; off again, it is there as it was.
  await win.getByTestId('blackout-button').click();
  await expect(out.getByTestId('blackout')).toBeVisible();
  expect((await snapshot(win)).state.layers.lowerThird?.lines[0]).toBe('Placeholder hall name');
  await win.getByTestId('blackout-button').click();
  await expect(out.getByTestId('blackout')).toHaveCount(0);
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');

  // Clear all: off at once (no out), with the rest; Put it back brings it back, still.
  await win.getByRole('button', { name: /^Clear all/u }).click();
  await expect(onScreen).toHaveCount(0);
  const cleared = (await snapshot(win)).state;
  expect(cleared.layers.lowerThird).toBeNull();
  expect(cleared.lowerThirdOff).toBeNull();
  await win.getByTestId('put-back').click();
  await expect(onScreen).toContainText('Placeholder hall name');
  await expect(onScreen).toHaveAttribute('data-lt-phase', 'still');
  await app.close();
});

test('every animation at its first, middle and last frame on a hall screen, in and out: drawn without an error, ending where it should', async () => {
  test.setTimeout(900_000);
  const { app, win, out } = await start({ DRASHTI_TEST_CLOCK_HOLD: '1' });
  const errors: string[] = [];
  out.on('pageerror', (e) => errors.push(String(e)));
  const hold = (at: number | null) =>
    app.evaluate(
      (_electron, t) =>
        (globalThis as { drashtiTestHoldClock?: (at: number | null) => number }).drashtiTestHoldClock?.(t) ??
        0,
      at,
    );
  const root = out.getByTestId('lower-third-layer');
  /** The band's and every unit's opacity, transform and clip, as the screen draws them. */
  const drawn = () =>
    root.evaluate((el) => {
      const look = (e: Element) => {
        const s = getComputedStyle(e);
        return { opacity: s.opacity, transform: s.transform, clip: s.clipPath };
      };
      const band = el.querySelector('[data-lt-band]');
      return {
        band: band ? look(band) : null,
        units: [...el.querySelectorAll('[data-lt-unit]')].map(look),
      };
    });
  const atRest = (l: { opacity: string; transform: string; clip: string }) =>
    l.opacity === '1' && l.transform === 'none' && l.clip === 'none';
  const lines = ['Placeholder name', 'Placeholder title'];
  let n = 0;
  for (const a of LOWER_THIRD_ANIMATIONS) {
    n += 1;
    const units = cutIntoUnits(shownLines(lines), a).units;
    const lt: LowerThird = {
      id: `probe-${String(n)}`,
      lines,
      look: DEFAULT_LOWER_THIRD_LOOK,
      where: 'hall',
      animation: a.id,
    };
    await win.evaluate(
      (l) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'showLowerThird', lowerThird: l }),
      lt,
    );
    const shownAt = (await snapshot(win)).state.layers.lowerThird?.shownAt ?? 0;
    const inLength = animationLength(a, 'in', units);
    // Its first frame (1 ms in: a screen draws a change from just after the moment it was made) and its middle.
    for (const t of [1, Math.round(inLength / 2)]) {
      expect(await hold(shownAt + t)).toBeGreaterThan(0);
      await expect(root).toHaveAttribute('data-lt-animation', a.id);
      await expect(root, `${a.name}: in at ${String(t)} ms`).toHaveAttribute('data-lt-at', String(t));
      expect((await drawn()).band, a.name).not.toBeNull();
    }
    // The last frame of its in: at rest.
    await hold(shownAt + inLength);
    await expect(root, `${a.name}: in, at its end`).toHaveAttribute('data-lt-phase', 'still');
    const rest = await drawn();
    expect(rest.band && atRest(rest.band), `${a.name}: its band at rest`).toBe(true);
    expect(rest.units.every(atRest), `${a.name}: every unit at rest`).toBe(true);
    // Out: from at rest, to gone.
    await hold(null);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'hideLowerThird' }));
    const off = (await snapshot(win)).state.lowerThirdOff?.at ?? 0;
    const outLength = animationLength(a, 'out', units);
    for (const t of [1, Math.round(outLength / 2)]) {
      await hold(off + t);
      await expect(root, `${a.name}: out at ${String(t)} ms`).toHaveAttribute('data-lt-at', String(t));
      await expect(root).toHaveAttribute('data-lt-phase', 'out');
    }
    await hold(off + outLength);
    await expect(root, `${a.name}: out, at its end`).toHaveCount(0);
    await hold(null);
  }
  console.info(`${String(n)} animations drawn at 6 frames each`);
  expect(errors).toEqual([]);
  await app.close();
});
