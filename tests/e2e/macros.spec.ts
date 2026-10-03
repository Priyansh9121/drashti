import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues } from './a11y';
import { apiCall, device, NETWORK_ENV, networkOn, pairByQr, pairingCode, pairToken } from './devices';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, setUpScreen } from './helpers';

/*
 * Macros and MIDI (Session 11): a macro made in the editor runs every action
 * as one change; a slide's cue runs one with the slide; the API and the
 * phone remote run one; actions a macro may not do are refused when saved and
 * again when run. MIDI, with Web MIDI mocked in the operator page: Learn maps
 * a note and a controller, and they work; only the operator page may use
 * MIDI (never SysEx); Simple Mode runs no macros, but Next from a pad works.
 * Placeholder content; tokens are made at run time.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

async function sampleKirtan(win: Page): Promise<string> {
  await win
    .getByTestId('presentation-list')
    .getByRole('button', { name: /Sample kirtan/ })
    .click();
  return (await win.getByTestId('slide-grid').getAttribute('data-presentation-id')) ?? '';
}

test('a macro runs every action as one change, from the panel, a slide cue, the API and the remote; forbidden actions are refused', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp(NETWORK_ENV);
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const output = await outputPage(app);
  await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const prop = await d.props.save(null, {
      name: 'Placeholder mandir logo',
      width: 1920,
      height: 1080,
      elements: [
        {
          id: 'logo-box',
          kind: 'shape',
          shape: 'rectangle',
          frame: { x: 1700, y: 40, width: 160, height: 160 },
          fill: '#f5a524',
          cornerRadius: 0,
          opacity: 1,
        },
      ],
    });
    if (!prop.ok) throw new Error(prop.message);
    const message = await d.messages.create({ name: 'Car', template: 'Car {plate} please move', fields: {} });
    if (!message.ok) throw new Error(message.message);
  });

  // The editor (the Macros panel's Edit): a new macro, its actions in order.
  const panel = win.getByTestId('macros-panel');
  await panel.getByRole('button', { name: 'Edit' }).click();
  const editor = win.getByTestId('macro-editor');
  await expect(editor).toBeVisible();
  await editor.getByTestId('macro-name').fill('Placeholder arti');
  const add = async (kind: string) => {
    await editor.getByTestId('macro-add-kind').selectOption(kind);
    await editor.getByTestId('macro-add-action').click();
  };
  await add('clearAll');
  await add('showProp');
  await add('showMessage');
  await editor.getByTestId('macro-action').nth(2).getByRole('textbox', { name: '{plate}' }).fill('12');
  await add('backgroundColor');
  await add('stageMessage');
  await expect(editor.getByTestId('macro-action')).toHaveCount(5);
  await expectNoSeriousA11yIssues(win, 'the macro editor');
  await editor.getByTestId('macro-save').click();
  await expect(editor.getByTestId('macro-list')).toContainText('Placeholder arti');
  await editor.getByRole('button', { name: 'Close macros' }).click();
  await expectNoSeriousA11yIssues(win, 'the Macros panel');

  // Run from the panel: every action, in one engine change.
  const presentationId = await sampleKirtan(win);
  await win.getByTestId('slide-thumb').first().click();
  await expect(output.locator('[data-layer="slide"]')).toHaveCount(1);
  const before = (await snapshot(win)).rev;
  await panel.getByTestId('macro-button').filter({ hasText: 'Placeholder arti' }).click();
  await expect.poll(async () => (await snapshot(win)).rev).toBe(before + 1);
  const s = (await snapshot(win)).state;
  expect(s.layers.slide).toBeNull();
  expect(s.layers.props.map((p) => p.name)).toEqual(['Placeholder mandir logo']);
  expect(s.layers.messages.map((m) => m.text)).toEqual(['Car 12 please move']);
  expect(s.layers.background).toEqual({ kind: 'color', color: '#000000' });
  expect(s.stageMessage).toBe('Placeholder: two minutes');
  await expect(output.locator('[data-layer="messages"]')).toHaveText('Car 12 please move');
  // It had Clear all in it: Put it back brings back what was up before it.
  expect(s.canPutBack).toBe(true);

  // Forbidden: refused when saved…
  const refused = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.macros.save(null, {
      name: 'Placeholder forbidden',
      color: '#3e63dd',
      actions: [{ kind: 'clearAll' }, { kind: 'goLiveStream' } as never],
    }),
  );
  expect(refused.ok ? '' : refused.message).toContain('not something a macro may do');
  // …and again when run, if one were written into the library another way.
  const macroId = (await win.evaluate(() => (globalThis as PageGlobals).drashti.macros.list()))[0]?.id ?? '';
  await app.evaluate(
    (_electron, { file, id }) => {
      const main = (process as unknown as { mainModule?: { require(name: string): unknown } }).mainModule;
      const Database = main?.require('better-sqlite3') as new (path: string) => {
        prepare(sql: string): { run(...args: unknown[]): unknown };
        close(): void;
      };
      const db = new Database(file);
      db.prepare('UPDATE macros SET actions = ? WHERE id = ?').run(
        JSON.stringify([{ kind: 'clearAll' }, { kind: 'endStream' }]),
        id,
      );
      db.close();
    },
    { file: join(userData, 'drashti.sqlite'), id: macroId },
  );
  const rev = (await snapshot(win)).rev;
  const ran = await win.evaluate((id) => (globalThis as PageGlobals).drashti.macros.run(id), macroId);
  expect(ran.ok ? '' : ran.message).toContain('not something a macro may do');
  expect((await snapshot(win)).rev).toBe(rev);

  // A slide's cue: the second slide runs a macro as it goes up, in the same change.
  const cue = await win.evaluate(async (pid) => {
    const d = (globalThis as PageGlobals).drashti;
    const made = await d.macros.save(null, {
      name: 'Placeholder cue',
      color: '#2f9e44',
      actions: [{ kind: 'stageMessage', text: 'Placeholder: the cue ran' }],
    });
    if (!made.ok) throw new Error(made.message);
    const loaded = await d.library.slidesForEdit(pid);
    if (!loaded.ok) throw new Error(loaded.message);
    const second = loaded.doc.groups.flatMap((g) => g.slides)[1];
    if (!second) throw new Error('no second slide');
    second.macroId = made.id;
    const saved = await d.library.saveSlides(pid, loaded.doc, loaded.stamp, false);
    if (!saved.ok) throw new Error(saved.message);
    await d.engine.dispatch({ type: 'clearStageMessage' });
    await d.engine.dispatch({ type: 'goLive', presentationId: pid, slideIndex: 0 });
    return made.id;
  }, presentationId);
  const atCue = (await snapshot(win)).rev;
  await win.evaluate(() => (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'next' }));
  const after = await snapshot(win);
  expect(after.rev).toBe(atCue + 1);
  expect(after.state.layers.slide?.slideIndex).toBe(1);
  expect(after.state.stageMessage).toBe('Placeholder: the cue ran');

  // The API, with a Remote device's token.
  const { port, base } = await networkOn(win);
  const token = await pairToken(win, port, 'remote', 'Placeholder script');
  const listed = await apiCall(port, '/api/v1/macros', { token });
  expect(listed.json).toMatchObject({
    ok: true,
    macros: [{ name: 'Placeholder arti' }, { name: 'Placeholder cue' }],
  });
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearStageMessage' }),
  );
  expect((await apiCall(port, `/api/v1/macros/${cue}/run`, { method: 'POST', token })).status).toBe(200);
  await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBe('Placeholder: the cue ran');

  // The phone remote, from its More tab.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearStageMessage' }),
  );
  const code = await pairingCode(win, 'remote', 'Placeholder phone');
  const phone = await device('chromium');
  try {
    await pairByQr(phone.page, base, code, '/remote');
    await expect(phone.page.getByTestId('connection')).toHaveText('Connected');
    await phone.page.getByTestId('remote-tab-more').click();
    await phone.page.getByTestId('remote-macros').getByRole('button', { name: 'Placeholder cue' }).click();
    await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBe('Placeholder: the cue ran');
  } finally {
    await phone.close();
  }
  await app.close();
});

/** Web MIDI, mocked in the operator page: one device whose messages the test sends. */
async function mockMidi(win: Page): Promise<void> {
  await win.evaluate(() => {
    const input = {
      id: 'placeholder-pad-1',
      name: 'Placeholder pad',
      state: 'connected',
      type: 'input',
      onmidimessage: null as ((e: { data: Uint8Array }) => void) | null,
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      onstatechange: null,
      sysexEnabled: false,
    };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: (options?: { sysex?: boolean }) =>
        options?.sysex === true ? Promise.reject(new Error('no SysEx')) : Promise.resolve(access),
    });
    (globalThis as unknown as { fakeMidi: (bytes: number[]) => void }).fakeMidi = (bytes) => {
      input.onmidimessage?.({ data: new Uint8Array(bytes) });
    };
  });
}

const midi = (win: Page, bytes: number[]) =>
  win.evaluate((b) => {
    (globalThis as unknown as { fakeMidi: (bytes: number[]) => void }).fakeMidi(b);
  }, bytes);

test('MIDI: only the operator page may use it; Learn maps a note and a controller; Simple Mode runs no macros but a pad’s Next works', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await setUpScreen(win);
  const output = await outputPage(app);

  // Permission: the operator page only, never SysEx.
  const query = (page: Page, sysex: boolean) =>
    page.evaluate(
      async (s) =>
        (await navigator.permissions.query({ name: 'midi', sysex: s } as unknown as PermissionDescriptor))
          .state,
      sysex,
    );
  expect(await query(win, false)).toBe('granted');
  expect(await query(win, true)).not.toBe('granted');
  expect(await query(output, false)).not.toBe('granted');

  const macroId = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.macros.save(null, {
      name: 'Placeholder pad macro',
      color: '#c2255c',
      actions: [{ kind: 'stageMessage', text: 'Placeholder: from the pad' }],
    });
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });
  await mockMidi(win);
  await win.getByTestId('macros-panel').getByTestId('open-midi').click();
  const dialog = win.getByTestId('midi-dialog');
  await dialog.getByTestId('midi-device').selectOption('Placeholder pad');
  await expect(dialog.getByText('Connected')).toBeVisible();
  const target = (name: string) => dialog.getByTestId('midi-target').filter({ hasText: name });
  await target('Next').getByRole('button', { name: 'Learn' }).click();
  await midi(win, [0x90, 36, 100]);
  await expect(target('Next').getByTestId('midi-input')).toHaveText('Note 36, channel 1');
  await target('Placeholder pad macro').getByRole('button', { name: 'Learn' }).click();
  await midi(win, [0xb9, 20, 127]);
  await expect(target('Placeholder pad macro').getByTestId('midi-input')).toHaveText(
    'Controller 20, channel 10',
  );
  await expectNoSeriousA11yIssues(win, 'the MIDI dialog');
  await dialog.getByRole('button', { name: 'Close MIDI' }).click();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.midi.get())).toEqual({
    deviceName: 'Placeholder pad',
    mappings: [
      { input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'next' } },
      { input: { type: 'cc', channel: 9, number: 20 }, action: { kind: 'macro', macroId } },
    ],
  });

  // The note is Next; the controller, rising past its middle, runs the macro.
  const pid = await sampleKirtan(win);
  await win.evaluate(
    (p) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: p,
        slideIndex: 0,
      }),
    pid,
  );
  await midi(win, [0x90, 36, 100]);
  await expect.poll(async () => (await snapshot(win)).state.layers.slide?.slideIndex).toBe(1);
  await midi(win, [0xb9, 20, 0]);
  await midi(win, [0xb9, 20, 127]);
  await expect.poll(async () => (await snapshot(win)).state.stageMessage).toBe('Placeholder: from the pad');

  // Simple Mode: the pad's Next still works; its macro is refused.
  await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.engine.dispatch({ type: 'clearStageMessage' }),
  );
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('switch-mode')?.click();
  });
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // The mock stays (the page did not reload); MIDI listens in both modes.
  await midi(win, [0xb9, 20, 0]);
  await midi(win, [0xb9, 20, 127]);
  await expect(win.getByTestId('operator-notice')).toContainText('Simple Mode is on');
  expect((await snapshot(win)).state.stageMessage).toBeNull();
  await midi(win, [0x90, 36, 100]);
  await expect.poll(async () => (await snapshot(win)).state.layers.slide?.slideIndex).toBe(2);
  const refused = await win.evaluate((id) => (globalThis as PageGlobals).drashti.macros.run(id), macroId);
  expect(refused).toMatchObject({ ok: false });
  await app.close();
});
