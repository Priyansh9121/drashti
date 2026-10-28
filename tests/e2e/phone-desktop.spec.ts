import type { ElectronApplication, Page } from '@playwright/test';
import { chromium, expect, test, webkit } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { MIDI_NOT_LISTED } from '../../src/shared/network-desktop';
import { ONLY_ON_IN_SIMPLE_MODE } from '../../src/main/outputs/screen-switches';
import { expectNoSeriousA11yIssues } from './a11y';
import {
  apiCall,
  device,
  type Engine,
  NETWORK_ENV,
  networkOn,
  pairByQr,
  pairingCode,
  pairToken,
} from './devices';
import {
  importAndGetIds,
  launchApp,
  needsRealScreen,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { makeTestVideo } from './test-media';

/*
 * The phone as a full Drashti (Session 54, the owner's item 3: "the drashti phone should be just like a mirror …
 * full of drashti connection"): the Drashti computer's own screens set up from a phone as its Screens sheet sets
 * them up, Keep these screens? answered on the phone with its countdown, and Audience and Stage turned there, off
 * asking the window's question first; Simple Mode refusing on the phone just what it refuses in the window; none of
 * it for a Stage or Announcements device; an output a phone would put over the controls asked in the computer's own
 * box (a real screen: CI); laid out at 375 × 812 and 768 × 1024 in Safari's engine and Chrome's, with axe, 44 px
 * targets and nothing off the side. Drashti's pretend displays and windowed outputs; placeholder names; codes and
 * tokens made at run time and never printed.
 */

/** Keep these screens? asked (a test about it), the outputs windows on Drashti's pretend displays. */
const ASKS = {
  ...NETWORK_ENV,
  DRASHTI_TEST_KEEP_SCREENS: '1',
  DRASHTI_WINDOWED_OUTPUTS: '1',
  DRASHTI_EXTRA_DISPLAYS: '2',
};
/** The first pretend display's id (src/main/outputs/electron-outputs.ts, EXTRA_DISPLAY_ID). */
const PRETEND = 900_000_000;

const SIZES = [
  { name: 'a phone', width: 375, height: 812, layout: 'phone' },
  { name: 'a tablet', width: 768, height: 1024, layout: 'wide' },
] as const;

/** The screens as the window has them: every group with its screens, and how each stands. */
const screensNow = (win: Page) =>
  win.evaluate(async () => {
    const s = await (globalThis as PageGlobals).drashti.screens.get();
    return { groups: s.groups.filter((g) => g.role !== 'stream'), status: s.status };
  });

const pendingNow = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.screens.pending());

const switchesNow = (win: Page) =>
  win.evaluate(() => (globalThis as PageGlobals).drashti.screenSwitches.get());

const openOutputs = (app: ElectronApplication) => outputPages(app).filter((p) => !p.isClosed()).length;

/** Every visible control under 44 × 44 CSS pixels (as phone-pages.spec.ts measures them). */
const tooSmall = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input:not([type="hidden"]), select, textarea, [role="tab"], [role="button"]',
      ),
    ]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({
        name: (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30),
        r: el.getBoundingClientRect(),
      }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ name, r }) => `${name} (${String(Math.round(r.width))} × ${String(Math.round(r.height))})`),
  );

/** Whatever reaches past the page's right edge, or makes the sheet or the remote scroll sideways. */
const offTheSide = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrolls = [
      document.scrollingElement,
      ...document.querySelectorAll('main, main *, [role="dialog"], [role="dialog"] *'),
    ].filter(
      (el): el is Element =>
        el !== null &&
        el.scrollWidth > el.clientWidth + 1 &&
        ['auto', 'scroll'].includes(getComputedStyle(el).overflowX),
    );
    const past = [...document.querySelectorAll<HTMLElement>('button, input, select, h2, h3')].filter(
      (el) => el.offsetParent !== null && el.getBoundingClientRect().right > width + 1,
    );
    return [...scrolls, ...past].map((el) => `${el.tagName} ${el.textContent.trim().slice(0, 30)}`);
  });

/** The phone's More, where the computer's screens are (a phone's tab; a tablet's column, scrolled to). */
async function toScreens(page: Page, layout: 'phone' | 'wide'): Promise<void> {
  if (layout === 'phone') await page.getByTestId('remote-tab-more').click();
  await page.getByTestId('remote-open-screens').click();
  await expect(page.getByTestId('remote-screens')).toBeVisible();
}

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the computer’s screens set up from a phone as in Screens, Keep these screens? answered there with its countdown, laid out at 375 × 812 and 768 × 1024 (${engine})`, async () => {
    test.setTimeout(300_000);
    const { app } = await launchApp(ASKS);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { base } = await networkOn(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    try {
      for (const size of SIZES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          isMobile: true,
          hasTouch: true,
          bypassCSP: true,
        });
        const p = await context.newPage();
        const at = `${size.name} (${String(size.width)} × ${String(size.height)}, ${engine})`;
        try {
          await pairByQr(p, base, await pairingCode(win, 'remote', `Placeholder ${size.name}`), '/remote');
          await expect(p.getByTestId('connection')).toHaveText('Connected');
          // In More, first: Audience and Stage, said On, and Screens.
          if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
          await expect(p.getByTestId('remote-switch-audience')).toHaveAttribute('aria-checked', 'true');
          await expect(p.getByTestId('remote-switch-stage')).toHaveAttribute('aria-checked', 'true');
          await toScreens(p, size.layout);
          const sheet = p.getByTestId('remote-screens');
          // The computer's displays as it sees them: its main one and the two pretend ones.
          await expect(sheet.getByTestId('remote-display')).toHaveCount(
            (
              await win.evaluate(
                async () => (await (globalThis as PageGlobals).drashti.screens.get()).displays,
              )
            ).length,
          );
          const pretend = sheet.locator(
            `[data-testid="remote-display"][data-display-id="${String(PRETEND)}"]`,
          );
          await expect(pretend).toBeVisible();

          // A group added on the phone is the window's at once.
          const group = `Placeholder Hall ${size.name}`;
          await sheet.getByTestId('remote-new-group').fill(group);
          await sheet.getByRole('button', { name: 'Add group' }).click();
          await expect(
            sheet.locator(`[data-testid="remote-screen-group"][data-group-name="${group}"]`),
          ).toHaveCount(1);
          await expect.poll(async () => (await screensNow(win)).groups.map((g) => g.name)).toContain(group);

          // Use this display on a pretend one: it opens, and Keep these screens? asks on the phone, with its
          // countdown, Keep holding the keyboard as in the window.
          await pretend.locator('select').selectOption({ label: group });
          await pretend.getByTestId('remote-use-display').click();
          const keep = p.getByTestId('remote-keep-screens');
          await expect(keep).toContainText('Keep these screens?');
          const countdown = keep.getByTestId('remote-keep-countdown');
          await expect(countdown).toHaveText(/^Going back by itself in \d+ seconds?\.$/u);
          expect(Number(await countdown.getAttribute('data-seconds'))).toBeGreaterThan(5);
          expect(Number(await countdown.getAttribute('data-seconds'))).toBeLessThanOrEqual(15);
          await expect(keep.getByTestId('remote-keep-screens-act')).toBeFocused();
          await expect.poll(() => openOutputs(app)).toBe(1);
          expect(await pendingNow(win)).toMatchObject({ coversControls: false });
          await expectNoSeriousA11yIssues(
            p,
            `Keep these screens? on ${at}`,
            '[data-testid="remote-keep-screens"]',
          );
          expect.soft(await tooSmall(p), `targets under 44 px: Keep these screens? on ${at}`).toEqual([]);
          // Keep, on the phone: the change stays, and the window no longer asks.
          await keep.getByTestId('remote-keep-screens-act').click();
          await expect(keep).toHaveCount(0);
          await expect.poll(() => pendingNow(win)).toBeNull();
          await expect.poll(() => openOutputs(app)).toBe(1);
          const screen = sheet.getByTestId('remote-screen');
          await expect(screen.getByTestId('remote-screen-state')).toContainText('Showing');

          // The sheet with a group and its screen: laid out for this size.
          await expectNoSeriousA11yIssues(p, `the computer’s screens on ${at}`);
          expect.soft(await tooSmall(p), `targets under 44 px: the screens on ${at}`).toEqual([]);
          expect.soft(await offTheSide(p), `off the side: the screens on ${at}`).toEqual([]);

          // Off asks nothing; On again asks, and Go back on the phone puts it off again.
          await screen.getByTestId('remote-screen-on').click();
          await expect.poll(() => openOutputs(app)).toBe(0);
          await expect(keep).toHaveCount(0);
          await expect(screen.getByTestId('remote-screen-on')).toHaveAttribute('aria-checked', 'false');
          await screen.getByTestId('remote-screen-on').click();
          await expect(keep).toBeVisible();
          await keep.getByTestId('remote-keep-screens-safe').click();
          await expect(keep).toHaveCount(0);
          await expect.poll(() => openOutputs(app)).toBe(0);
          await expect(screen.getByTestId('remote-screen-on')).toHaveAttribute('aria-checked', 'false');

          // Its scaling, and the group's name, as the window then has them.
          await screen.getByTestId('remote-screen-scaling').selectOption('fill');
          await expect
            .poll(async () => (await screensNow(win)).groups.flatMap((g) => g.screens).map((s) => s.scaling))
            .toContain('fill');
          const renamed = `${group} renamed`;
          const name = sheet
            .locator(`[data-testid="remote-screen-group"][data-group-name="${group}"]`)
            .getByLabel('Group name');
          await name.fill(renamed);
          await name.press('Enter');
          await expect.poll(async () => (await screensNow(win)).groups.map((g) => g.name)).toContain(renamed);

          // A group the window adds shows on the phone with no reload.
          await win.evaluate(async (n) => {
            const made = await (globalThis as PageGlobals).drashti.screens.createGroup(n);
            if (!made.ok) throw new Error(made.message);
          }, `Placeholder Stage ${size.name}`);
          await expect(
            sheet.locator(
              `[data-testid="remote-screen-group"][data-group-name="Placeholder Stage ${size.name}"]`,
            ),
          ).toHaveCount(1);

          // Delete group, on the phone: gone from both.
          for (const n of [renamed, `Placeholder Stage ${size.name}`])
            await sheet
              .locator(`[data-testid="remote-screen-group"][data-group-name="${n}"]`)
              .getByTestId('remote-group-delete')
              .click();
          await expect(sheet.getByTestId('remote-screen-group')).toHaveCount(0);
          await expect.poll(async () => (await screensNow(win)).groups).toEqual([]);

          // Close, and the phone's own Back would close it as well: the remote is as it was.
          await sheet.getByTestId('remote-screens-close').click();
          await expect(sheet).toHaveCount(0);
          await expect(p.getByTestId('remote')).toBeVisible();
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
    await app.close();
  });

/** Chromium's fake camera, as the computer names it (DRASHTI_TEST_FAKE_DEVICES), and the window stand-in's name. */
const FAKE_CAMERA = 'fake_device_0';
const MEETING = 'Placeholder meeting';

/** A placeholder meeting window, opened in Drashti's own process without the focus (show-a-window.spec.ts's). */
const openMeeting = (app: ElectronApplication) =>
  app.evaluate(async ({ BrowserWindow }, title) => {
    const w = new BrowserWindow({
      width: 640,
      height: 360,
      show: false,
      title,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    const html = `<!doctype html><title>${title}</title><body style="background:#1d4ed8">`;
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    w.showInactive();
    return w.id;
  }, MEETING);

const backgroundNow = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.background,
  );

const inputsNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.videoInputs.list()).inputs);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`video inputs and windows from a phone as in Media: one named from the computer’s cameras, put up, changed and deleted (asked first), and a window from its list; at 375 × 812 and 768 × 1024 (${engine})`, async () => {
    test.setTimeout(300_000);
    const { app } = await launchApp({
      ...NETWORK_ENV,
      DRASHTI_TEST_FAKE_DEVICES: '1',
      DRASHTI_TEST_WINDOW_STANDIN: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    await openMeeting(app);
    const { base } = await networkOn(win);
    const browser = await (engine === 'webkit' ? webkit : chromium).launch();
    try {
      for (const [index, size] of SIZES.entries()) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          isMobile: true,
          hasTouch: true,
          bypassCSP: true,
        });
        const p = await context.newPage();
        const at = `${size.name} (${String(size.width)} × ${String(size.height)}, ${engine})`;
        try {
          await pairByQr(p, base, await pairingCode(win, 'remote', `Placeholder ${size.name}`), '/remote');
          await expect(p.getByTestId('connection')).toHaveText('Connected');
          if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
          await p.getByTestId('remote-open-inputs').click();
          const sheet = p.getByTestId('remote-inputs-sheet');
          await expect(sheet).toBeVisible();
          if (index === 0) {
            // Named from the cameras the computer lists: the fake one, as its window sees it.
            await sheet.getByTestId('remote-input-add').click();
            const form = sheet.getByTestId('remote-input-add-form');
            await expect(form.getByLabel('Name')).toHaveValue('Input 1');
            await form.getByLabel('Name').fill('Placeholder input');
            await expect(form.getByTestId('remote-input-camera').locator('option')).toContainText([
              FAKE_CAMERA,
            ]);
            await form.getByTestId('remote-input-camera').selectOption(FAKE_CAMERA);
            await form.getByRole('button', { name: 'Add' }).click();
            await expect
              .poll(() => inputsNow(win))
              .toEqual([
                expect.objectContaining({ name: 'Placeholder input', device: FAKE_CAMERA, fit: 'fit' }),
              ]);
            // Put up as Media's click does, and cleared.
            const row = sheet.locator('[data-testid="remote-input"][data-name="Placeholder input"]');
            await row.getByTestId('remote-input-show').click();
            await expect.poll(async () => (await backgroundNow(win))?.kind).toBe('input');
            await expect(row).toHaveAttribute('data-live', 'true');
            await row.getByTestId('remote-input-clear').click();
            await expect.poll(() => backgroundNow(win)).toBeNull();
            // Changed: the window's Media has the new name.
            await row.getByTestId('remote-input-change').click();
            const change = sheet.getByTestId('remote-input-change-form');
            await change.getByLabel('Name').fill('Placeholder stage camera');
            await change.getByRole('button', { name: 'Keep' }).click();
            await expect
              .poll(async () => (await inputsNow(win)).map((i) => i.name))
              .toEqual(['Placeholder stage camera']);
          }
          // Show a Window…'s list, by name only: the placeholder meeting, put up and cleared.
          await sheet.getByTestId('remote-windows-look').click();
          const meeting = sheet.locator(`[data-testid="remote-window"][data-name="${MEETING}"]`);
          await expect(meeting).toHaveCount(1);
          await expect(sheet.locator('[data-testid="remote-windows"] img')).toHaveCount(0);
          await meeting.getByTestId('remote-window-show').click();
          await expect.poll(async () => (await backgroundNow(win))?.kind).toBe('window');
          await expect(sheet.getByTestId('remote-window-up')).toContainText(MEETING);
          // The sheet with an input and a window up: laid out for this size.
          await expectNoSeriousA11yIssues(p, `video inputs and windows on ${at}`);
          expect.soft(await tooSmall(p), `targets under 44 px: inputs and windows on ${at}`).toEqual([]);
          expect.soft(await offTheSide(p), `off the side: inputs and windows on ${at}`).toEqual([]);
          await sheet.getByTestId('remote-window-clear').click();
          await expect.poll(() => backgroundNow(win)).toBeNull();
          if (index === SIZES.length - 1) {
            // Deleted, asked first in Media's words: Cancel keeps it, Delete takes it from Media.
            const row = sheet.locator('[data-testid="remote-input"][data-name="Placeholder stage camera"]');
            await row.getByTestId('remote-input-delete').click();
            const ask = p.getByTestId('remote-input-delete-ask');
            await expect(ask).toContainText('Delete the video input “Placeholder stage camera”?');
            await expect(ask.getByTestId('remote-input-delete-ask-safe')).toBeFocused();
            await ask.getByTestId('remote-input-delete-ask-safe').click();
            expect(await inputsNow(win)).toHaveLength(1);
            await row.getByTestId('remote-input-delete').click();
            await ask.getByTestId('remote-input-delete-ask-act').click();
            await expect.poll(() => inputsNow(win)).toEqual([]);
          }
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
    await app.close();
  });

test('Audience and Stage from a phone as from the window’s top bar: off asks the window’s question while its screens show something, on puts them back where they were', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win, 'Placeholder Hall', 1);
  await expect.poll(() => openOutputs(app)).toBe(1);
  // Something on the hall's screens: turning Audience off asks first, as in the window.
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const r = await d.engine.dispatch({ type: 'setBlackout', on: true });
    if (!r.ok) throw new Error(r.message);
  });
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await p.getByTestId('remote-tab-more').click();
    const audience = p.getByTestId('remote-switch-audience');
    await audience.click();
    const ask = p.getByTestId('remote-switch-ask');
    await expect(ask).toContainText('Turn Audience off?');
    await expect(ask).toContainText('The hall’s screens will show this computer’s desktop.');
    // Cancel has the keyboard, as in the window: nothing changes.
    await expect(ask.getByTestId('remote-switch-ask-safe')).toBeFocused();
    await expectNoSeriousA11yIssues(p, 'Turn Audience off? on a phone', '[data-testid="remote-switch-ask"]');
    await ask.getByTestId('remote-switch-ask-safe').click();
    await expect(ask).toHaveCount(0);
    expect(await switchesNow(win)).toEqual({ audience: true, stage: true });
    expect(openOutputs(app)).toBe(1);
    // Turn off: the hall's window closes, and the window and the phone both say Audience is off.
    await audience.click();
    await ask.getByTestId('remote-switch-ask-act').click();
    await expect.poll(() => switchesNow(win)).toEqual({ audience: false, stage: true });
    await expect.poll(() => openOutputs(app)).toBe(0);
    await expect(audience).toHaveAttribute('aria-checked', 'false');
    await expect(win.getByTestId('switch-off-audience')).toBeVisible();
    // Stage has no screens open: it goes off at once, asking nothing.
    await p.getByTestId('remote-switch-stage').click();
    await expect.poll(() => switchesNow(win)).toEqual({ audience: false, stage: false });
    await expect(ask).toHaveCount(0);
    // On puts them back where they were, asking nothing.
    await audience.click();
    await p.getByTestId('remote-switch-stage').click();
    await expect.poll(() => switchesNow(win)).toEqual({ audience: true, stage: true });
    await expect.poll(() => openOutputs(app)).toBe(1);
    await expect(audience).toHaveAttribute('aria-checked', 'true');
  } finally {
    await phone.close();
  }
  await app.close();
});

test('Simple Mode refuses on a phone just what it refuses in the window: the screens’ setup changed, a switch turned off; Keep, Identify and On stay', async () => {
  test.setTimeout(180_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const groupId = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder Hall');
    if (!made.ok) throw new Error(made.message);
    return made.snapshot.groups.find((g) => g.name === 'Placeholder Hall')?.id ?? '';
  });
  const { port, base } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  const phone = await device('chromium');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
    await expect(win.getByTestId('simple-mode')).toBeVisible();
    // On the phone: refused in Simple Mode's own words, nothing changed.
    await toScreens(p, 'phone');
    const sheet = p.getByTestId('remote-screens');
    await sheet.getByTestId('remote-new-group').fill('Placeholder Stage');
    await sheet.getByRole('button', { name: 'Add group' }).click();
    await expect(sheet.getByTestId('remote-screens-problem')).toContainText(SIMPLE_MODE_REFUSAL);
    expect((await screensNow(win)).groups.map((g) => g.name)).toEqual(['Placeholder Hall']);
    await sheet.getByTestId('remote-screens-close').click();
    // A switch only goes on.
    await p.getByTestId('remote-switch-audience').click();
    await expect(p.getByTestId('remote-desktop-problem')).toContainText(ONLY_ON_IN_SIMPLE_MODE);
    expect(await switchesNow(win)).toEqual({ audience: true, stage: true });
    // Every change as a script sends it: refused alike; reading, Keep, Go back and Identify are not.
    const changes: [string, unknown][] = [
      ['/api/v1/screen-groups', { name: 'Placeholder Stage' }],
      [`/api/v1/screen-groups/${groupId}/name`, { name: 'Placeholder renamed' }],
      [`/api/v1/screen-groups/${groupId}/role`, { role: 'stage' }],
      [`/api/v1/screen-groups/${groupId}/display`, { displayId: PRETEND }],
      [`/api/v1/screen-groups/${groupId}/delete`, undefined],
    ];
    for (const [path, body] of changes)
      expect(await apiCall(port, path, { method: 'POST', token, body }), path).toEqual({
        status: 403,
        json: { ok: false, message: SIMPLE_MODE_REFUSAL },
      });
    expect((await apiCall(port, '/api/v1/screens', { token })).status).toBe(200);
    expect((await apiCall(port, '/api/v1/screens/identify', { method: 'POST', token })).status).toBe(200);
    // Nothing waits: Keep says so (409), never Simple Mode's refusal.
    expect((await apiCall(port, '/api/v1/screens/keep', { method: 'POST', token })).status).toBe(409);
    expect(
      await apiCall(port, '/api/v1/switches/stage', {
        method: 'POST',
        token,
        body: { on: false, confirmed: true },
      }),
    ).toEqual({ status: 403, json: { ok: false, message: ONLY_ON_IN_SIMPLE_MODE } });
    expect(
      (await apiCall(port, '/api/v1/switches/stage', { method: 'POST', token, body: { on: true } })).status,
    ).toBe(200);
    // Media's video inputs are read, never changed; the windows are Pro Mode's.
    expect((await apiCall(port, '/api/v1/video-inputs', { token })).status).toBe(200);
    expect(
      await apiCall(port, '/api/v1/video-inputs', {
        method: 'POST',
        token,
        body: { name: 'Input 1', device: 'Placeholder camera', fit: 'fit' },
      }),
    ).toEqual({ status: 403, json: { ok: false, message: SIMPLE_MODE_REFUSAL } });
    expect(await apiCall(port, '/api/v1/windows', { token })).toEqual({
      status: 403,
      json: { ok: false, message: SIMPLE_MODE_REFUSAL },
    });
  } finally {
    await phone.close();
  }
  await app.close();
});

test('a Stage or Announcements device can do none of it, and a phone never gives the operator’s consent to cover the controls', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({
    ...NETWORK_ENV,
    DRASHTI_WINDOWED_OUTPUTS: '1',
    DRASHTI_EXTRA_DISPLAYS: '2',
  });
  const win = await operatorPage(app);
  await operatorReady(win);
  const groupId = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder Hall');
    if (!made.ok) throw new Error(made.message);
    return made.snapshot.groups.find((g) => g.name === 'Placeholder Hall')?.id ?? '';
  });
  const { port } = await networkOn(win);
  const remote = await pairToken(win, port, 'remote', 'Placeholder script');
  const stage = await pairToken(win, port, 'stage', 'Placeholder tablet');
  const poster = await pairToken(win, port, 'announcements', 'Placeholder poster');
  const asked: [string, string, unknown][] = [
    ['GET', '/api/v1/screens', undefined],
    ['POST', '/api/v1/screen-groups', { name: 'Placeholder Stage' }],
    ['POST', `/api/v1/screen-groups/${groupId}/display`, { displayId: PRETEND }],
    ['POST', '/api/v1/screens/identify', undefined],
    ['POST', '/api/v1/switches/audience', { on: true }],
  ];
  for (const [method, path, body] of asked)
    for (const token of [stage, poster])
      expect((await apiCall(port, path, { method, token, body })).status, path).toBe(403);
  expect((await screensNow(win)).groups.map((g) => g.name)).toEqual(['Placeholder Hall']);
  // The window's own consent, sent by a phone, is refused outright: nothing changes.
  for (const body of [
    { displayId: PRETEND, coverOperator: true },
    { displayId: PRETEND, options: { coverOperator: true } },
  ])
    expect(
      (
        await apiCall(port, `/api/v1/screen-groups/${groupId}/display`, {
          method: 'POST',
          token: remote,
          body,
        })
      ).status,
    ).toBe(400);
  expect((await screensNow(win)).groups.flatMap((g) => g.screens)).toEqual([]);
  // And the Remote may.
  expect(
    (
      await apiCall(port, `/api/v1/screen-groups/${groupId}/display`, {
        method: 'POST',
        token: remote,
        body: { displayId: PRETEND },
      })
    ).status,
  ).toBe(200);
  await expect.poll(async () => (await screensNow(win)).groups.flatMap((g) => g.screens).length).toBe(1);
  await app.close();
});

test('an output a phone would put over the controls is asked in the computer’s own box: only its yes puts it there, and Keep these screens? is the phone’s to answer', async () => {
  // The display the controls are on: a real screen (CI's one display), not the quiet test's windowed outputs.
  needsRealScreen();
  test.setTimeout(180_000);
  const { app } = await launchApp({ ...NETWORK_ENV, DRASHTI_TEST_KEEP_SCREENS: '1' });
  const win = await operatorPage(app);
  await operatorReady(win);
  const controls = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'));
    return w ? screen.getDisplayMatching(w.getBounds()).id : -1;
  });
  await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.screens.createGroup('Placeholder Hall');
    if (!made.ok) throw new Error(made.message);
  });
  // The computer's box, answered as the operator would: Cover the controls (1), or Cancel (0); what it said kept.
  const answerBoxWith = (response: number) =>
    app.evaluate(({ dialog }, r) => {
      const said = globalThis as unknown as { boxes?: { message: string; detail: string }[] };
      said.boxes = [];
      Object.assign(dialog, {
        showMessageBox: (...args: unknown[]) => {
          const box = args.find((a) => typeof a === 'object' && a !== null && 'message' in a) as {
            message: string;
            detail: string;
          };
          said.boxes?.push({ message: box.message, detail: box.detail });
          return Promise.resolve({ response: r, checkboxChecked: false });
        },
      });
    }, response);
  const boxes = () =>
    app.evaluate(
      () => (globalThis as unknown as { boxes?: { message: string; detail: string }[] }).boxes ?? [],
    );
  const { base } = await networkOn(win);
  const phone = await device('webkit');
  const p = phone.page;
  try {
    await pairByQr(p, base, await pairingCode(win, 'remote', 'Placeholder phone'), '/remote');
    await expect(p.getByTestId('connection')).toHaveText('Connected');
    await toScreens(p, 'phone');
    const sheet = p.getByTestId('remote-screens');
    const card = sheet.locator(`[data-testid="remote-display"][data-display-id="${String(controls)}"]`);
    await expect(card.getByTestId('remote-display-controls')).toContainText(
      'The Drashti controls are on this display',
    );

    // Agreed on the computer: the output opens over the controls, and the phone answers Keep these screens?.
    await answerBoxWith(1);
    await card.getByTestId('remote-use-display').click();
    await expect.poll(() => boxes()).toHaveLength(1);
    const [box] = await boxes();
    expect(box?.message).toBe('Cover the Drashti controls?');
    expect(box?.detail).toContain('Remote “Placeholder phone” asks to put “Placeholder Hall” on');
    await expect(sheet.getByTestId('remote-screens-asked')).toHaveAttribute('data-state', 'agreed');
    const keep = p.getByTestId('remote-keep-screens');
    await expect(keep).toContainText('An output covers the Drashti controls on the computer now');
    await keep.getByTestId('remote-keep-screens-act').click();
    await expect.poll(() => pendingNow(win)).toBeNull();
    await expect(sheet.getByTestId('remote-screen').getByTestId('remote-screen-state')).toContainText(
      'Showing',
    );

    // Off from the phone asks nothing; On again over the controls is asked, and the computer's Cancel changes nothing.
    await sheet.getByTestId('remote-screen').getByTestId('remote-screen-on').click();
    await expect(sheet.getByTestId('remote-screen').getByTestId('remote-screen-on')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await answerBoxWith(0);
    await sheet.getByTestId('remote-screen').getByTestId('remote-screen-on').click();
    await expect(sheet.getByTestId('remote-screens-asked')).toHaveAttribute('data-state', 'refused');
    await expect(sheet.getByTestId('remote-screens-asked')).toContainText(
      'The Drashti computer did not agree, so nothing changed.',
    );
    expect(await boxes()).toHaveLength(1);
    await expect(sheet.getByTestId('remote-screen').getByTestId('remote-screen-on')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(await pendingNow(win)).toBeNull();
    // Asked again at once: a moment first (nothing a phone sends keeps the box up).
    await sheet.getByTestId('remote-screen').getByTestId('remote-screen-on').click();
    await expect(sheet.getByTestId('remote-screens-problem')).toContainText(
      'The Drashti computer said no just now',
    );
    expect(await boxes()).toHaveLength(1);
  } finally {
    await phone.close();
  }
  await app.close();
});

/** The picture-in-picture box as the engine has it now, or null. */
const pipNow = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.pip);

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the picture-in-picture box set up from a phone as Picture in Picture… does: a Media video in it, moved to a corner and made Large, swapped and taken off, laid out at 375 × 812 and 768 × 1024, and Simple Mode refusing it in words (${engine})`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp({
      ...NETWORK_ENV,
      DRASHTI_WINDOWED_OUTPUTS: '1',
      DRASHTI_EXTRA_DISPLAYS: '1',
    });
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-phone-pip-'));
    const clip = await makeTestVideo(win, join(dir, 'Placeholder boxed clip.webm'), { seconds: 4, hue: 120 });
    const [mediaId = ''] = await importAndGetIds(win, [clip]);
    await setUpScreen(win, 'Main Hall', 0);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        await p.setViewportSize(size);
        if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
        await p.getByTestId('remote-open-pip').click();
        await expect(p.getByTestId('remote-pip-sheet')).toBeVisible();
        await expect(p.getByTestId('remote-pip-none')).toBeVisible();
        // A video from Media, by its id: in the box on the screens, named on the phone.
        await p.locator(`[data-testid="remote-pip-media-item"][data-media-id="${mediaId}"]`).click();
        await expect
          .poll(async () => (await pipNow(win))?.source)
          .toEqual({ kind: 'media', mediaId, media: 'video' });
        await expect(p.getByTestId('remote-pip-now')).toContainText('Placeholder boxed clip');
        // To the top left, then Large: on every screen at once (the engine's place).
        await p.getByTestId('remote-pip-corner-top-left').click();
        await expect.poll(async () => (await pipNow(win))?.place.corner).toBe('top-left');
        await p.getByTestId('remote-pip-size-large').click();
        await expect.poll(async () => (await pipNow(win))?.place.size).toBe('large');
        await expect(p.getByTestId('remote-pip-size-large')).toHaveAttribute('aria-pressed', 'true');
        // Swap: the box's picture and the main picture change places.
        await p.getByTestId('remote-pip-swap').click();
        await expect.poll(async () => (await pipNow(win))?.swapped).toBe(true);
        expect(await tooSmall(p), `targets on ${size.name}`).toEqual([]);
        expect(await offTheSide(p), `nothing off the side on ${size.name}`).toEqual([]);
        await expectNoSeriousA11yIssues(p, `the box’s sheet on ${size.name} (${engine})`);
        // Take off: the box goes.
        await p.getByTestId('remote-pip-sheet-take-off').click();
        await expect.poll(() => pipNow(win)).toBeNull();
        await expect(p.getByTestId('remote-pip-none')).toBeVisible();
        await p.getByTestId('remote-pip-sheet-close').click();
        await expect(p.getByTestId('remote-pip-sheet')).toHaveCount(0);
      }
      // Simple Mode: the slides in the box refused, said on the phone, nothing up.
      await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await p.getByTestId('remote-open-pip').click();
      await p.getByTestId('remote-pip-kind-slides').click();
      await p.getByTestId('remote-pip-slides').click();
      await expect(p.getByTestId('remote-pip-sheet-notice')).toContainText('Simple Mode');
      expect(await pipNow(win)).toBeNull();
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** The window's playlists (not folders) by name, and a playlist's items by their labels, as the window reads them. */
const playlistNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.playlists.tree())
      .filter((p) => !p.isFolder)
      .map((p) => p.name),
  );
const playlistId = (win: Page, name: string) =>
  win.evaluate(
    async (name) =>
      (await (globalThis as PageGlobals).drashti.playlists.tree()).find((p) => p.name === name)?.id ?? null,
    name,
  );
const itemIds = (win: Page, id: string) =>
  win.evaluate(
    async (id) => (await (globalThis as PageGlobals).drashti.playlists.items(id)).map((i) => i.id),
    id,
  );
const presentationNames = (win: Page) =>
  win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name),
  );

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the library changed from a phone as the window changes it: a presentation from words, a playlist made, added to, moved, taken out and put back with Undo, renamed, deleted and put back, laid out at 375 × 812 and 768 × 1024, and Simple Mode refusing it in words (${engine})`, async () => {
    test.setTimeout(240_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        const words = `Placeholder phone words ${size.layout}`;
        const list = `Placeholder phone list ${size.layout}`;
        await p.setViewportSize(size);
        if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
        await p.getByTestId('remote-open-library').click();
        await expect(p.getByTestId('remote-library-sheet')).toBeVisible();
        // A presentation from words, made in the computer's library.
        await p.getByTestId('remote-library-tab-presentations').click();
        await p.getByTestId('remote-library-new-presentation-name').fill(words);
        await p
          .getByTestId('remote-library-new-presentation-words')
          .fill('Placeholder line one\n\nPlaceholder line two');
        await p
          .getByTestId('remote-library-new-presentation')
          .getByRole('button', { name: 'Make the presentation' })
          .click();
        await expect.poll(() => presentationNames(win)).toContain(words);
        // A playlist made: in the window's list, and open on the phone.
        await p.getByTestId('remote-library-tab-playlists').click();
        await p.getByTestId('remote-library-new-playlist-name').fill(list);
        await p
          .getByTestId('remote-library-new-playlist')
          .getByRole('button', { name: 'Make the playlist' })
          .click();
        await expect.poll(() => playlistNames(win)).toContain(list);
        const id = (await playlistId(win, list)) ?? '';
        const row = p.locator(`[data-testid="remote-library-playlist"][data-playlist-id="${id}"]`);
        await expect(row.getByTestId('remote-library-playlist-open')).toHaveAttribute('aria-pressed', 'true');
        // The presentation added twice, then the second moved up: the window has the same order.
        const choice = row.getByTestId('remote-library-add-choice');
        for (let i = 0; i < 2; i += 1) {
          await expect(choice.locator('option', { hasText: words })).toHaveCount(1);
          await choice.selectOption({ label: words });
          await row.getByTestId('remote-library-add-form').getByRole('button', { name: 'Add' }).click();
          await expect.poll(async () => (await itemIds(win, id)).length).toBe(i + 1);
          // On the phone too, its choice cleared for the next.
          await expect(row.getByTestId('remote-library-item')).toHaveCount(i + 1);
          await expect(choice).toHaveValue('');
        }
        const [first = '', second = ''] = await itemIds(win, id);
        await row
          .locator(`[data-testid="remote-library-item"][data-item-id="${second}"]`)
          .getByTestId('remote-library-item-up')
          .click();
        await expect.poll(() => itemIds(win, id)).toEqual([second, first]);
        // One taken out, then put back by Undo, where it was.
        await row
          .locator(`[data-testid="remote-library-item"][data-item-id="${first}"]`)
          .getByTestId('remote-library-item-remove')
          .click();
        await expect.poll(() => itemIds(win, id)).toEqual([second]);
        await p.getByTestId('remote-library-undo').click();
        await expect.poll(() => itemIds(win, id)).toEqual([second, first]);
        // Renamed, then deleted and put back by Undo.
        await row.getByTestId('remote-library-playlist-rename').click();
        await p.getByTestId('remote-library-rename-name').fill(`${list}, renamed`);
        await p.getByTestId('remote-library-rename-form').getByRole('button', { name: 'Rename' }).click();
        await expect.poll(() => playlistNames(win)).toContain(`${list}, renamed`);
        expect(await tooSmall(p), `targets on ${size.name}`).toEqual([]);
        expect(await offTheSide(p), `nothing off the side on ${size.name}`).toEqual([]);
        await expectNoSeriousA11yIssues(p, `the library’s sheet on ${size.name} (${engine})`);
        await row.getByTestId('remote-library-playlist-delete').click();
        await expect.poll(() => playlistNames(win)).not.toContain(`${list}, renamed`);
        await p.getByTestId('remote-library-undo').click();
        await expect.poll(() => playlistNames(win)).toContain(`${list}, renamed`);
        await p.getByTestId('remote-library-sheet-close').click();
        await expect(p.getByTestId('remote-library-sheet')).toHaveCount(0);
      }
      // Simple Mode: a new playlist refused in words on the phone, and none made.
      await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await p.getByTestId('remote-open-library').click();
      await p.getByTestId('remote-library-new-playlist-name').fill('Placeholder refused list');
      await p
        .getByTestId('remote-library-new-playlist')
        .getByRole('button', { name: 'Make the playlist' })
        .click();
      await expect(p.getByTestId('remote-library-problem')).toContainText('Simple Mode');
      expect(await playlistNames(win)).not.toContain('Placeholder refused list');
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** The mask up on the audience screens, as the engine has it (its id), or null. */
const maskUp = (win: Page) =>
  win.evaluate(
    async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.masks?.id ?? null,
  );

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the library’s masks from a phone as Masks puts them up: one shown by its id and taken off, laid out at 375 × 812 and 768 × 1024 (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const made = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.masks.save(null, {
        name: 'Placeholder band',
        width: 1920,
        height: 1080,
        mode: 'hide',
        shapes: [
          {
            id: 'placeholder-band-shape',
            kind: 'rectangle',
            frame: { x: 0, y: 0, width: 1920, height: 200 },
          },
        ],
      }),
    );
    if (!made.ok) throw new Error(made.message);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        await p.setViewportSize(size);
        if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
        const row = p.locator(`[data-testid="remote-mask"][data-mask-id="${made.id}"]`);
        await expect(row).toContainText('Placeholder band');
        await row.getByTestId('remote-mask-toggle').click();
        await expect.poll(() => maskUp(win)).toBe(made.id);
        await expect(row).toHaveAttribute('data-shown', 'true');
        await expect(row.getByTestId('remote-mask-toggle')).toHaveText('Take off');
        expect(await tooSmall(p), `targets on ${size.name}`).toEqual([]);
        expect(await offTheSide(p), `nothing off the side on ${size.name}`).toEqual([]);
        await expectNoSeriousA11yIssues(p, `the masks on ${size.name} (${engine})`);
        await row.getByTestId('remote-mask-toggle').click();
        await expect.poll(() => maskUp(win)).toBeNull();
        await expect(row.getByTestId('remote-mask-toggle')).toHaveText('Show');
      }
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** MIDI's settings as the window reads them. */
const midiNow = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.midi.get());

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`MIDI from a phone as MIDI… sets it up on the computer: its device and mappings read, Learn asked of the computer and cancelled, a mapping forgotten, None chosen, laid out at 375 × 812 and 768 × 1024, and Simple Mode refusing it in words (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    // A device and a mapping set up in the window (a made-up device: none is plugged into a test computer).
    const kept = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.midi.set({
        deviceName: 'Placeholder pad',
        mappings: [
          { input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'next' } },
          { input: { type: 'note', channel: 0, number: 38 }, action: { kind: 'back' } },
        ],
      }),
    );
    expect(kept.ok).toBe(true);
    const { base } = await networkOn(win);
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        await p.setViewportSize(size);
        if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
        await p.getByTestId('remote-open-midi').click();
        await expect(p.getByTestId('remote-midi-sheet')).toBeVisible();
        // The chosen device, not plugged in here; the computer's window has listed what it sees.
        const chosen = p.locator('[data-testid="remote-midi-device"][data-device="Placeholder pad"]');
        await expect(chosen).toHaveAttribute('aria-pressed', 'true');
        await expect(chosen).toContainText('not plugged in');
        await expect(p.getByText(MIDI_NOT_LISTED)).toHaveCount(0);
        await expect(p.getByTestId('remote-midi-mapping')).toHaveCount(size.layout === 'phone' ? 2 : 1);
        // Learn: the computer waits for a press on its controller; Cancel stops it. A computer that refuses Drashti
        // MIDI (a test computer may) says so, and Learn is off: it would wait for a press that could never come.
        const learnBlackout = p.getByTestId('remote-midi-learn-blackout');
        if (await learnBlackout.isEnabled()) {
          await learnBlackout.click();
          await expect(p.getByTestId('remote-midi-learning')).toContainText('Black-out');
          await p.getByTestId('remote-midi-learning').getByRole('button', { name: 'Cancel' }).click();
          await expect(p.getByTestId('remote-midi-learning')).toHaveCount(0);
        } else {
          await expect(p.getByTestId('remote-midi-devices')).toContainText(/refused MIDI|cannot be used/u);
        }
        expect(await tooSmall(p), `targets on ${size.name}`).toEqual([]);
        expect(await offTheSide(p), `nothing off the side on ${size.name}`).toEqual([]);
        await expectNoSeriousA11yIssues(p, `the MIDI sheet on ${size.name} (${engine})`);
        // On the phone's pass, Back's mapping is forgotten: the window has it so.
        if (size.layout === 'phone') {
          await p.getByTestId('remote-midi-forget').nth(1).click();
          await expect
            .poll(async () => (await midiNow(win)).mappings.map((m) => m.action.kind))
            .toEqual(['next']);
        }
        await p.getByTestId('remote-midi-sheet-close').click();
      }
      // Simple Mode: forgetting refused in words, nothing changed.
      await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await p.getByTestId('remote-open-midi').click();
      await p.getByTestId('remote-midi-forget').first().click();
      await expect(p.getByTestId('remote-midi-problem')).toContainText('Simple Mode');
      expect((await midiNow(win)).mappings).toHaveLength(1);
      // Pro Mode again: None chosen from the phone.
      expect(
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro')),
      ).toMatchObject({
        ok: true,
      });
      await expect(win.getByTestId('simple-mode')).toHaveCount(0);
      await p.locator('[data-testid="remote-midi-device"][data-device=""]').click();
      await expect.poll(async () => (await midiNow(win)).deviceName).toBeNull();
    } finally {
      await phone.close();
      await app.close();
    }
  });

/** The announcements in the ticker on the screens now, by id. */
const inTicker = (win: Page) =>
  win.evaluate(async () =>
    ((await (globalThis as PageGlobals).drashti.engine.snapshot()).state.layers.ticker?.items ?? []).map(
      (i) => i.id,
    ),
  );

for (const engine of ['webkit', 'chromium'] as Engine[])
  test(`the announcements’ queue from a phone as Announcements decides: one put in the ticker and taken off, one rejected, laid out at 375 × 812 and 768 × 1024, and Simple Mode refusing it in words (${engine})`, async () => {
    test.setTimeout(180_000);
    const { app } = await launchApp(NETWORK_ENV);
    const win = await operatorPage(app);
    await operatorReady(win);
    const { port, base } = await networkOn(win);
    const poster = await pairToken(win, port, 'announcements', 'Placeholder poster');
    const send = async (text: string) => {
      const sent = await apiCall(port, '/api/v1/announcements', {
        method: 'POST',
        token: poster,
        body: { text, from: 'Placeholder volunteer', minutes: 10 },
      });
      expect(sent.status).toBe(202);
      return (sent.json['announcement'] as { id: string }).id;
    };
    const code = await pairingCode(win, 'remote', 'Placeholder phone');
    const phone = await device(engine);
    const p = phone.page;
    try {
      await pairByQr(p, base, code, '/remote');
      await expect(p.getByTestId('connection')).toHaveText('Connected');
      for (const size of SIZES) {
        const first = await send(`Placeholder car notice ${size.layout}`);
        const second = await send(`Placeholder lost keys ${size.layout}`);
        await p.setViewportSize(size);
        if (size.layout === 'phone') await p.getByTestId('remote-tab-more').click();
        await p.getByTestId('remote-open-queue').click();
        await expect(p.getByTestId('remote-queue-sheet')).toBeVisible();
        const waiting = (id: string) => p.locator(`[data-testid="remote-queue-waiting"][data-id="${id}"]`);
        await expect(waiting(first)).toContainText('Placeholder volunteer');
        expect(await tooSmall(p), `targets on ${size.name}`).toEqual([]);
        expect(await offTheSide(p), `nothing off the side on ${size.name}`).toEqual([]);
        await expectNoSeriousA11yIssues(p, `the announcements’ queue on ${size.name} (${engine})`);
        // In the ticker: on the hall's screens; then taken off.
        await waiting(first).getByTestId('remote-queue-ticker').click();
        await expect.poll(() => inTicker(win)).toContain(first);
        const showing = p.locator(`[data-testid="remote-queue-showing"][data-id="${first}"]`);
        await expect(showing).toContainText('in the ticker');
        await showing.getByTestId('remote-queue-take-off').click();
        await expect.poll(() => inTicker(win)).not.toContain(first);
        // Rejected: gone from the queue.
        await waiting(second).getByTestId('remote-queue-reject').click();
        await expect(waiting(second)).toHaveCount(0);
        await p.getByTestId('remote-queue-sheet-close').click();
      }
      // Simple Mode: approving refused in words, nothing up.
      const third = await send('Placeholder refused notice');
      await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).click();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await p.getByTestId('remote-open-queue').click();
      await p
        .locator(`[data-testid="remote-queue-waiting"][data-id="${third}"]`)
        .getByTestId('remote-queue-ticker')
        .click();
      await expect(p.getByTestId('remote-queue-problem')).toContainText('Simple Mode');
      expect(await inTicker(win)).not.toContain(third);
    } finally {
      await phone.close();
      await app.close();
    }
  });
