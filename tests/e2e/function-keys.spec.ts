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
 * (Session 51, S5-3: no test pressed F7): F5 takes the sound off, F6 the messages, F7 the ticker and F8 the Masks
 * layer, each leaving everything else up, on the engine and on the screens; F12 covers the picture with the logo
 * and F12 again uncovers it. Simple Mode's key line names F12 or L for the Logo while the single-letter keys are
 * on. View › Audience and Stage show ⌘1 and ⌘2 (Ctrl+1 and Ctrl+2) without binding them (S2-6), and the window
 * takes every press of them. Placeholder words, a generated tone, and this computer's own network only.
 */

const LOGO = 'Placeholder Logo';

/** The operator page's globals, with the presses of 1 and 2 a test keeps. */
type Pressed = typeof globalThis & { digitPresses?: KeyboardEvent[] };

/** A line of placeholder words for a prop. */
const words = (id: string, text: string) => ({
  id,
  kind: 'text' as const,
  frame: { x: 360, y: 440, width: 1200, height: 200 },
  text,
  lang: 'en' as const,
  style: {
    fontFamily: null,
    fontSize: 96,
    fontWeight: 700,
    color: '#ffffff',
    align: 'center' as const,
    verticalAlign: 'middle' as const,
    lineHeight: 1.2,
    shadow: false,
  },
});

/** A placeholder prop marked as the logo, so F12 and L have something to put up. */
async function markLogo(win: Page): Promise<void> {
  const problem = await win.evaluate(
    async (logo) => {
      const d = (globalThis as PageGlobals).drashti;
      const prop = await d.props.save(null, {
        name: logo.name,
        width: 1920,
        height: 1080,
        elements: [logo.words],
      });
      if (!prop.ok) return prop.message;
      const marked = await d.props.setLogo(prop.id);
      return marked.ok ? '' : marked.message;
    },
    { name: LOGO, words: words('placeholder-logo-words', LOGO) },
  );
  expect(problem).toBe('');
}

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

/** What is up as the engine has it: each layer the keys clear, and the logo over the picture. */
const up = (win: Page) =>
  win.evaluate(async () => {
    const s = (await (globalThis as PageGlobals).drashti.engine.snapshot()).state;
    return {
      background: s.layers.background !== null,
      props: s.layers.props.length > 0,
      sound: s.layers.audio !== null,
      messages: s.layers.messages.length > 0,
      ticker: s.layers.ticker !== null,
      masks: s.layers.masks !== null,
      logo: s.logo !== null,
    };
  });

/** The same as the audience screen draws it, and the sound as the audio player plays it. */
const drawn = async (out: Page, audio: Page, soundId: string) => {
  const has = async (page: Page, selector: string) => (await page.locator(selector).count()) > 0;
  return {
    background: await has(out, '[data-layer="background"]'),
    props: await has(out, '[data-layer="props"]'),
    sound: await has(audio, `audio[data-media-id="${soundId}"]`),
    messages: await has(out, '[data-layer="messages"]'),
    ticker: await has(out, '[data-layer="ticker"]'),
    masks: await has(out, '[data-layer="masks"]'),
    logo: await has(out, '[data-layer="logo"]'),
  };
};

test('F5 takes the sound off, F6 the messages, F7 the ticker and F8 the masks, each leaving the rest; F12 covers the picture with the logo and F12 again uncovers it (S5-3)', async () => {
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
  await markLogo(win);

  // Everything up: a background, a prop, the tone (going round), a message, the Masks layer, and the ticker.
  await dispatch(win, { type: 'setBackground', background: { kind: 'color', color: '#1d4e89' } });
  await dispatch(win, {
    type: 'showProp',
    prop: {
      id: 'placeholder-prop',
      name: 'Placeholder prop',
      width: 1920,
      height: 1080,
      elements: [words('placeholder-prop-words', 'Placeholder prop')],
    },
  });
  await dispatch(win, {
    type: 'playAudio',
    audio: { id: 'placeholder-tone', title: 'Placeholder tone', mediaId: soundId, volume: 1, loop: true },
  });
  await dispatch(win, {
    type: 'showMessage',
    message: { id: 'placeholder-message', text: 'Placeholder message' },
  });
  await dispatch(win, {
    type: 'setMask',
    mask: {
      id: 'placeholder-circle',
      name: 'Placeholder circle',
      width: 1920,
      height: 1080,
      mode: 'show',
      shapes: [{ id: 'circle', kind: 'ellipse', frame: { x: 660, y: 240, width: 600, height: 600 } }],
    },
  });
  await tickerUp(win, 'Placeholder announcement');
  const all = {
    background: true,
    props: true,
    sound: true,
    messages: true,
    ticker: true,
    masks: true,
    logo: false,
  };
  await expect.poll(() => up(win)).toEqual(all);
  await expect.poll(() => drawn(out, audio, soundId)).toEqual(all);

  // Each key takes its own layer off and leaves the rest, on the engine, the screen and the sound.
  await letGo(win);
  const steps = [
    { key: 'F5', left: { ...all, sound: false } },
    { key: 'F6', left: { ...all, sound: false, messages: false } },
    { key: 'F7', left: { ...all, sound: false, messages: false, ticker: false } },
    { key: 'F8', left: { ...all, sound: false, messages: false, ticker: false, masks: false } },
  ];
  for (const { key, left } of steps) {
    await win.keyboard.press(key);
    await expect.poll(() => up(win), `${key}: its own layer off, the rest up`).toEqual(left);
    await expect.poll(() => drawn(out, audio, soundId), `${key}: as the screen draws it`).toEqual(left);
  }

  // F12: the logo over the picture, which carries on underneath (the background and the prop stay up); F12
  // again: the picture as it was.
  const before = { ...all, sound: false, messages: false, ticker: false, masks: false };
  await win.keyboard.press('F12');
  await expect.poll(() => up(win)).toEqual({ ...before, logo: true });
  await expect(out.getByTestId('logo')).toContainText(LOGO);
  await expect.poll(() => drawn(out, audio, soundId)).toEqual({ ...before, logo: true });
  await win.keyboard.press('F12');
  await expect.poll(() => up(win)).toEqual(before);
  await expect.poll(() => drawn(out, audio, soundId)).toEqual(before);
  await app.close();
});

test('Simple Mode’s key line names F12 or L for the Logo while the single-letter keys are on, and F12 covers and uncovers there (S5-3)', async () => {
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await markLogo(win);
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.app.singleKeys())).toBe(true);
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple'));
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const keyLine = win.getByTestId('simple-keys');
  await expect(keyLine).toContainText('Logo F12 or L');
  await expect(keyLine).toContainText('Black-out B or .');
  // Every one has a key: none is left to its button.
  await expect(keyLine).not.toContainText('button');
  const logoUp = () =>
    win.evaluate(
      async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.logo !== null,
    );
  await letGo(win);
  await win.keyboard.press('F12');
  await expect.poll(logoUp).toBe(true);
  await expect(win.getByTestId('simple-logo')).toHaveText(/Logo is on/u);
  await win.keyboard.press('F12');
  await expect.poll(logoUp).toBe(false);
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
