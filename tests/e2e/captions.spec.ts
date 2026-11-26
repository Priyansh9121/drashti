import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CaptionTranslationStatus } from '../../src/shared/caption-translation';
import type { CaptionsStatus } from '../../src/shared/captions';
import { IPC } from '../../src/shared/ipc';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import {
  skippedText,
  TRANSLATION_TRIAL_WARNING,
  unavailableText,
} from '../../src/renderer/src/captions/caption-target-words';
import { expectNoSeriousA11yIssues } from './a11y';
import { expectFits } from './fit';
import {
  chooseMenuItem,
  launchApp,
  NO_PLACEHOLDERS,
  operatorPage,
  operatorReady,
  outputPages,
  type PageGlobals,
  setUpScreen,
} from './helpers';
import { importCaptionPack, placeholderCaptionPack } from './caption-ai-fixtures';

/*
 * Live captions (Session 55, Part 10). The test switch DRASHTI_TEST_SPEECH stands in for the engine (no sound, no
 * model, no download): it "hears" placeholder phrases in turn, each half then whole, and the hub, the captions and
 * the screens run as they do with whisper.cpp. Off until an admin turns them on (File › Live Captions…, Pro Mode),
 * marked Trial; on, they show on the stage screens, and on the audience screens only when chosen; Gujarati chosen
 * says it is a trial; off takes them off every screen; Simple Mode has no way to change them. Two outputs on one
 * computer, windowed, the second on a pretend display: nothing takes the screen.
 */

const OUTPUTS = { DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_EXTRA_DISPLAYS: '1' };
const SPEECH = { DRASHTI_TEST_SPEECH: 'alpha beta gamma कखग|delta epsilon zeta कखग' };
const HEARD = /alpha beta gamma|delta epsilon zeta/u;

const roleOf = (p: Page) => p.getByTestId('output-root').getAttribute('data-role');
const openRoles = async (app: ElectronApplication) =>
  (await Promise.all(outputPages(app).map(roleOf))).sort();
const outputWith = async (app: ElectronApplication, role: string) => {
  for (const p of outputPages(app)) if ((await roleOf(p)) === role) return p;
  throw new Error(`No ${role} output is open`);
};

/** The hall's screen on the first display and the stage screen on the second. */
async function hallAndStage(win: Page, app: ElectronApplication): Promise<void> {
  await setUpScreen(win, 'Main Hall', 0);
  const stage = await setUpScreen(win, 'Stage', 1);
  await win.evaluate(async (screenId) => {
    const d = (globalThis as PageGlobals).drashti;
    const group = (await d.screens.get()).groups.find((g) => g.screens.some((x) => x.id === screenId));
    const set = await d.screens.setGroupRole(group?.id ?? '', 'stage');
    if (!set.ok) throw new Error(set.message);
  }, stage);
  await expect.poll(() => openRoles(app)).toEqual(['audience', 'stage']);
}

test('off until turned on and marked Trial; on, what is heard shows on the stage, on the audience only when chosen; off takes it off every screen', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp({ ...OUTPUTS, ...NO_PLACEHOLDERS, ...SPEECH });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await hallAndStage(win, app);
    const stage = await outputWith(app, 'stage');
    const hall = await outputWith(app, 'audience');

    // Off at first, marked Trial; nothing on any screen.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('captions-trial')).toHaveText('Trial');
    await expect(dialog.getByTestId('captions-on')).toHaveText(
      'Live captions on this computer (Trial). Can slow the screens while on.',
    );
    await expect(dialog.getByTestId('captions-on')).toHaveAttribute('aria-checked', 'false');
    await expect(dialog.getByTestId('captions-state')).toHaveText('Off on this computer.');
    for (const p of outputPages(app)) await expect(p.getByTestId('captions')).toHaveCount(0);

    // On: the stand-in's words on the stage screen, not on the audience's.
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    await expect(stage.getByTestId('captions')).toContainText(HEARD, { timeout: 15_000 });
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-screen', 'stage');
    await expect(hall.getByTestId('captions')).toHaveCount(0);

    // The audience screens too, when chosen: kept in the library.
    await dialog.getByTestId('captions-audience').click();
    await expect(hall.getByTestId('captions')).toContainText(HEARD, { timeout: 15_000 });
    expect(
      await win.evaluate(
        async () => (await (globalThis as PageGlobals).drashti.captions.view()).settings.audience,
      ),
    ).toBe(true);

    // Size and place follow at once.
    await dialog.getByTestId('captions-size').selectOption('large');
    await dialog.getByTestId('captions-place').selectOption('top');
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-size', 'large', { timeout: 15_000 });
    await expect(stage.getByTestId('captions')).toHaveAttribute('data-place', 'top');

    // Gujarati chosen: it says plainly it is a trial.
    await dialog.getByTestId('captions-language').selectOption('gu');
    await expect(dialog.getByTestId('captions-gujarati-trial')).toContainText('Gujarati is a trial');

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(dialog, `the Live captions dialog at ${String(size.width)} × ${String(size.height)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Live captions');

    await dialog.getByTestId('captions-language').selectOption('sa');
    for (const output of [stage, hall]) {
      const captions = output.getByTestId('captions');
      await expect(captions).toHaveAttribute('lang', 'sa-Gujr');
      await expect(captions).toContainText('કખગ');
      await expect(captions.locator(':scope > div')).toHaveCSS('font-family', /^["']?Noto Sans Gujarati/u);
    }

    // Off: off every screen at once.
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Off on this computer.');
    for (const p of outputPages(app)) await expect(p.getByTestId('captions')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // Simple Mode: no File menu, and the main process refuses to show or change captions.
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    expect(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('live-captions') ?? null),
    ).toBeNull();
    const refused = await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      return { view: await d.captions.view(), on: await d.captions.setOn(true) };
    });
    expect(refused.view).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    expect(refused.on).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  } finally {
    await app.close();
  }
});

/**
 * Captions resting because the computer cannot keep up (cap-threads: today's Standard on CI's two-core Windows showed
 * nothing at all). Never silence: DRASHTI_TEST_SPEECH_HOLD makes the stand-in rest after its first phrase, as a
 * computer too slow for its model does (placeholder numbers). With the dialog closed, the status bar says so, and its
 * Live Captions… opens the dialog, which says what was measured; off, the line goes. Simple Mode shows the line too,
 * without the button (the dialog is Pro Mode's).
 */
test('captions resting because the computer cannot keep up say so in the status bar, and the dialog says what was measured', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...NO_PLACEHOLDERS, ...SPEECH, DRASHTI_TEST_SPEECH_HOLD: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const line = win.getByTestId('captions-warning');
    await expect(line).toHaveCount(0);

    // Turned on, then the dialog closed: the operator watches the show, not the dialog.
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-on').click();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(line).toHaveText('Captions are resting: this computer cannot keep up.Live Captions…', {
      timeout: 15_000,
    });
    await expectFits(
      win.getByRole('contentinfo', { name: 'Status' }),
      'the status bar with captions resting',
    );
    await expectNoSeriousA11yIssues(win, 'Captions resting, in the status bar');

    // Its button opens the dialog, which says what was measured.
    await line.getByRole('button', { name: 'Live Captions…' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('captions-state')).toHaveText(
      /^Resting: this computer could not keep up with live captions \(3 answers in a row took over 2\.2 seconds each, the last 9\.1 seconds, with 2 engine threads\)/u,
    );

    // Off: the line goes. On again: it rests again, and says so again.
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Off on this computer.');
    await expect(line).toHaveCount(0);
    await dialog.getByTestId('captions-on').click();
    await expect(line).toContainText('Captions are resting: this computer cannot keep up.', {
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // Simple Mode: the same line, without the button.
    await win.getByRole('button', { name: 'Simple Mode' }).dblclick();
    await expect
      .poll(() => win.evaluate(() => (globalThis as PageGlobals).drashti.app.getMode()))
      .toBe('simple');
    await expect(line).toHaveText('Captions are resting: this computer cannot keep up.');
    await expect(line.getByRole('button')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

/**
 * A computer too slow for live captions (cap-threads, the owner: "Say so and stop"): after 3 rests in a row captions
 * stop. DRASHTI_TEST_SPEECH_HOLD=3 makes the stand-in's rest the third in a row (placeholder numbers). The switch shows
 * Off, the dialog says this computer is too slow for live captions with this model and, Gujarati chosen, points to its
 * IndicConformer model pack; the status bar says so too, with the dialog closed. On again, captions try again.
 */
test('after 3 rests in a row captions stop: the switch shows Off, and the dialog and the status bar say this computer is too slow, with the Gujarati pack named', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...NO_PLACEHOLDERS, ...SPEECH, DRASHTI_TEST_SPEECH_HOLD: '3' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await dialog.getByTestId('captions-language').selectOption('gu');
    await dialog.getByTestId('captions-on').click();

    // Stopped by itself: Off, with the reason and the Gujarati pack.
    const toggle = dialog.getByTestId('captions-on');
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
    const state = dialog.getByTestId('captions-state');
    await expect(state).toHaveText(/^Off: this computer is too slow for live captions with this model\./u);
    await expect(state).toContainText('the Gujarati IndicConformer model pack');
    await expect(state).toContainText('Turn captions on to try again.');
    await expectFits(dialog, 'the Live captions dialog, stopped as too slow');
    await expectNoSeriousA11yIssues(win, 'Live captions stopped as too slow');

    // The status bar says it too, with the dialog closed.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const line = win.getByTestId('captions-warning');
    await expect(line).toHaveText(
      'Captions stopped: this computer is too slow for live captions with this model.Live Captions…',
    );

    // On again: they try again (and the stand-in stops them again). Each change the dialog is told, from here on.
    await win.evaluate(() => {
      const g = globalThis as PageGlobals & { captionsOn?: boolean[] };
      g.captionsOn = [];
      g.drashti.captions.onChanged((view) => g.captionsOn?.push(view.on));
    });
    await line.getByRole('button', { name: 'Live Captions…' }).click();
    await toggle.click();
    await expect
      .poll(() => win.evaluate(() => (globalThis as { captionsOn?: boolean[] }).captionsOn ?? []), {
        timeout: 15_000,
      })
      .toContain(true);
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 15_000 });
    await expect(state).toContainText('Turn captions on to try again.');
  } finally {
    await app.close();
  }
});

/**
 * A model per language, the speaker's language and live timing (alpha.22, cap-whisper). The test switch
 * DRASHTI_TEST_SPEECH_MODELS lists one placeholder Gujarati "model" (generated bytes, never a real model) by its
 * size and SHA-256, as Drashti's own list will once the owner approves a file; the stand-in engine still hears.
 */
test('a known model comes with the model pack, chosen for Gujarati and checked; File › Speaker’s Language sets the language; the timing stays folded away until asked for', async () => {
  test.setTimeout(150_000);
  // A placeholder Gujarati model this copy knows (DRASHTI_TEST_SPEECH_MODELS), in an offline pack (cap-pack's).
  const pack = placeholderCaptionPack();
  const { app } = await launchApp({ ...NO_PLACEHOLDERS, ...SPEECH, DRASHTI_TEST_SPEECH_MODELS: pack.list });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('captions-on').click();
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');

    // Gujarati's row: the general model hears it until a model of its own is added.
    const gujarati = dialog.getByTestId('captions-language-model-gu');
    await expect(gujarati).toHaveAttribute('data-phase', 'general');
    await expect(dialog.getByTestId('captions-language-model-gu-state')).toHaveText(
      'The general model hears Gujarati.',
    );

    // A model of its own comes only with the offline model pack (the lead's Q-CAPI-2 A): the row offers the pack's
    // dialog, never a file of its own.
    await expect(dialog.getByTestId('captions-language-model-gu-add')).toHaveCount(0);
    await expect(dialog.getByTestId('captions-language-model-gu-packs')).toHaveText(
      'Caption and Translation Models…',
    );
    await expect(dialog.getByTestId('captions-language-model-gu-choice')).toContainText(
      '(not on this computer)',
    );
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await importCaptionPack(app, win, pack.folder);
    await chooseMenuItem(app, 'live-captions');
    await dialog.getByTestId('captions-language-model-gu-choice').selectOption('placeholder-gu');
    await expect(gujarati).toHaveAttribute('data-phase', 'ready');
    await expect(dialog.getByTestId('captions-language-model-gu-choice')).toHaveValue('placeholder-gu');

    // File › Speaker’s Language: Gujarati, ticked; the dialog and listening follow.
    await chooseMenuItem(app, 'speaker-language-gu');
    await expect(dialog.getByTestId('captions-language')).toHaveValue('gu');
    await expect(dialog.getByTestId('captions-state')).toHaveText('Listening to the stream’s sound input.');
    await expect
      .poll(() =>
        app.evaluate(
          ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('speaker-language-gu')?.checked ?? null,
        ),
      )
      .toBe(true);

    // Timing: folded away, the standard choices to begin with; a change is kept on this computer.
    await expect(dialog.getByTestId('captions-timing')).toHaveCount(0);
    await dialog.getByTestId('captions-timing-open').click();
    await expect(dialog.getByTestId('captions-timing-step')).toHaveValue('1500');
    await expect(dialog.getByTestId('captions-timing-threads')).toHaveValue('4');
    await dialog.getByTestId('captions-timing-step').selectOption('1000');
    await expect
      .poll(() =>
        win.evaluate(async () => (await (globalThis as PageGlobals).drashti.captions.view()).timing.stepMs),
      )
      .toBe(1_000);

    // Readable in CI's operator window and at 1280 × 720, and nothing serious for a screen reader.
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(dialog, `the Live captions dialog's models and timing at ${String(size.width)}`);
    }
    await expectNoSeriousA11yIssues(win, 'Live captions with models and timing');

    // As heard again: from the menu too.
    await chooseMenuItem(app, 'speaker-language-auto');
    await expect(dialog.getByTestId('captions-language')).toHaveValue('auto');
  } finally {
    await app.close();
  }
});

/**
 * "Captions in" (alpha.24, QA24-CAPLANG-2, the owner's 2a, 2c, 2e and 2f A): one choice for the whole show, under
 * Speaker's language in Pro Mode's Live captions dialog. How translated captions stand is a stand-in told to the
 * operator window as main tells it (captions:changed, test-side only: nothing in Drashti for it): whether this
 * computer can translate, the phrases skipped and the engine's fault are main's (a24-captrans, with specs of its own).
 * This test is the dialog's: its label and hints, the reasons, the Trial warning, the count and the fault, its fit in
 * CI's window and a screen reader's view, and the status bar. Nothing is translated or drawn on a screen here.
 */
test('"Captions in" under Speaker’s language: greyed out with the reason, the Trial warning once chosen, the phrases skipped and the fault; the status bar says when a chosen translation cannot be made', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp({ ...NO_PLACEHOLDERS });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await chooseMenuItem(app, 'live-captions');
    const dialog = win.getByTestId('captions-dialog');
    await expect(dialog).toBeVisible();

    // A select with its own visible label, under Speaker's language, the speaker's own words chosen.
    const target = dialog.getByLabel('Captions in', { exact: true });
    await expect(target).toHaveAttribute('data-testid', 'captions-target');
    await expect(target).toHaveValue('same');
    expect(
      await dialog.evaluate((d) => {
        const speaker = d.querySelector('[data-testid="captions-language"]');
        const captionsIn = d.querySelector('[data-testid="captions-target"]');
        return speaker && captionsIn
          ? (speaker.compareDocumentPosition(captionsIn) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          : false;
      }),
    ).toBe(true);

    const real: CaptionsStatus = await win.evaluate(() =>
      (globalThis as PageGlobals).drashti.captions.view(),
    );
    const translation = (over: Partial<CaptionTranslationStatus>): CaptionTranslationStatus => ({
      target: null,
      offered: true,
      unavailable: null,
      skipped: 0,
      fault: null,
      ...over,
    });
    const tell = (over: Partial<CaptionsStatus>) =>
      app.evaluate(
        ({ BrowserWindow }, { channel, payload }) => {
          BrowserWindow.getAllWindows()
            .find((w) => w.webContents.getURL().includes('index.html'))
            ?.webContents.send(channel, payload);
        },
        { channel: IPC.captions.changed, payload: { ...real, ...over } },
      );
    const gujarati = (captionLanguage: 'same' | 'hi') => ({
      ...real.settings,
      language: 'gu' as const,
      captionLanguage,
    });

    // This computer cannot translate (no pack): greyed out, and its description says why.
    await tell({
      settings: gujarati('same'),
      translation: translation({ offered: false, unavailable: 'no-pack' }),
    });
    await expect(target).toBeDisabled();
    await expect(target).toHaveAccessibleDescription(unavailableText('no-pack'));
    await tell({
      settings: { ...real.settings, language: 'auto', captionLanguage: 'same' },
      translation: translation({ offered: false, unavailable: 'speaker-as-heard' }),
    });
    await expect(target).toHaveAccessibleDescription(unavailableText('speaker-as-heard'));

    // It can: open, the speaker's own language greyed out.
    await tell({ settings: gujarati('same'), translation: translation({}) });
    await expect(target).toBeEnabled();
    await expect(target.locator('option[value="gu"]')).toBeDisabled();
    for (const other of ['same', 'hi', 'en'])
      await expect(target.locator(`option[value="${other}"]`)).toBeEnabled();

    // Hindi chosen and translating: the Trial warning, the phrases skipped (no live region) and the last fault.
    await tell({
      on: true,
      settings: gujarati('hi'),
      translation: translation({ target: 'hi', skipped: 2, fault: 'Placeholder fault words.' }),
    });
    await expect(target).toHaveValue('hi');
    await expect(dialog.getByTestId('captions-target-trial')).toHaveText(TRANSLATION_TRIAL_WARNING);
    await expect(dialog.getByTestId('captions-target-skipped')).toHaveText(skippedText(2));
    await expect(dialog.getByTestId('captions-target-skipped')).not.toHaveAttribute('aria-live', /./u);
    await expect(dialog.getByTestId('captions-target-fault')).toHaveText(
      'Last problem translating captions: Placeholder fault words.',
    );
    // A target of at least 24 × 24 (WCAG 2.5.8).
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
    for (const size of [
      { width: 1024, height: 645 },
      { width: 1280, height: 720 },
    ]) {
      await win.setViewportSize(size);
      await expectFits(
        dialog,
        `the Live captions dialog translating at ${String(size.width)} × ${String(size.height)}`,
      );
    }
    await expectNoSeriousA11yIssues(win, 'Live captions translated into Hindi');

    // Chosen, but the pack has gone: the reason, and that the audience screens and the stream show no captions;
    // the speaker's own words can still be chosen again.
    await tell({
      on: true,
      settings: gujarati('hi'),
      translation: translation({ offered: false, unavailable: 'no-pack' }),
    });
    const unavailable = dialog.getByTestId('captions-target-unavailable');
    await expect(unavailable).toContainText(unavailableText('no-pack'));
    await expect(unavailable).toContainText('the audience screens and the stream show no captions');
    await expect(target).toBeEnabled();
    await expect(target.locator('option[value="same"]')).toBeEnabled();
    await win.setViewportSize({ width: 1024, height: 645 });
    await expectFits(dialog, 'the Live captions dialog, the translation pack gone, at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'Live captions, the translation pack gone');

    // The status bar says so, with the dialog closed.
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const line = win.getByTestId('captions-warning');
    await expect(line).toHaveText(
      'Translated captions are off: the translation model pack is not on this computer.Live Captions…',
    );
    await expectFits(
      win.getByRole('contentinfo', { name: 'Status' }),
      'the status bar, translated captions off',
    );

    // The engine stopped: the reason, its fault, and Try again (choosing Hindi again: main tries once more, df4a47045).
    await chooseMenuItem(app, 'live-captions');
    await expect(dialog).toBeVisible();
    await tell({
      on: true,
      settings: gujarati('hi'),
      translation: translation({
        offered: false,
        unavailable: 'engine-fault',
        fault: 'Placeholder fault words.',
      }),
    });
    await expect(unavailable).toContainText(unavailableText('engine-fault'));
    await expect(dialog.getByTestId('captions-target-fault')).toHaveText(
      'Last problem translating captions: Placeholder fault words.',
    );
    await expect(target.locator('option[value="hi"]')).toBeEnabled();
    const retry = dialog.getByTestId('captions-target-retry');
    await expect(retry).toHaveText('Try again');
    const retryBox = await retry.boundingBox();
    expect(retryBox?.height ?? 0).toBeGreaterThanOrEqual(24);
    await expectFits(dialog, 'the Live captions dialog, the translation engine stopped, at 1024 × 645');
    await expectNoSeriousA11yIssues(win, 'Live captions, the translation engine stopped');
    await retry.click();
    // Saved again through captions:set-settings: the library keeps Hindi for a Gujarati speaker.
    await expect
      .poll(() =>
        win.evaluate(async () => {
          const s = (await (globalThis as PageGlobals).drashti.captions.view()).settings;
          return `${s.language}>${s.captionLanguage ?? ''}`;
        }),
      )
      .toBe('gu>hi');
  } finally {
    await app.close();
  }
});
