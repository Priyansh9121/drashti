import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiCall, NETWORK_ENV, networkOn, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  holdStill,
  importAndGetIds,
  launchApp,
  openLibrary,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
} from './helpers';
import { makeTestTone } from './test-media';

/*
 * The keys the operators already press (Session 50, from their presentation program's menus), pressed for real
 * (Session 51, S5-3: no test pressed F7): F5 takes the sound off, F6 the messages and F7 the ticker, each leaving
 * everything else up, on the engine and on the screens; F4 and F8 do nothing (Session 55: Props and Masks went);
 * F12 covers the picture with the Wallpaper (the Logo's key; black until Part 6 brings wallpapers) and F12 again
 * uncovers it. Simple Mode's key line names F12 for the Wallpaper. View › Audience and Stage show ⌘1 and ⌘2 (Ctrl+1 and
 * Ctrl+2) without binding them (S2-6), and the window takes every press of them. Placeholder words, a generated tone,
 * and this computer's own network only.
 */

/** The operator page's globals, with the presses of 1 and 2 a test keeps. */
type Pressed = typeof globalThis & { digitPresses?: KeyboardEvent[] };

/** A command to the show engine, which must be taken. */
async function dispatch(win: Page, command: unknown): Promise<void> {
  const result = await win.evaluate(
    (c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never),
    command,
  );
  expect(result.ok, JSON.stringify(command)).toBe(true);
}

/** An announcement from a phone, on this computer's own network, approved into the ticker. */
async function tickerUp(win: Page, text: string): Promise<void> {
  const { port } = await networkOn(win);
  const token = await pairToken(win, port, 'announcements', 'Placeholder poster');
  const sent = await apiCall(port, '/api/v1/announcements', {
    method: 'POST',
    token,
    body: { text, from: 'Placeholder poster', minutes: 10 },
  });
  expect(sent.status).toBe(202);
  const id = (sent.json['announcement'] as { id: string }).id;
  const approved = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.announcements.approve({ id, as: 'ticker' }),
    id,
  );
  expect(approved.ok).toBe(true);
}

/** The window that plays the show's sound. */
async function audioPage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((w) => w.url().includes('audio.html'))).toBe(true);
  const page = app.windows().find((w) => w.url().includes('audio.html'));
  if (!page) throw new Error('no audio player');
  return page;
}

/** Nothing has the keyboard: the show's keys act anywhere in the window then. */
const letGo = (win: Page) =>
  win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

/** What is up as the engine has it: each layer the keys clear, and the Wallpaper over the picture. */
const up = (win: Page) =>
  win.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return {
      background: s.layers.background !== null,
      slide: s.layers.slide !== null,
      sound: s.layers.audio !== null,
      messages: s.layers.messages.length > 0,
      ticker: s.layers.ticker !== null,
      wallpaper: s.wallpaper,
    };
  });

/** The same as the audience screen draws it, and the sound as the audio player plays it. */
const drawn = async (out: Page, audio: Page, soundId: string) => {
  const has = async (page: Page, selector: string) => (await page.locator(selector).count()) > 0;
  return {
    background: await has(out, '[data-layer="background"]'),
    slide: await has(out, '[data-layer="slide"] [data-slide-in]'),
    sound: await has(audio, `audio[data-media-id="${soundId}"]`),
    messages: await has(out, '[data-layer="messages"]'),
    ticker: await has(out, '[data-layer="ticker"]'),
    wallpaper: await has(out, '[data-layer="wallpaper"]'),
  };
};

test('F5 takes the sound off, F6 the messages and F7 the ticker, each leaving the rest; F4 and F8 do nothing; F12 covers the picture with the Wallpaper and F12 again uncovers it (S5-3, Session 55)', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_WINDOWED_OUTPUTS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const out = await outputPage(app);
  await outputReady(out);
  const audio = await audioPage(app);
  const dir = mkdtempSync(join(tmpdir(), 'drashti-function-keys-'));
  const [soundId = ''] = await importAndGetIds(win, [
    makeTestTone(join(dir, 'Placeholder tone.wav'), { seconds: 20, hz: 330 }),
  ]);
  expect(soundId).not.toBe('');

  // Everything up: a background, a slide, the tone (going round), a message, and the ticker.
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1d4e89' } });
  const sample = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    return (await d.library.listPresentations()).find((p) => p.name.startsWith('Sample kirtan'))?.id ?? '';
  });
  expect(sample).not.toBe('');
  await dispatch(win, { type: 'goLive', presentationId: sample, slideIndex: 0 });
  await dispatch(win, {
    type: 'playAudio',
    audio: { id: 'placeholder-tone', title: 'Placeholder tone', mediaId: soundId, volume: 1, loop: true },
  });
  await dispatch(win, {
    type: 'showMessage',
    message: { id: 'placeholder-message', text: 'Placeholder message' },
  });
  await tickerUp(win, 'Placeholder announcement');
  const all = {
    background: true,
    slide: true,
    sound: true,
    messages: true,
    ticker: true,
    wallpaper: false,
  };
  await expect.poll(() => up(win)).toEqual(all);
  await expect.poll(() => drawn(out, audio, soundId)).toEqual(all);

  // Each key takes its own layer off and leaves the rest, on the engine, the screen and the sound.
  await letGo(win);
  // F4 and F8 first: they took the props and the masks off until Session 55, and do nothing now.
  const steps = [
    { key: 'F4', left: all },
    { key: 'F5', left: { ...all, sound: false } },
    { key: 'F6', left: { ...all, sound: false, messages: false } },
    { key: 'F7', left: { ...all, sound: false, messages: false, ticker: false } },
    { key: 'F8', left: { ...all, sound: false, messages: false, ticker: false } },
  ];
  for (const { key, left } of steps) {
    await win.keyboard.press(key);
    await expect.poll(() => up(win), `${key}: its own layer off, the rest up`).toEqual(left);
    await expect.poll(() => drawn(out, audio, soundId), `${key}: as the screen draws it`).toEqual(left);
  }

  // F12: the Wallpaper over the picture, which carries on underneath (the background and the slide stay up); F12
  // again: the picture as it was.
  const before = { ...all, sound: false, messages: false, ticker: false };
  await win.keyboard.press('F12');
  await expect.poll(() => up(win)).toEqual({ ...before, wallpaper: true });
  await expect(out.getByTestId('wallpaper')).toBeVisible();
  await expect.poll(() => drawn(out, audio, soundId)).toEqual({ ...before, wallpaper: true });
  await win.keyboard.press('F12');
  await expect.poll(() => up(win)).toEqual(before);
  await expect.poll(() => drawn(out, audio, soundId)).toEqual(before);
  await app.close();
});

test('Simple Mode’s buttons name F12 for the Wallpaper (its key line went in Session 56), and F12 covers and uncovers there (S5-3, Session 55)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.singleKeys())).toBe(true);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // No key line (the owner, 11 Nov 2026: "Remove the keys line"): each button shows its key, the Logo's gone.
  await expect(win.getByTestId('simple-keys')).toHaveCount(0);
  const bar = win.getByTestId('simple-buttons');
  await expect(bar.getByTestId('simple-wallpaper').locator('kbd')).toHaveText('F12');
  await expect(bar).not.toContainText('Logo');
  await expect(bar.getByTestId('simple-blackout').locator('kbd')).toHaveText('B');
  await expect(bar.getByTestId('simple-clear-all').locator('kbd')).toHaveText('F1');
  const wallpaperUp = () =>
    win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.wallpaper);
  await letGo(win);
  await win.keyboard.press('F12');
  await expect.poll(wallpaperUp).toBe(true);
  await expect(win.getByTestId('simple-wallpaper')).toHaveText(/Wallpaper is on/u);
  await win.keyboard.press('F12');
  await expect.poll(wallpaperUp).toBe(false);
  await app.close();
});

test('View › Audience and Stage show ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2) unbound, and the window takes every press of them, acting on none in a field or under a dialog (S2-6)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  // As Electron built them: the keymap's keys, shown beside the items, left unbound (Windows' menu then leaves
  // them to the window; the Mac's acts on any key it shows that the window leaves alone, so it takes them all).
  const items = await app.evaluate(({ Menu }) =>
    ['screen-switch-audience', 'screen-switch-stage'].map((id) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id);
      return {
        accelerator: item?.accelerator ?? null,
        registerAccelerator: item?.registerAccelerator ?? null,
      };
    }),
  );
  expect(items).toEqual([
    { accelerator: 'CommandOrControl+1', registerAccelerator: false },
    { accelerator: 'CommandOrControl+2', registerAccelerator: false },
  ]);

  // Each press of 1 or 2, kept to read whether the window took it (its default prevented) once it has gone by.
  await win.evaluate(() => {
    const g = globalThis as Pressed;
    g.digitPresses = [];
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === '1' || e.key === '2') g.digitPresses?.push(e);
      },
      true,
    );
  });
  const taken = () =>
    win.evaluate(() => ((globalThis as Pressed).digitPresses ?? []).map((e) => e.defaultPrevented));
  const bothOn = async () => {
    const s = await win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());
    return s.audience && s.stage;
  };
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  // In a field (the library's search box): taken, nothing typed, nothing turned off.
  await openLibrary(win);
  const search = win.getByTestId('library-search');
  await search.focus();
  await win.keyboard.press(`${mod}+1`);
  await win.keyboard.press(`${mod}+2`);
  await expect(search).toHaveValue('');
  // Under a dialog (the keys sheet): the same.
  await chooseMenuItem(app, 'keyboard-shortcuts');
  await expect(win.getByTestId('keys-sheet')).toBeVisible();
  await win.keyboard.press(`${mod}+1`);
  await win.keyboard.press(`${mod}+2`);
  await holdStill(bothOn, 1000, 'Mod+1 and Mod+2 in a field and under a dialog turn nothing off');
  expect(await taken()).toEqual([true, true, true, true]);
  await win.keyboard.press('Escape');
  await expect(win.getByTestId('keys-sheet')).toHaveCount(0);
  await app.close();
});
