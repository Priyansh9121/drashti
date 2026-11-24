import { expect, test, type ElectronApplication } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  type PageGlobals,
} from './helpers';
import { testFfmpeg } from './stream-helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * Combine videos… (alpha.22; the owner, 24 Nov 2026: "new feature, combine 2 videos", "Yes, one after other"): two
 * generated placeholder videos, of different sizes, rates and sound, chosen in Media, put in order and joined into one
 * new video in Media, by the one idle worker, only once off air. Only generated colours and a generated tone.
 */
interface CombineJob {
  id: string;
  name: string;
  state: string;
  note: string | null;
  message: string | null;
  mediaId: string | null;
}
interface CombineGlobals {
  drashti: { media: { combineList(): Promise<CombineJob[]> } };
}
function ffmpeg(args: string[]) {
  const file = testFfmpeg();
  if (!file) throw new Error('The bundled FFmpeg is required.');
  return spawnSync(
    file,
    ['-hide_banner', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1', ...args],
    {
      windowsHide: true,
    },
  );
}
/** A placeholder: one colour, with a generated tone or no sound at all. */
function generated(
  path: string,
  colour: string,
  size: string,
  rate: number,
  seconds: number,
  sound: boolean,
) {
  const made = ffmpeg([
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=${colour}:s=${size}:r=${String(rate)}:d=${String(seconds)}`,
    ...(sound ? ['-f', 'lavfi', '-i', `sine=f=440:r=44100:d=${String(seconds)}`] : []),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    ...(sound ? ['-c:a', 'aac', '-shortest'] : []),
    '-threads',
    '1',
    path,
  ]);
  expect(made.status, made.stderr.toString()).toBe(0);
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** Every file under Media's folder, by its full path. */
function stored(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile() && path.endsWith('.mp4'));
}
/** The picture's colour in its middle, at `at` seconds. */
function middle(file: string, at: string): number[] {
  const read = ffmpeg([
    '-loglevel',
    'error',
    '-ss',
    at,
    '-i',
    file,
    '-frames:v',
    '1',
    '-vf',
    "crop=2:2:'iw/2':'ih/2'",
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    'pipe:1',
  ]);
  expect(read.status, read.stderr.toString()).toBe(0);
  return [...read.stdout.subarray(0, 3)];
}

/** The file read's length in seconds, as FFmpeg says it. */
function lengthOf(file: string): number {
  const read = ffmpeg(['-i', file]).stderr.toString();
  const length = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(read);
  return length ? (Number(length[1]) * 60 + Number(length[2])) * 60 + Number(length[3]) : 0;
}
interface SaveAsGlobals {
  drashtiSaveAs?: string[];
  drashtiOffered?: string[];
}
/** The system's save dialog answers with `path` next (and says where it offered), as manual.spec's does. */
async function answerSaveAs(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    const g = globalThis as SaveAsGlobals;
    g.drashtiSaveAs = [...(g.drashtiSaveAs ?? []), path];
    g.drashtiOffered ??= [];
    dialog.showSaveDialog = (...args: unknown[]) => {
      const options = args.find(
        (a): a is { defaultPath?: string } => typeof a === 'object' && a !== null && 'defaultPath' in a,
      );
      g.drashtiOffered?.push(options?.defaultPath ?? '');
      const answer = g.drashtiSaveAs?.shift();
      return Promise.resolve(
        answer ? { canceled: false, filePath: answer } : { canceled: true, filePath: '' },
      );
    };
  }, path);
}
const offeredSaveAs = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as SaveAsGlobals).drashtiOffered ?? []);

test('Combine videos…: two videos chosen in Media, put in order, joined with a dissolve or a cut into one new video in Media once off air, and exported', async () => {
  const { app, userData } = await launchApp({ DRASHTI_TEST_ON_AIR_HOOK: '1' });
  const dir = mkdtempSync(join(tmpdir(), 'drashti-combine-'));
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await sizeOperatorWindow(app, win, CI_WINDOW);
    await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
    const first = join(dir, 'Placeholder red.mp4');
    const second = join(dir, 'Placeholder blue.mp4');
    // Red: 320 × 180 at 25 fps for 3 s with a tone. Blue: an upright 180 × 320 at 30 fps for 2 s with no sound.
    generated(first, 'red', '320x180', 25, 3, true);
    generated(second, 'blue', '180x320', 30, 2, false);
    const sources = [digest(first), digest(second)];
    const ids = await importAndGetIds(win, [first, second]);
    expect(ids.every((id) => id !== '')).toBe(true);
    const media = join(userData, 'Media');
    const kept = new Map(stored(media).map((path) => [path, digest(path)]));
    // Media's own copies of the two, byte for byte.
    expect([...kept.values()]).toEqual(expect.arrayContaining(sources));

    await openLibrary(win);
    await win.getByTestId('library-tab-media').click();
    // Each by its whole name: the new video's name holds both of theirs.
    const item = (name: string) =>
      win.getByTestId('media-item').filter({ has: win.getByText(name, { exact: true }) });
    const red = item('Placeholder red.mp4');
    const blue = item('Placeholder blue.mp4');
    // One video alone: no Combine videos… in its menu.
    await red.click();
    await red.click({ button: 'right' });
    await expect(win.getByRole('menuitem', { name: 'Edit Video…', exact: true })).toBeVisible();
    await expect(win.getByRole('menuitem', { name: 'Combine videos…', exact: true })).toHaveCount(0);
    await win.keyboard.press('Escape');
    // Both chosen (Cmd-click on a Mac, Ctrl-click on Windows): the menu of either has it.
    await blue.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await blue.click({ button: 'right' });
    await win.getByRole('menuitem', { name: 'Combine videos…', exact: true }).click();
    const dialog = win.getByTestId('combine-videos');
    await expect(dialog).toBeVisible();
    const rows = dialog.getByTestId('combine-videos-row');
    // In Media's order (by name): blue, then red.
    await expect(rows).toHaveText([/Placeholder blue/u, /Placeholder red/u]);
    await dialog.getByRole('button', { name: 'Move “Placeholder red.mp4” up', exact: true }).click();
    await expect(rows).toHaveText([/Placeholder red/u, /Placeholder blue/u]);
    await expect(
      dialog.getByRole('button', { name: 'Move “Placeholder red.mp4” up', exact: true }),
    ).toBeDisabled();
    await expectFits(dialog, 'Combine videos at the CI operator size');
    await expectNoSeriousA11yIssues(win, 'Combine videos');

    // The transition (the owner: "transition between 2 merged videos"): Dissolve of 1 s unless chosen otherwise.
    await expect(dialog.getByLabel('Transition', { exact: true })).toHaveValue('dissolve');
    await expect(dialog.getByLabel('Length', { exact: true })).toHaveValue('1000');
    await expect(dialog.getByLabel('Also save a copy to a file')).not.toBeChecked();

    // On air: it waits, makes nothing, and says so.
    await app.evaluate(() =>
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(true),
    );
    await dialog.getByRole('button', { name: 'Combine', exact: true }).click();
    const jobs = dialog.getByTestId('combine-videos-job');
    const dissolveJob = jobs.nth(0);
    await expect(dissolveJob).toHaveAttribute('data-state', 'waiting');
    await expect(dissolveJob).toContainText('Waits while');
    const list = () =>
      win.evaluate(() => (globalThis as unknown as CombineGlobals).drashti.media.combineList());
    expect(await list()).toMatchObject([
      { name: 'Placeholder red + Placeholder blue.mp4', state: 'waiting', mediaId: null },
    ]);
    expect(stored(media)).toHaveLength(kept.size);
    await test.info().attach('Combine videos, waiting on air', {
      body: await dialog.screenshot(),
      contentType: 'image/png',
    });
    const finished = (at: number) =>
      expect
        .poll(
          async () => {
            const now = (await list())[at];
            if (now?.state === 'failed') throw new Error(now.message ?? 'The combine failed.');
            return now?.state;
          },
          { timeout: 90_000 },
        )
        .toBe('done');

    // Off air: it combines, and the new video is in Media.
    await app.evaluate(() =>
      (globalThis as { drashtiTestOnAir?: (on: boolean) => void }).drashtiTestOnAir?.(false),
    );
    await finished(0);
    await expect(dissolveJob).toHaveAttribute('data-state', 'done');
    await expect(dissolveJob).toContainText('Added “Placeholder red + Placeholder blue.mp4” to Media.');

    // Export… on its notice (the owner: "export button as well to download"): the system's save dialog, offered in
    // Downloads under its name; the very file copied there.
    const exported = join(dir, 'Exported dissolve.mp4');
    await answerSaveAs(app, exported);
    await dissolveJob.getByRole('button', { name: 'Export…', exact: true }).click();
    await expect.poll(() => existsSync(exported), { timeout: 20_000 }).toBe(true);
    await expect(dissolveJob).toContainText('Exported as “Exported dissolve.mp4”.');
    const downloads = await app.evaluate(({ app: electronApp }) => electronApp.getPath('downloads'));
    expect(await offeredSaveAs(app)).toEqual([join(downloads, 'Placeholder red + Placeholder blue.mp4')]);

    // A Cut, with a copy also saved to a file: chosen before it combines.
    await dialog.getByLabel('Transition', { exact: true }).selectOption('cut');
    await expect(dialog.getByLabel('Length', { exact: true })).toBeHidden();
    await dialog.getByLabel('Also save a copy to a file').check();
    const saved = join(dir, 'Saved cut.mp4');
    await answerSaveAs(app, saved);
    await dialog.getByRole('button', { name: 'Combine', exact: true }).click();
    await finished(1);
    const cutJob = jobs.nth(1);
    await expect(cutJob).toHaveAttribute('data-state', 'done');
    await expect(cutJob).toContainText('A copy was saved as “Saved cut.mp4”.');
    expect(existsSync(saved)).toBe(true);
    const [dissolveDone, cutDone] = await list();
    const dissolveId = dissolveDone?.mediaId ?? '';
    expect(dissolveId).not.toBe('');
    expect(cutDone?.mediaId ?? '').not.toBe('');

    // Each exported file is Media's own new copy, byte for byte (copied, never encoded twice).
    const made = stored(media).filter((path) => !kept.has(path));
    expect(made).toHaveLength(2);
    expect(made.map(digest).sort()).toEqual([digest(exported), digest(saved)].sort());
    // The Dissolve: 3 s + 2 s less the 1 s overlap; red, then both mixed half-way through the join, then blue.
    expect(Math.abs(lengthOf(exported) - 4)).toBeLessThanOrEqual(0.2);
    const info = ffmpeg(['-i', exported]).stderr.toString();
    expect(info).toMatch(/Video: h264[^\n]*320x180/u);
    expect(info).toMatch(/Audio: aac/u);
    const [r1 = 0, , b1 = 0] = middle(exported, '1.0');
    const [r2 = 0, , b2 = 0] = middle(exported, '2.5');
    const [r3 = 0, , b3 = 0] = middle(exported, '3.5');
    expect(r1, 'red first').toBeGreaterThan(b1 + 100);
    expect(Math.min(r2, b2), 'red and blue mixed in the dissolve').toBeGreaterThan(50);
    expect(b3, 'blue after the dissolve').toBeGreaterThan(r3 + 100);
    // The Cut: the sum, red until 3 s, then blue.
    expect(Math.abs(lengthOf(saved) - 5)).toBeLessThanOrEqual(0.2);
    const [r4 = 0, , b4 = 0] = middle(saved, '2.5');
    const [r5 = 0, , b5 = 0] = middle(saved, '4.0');
    expect(r4, 'still red at 2.5 s with a cut').toBeGreaterThan(b4 + 100);
    expect(b5, 'blue after the cut').toBeGreaterThan(r5 + 100);

    // It plays in Drashti: its length as made, and its time moves.
    await win.evaluate(async (id) => {
      const video = document.createElement('video');
      video.id = 'combine-videos-check';
      video.muted = true;
      video.src = `drashti-media://media/${id}`;
      document.body.append(video);
      await video.play();
    }, dissolveId);
    const check = () =>
      win.evaluate(() => {
        const video = document.getElementById('combine-videos-check') as HTMLVideoElement;
        return { duration: video.duration, time: video.currentTime, error: video.error?.code ?? null };
      });
    await expect.poll(async () => (await check()).time, { timeout: 10_000 }).toBeGreaterThanOrEqual(0.5);
    const played = await check();
    await win.evaluate(() => {
      const video = document.getElementById('combine-videos-check') as HTMLVideoElement;
      video.pause();
      video.remove();
    });
    expect(played.error).toBeNull();
    expect(Math.abs(played.duration - 4)).toBeLessThanOrEqual(0.2);

    // Show in Media: the window closes, and the new video is the one chosen in Media.
    await dissolveJob.getByRole('button', { name: 'Show in Media', exact: true }).click();
    await expect(dialog).toBeHidden();
    const chosen = win.locator('[data-testid="media-item"][data-marked="true"]');
    await expect(chosen).toHaveCount(1);
    await expect(chosen).toContainText('Placeholder red + Placeholder blue');
    await expect(
      win.getByTestId('media-item').filter({ hasText: 'Placeholder red + Placeholder blue' }),
    ).toHaveCount(2);

    // The originals unchanged: the files imported from, and Media's own copies.
    expect([digest(first), digest(second)]).toEqual(sources);
    for (const [path, hash] of kept) expect(digest(path), path).toBe(hash);
    await expect(red).toBeVisible();
    await expect(blue).toBeVisible();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
