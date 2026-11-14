import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { MORE_MOTIONS } from '../../src/shared/lower-third-motions-more';
import { LOWER_THIRD_MOTIONS, motionPieces } from '../../src/shared/lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK } from '../../src/shared/lower-thirds';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';

/*
 * The GPU warm-up draws every moving background of the Lower Thirds studio (Session 58, Q58-18; render/WarmUp.tsx):
 * before a hall screen or the stream's page first draws the show, one scene of small lower thirds draws each background
 * of the registry at two moments of its loop or more, unseen, so a screen with a graphics chip has made what each
 * draws before a show asks for it. The LIVE picture's warm-up leaves it out (the opening waits for that one).
 * Placeholder words only.
 */

/** Tests only: a page's warm-up stays drawn to be looked at (its shadow tree open), with or without a graphics chip. */
const HOLD = { DRASHTI_TEST_HOLD_WARM_UP: '1' };
const WITHOUT_A_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' };

/**
 * The moving backgrounds a page's held warm-up draws: each small lower third's background and how many pieces it drew
 * ("bloom 8"), or null when the page draws no such scene.
 */
const warmBackgroundsIn = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    const tree = document.querySelector(scope)?.querySelector('[data-warm-up]')?.shadowRoot;
    const scene = tree?.querySelector('[data-warm-scene="lower-third-backgrounds"]');
    if (!scene) return null;
    return [...scene.querySelectorAll<HTMLElement>('[data-testid="lower-third-layer"]')].map(
      (l) => `${l.dataset['ltMotion'] ?? ''} ${String(l.querySelectorAll('[data-lt-piece]').length)}`,
    );
  }, scope);

/** Every background of the registry, each with all its pieces, at two moments or more; nothing else. */
function expectEveryBackground(drawn: string[] | null, what: string): void {
  expect(drawn, what).not.toBeNull();
  const all = LOWER_THIRD_MOTIONS.filter((m) => m !== 'none');
  for (const motion of all) {
    const pieces = motionPieces(motion, { ...DEFAULT_LOWER_THIRD_LOOK, motion }).length;
    const times = (drawn ?? []).filter((d) => d === `${motion} ${String(pieces)}`).length;
    expect(times, `${what}: ${motion}, ${String(pieces)} pieces`).toBeGreaterThanOrEqual(2);
  }
  const known = new Set<string>(all);
  for (const d of drawn ?? []) expect(known.has(d.split(' ')[0] ?? ''), `${what}: ${d}`).toBe(true);
}

test('before a hall screen or the stream’s page first draws the show, its warm-up draws every moving background, unseen; the LIVE picture’s draws none', async () => {
  test.setTimeout(180_000);
  // The studio's first seven, part 1's twelve and these eleven: thirty.
  expect(LOWER_THIRD_MOTIONS.filter((m) => m !== 'none').length).toBeGreaterThanOrEqual(
    7 + Object.keys(MORE_MOTIONS).length,
  );
  // Kept drawn even where Chromium draws without a graphics chip: the test asks to look at it.
  const { app } = await launchApp({
    ...HOLD,
    ...WITHOUT_A_CHIP,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_TEST_FAKE_DEVICES: '1',
  });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const live = '[data-testid="live-preview"]';
    await expect(win.locator(`${live} [data-warm-up="during"]`)).toHaveCount(1, { timeout: 30_000 });
    expect(await warmBackgroundsIn(win, live), 'the LIVE picture').toBeNull();
    await setUpScreen(win);
    const out = await outputPage(app);
    const output = '[data-testid="output-root"]';
    await expect(out.locator(`${output} [data-warm-up="during"]`)).toHaveCount(1, { timeout: 30_000 });
    expectEveryBackground(await warmBackgroundsIn(out, output), 'a hall screen');
    await win.getByTestId('open-stream').click();
    const isStream = (p: Page) => p.url().includes('stream.html');
    const program =
      app.windows().find(isStream) ?? (await app.waitForEvent('window', { predicate: isStream }));
    const stream = '[data-testid="program-root"]';
    await expect(program.locator(`${stream} [data-warm-up="during"]`)).toHaveCount(1, { timeout: 30_000 });
    expectEveryBackground(await warmBackgroundsIn(program, stream), 'the stream’s page');
  } finally {
    await app.close();
  }
});
