import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  killApp,
  launchApp,
  operatorPage,
  operatorReady,
  outputPages,
  relaunchApp,
  setUpScreen,
} from './helpers';

/*
 * Looks (Session 11): what each screen group shows, one Look live at a time.
 * Two groups show different layers, languages and slide styles; switching
 * the Look changes both outputs in one engine change; a library from before
 * Looks keeps exactly what each group showed; recovery brings the Look back;
 * Simple Mode refuses switching; the remote and the API switch it. The
 * seeded sample kirtan and placeholder words only.
 */

const TWO_OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };

/** The output showing this screen. */
async function outputFor(app: ElectronApplication, screenId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of outputPages(app))
        if ((await p.getByTestId('output-root').getAttribute('data-screen')) === screenId) found = p;
      return found !== undefined;
    })
    .toBe(true);
  if (!found) throw new Error(`no output for ${screenId}`);
  return found;
}

const bridge = (win: Page) =>
  ({
    snapshot: () => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot()),
    looks: () => win.evaluate(() => (globalThis as PageGlobals).drashti.looks.list()),
  }) as const;

/** The sample kirtan's first slide live, a colour behind it and a message (each a layer a Look can leave out). */
async function upOnTheScreens(win: Page): Promise<void> {
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    await d.engine.dispatch({ type: 'setBackground', background: { kind: 'color', color: '#203040' } });
    await d.engine.dispatch({ type: 'showMessage', message: { id: 'm1', text: 'Placeholder message' } });
  });
}

/**
 * What an output draws now: its Look, layers, the slide's languages, whether the words are a lower
 * third, and where the messages go (along the top over a lower third, never covering its words).
 */
const drawn = (out: Page) =>
  out.getByTestId('output-root').evaluate((root) => {
    const message = root.querySelector<HTMLElement>('[data-layer="messages"]');
    const a = message?.getBoundingClientRect();
    const b = root.querySelector('[data-testid="lower-third"] > div')?.getBoundingClientRect();
    return {
      look: root.getAttribute('data-look'),
      background: root.querySelector('[data-layer="background"]') !== null,
      messages: message !== null,
      messagesAt: message ? (message.style.top === '' ? 'bottom' : 'top') : null,
      covered: a !== undefined && b !== undefined && a.top < b.bottom && b.top < a.bottom,
      slides: root.querySelector('[data-layer="slide"]')?.getAttribute('data-slides') ?? null,
      lowerThird: [...root.querySelectorAll('[data-testid="lower-third"] [data-lang]')].map((l) =>
        l.getAttribute('data-lang'),
      ),
      langs: [...root.querySelectorAll('[data-layer="slide"] [data-slide-in] [data-run]')].map((r) =>
        r.getAttribute('data-lang'),
      ),
    };
  });

test('two groups show their own layers, languages and slide style, and switching the Look changes both at once', async () => {
  const { app } = await launchApp(TWO_OUTPUTS);
  const win = await operatorPage(app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Hall', 0);
  const sideId = await setUpScreen(win, 'Side', 1);
  const [hall, side] = [await outputFor(app, hallId), await outputFor(app, sideId)];
  await upOnTheScreens(win);
  const standard = (await bridge(win).looks()).liveId;
  await expect
    .poll(() => drawn(hall))
    .toEqual({
      look: standard,
      background: true,
      messages: true,
      messagesAt: 'bottom',
      covered: false,
      slides: 'designed',
      lowerThird: [],
      langs: ['gu', 'hi', 'translit', 'en'],
    });

  // In Screens: a new Look. The hall: no background, the words as a lower third in transliteration;
  // the side: Gujarati only, no messages.
  await win.getByRole('button', { name: 'Screens', exact: true }).click();
  const section = win.getByTestId('looks-section');
  await expect(section.getByTestId('look-choice').filter({ hasText: 'Standard' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await section.getByTestId('new-look').click();
  await expect(section.getByTestId('look-choice').filter({ hasText: 'New Look' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await section.getByRole('textbox', { name: 'Look name' }).fill('Placeholder lower thirds');
  await section.getByRole('textbox', { name: 'Look name' }).press('Enter');
  await expect(
    section.getByTestId('look-choice').filter({ hasText: 'Placeholder lower thirds' }),
  ).toBeVisible();
  const groups = win.getByTestId('screen-group');
  const hallCard = groups.nth(0).getByTestId('group-look');
  await expect(hallCard).toContainText('In the Look “Placeholder lower thirds”');
  await hallCard.getByTestId('look-layer-background').uncheck();
  await hallCard.getByTestId('look-slides').selectOption('lowerThird');
  await hallCard.getByTestId('languages-some').check();
  for (const name of ['Gujarati', 'Hindi', 'English'])
    await hallCard.getByTestId('language-picker').getByRole('checkbox', { name }).uncheck();
  const sideCard = groups.nth(1).getByTestId('group-look');
  await sideCard.getByTestId('look-layer-messages').uncheck();
  await sideCard.getByTestId('languages-some').check();
  for (const name of ['Hindi', 'Transliteration', 'English'])
    await sideCard.getByTestId('language-picker').getByRole('checkbox', { name }).uncheck();
  await expectNoSeriousA11yIssues(win, 'Screens with two Looks, a group’s settings in one');
  // Standard is unchanged: its settings are still the defaults.
  await section.getByTestId('look-choice').filter({ hasText: 'Standard' }).click();
  await expect(groups.nth(0).getByTestId('look-layer-background')).toBeChecked();
  await expect(groups.nth(0).getByTestId('languages-all')).toBeChecked();
  await win.getByRole('button', { name: 'Close screens' }).click();
  // Nothing changed on the screens: the new Look is not live.
  await expect.poll(async () => (await drawn(hall)).look).toBe(standard);
  expect((await drawn(side)).langs).toEqual(['gu', 'hi', 'translit', 'en']);

  // Switch from the Looks panel: one engine change, and both outputs draw it.
  const panel = win.getByTestId('looks-panel');
  await expectNoSeriousA11yIssues(win, 'the Looks panel');
  const lower =
    (await bridge(win).looks()).looks.find((l) => l.name === 'Placeholder lower thirds')?.id ?? '';
  const before = (await bridge(win).snapshot()).rev;
  await panel.getByRole('button', { name: 'Placeholder lower thirds' }).click();
  await expect(panel.getByRole('button', { name: 'Placeholder lower thirds' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const after = await bridge(win).snapshot();
  expect(after.rev).toBe(before + 1);
  expect(after.state.look.id).toBe(lower);
  await expect
    .poll(() => drawn(hall))
    .toEqual({
      look: lower,
      background: false,
      messages: true,
      messagesAt: 'top',
      covered: false,
      slides: 'lowerThird',
      lowerThird: ['translit'],
      langs: [],
    });
  await expect
    .poll(() => drawn(side))
    .toEqual({
      look: lower,
      background: true,
      messages: false,
      messagesAt: null,
      covered: false,
      slides: 'designed',
      lowerThird: [],
      langs: ['gu'],
    });
  // Both painted the switch's revision (in step: the same engine change).
  for (const out of [hall, side])
    await expect
      .poll(async () => Number(await out.getByTestId('output-root').getAttribute('data-painted-rev')))
      .toBeGreaterThanOrEqual(after.rev);
  // And back.
  await panel.getByRole('button', { name: /Standard/ }).click();
  await expect.poll(async () => (await drawn(hall)).langs).toEqual(['gu', 'hi', 'translit', 'en']);
  await expect.poll(async () => (await drawn(side)).messages).toBe(true);
  await app.close();
});

test('a library from before Looks keeps exactly what each group showed', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'drashti-e2e-'));
  // Written as Drashti kept it in Session 10 (schema 19: each group's languages on the group).
  const electron = createRequire(__filename)('electron') as string;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, TWO_OUTPUTS, {
    DRASHTI_USER_DATA_DIR: userData,
    DRASHTI_SELFTEST: 'old-library',
    DRASHTI_TEST_QUIET: '1',
    DRASHTI_SELFTEST_LIBRARY: JSON.stringify({
      schema: 19,
      groups: [
        { name: 'Hall', role: 'audience', languages: ['translit', 'gu'], display: 0 },
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
  // The upgrade kept a copy of the old library, and made one Look: Standard, with each group's languages.
  expect(existsSync(join(userData, 'drashti.sqlite.v19.bak'))).toBe(true);
  const { looks, liveId } = await bridge(win).looks();
  expect(looks.map((l) => l.name)).toEqual(['Standard']);
  expect(liveId).toBe(looks[0]?.id);
  const snapshot = await win.evaluate(() => (globalThis as PageGlobals).drashti.screens.get());
  const all = ['background', 'slide', 'props', 'messages', 'ticker', 'masks'];
  const standard = { layers: all, slides: 'designed', stageLayoutId: null, maskId: null, idle: 'off' };
  expect(snapshot.groups.map((g) => [g.name, g.role, looks[0]?.groups[g.id]])).toEqual([
    ['Hall', 'audience', { ...standard, languages: ['translit', 'gu'] }],
    ['Stage', 'stage', { ...standard, languages: ['gu'] }],
  ]);
  // The screens show what they did: the hall transliteration then Gujarati, the stage Gujarati only.
  await expect.poll(() => outputPages(app).length).toBe(2);
  const hallScreen = snapshot.groups[0]?.screens[0]?.id ?? '';
  const stageScreen = snapshot.groups[1]?.screens[0]?.id ?? '';
  const [hall, stage] = [await outputFor(app, hallScreen), await outputFor(app, stageScreen)];
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  await win.getByTestId('slide-thumb').first().click();
  await expect(hall.getByTestId('output-root')).toHaveAttribute('data-languages', 'translit,gu');
  await expect.poll(async () => (await drawn(hall)).langs).toEqual(['translit', 'gu']);
  await expect(stage.getByTestId('stage-current')).toHaveText('નમૂનાની પહેલી પંક્તિ');
  await app.close();
});

test('recovery brings the Look back; Simple Mode refuses switching; the remote and the API switch it', async () => {
  test.setTimeout(150_000);
  const first = await launchApp({ ...NETWORK_ENV, ...TWO_OUTPUTS });
  const win = await operatorPage(first.app);
  await operatorReady(win);
  const hallId = await setUpScreen(win, 'Hall', 0);
  const hall = await outputFor(first.app, hallId);
  await upOnTheScreens(win);
  // A second Look, made through the bridge: the hall in Gujarati only.
  const second = await win.evaluate(async (groupName) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.looks.create('Placeholder evening', null);
    if (!made.ok) throw new Error(made.message);
    const look = made.view.looks.find((l) => l.name === 'Placeholder evening');
    const group = (await d.screens.get()).groups.find((g) => g.name === groupName);
    const set = await d.looks.setGroup(look?.id ?? '', group?.id ?? '', { languages: ['gu'] });
    if (!set.ok) throw new Error(set.message);
    return look?.id ?? '';
  }, 'Hall');
  const standard = (await bridge(win).looks()).liveId;

  // The API switches it, with a Remote device's token; a Stage device's is refused.
  const { port, base } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  const listed = await apiCall(port, '/api/v1/looks', { token });
  expect(listed.json).toMatchObject({
    ok: true,
    liveId: standard,
    looks: [
      { id: standard, name: 'Standard' },
      { id: second, name: 'Placeholder evening' },
    ],
  });
  expect((await apiCall(port, `/api/v1/looks/${second}/live`, { method: 'POST', token })).status).toBe(200);
  await expect.poll(async () => (await drawn(hall)).langs).toEqual(['gu']);
  const stageToken = await pairToken(win, port, 'stage', 'Placeholder tablet');
  expect(
    (await apiCall(port, `/api/v1/looks/${standard}/live`, { method: 'POST', token: stageToken })).status,
  ).toBe(403);
  expect((await apiCall(port, '/api/v1/looks/no-such-look/live', { method: 'POST', token })).status).toBe(
    409,
  );

  // The phone remote switches it back, from its More tab.
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await phone.page.getByTestId('remote-tab-more').click();
    const looksOnPhone = phone.page.getByTestId('remote-looks');
    await expect(looksOnPhone.getByRole('button', { name: 'Placeholder evening' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expectNoSeriousA11yIssues(phone.page, 'the remote’s More tab with Looks');
    await looksOnPhone.getByRole('button', { name: 'Standard' }).click();
    await expect.poll(async () => (await bridge(win).snapshot()).state.look.id).toBe(standard);
    await expect.poll(async () => (await drawn(hall)).langs).toEqual(['gu', 'hi', 'translit', 'en']);
  } finally {
    await phone.close();
  }

  // Simple Mode keeps the live Look: the window, the API and the remote are all refused.
  await chooseMenuItem(first.app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  await expect(win.getByTestId('looks-panel')).toHaveCount(0);
  const refused = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'setLook', lookId: id }),
    second,
  );
  expect(refused).toMatchObject({ ok: false, error: 'forbidden' });
  expect((await apiCall(port, `/api/v1/looks/${second}/live`, { method: 'POST', token })).status).toBe(403);
  const changeRefused = await win.evaluate(
    (id) => (globalThis as PageGlobals).drashti.looks.rename(id, 'Changed'),
    second,
  );
  expect(changeRefused.ok).toBe(false);
  expect((await bridge(win).snapshot()).state.look.id).toBe(standard);
  // Back to Pro Mode (the word typed), then the second Look live, and an unexpected stop.
  await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro', 'pro'));
  await expect(win.getByTestId('looks-panel')).toBeVisible();
  await win.getByTestId('looks-panel').getByRole('button', { name: 'Placeholder evening' }).click();
  await expect.poll(async () => (await drawn(hall)).langs).toEqual(['gu']);
  const saved = join(first.userData, 'live-state.json');
  await expect
    .poll(() =>
      existsSync(saved) ? (JSON.parse(readFileSync(saved, 'utf8')) as { lookId?: string }).lookId : null,
    )
    .toBe(second);
  await killApp(first.app);

  // Recovery: the Look comes back, and the operator is told.
  const again = await relaunchApp(first.userData, { ...NETWORK_ENV, ...TWO_OUTPUTS });
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await expect.poll(async () => (await bridge(win2).snapshot()).state.look.id).toBe(second);
  await expect(win2.getByTestId('recovery-notice')).toContainText('the Look “Placeholder evening”');
  const hall2 = await outputFor(again.app, hallId);
  await expect.poll(async () => (await drawn(hall2)).langs).toEqual(['gu']);
  await again.app.close();
});
