import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestPdf } from '../../src/main/import/testing/make-pdf';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import {
  importAndGetIds,
  launchApp,
  openAllSections,
  operatorPage,
  operatorReady,
  outputPages,
} from './helpers';
import { expectPhoneRefuses } from './phone-refuses';

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

  // The top bar: no Themes beside Screens. LIVE: no Props and no Looks; its sections: no Masks, no Idle rotation, and
  // MIDI's words name no Logo.
  await expect(win.getByTestId('app-header').getByRole('button', { name: 'Themes' })).toHaveCount(0);
  for (const id of ['props', 'looks-panel', 'masks-panel', 'idle-panel', 'logo-button'])
    await expect(win.getByTestId(id), id).toHaveCount(0);
  await openAllSections(win);
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

test('the phone and the API have none of them; the phone’s and the API’s /api/v1/wallpaper are refused in words, F12 in the window puts the wallpaper up and takes it off, and of the phone’s clears only a PDF’s Clear slide is left', async () => {
  test.setTimeout(150_000);
  // A PDF comes in as pictures of its pages (a phone's deck), nothing on this computer asked to convert it.
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_TEST_NO_CONVERTER: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const pdf = join(mkdtempSync(join(tmpdir(), 'drashti-taken-out-')), 'Placeholder handout.pdf');
  writeFileSync(
    pdf,
    makeTestPdf([
      { width: 960, height: 540, color: [30, 58, 138], text: 'Placeholder handout page one' },
      { width: 960, height: 540, color: [127, 29, 29], text: 'Placeholder handout page two' },
    ]),
  );
  const [deckId = ''] = await importAndGetIds(win, [pdf]);
  expect(deckId).not.toBe('');
  const { port, base } = await networkOn(win);
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    // The phone's Wallpaper (alpha.23, QA23-PHONE-1: a phone changes no pictures) is refused in words, the wallpaper
    // as it was; moved to the window: F12 puts it up and takes it off (as the first test's keys do).
    const fromPhone = { win, page: p };
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/wallpaper', {}, 'media');
    expect(await wallpaperUp(win)).toBe(false);
    await win.keyboard.press('F12');
    await expect.poll(() => wallpaperUp(win)).toBe(true);
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/wallpaper', {}, 'media');
    await win.keyboard.press('F12');
    await expect.poll(() => wallpaperUp(win)).toBe(false);

    // The phone's clears (were the window's bottom bar: Clear all, each layer, the Wallpaper, Black-out), under the
    // rule: with a PDF up (from the window), Clear all, the background's and Black-out are refused in words, the PDF
    // still up; Clear slide alone is left to a phone in Pro Mode (the owner's Q7), and takes the PDF's page off.
    await win.evaluate(
      (presentationId) =>
        (globalThis as PageGlobals).drashti.engine.dispatch({
          type: 'goLive',
          presentationId,
          slideIndex: 0,
        }),
      deckId,
    );
    await expect.poll(async () => (await snapshot(win)).state.layers.slide?.presentationId).toBe(deckId);
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/all', {}, 'computer');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/clear/background', {}, 'computer');
    await expectPhoneRefuses(fromPhone, 'POST', '/api/v1/blackout', {}, 'computer');
    const cleared = await p.evaluate(async () => {
      const token =
        (JSON.parse(localStorage.getItem('drashti.device') ?? '{}') as { token?: string }).token ?? '';
      const r = await fetch('/api/v1/clear/slide', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      return { status: r.status, json: (await r.json()) as Record<string, unknown> };
    });
    expect(cleared).toMatchObject({ status: 200, json: { ok: true } });
    await expect.poll(async () => (await snapshot(win)).state.layers.slide).toBeNull();

    // No Props, Masks, Idle rotation or Looks anywhere on the phone's page.
    for (const id of ['remote-props', 'remote-masks', 'remote-idle', 'remote-looks'])
      await expect(p.getByTestId(id), id).toHaveCount(0);
    await expect(p.locator('body')).not.toContainText(GONE);
  } finally {
    await phone.close();
  }

  // The API (Companion, a Stream Deck): their routes are gone; the wallpaper's is refused to a Remote in words.
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
  const script = { win, port, token };
  await expectPhoneRefuses(script, 'POST', '/api/v1/wallpaper', { on: true }, 'media');
  expect(await wallpaperUp(win)).toBe(false);
  // Moved to the window: up with F12, and the API's off refused (still up), F12 takes it off.
  await win.keyboard.press('F12');
  await expect.poll(() => wallpaperUp(win)).toBe(true);
  await expectPhoneRefuses(script, 'POST', '/api/v1/wallpaper', {}, 'media');
  await win.keyboard.press('F12');
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
  await openAllSections(win);
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
