import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import {
  chooseMenuItem,
  closeLibrary,
  launchApp,
  openLibrary,
  openMoreTools,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
} from './helpers';

/*
 * The MIDI controller (Session 11; Session 44 moved its way in to More tools, as Macros went): with Web MIDI
 * mocked in the operator page, Learn maps a note and a controller, and they work; only the operator page may use
 * MIDI (never SysEx); Simple Mode's own actions work from a pad there too. A pad mapped to a macro before Session
 * 44 stays in the settings, as the library had it, and does nothing. Placeholder content only.
 */

const snapshot = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

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

test('MIDI: only the operator page may use it; Learn maps a note and a controller; they work in Pro Mode and Simple Mode; a pad once mapped to a macro does nothing', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await openMoreTools(win);
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

  // A library from before Session 44: a pad mapped to a macro. Kept as it was, never listed.
  const oldMacro = '00000000-0000-4000-8000-0000000000aa';
  const kept = await win.evaluate(
    (macroId) =>
      (globalThis as PageGlobals).drashti.midi.set({
        deviceName: null,
        mappings: [{ input: { type: 'note', channel: 0, number: 40 }, action: { kind: 'macro', macroId } }],
      }),
    oldMacro,
  );
  expect(kept.ok).toBe(true);
  // The window reads it as it starts, as it would a library's from before.
  await win.reload();
  await operatorReady(win);
  await openMoreTools(win);

  await mockMidi(win);
  // MIDI is in More tools (Session 44: it was the Macros panel's).
  await win.getByTestId('more-tools').getByTestId('open-midi').click();
  const dialog = win.getByTestId('midi-dialog');
  await dialog.getByTestId('midi-device').selectOption('Placeholder pad');
  await expect(dialog.getByText('Connected')).toBeVisible();
  const target = (name: string) => dialog.getByTestId('midi-target').filter({ hasText: name });
  await expect(dialog.getByTestId('midi-target')).toHaveText([
    /^Next/u,
    /^Back/u,
    /^Clear all/u,
    /^Black-out/u,
    /^Logo/u,
  ]);
  await target('Next').getByRole('button', { name: 'Learn' }).click();
  await midi(win, [0x90, 36, 100]);
  await expect(target('Next').getByTestId('midi-input')).toHaveText('Note 36, channel 1');
  await target('Black-out').getByRole('button', { name: 'Learn' }).click();
  await midi(win, [0xb9, 20, 127]);
  await expect(target('Black-out').getByTestId('midi-input')).toHaveText('Controller 20, channel 10');
  await expectNoSeriousA11yIssues(win, 'the MIDI dialog');
  await dialog.getByRole('button', { name: 'Close MIDI' }).click();
  expect(await win.evaluate(() => (globalThis as PageGlobals).drashti.midi.get())).toEqual({
    deviceName: 'Placeholder pad',
    mappings: [
      { input: { type: 'note', channel: 0, number: 40 }, action: { kind: 'macro', macroId: oldMacro } },
      { input: { type: 'note', channel: 0, number: 36 }, action: { kind: 'next' } },
      { input: { type: 'cc', channel: 9, number: 20 }, action: { kind: 'blackout' } },
    ],
  });

  // The note is Next; the controller, rising past its middle, is Black-out; the old macro's pad does nothing.
  const id = await win.evaluate(async () => {
    const made = await (globalThis as PageGlobals).drashti.library.newFromWords(
      'Placeholder pad words',
      'Placeholder one\n\nPlaceholder two\n\nPlaceholder three\n',
    );
    if (!made.ok) throw new Error(made.message);
    return made.id;
  });
  // Chosen in the window, then live: Next goes on in it (as the → key does).
  const sheet = await openLibrary(win);
  await sheet.getByTestId('presentation-row').filter({ hasText: 'Placeholder pad words' }).click();
  await closeLibrary(win);
  await win.evaluate(
    (p) =>
      (globalThis as PageGlobals).drashti.engine.dispatch({
        type: 'goLive',
        presentationId: p,
        slideIndex: 0,
      }),
    id,
  );
  await midi(win, [0x90, 36, 100]);
  await expect.poll(async () => (await snapshot(win)).state.layers.slide?.slideIndex).toBe(1);
  const before = (await snapshot(win)).rev;
  await midi(win, [0x90, 40, 100]);
  await expect(win.getByTestId('operator-notice')).toHaveCount(0);
  expect((await snapshot(win)).rev).toBe(before);
  await midi(win, [0xb9, 20, 0]);
  await midi(win, [0xb9, 20, 127]);
  await expect.poll(async () => (await snapshot(win)).state.blackout).toBe(true);
  await midi(win, [0xb9, 20, 0]);
  await midi(win, [0xb9, 20, 127]);
  await expect.poll(async () => (await snapshot(win)).state.blackout).toBe(false);

  // Simple Mode: the pad's Next and Black-out still work; the old macro's pad still does nothing.
  await chooseMenuItem(app, 'switch-mode');
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  // The mock stays (the page did not reload); MIDI listens in both modes.
  await midi(win, [0x90, 36, 100]);
  await expect.poll(async () => (await snapshot(win)).state.layers.slide?.slideIndex).toBe(2);
  const still = (await snapshot(win)).rev;
  await midi(win, [0x90, 40, 100]);
  await expect(win.getByTestId('operator-notice')).toHaveCount(0);
  expect((await snapshot(win)).rev).toBe(still);
  await midi(win, [0xb9, 20, 0]);
  await midi(win, [0xb9, 20, 127]);
  await expect.poll(async () => (await snapshot(win)).state.blackout).toBe(true);
  await app.close();
});
