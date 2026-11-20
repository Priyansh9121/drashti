import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  importAndGetIds,
  launchApp,
  letTimePass,
  operatorPage,
  operatorReady,
  outputPages,
  outputReady,
  setUpScreen,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { audioPage, backgroundTiming, type Copy, dispatch, inStep, row } from './time-bar-helpers';

/*
 * The time bar's ⋯ (alpha.20: the owner's Q60-34 items, his "Yes, all A" to Q60-39 P4 A and P6 (i) A): at the end of
 * each row under LIVE, in Pro Mode. **Repeat from here (A)**, then **…to here (B)**: every screen and the hall's sound
 * go round from A to B together, the row saying A-B; **Stop repeating A-B** plays on from where it is, past B. While
 * paused, **One frame back** and **One frame on** (and Alt with ← and → on the bar) show the frame before or after on
 * every screen. Generated media only, placeholder names, two pretend screens in windows.
 */

const ffmpeg = testFfmpeg();
test.skip(!ffmpeg && !process.env['CI'], 'FFmpeg is not fetched here: run node scripts/fetch-ffmpeg.mjs');

function ff(args: string[]): string {
  const r = spawnSync(ffmpeg ?? '', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], {
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return args.at(-1) ?? '';
}

/** `seconds` of a moving test picture at `fps`, small, with a quiet tone when `sound`. */
const clip = (file: string, seconds: number, fps: number, sound: boolean) =>
  ff([
    ...['-f', 'lavfi', '-i', `testsrc2=s=160x90:r=${String(fps)}:d=${String(seconds)}`],
    ...(sound ? ['-f', 'lavfi', '-i', `sine=f=440:r=48000:d=${String(seconds)}`] : []),
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', String(fps)],
    ...(sound ? ['-af', 'volume=0.2', '-c:a', 'aac', '-b:a', '64k', '-shortest'] : ['-an']),
    file,
  ]);

/** Two pretend screens in windows, each showing the audience, ready. */
async function twoScreens(app: ElectronApplication, win: Page): Promise<[Page, Page]> {
  await setUpScreen(win, 'Main Hall', 0);
  await setUpScreen(win, 'Overflow', 1);
  await expect.poll(() => outputPages(app).length).toBe(2);
  const [a, b] = outputPages(app) as [Page, Page];
  for (const o of [a, b]) await outputReady(o);
  return [a, b];
}

const upAsBackground = async (win: Page, mediaId: string) => {
  expect(
    (
      await dispatch(win, {
        type: 'setBackground',
        background: { kind: 'media', mediaId, media: 'video', fit: 'fill', loop: false },
      })
    ).ok,
  ).toBe(true);
  // Its row under LIVE, once its length is known.
  await expect(
    row(win, 'background').getByRole('slider', { name: 'Time of the background video', exact: true }),
  ).toBeVisible({ timeout: 15_000 });
};

const at = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector<HTMLMediaElement>(s)?.currentTime ?? -1, selector);

test('A-B repeat from the time bar’s ⋯: two screens and the hall’s sound go round from A to B together; Stop plays on past B; the menu with the keyboard', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-ab-repeat-'));
    const [mediaId = ''] = await importAndGetIds(win, [
      clip(join(dir, 'Placeholder ab clip.mp4'), 12, 25, true),
    ]);
    expect(mediaId).not.toBe('');
    const [a, b] = await twoScreens(app, win);
    const audio = await audioPage(app);
    const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
    const copies: Copy[] = [
      { name: 'the first screen', page: a, selector: picture },
      { name: 'the second screen', page: b, selector: picture },
      { name: 'the audio player', page: audio, selector: `audio[data-media-id="${mediaId}"]`, sound: true },
    ];
    await upAsBackground(win, mediaId);
    const bg = row(win, 'background');
    const more = bg.getByRole('button', { name: 'More for Background' });

    // A at 4 s and B at 6 s, each where it waits (paused, then moved there).
    expect((await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } })).ok).toBe(true);
    expect((await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 4000 })).ok).toBe(
      true,
    );
    await more.click();
    await win.getByRole('menuitem', { name: 'Repeat from here (A)' }).click();
    expect((await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: 6000 })).ok).toBe(
      true,
    );
    // B with the keyboard: the ⋯ opened with Enter, its item reached with the arrows.
    await more.focus();
    await win.keyboard.press('Enter');
    const toB = win.getByRole('menuitem', { name: '…to here (B)' });
    await expect(toB).toBeVisible();
    await expectNoSeriousA11yIssues(win, 'the time bar’s ⋯');
    for (let i = 0; i < 8 && !(await toB.evaluate((e) => e === document.activeElement)); i++)
      await win.keyboard.press('ArrowDown');
    await expect(toB).toBeFocused();
    await win.keyboard.press('Enter');

    // Repeating: the row says A-B, and every copy goes round between 4 and 6 s, in step.
    await expect(bg.getByText('A-B', { exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const t = await backgroundTiming(win);
        return { from: t.clip?.startMs, to: t.clip?.endMs, loop: t.loop };
      })
      .toEqual({ from: 4000, to: 6000, loop: true });
    expect((await dispatch(win, { type: 'resumePlaying', playing: { layer: 'background' } })).ok).toBe(true);
    await inStep(copies, () => backgroundTiming(win), 'repeating A-B');
    const until = Date.now() + 6000;
    while (Date.now() < until) {
      for (const c of copies) {
        const t = await at(c.page, c.selector);
        expect(t, `${c.name}, from A`).toBeGreaterThan(3.75);
        expect(t, `${c.name}, to B`).toBeLessThan(6.25);
      }
      await letTimePass(win, 250, 'it goes round between A and B');
    }
    await inStep(copies, () => backgroundTiming(win), 'still in step after going round');

    // Stop: it plays on from where it is, past B, its own points and once-only playing back.
    await more.click();
    await win.getByRole('menuitem', { name: 'Stop repeating A-B' }).click();
    await expect(bg.getByText('A-B', { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        const t = await backgroundTiming(win);
        return { clip: t.clip ?? null, loop: t.loop };
      })
      .toEqual({ clip: null, loop: false });
    await expect.poll(() => at(a, picture), { timeout: 10_000 }).toBeGreaterThan(6.5);
  } finally {
    await app.close();
  }
});

test('one frame back and on while paused, at 25 and at 60 a second, from the ⋯ and with Alt and the arrows: both screens show that frame', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-frame-step-'));
    const [a, b] = await twoScreens(app, win);
    for (const fps of [25, 60]) {
      const [mediaId = ''] = await importAndGetIds(win, [
        clip(join(dir, `Placeholder ${String(fps)} a second.mp4`), 3, fps, false),
      ]);
      expect(mediaId).not.toBe('');
      await upAsBackground(win, mediaId);
      const bg = row(win, 'background');
      const bar = bg.getByRole('slider', { name: 'Time of the background video', exact: true });
      const picture = `[data-layer="background"] video[data-media-id="${mediaId}"]`;
      /** Both screens paused on frame `n` (counted from 0). */
      const shows = async (n: number, how: string) => {
        for (const [name, page] of [
          ['the first screen', a],
          ['the second screen', b],
        ] as const)
          await expect
            .poll(
              () =>
                page.evaluate(
                  ({ selector, fps }) => {
                    const v = document.querySelector<HTMLMediaElement>(selector);
                    return v?.paused ? Math.floor(v.currentTime * fps + 1e-3) : -1;
                  },
                  { selector: picture, fps },
                ),
              { message: `${how}: ${name} on frame ${String(n)} of the ${String(fps)} a second video` },
            )
            .toBe(n);
      };
      expect((await dispatch(win, { type: 'pausePlaying', playing: { layer: 'background' } })).ok).toBe(true);
      // Into the middle of frame `fps` (one second in), where it waits.
      const second = Math.round(((fps + 0.5) * 1000) / fps);
      expect(
        (await dispatch(win, { type: 'moveTo', playing: { layer: 'background' }, toMs: second })).ok,
      ).toBe(true);
      await shows(fps, 'paused one second in');
      const more = bg.getByRole('button', { name: 'More for Background' });
      await more.click();
      await win.getByRole('menuitem', { name: 'One frame on' }).click();
      await shows(fps + 1, 'one frame on');
      await bar.focus();
      await win.keyboard.press('Alt+ArrowRight');
      await shows(fps + 2, 'Alt and →');
      await win.keyboard.press('Alt+ArrowLeft');
      await shows(fps + 1, 'Alt and ←');
      await more.click();
      await win.getByRole('menuitem', { name: 'One frame back' }).click();
      await shows(fps, 'one frame back');
      await dispatch(win, { type: 'clearLayer', layer: 'background' });
    }
  } finally {
    await app.close();
  }
});
