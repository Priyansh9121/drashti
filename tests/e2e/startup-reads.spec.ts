import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { launchApp, operatorPage, operatorReady, relaunchApp, type PageGlobals } from './helpers';

/*
 * The reads a window needs as it opens say what they could not read, with Try again (Session 39): the
 * playlists (Pro Mode and Simple Mode, never "No playlists" when there are some, and Simple Mode's Next says
 * why it does nothing), an open playlist's items, the presentation the slide grid opens (never "Opening the
 * presentation…" for good), and the show's state (asked again by itself after 1, 2 and 5 s, then said). The
 * test switch DRASHTI_TEST_UNREADABLE holds a read failing until the test makes it readable. Placeholder
 * content only.
 */

/** A library with a playlist of the two sample presentations, made and quit cleanly. */
async function libraryWithPlaylist(): Promise<string> {
  const { app, userData } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const [a, b] = await d.library.listPresentations();
    const made = await d.playlists.create('Placeholder sabha', null, false);
    if (!made.ok) throw new Error(made.message);
    await d.playlists.addItems(made.ids[0] ?? '', null, [
      { kind: 'presentation', presentationId: a?.id ?? '' },
      { kind: 'presentation', presentationId: b?.id ?? '' },
    ]);
  });
  await app.close();
  return userData;
}

/** Make a read the test held failing answer again. */
const readable = (app: ElectronApplication, name: string) =>
  app.evaluate((_electron, n) => {
    (globalThis as { drashtiTestReadable?: (name: string) => void }).drashtiTestReadable?.(n);
  }, name);

/** The main process's log lines naming a failed start-up read of `what`. */
const logged = (userData: string, what: string) => () =>
  readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`Start-up: Drashti could not read ${what} for a window`));

async function opened(
  env: Record<string, string>,
  userData: string,
): Promise<{ app: ElectronApplication; win: Page }> {
  const { app } = await relaunchApp(userData, env);
  const win = await operatorPage(app);
  await win.setViewportSize({ width: 1280, height: 720 });
  await operatorReady(win);
  return { app, win };
}

test('Pro Mode: playlists that could not be read say so with Try again, never “No playlists yet”', async () => {
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'playlists' }, userData);
  const panel = win.getByTestId('playlists');
  const unread = panel.getByTestId('playlists-unread');
  await expect(unread).toBeVisible();
  await expect(unread).toHaveAttribute('role', 'alert');
  await expect(unread).toContainText('Drashti couldn’t read the playlists');
  await expect(panel.getByText('No playlists yet')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'playlists that could not be read, Pro Mode');
  // Try again while it still fails: still said.
  await panel.getByTestId('playlists-try-again').click();
  await expect(unread).toBeVisible();
  await expect(panel.getByText('No playlists yet')).toHaveCount(0);
  // It answers: Try again, from the keyboard, brings the playlist and the message goes.
  await readable(app, 'playlists');
  await panel.getByTestId('playlists-try-again').focus();
  await win.keyboard.press('Enter');
  await expect(panel.getByTestId('playlist-node').filter({ hasText: /^Placeholder sabha/u })).toBeVisible();
  await expect(unread).toHaveCount(0);
  await expect.poll(logged(userData, 'the playlists')).toHaveLength(1);
  await app.close();
});

test('Simple Mode: playlists that could not be read say so, Next says why it does nothing, and Try again brings them', async () => {
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'playlists' }, userData);
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const simple = win.getByTestId('simple-mode');
  await expect(simple).toBeVisible();
  const unread = simple.getByTestId('playlists-unread');
  await expect(unread).toBeVisible();
  await expect(simple.getByText('No playlists', { exact: true })).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'playlists that could not be read, Simple Mode');
  // Next has nothing to start: it says why, never nothing at all.
  await simple.getByRole('button', { name: /^Next/u }).click();
  await expect(win.getByTestId('operator-notice')).toContainText(
    'Next has nothing to start: Drashti couldn’t read the playlist',
  );
  expect(
    await win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.live.playlist,
    ),
  ).toBeNull();
  await readable(app, 'playlists');
  await simple.getByTestId('playlists-try-again').click();
  await expect(unread).toHaveCount(0);
  await expect(simple.getByTestId('simple-playlist')).toBeVisible();
  await expect(simple.getByTestId('simple-item')).toHaveCount(2);
  // Now Next starts the playlist.
  await simple.getByRole('button', { name: /^Next/u }).click();
  await expect(simple.getByTestId('simple-item').first()).toHaveAttribute('aria-current', 'true');
  await app.close();
});

test('an open playlist whose items could not be read says so in both modes, never “This playlist is empty”', async () => {
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'playlist-items' }, userData);
  await win
    .getByTestId('playlist-node')
    .filter({ hasText: /^Placeholder sabha/u })
    .click();
  const items = win.getByTestId('playlist-items-unread');
  await expect(items).toBeVisible();
  await expect(items).toContainText('Drashti couldn’t read this playlist');
  await expect(win.getByText('This playlist is empty')).toHaveCount(0);
  // Simple Mode says it too, beside the playlist it opened.
  await win.getByRole('button', { name: 'Simple Mode' }).click();
  const simple = win.getByTestId('simple-mode');
  await expect(simple.getByTestId('playlist-items-unread')).toBeVisible();
  await expect(simple.getByTestId('simple-item')).toHaveCount(0);
  await readable(app, 'playlist-items');
  await simple.getByTestId('playlist-items-try-again').click();
  await expect(simple.getByTestId('simple-item')).toHaveCount(2);
  await expect(simple.getByTestId('playlist-items-unread')).toHaveCount(0);
  await expect.poll(logged(userData, 'a playlist’s items')).toHaveLength(1);
  await app.close();
});

test('a presentation that could not be opened says so with Try again, never “Opening the presentation…” for good', async () => {
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'presentation' }, userData);
  const again = win.getByTestId('presentation-try-again');
  await expect(again).toBeVisible();
  const said = win.getByRole('alert').filter({ has: again });
  await expect(said).toContainText(/Drashti couldn’t open “.+”/u);
  await expect(win.getByText('Opening the presentation…')).toBeHidden();
  await expect(win.getByTestId('slide-thumb')).toHaveCount(0);
  await expectNoSeriousA11yIssues(win, 'a presentation that could not be opened');
  await readable(app, 'presentation');
  await again.click();
  await expect(win.getByTestId('slide-thumb').first()).toBeVisible();
  await expect(again).toHaveCount(0);
  await expect.poll(logged(userData, 'a presentation')).toHaveLength(1);
  await app.close();
});

test('the show’s state is asked for again by itself, then said with Try again; Next waits for it', async () => {
  test.setTimeout(90_000);
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'engine' }, userData);
  const next = win.getByTestId('show-next');
  const unread = win.getByTestId('engine-unread');
  // Asked again after 1, 2 and 5 s before it is said: not said at first.
  await expect(unread).toHaveCount(0);
  await expect(next).toBeDisabled();
  await expect(unread).toBeVisible({ timeout: 20_000 });
  await expect(unread.getByRole('alert')).toContainText('Drashti couldn’t read what the screens are showing');
  await expect(next).toBeDisabled();
  await expectNoSeriousA11yIssues(win, 'the show’s state could not be read');
  await readable(app, 'engine');
  await win.getByTestId('engine-try-again').click();
  await expect(unread).toHaveCount(0);
  await expect(next).toBeEnabled();
  await next.click();
  await expect(win.getByTestId('slide-thumb').first()).toHaveAttribute('aria-current', 'true');
  await expect.poll(logged(userData, 'the show’s state')).toHaveLength(1);
  await app.close();
});

test('the show’s state that answers on a later ask comes by itself, with nothing said', async () => {
  const userData = await libraryWithPlaylist();
  const { app, win } = await opened({ DRASHTI_TEST_UNREADABLE: 'engine' }, userData);
  await expect(win.getByTestId('show-next')).toBeDisabled();
  await readable(app, 'engine');
  // The next ask, within 1 + 2 + 5 s of the window opening, gets it: nothing is said.
  await expect(win.getByTestId('show-next')).toBeEnabled({ timeout: 12_000 });
  await expect(win.getByTestId('engine-unread')).toHaveCount(0);
  await app.close();
});
