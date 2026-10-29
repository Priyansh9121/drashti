import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import { launchApp, openMoreTools, operatorPage, operatorReady, outputPages } from './helpers';

/*
 * Taken out (Session 55, Part 12: "Gone from the window, the menus, the keys, the phone and the screens"): Props,
 * Looks, the Idle rotation, Masks, Themes (the top bar's button and the theme editor) and the Logo (its button,
 * F12 and L, its setting, MIDI's Logo). F4 and F8 do nothing; F12 is the Wallpaper's (Part 13), which puts the
 * chosen wallpaper up instead of the picture (black until Part 6 brings wallpapers) and takes it off again. A
 * library holding their data still opens, nothing of them on the screens, its groups' languages in Screens and its
 * default theme still the look new presentations start with. Placeholder names and words only.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());
/** Whether the wallpaper is up, as the engine says (undefined before Session 55 had it). */
const wallpaperUp = async (win: Page) =>
  ((await snapshot(win)).state as unknown as Record<string, unknown>)['wallpaper'];

/** Every label in the application menu, its submenus' too. */
const menuLabels = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) => {
    const out: string[] = [];
    interface Item {
      label: string;
      submenu?: { items: Item[] } | null;
    }
    const walk = (items: readonly Item[]) => {
      for (const i of items) {
        out.push(i.label);
        if (i.submenu) walk(i.submenu.items);
      }
    };
    walk(Menu.getApplicationMenu()?.items ?? []);
    return out;
  });

/** The output showing this screen. */
async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  const find = async () => {
    for (const p of outputPages(app))
      if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) return p;
    return null;
  };
  await expect.poll(async () => (await find()) !== null).toBe(true);
  const page = await find();
  if (!page) throw new Error(`no output for ${screenId}`);
  return page;
}

/** The words of what was taken out, as the window, a menu or the phone would say them. */
const GONE = /\b(Props?|Looks?|Masks?|Idle rotation|Themes?|Logo)\b/u;

test('Props, Looks, Masks, the Idle rotation, Themes and the Logo are gone from the window, the menus and the keys; F12 puts the wallpaper up and takes it off', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.setViewportSize({ width: 1280, height: 900 });

  // The top bar: no Themes beside Screens. LIVE: no Props and no Looks; More tools: no Masks, no Idle rotation, and
  // MIDI's words name no Logo.
  await expect(win.getByTestId('app-header').getByRole('button', { name: 'Themes' })).toHaveCount(0);
  for (const id of ['props', 'looks-panel', 'masks-panel', 'idle-panel', 'logo-button'])
    await expect(win.getByTestId(id), id).toHaveCount(0);
  await openMoreTools(win);
  await expect(win.getByRole('complementary', { name: 'Live' })).not.toContainText(GONE);
  // The bottom bar: no clear for props or masks.
  await expect(win.getByTestId('layer-bar')).not.toContainText(GONE);
  // Screens: no Looks and no group's Look (layers, mask, idle, Movement); the languages stay.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const screens = win.getByRole('dialog', { name: 'Screens' });
  for (const id of ['looks-section', 'group-look', 'look-mask', 'look-idle', 'look-movement'])
    await expect(screens.getByTestId(id), id).toHaveCount(0);
  await expect(screens.getByTestId('language-picker').first()).toBeVisible();
  await screens.getByRole('button', { name: 'Close screens' }).click();

  // The menus: none of them.
  expect((await menuLabels(app)).filter((l) => GONE.test(l))).toEqual([]);

  // The keys: L and F4 and F8 do nothing (no word of a logo); F12 puts the wallpaper up, and takes it off.
  expect(await wallpaperUp(win)).toBe(false);
  for (const key of ['l', 'F4', 'F8']) await win.keyboard.press(key);
  await win.keyboard.press('F12');
  await expect.poll(() => wallpaperUp(win)).toBe(true);
  await expect(win.getByText(/logo/iu)).toHaveCount(0);
  await win.keyboard.press('F12');
  await expect.poll(() => wallpaperUp(win)).toBe(false);

  // Keys at a glance: the Wallpaper on F12; no Logo, no clear of props or masks.
  await win.keyboard.press('?');
  const sheet = win.getByTestId('keys-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Wallpaper');
  await expect(sheet).not.toContainText(GONE);
  await app.close();
});

test('the phone and the API have none of them: the phone’s Wallpaper and the API’s /api/v1/wallpaper put the wallpaper up and take it off', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  const { port, base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The clears, as the window's bottom bar has them (Part 13).
    await expect
      .poll(() =>
        p
          .getByTestId('remote-actions')
          .getByRole('button')
          .evaluateAll((b) => b.map((x) => (x as HTMLElement).innerText.replace(/\s+/gu, ' ').trim())),
      )
      .toEqual([
        'Clear all F1',
        'Slide F2',
        'Background F3',
        'Audio F5',
        'Messages F6',
        'Ticker F7',
        'Wallpaper F12',
        'Black-out B',
      ]);
    await p.getByTestId('remote-wallpaper').click();
    await expect.poll(() => wallpaperUp(win)).toBe(true);
    await expect(p.getByTestId('remote-wallpaper')).toContainText('Wallpaper is on');
    await p.getByTestId('remote-wallpaper').click();
    await expect.poll(() => wallpaperUp(win)).toBe(false);
    // More: no Props, Masks, Idle rotation or Looks.
    await p.getByTestId('remote-tab-more').click();
    for (const id of ['remote-props', 'remote-masks', 'remote-idle', 'remote-looks'])
      await expect(p.getByTestId(id), id).toHaveCount(0);
    await expect(p.locator('body')).not.toContainText(GONE);
  } finally {
    await phone.close();
  }

  // The API (Companion, a Stream Deck): their routes are gone; the wallpaper's is there.
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  for (const [method, path] of [
    ['GET', '/api/v1/logo'],
    ['POST', '/api/v1/logo'],
    ['GET', '/api/v1/looks'],
    ['GET', '/api/v1/props'],
    ['GET', '/api/v1/masks'],
    ['POST', '/api/v1/idle/start'],
    ['POST', '/api/v1/idle/stop'],
  ] as const)
    expect(
      (await apiCall(port, path, { method, token, body: method === 'POST' ? {} : undefined })).status,
      path,
    ).toBe(404);
  for (const layer of ['props', 'masks'])
    expect(
      (await apiCall(port, `/api/v1/clear/${layer}`, { method: 'POST', token, body: {} })).status,
    ).not.toBe(200);
  expect(
    (await apiCall(port, '/api/v1/wallpaper', { method: 'POST', token, body: { on: true } })).status,
  ).toBe(200);
  await expect.poll(() => wallpaperUp(win)).toBe(true);
  expect((await apiCall(port, '/api/v1/wallpaper', { method: 'POST', token, body: {} })).status).toBe(200);
  await expect.poll(() => wallpaperUp(win)).toBe(false);
  await app.close();
});

test('a library holding props, a logo, masks, Looks, the idle rotation and a theme of its own opens: its languages in Screens, none of them on the screens, new words in its default look', async () => {
  test.setTimeout(150_000);
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
  // Written as alpha.13 kept it (schema 49), with what Part 12 took out (main/old-library-selftest.ts).
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, TWO_OUTPUTS, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_SELFTEST: 'old-library',
    DRASHTI_TEST_QUIET: '1',
    DRASHTI_SELFTEST_LIBRARY: JSON.stringify({
      schema: 49,
      held: true,
      groups: [
        { name: 'Hall', role: 'audience', languages: ['gu', 'translit'], display: 0 },
        { name: 'Stage', role: 'stage', languages: ['gu'], display: 1 },
      ],
    }),
  });
  const code = await new Promise<number | null>((resolve) => {
    spawn(electron, ['.'], { env, stdio: 'ignore' }).on('exit', resolve);
  });
  expect(code).toBe(0);
  expect(existsSync(join(userData, 'drashti.sqlite'))).toBe(true);

  const { app } = await launchApp(TWO_OUTPUTS, userData);
  const win = await operatorPage(app);
  await operatorReady(win);
  // Each group's languages, in Screens ('none' where a group says nothing of them; null is every language).
  const groups = await win.evaluate(async () => {
    const snap = await (globalThis as PageGlobals).drashti.screens.get();
    return snap.groups.map((g) => [g.name, 'languages' in g ? g.languages : 'none']);
  });
  expect(groups).toEqual([
    ['Hall', ['gu', 'translit']],
    ['Stage', ['gu']],
    ['Stream', null],
  ]);
  // Nothing of them on the screens: the hall shows black with nothing up (not the idle rotation), no mask, every
  // layer the hall's role has (its ticker too), Calm; nothing covering it.
  await expect.poll(() => outputPages(app).length).toBe(2);
  const hallScreen = await win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.screens.get()).groups[0]?.screens[0]?.id ?? '',
  );
  const hall = await outputFor(app, hallScreen);
  const scene = hall.getByTestId('scene');
  await expect(scene).toHaveAttribute('data-nothing-up', 'black');
  await expect(scene).toHaveAttribute('data-movement', 'calm');
  await expect(scene).toHaveAttribute('data-look-layers', /ticker/u);
  for (const layer of ['idle', 'logo', 'masks', 'look'])
    await expect(hall.locator(`[data-layer="${layer}"]`)).toHaveCount(0);
  const state = (await snapshot(win)).state as unknown as Record<string, unknown>;
  expect([state['wallpaper'], 'logo' in state, 'idle' in state]).toEqual([false, false, false]);
  // Nothing of them in the window either.
  await openMoreTools(win);
  await expect(win.getByRole('complementary', { name: 'Live' })).not.toContainText(GONE);
  // New words start in the library's default look, its own theme's orange, though Themes are gone.
  const color = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.library.newFromWords('Placeholder new words', 'Placeholder line one');
    if (!made.ok) throw new Error(made.message);
    const loaded = await d.library.slidesForEdit(made.id);
    if (!loaded.ok) throw new Error(loaded.message);
    const box = loaded.doc.groups[0]?.slides[0]?.elements.find((e) => e.kind === 'text');
    if (box?.kind !== 'text') return [];
    return [box.style.color, ...(box.runs ?? []).flatMap((r) => (r.color ? [r.color] : []))];
  });
  expect(color.length).toBeGreaterThan(0);
  expect(new Set(color.map((c) => c.toLowerCase()))).toEqual(new Set(['#ff9900']));
  await app.close();
});
