import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdStill, launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';
import { testFfmpeg } from './stream-helpers';

/*
 * Live appearances (Session 60, the owner's Q60-36 (3), his motion safety rule "Yes, A" and Q60-45): a live look's
 * touch moves only in the header and the band, behind every word, by transform and opacity alone, never on LIVE or
 * the show's controls; it never moves without a graphics chip (CI's Windows draws without one: there it must never
 * appear), and Moving: Off, interface motion Off and Reduce motion hold it still, as does streaming or recording on
 * a slow computer (four logical cores or fewer); it comes back by itself. A still look never draws it. Placeholder
 * content only; recording into a folder of the test's own, never to the internet.
 */

const look = (win: Page, where: 'header' | 'band') => win.getByTestId(`look-motion-${where}`);

/** The window has opened settled (ui/motion.ts): only then may anything move. */
async function opened(win: Page): Promise<void> {
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
}

/** Whether Chromium draws without a graphics chip, once it has said (data-chip: unknown until then). */
async function chipless(win: Page): Promise<boolean> {
  await expect(win.locator('html')).toHaveAttribute('data-chip', /^(yes|no)$/u);
  return (await win.locator('html').getAttribute('data-chip')) === 'no';
}

/** Every animation running on a live look's touch: whether it is in a look's layer, and the properties it moves. */
const animations = (win: Page) =>
  win.evaluate(() =>
    document.getAnimations().map((a) => {
      const effect = a.effect as KeyframeEffect | null;
      const target = effect?.target ?? null;
      const props = new Set<string>();
      for (const frame of effect?.getKeyframes() ?? []) for (const p of Object.keys(frame)) props.add(p);
      return {
        inLook: target?.closest('[data-touch-layer]') !== null && target !== null,
        onShow: target?.closest('[data-show-control], [data-header-states]') !== null && target !== null,
        props: [...props],
      };
    }),
  );
const lookAnimations = async (win: Page) => (await animations(win)).filter((a) => a.inLook);
/** No look's layer and no touch animating. */
const nothingMoves = async (win: Page) =>
  (await look(win, 'header').count()) === 0 &&
  (await look(win, 'band').count()) === 0 &&
  (await lookAnimations(win)).length === 0;
const KEYFRAME_FIELDS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
const MOVES = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity']);

/** A live look moving now: its layers there and its touches animating; or, without a chip, never there. */
async function expectMoving(
  win: Page,
  where: readonly ('header' | 'band')[],
  noChip: boolean,
): Promise<void> {
  if (noChip) {
    await holdStill(() => nothingMoves(win), 1500, 'without a graphics chip a live look never moves');
    return;
  }
  for (const w of where) await expect(look(win, w)).toHaveCount(1);
  await expect.poll(async () => (await lookAnimations(win)).length).toBeGreaterThan(0);
}

async function expectStill(win: Page): Promise<void> {
  for (const w of ['header', 'band'] as const) await expect(look(win, w)).toHaveCount(0);
  await expect.poll(async () => (await lookAnimations(win)).length).toBe(0);
}

test('a live look moves in the header and the band only, behind every word, by transform and opacity; never LIVE or the show’s controls, and never without a graphics chip', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_APPEARANCE: 'diwali' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await opened(win);
  const noChip = await chipless(win);
  await expectMoving(win, ['header', 'band'], noChip);
  if (!noChip) {
    for (const where of ['header', 'band'] as const) {
      await expect(look(win, where)).toHaveAttribute('aria-hidden', 'true');
      expect(await look(win, where).evaluate((el) => (el as HTMLElement).inert)).toBe(true);
      expect(await look(win, where).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    }
    // Only transform and opacity move, only in a look's layers, never on LIVE's panel or a show control.
    const all = await animations(win);
    const touches = all.filter((a) => a.inLook);
    expect(touches.length).toBeGreaterThan(0);
    for (const a of touches)
      expect(
        a.props.filter((p) => !KEYFRAME_FIELDS.has(p) && !MOVES.has(p)),
        a.props.join(' '),
      ).toEqual([]);
    expect(all.filter((a) => a.inLook && a.onShow)).toEqual([]);
    // Behind every word: the name and the header's buttons are what a point over them finds, never a touch.
    const header = win.getByTestId('app-header');
    for (const part of [header.locator('h1'), header.getByRole('button', { name: /Screens/u }).first()]) {
      const box = await part.boundingBox();
      if (!box) throw new Error('the header’s name and buttons are drawn');
      const under = await win.evaluate(
        ([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('[data-touch-layer]') !== null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(under).toBe(false);
    }
  }
  await app.close();
});

test('Moving: Off, interface motion Off and Reduce motion hold a live look still, and it comes back by itself', async () => {
  const { app } = await launchApp({ DRASHTI_TEST_APPEARANCE: 'dusk-slate' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await opened(win);
  const noChip = await chipless(win);
  await expectMoving(win, ['header'], noChip);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMoving(false));
  await expect(win.locator('html')).toHaveAttribute('data-moving', 'off');
  await expectStill(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMoving(true));
  await expect(win.locator('html')).toHaveAttribute('data-moving', 'on');
  await expectMoving(win, ['header'], noChip);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('off'));
  await expectStill(win);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.appearance.setMotion('calm'));
  await expectMoving(win, ['header'], noChip);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await expectStill(win);
  await win.emulateMedia({ reducedMotion: 'no-preference' });
  await expectMoving(win, ['header'], noChip);
  await app.close();
});

test('without a graphics chip a live look never moves, and a still look never draws a touch', async () => {
  const chipOff = await launchApp({
    DRASHTI_TEST_APPEARANCE: 'uttarayan',
    DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software',
  });
  const win = await operatorPage(chipOff.app);
  await operatorReady(win);
  await opened(win);
  expect(await chipless(win)).toBe(true);
  await expectMoving(win, ['header'], true);
  await chipOff.app.close();
  const still = await launchApp({ DRASHTI_TEST_APPEARANCE: 'dhaja' });
  const page = await operatorPage(still.app);
  await operatorReady(page);
  await opened(page);
  await holdStill(() => nothingMoves(page), 1500, 'a still look never draws a touch');
  await still.app.close();
});

/** Recording begun, into a folder of the test's own (stream-pictures.spec.ts's way): never to the internet. */
async function record(app: ElectronApplication, win: Page): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-look-record-'));
  await app.evaluate(({ dialog }, into) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [into] });
  }, dir);
  const began = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const folder = await d.stream.pickFolder();
    if (!folder.ok) return folder.message;
    const r = await d.stream.startRecording();
    return r.ok ? 'ok' : r.message;
  });
  expect(began, 'recording begun').toBe('ok');
}

test('streaming or recording holds a live look still on a slow computer (four logical cores or fewer), and not on a faster one', async () => {
  // CI fetches FFmpeg first (scripts/fetch-ffmpeg.mjs): there, a missing one is a failure, not a skip.
  test.skip(
    !testFfmpeg() && !process.env['CI'],
    'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs',
  );
  test.setTimeout(180_000);
  for (const cores of ['4', '8']) {
    const { app } = await launchApp({
      DRASHTI_TEST_APPEARANCE: 'sandhya',
      DRASHTI_TEST_CORES: cores,
      DRASHTI_TEST_FAKE_DEVICES: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await opened(win);
    await expect(win.locator('html')).toHaveAttribute('data-slow', cores === '4' ? 'true' : 'false');
    const noChip = await chipless(win);
    await expectMoving(win, ['header'], noChip);
    await record(app, win);
    if (cores === '4') await expectStill(win);
    else await expectMoving(win, ['header'], noChip);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.stream.stopRecording());
    await expectMoving(win, ['header'], noChip);
    await app.close();
  }
});
