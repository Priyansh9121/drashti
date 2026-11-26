import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import { smallestContent } from './fit-sweep';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  sizeSlideEditor,
  slideEditorWindow,
  type PageGlobals,
} from './helpers';
import { generatedPdf, PDF_PAGES } from './pdf-tools-fixtures';
import { CI_WINDOW } from './window-size';

/*
 * The slide editor in a small window (a22-ribbonfold; QA23-X95N-1, 1b and 1c, lead 2's A): at its least window with
 * 200% text the top and the ribbon took 241-279 of 260 CSS px and the slide list (176 px) and the Inspector (288 px)
 * more than the window's 442, so the slide was 96 x 54 (24 x 16 for a PDF) and below the window (run 45509623792).
 * In a short window the ribbon folds to its group tabs, a tab dropping its ribbon over the slide; in a narrow one the
 * Inspector folds behind a button, opening over the slide; each can be kept open. Nothing changes at 1024 x 645 or
 * larger at 100%. Placeholder presentations only.
 */

async function openEditor(
  mode: 'pro' | 'simple',
  format: 'native' | 'PDF',
  prepare?: (win: Page) => Promise<void>,
): Promise<{ app: ElectronApplication; ed: Page; editor: Locator }> {
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await prepare?.(win);
    const file = join(userData, `Placeholder small window.${format === 'PDF' ? 'pdf' : 'txt'}`);
    writeFileSync(
      file,
      format === 'PDF' ? generatedPdf(PDF_PAGES) : '[Verse]\nPlaceholder small window words\n',
    );
    const [id] = await importAndGetIds(win, [file]);
    if (!id) throw new Error('Placeholder presentation did not import');
    const opened = await win.evaluate(
      async ({ id, mode }) => {
        const d = (globalThis as PageGlobals).drashti;
        // Simple Mode edits the presentations of its playlist.
        const list = await d.playlists.create('Placeholder small window playlist', null, false);
        if (!list.ok || !list.ids[0]) throw new Error('No placeholder playlist');
        const added = await d.playlists.addItems(list.ids[0], null, [
          { kind: 'presentation', presentationId: id },
        ]);
        if (!added.ok) throw new Error(added.message);
        const changed = await d.app.setMode(mode);
        if (!changed.ok) throw new Error(changed.message);
        return d.slideEditor.open(id, null);
      },
      { id, mode },
    );
    expect(opened.ok).toBe(true);
    const { ed, editor } = await slideEditorWindow(app);
    return { app, ed, editor };
  } catch (error) {
    await app.close();
    throw error;
  }
}

/** The editor's text made `factor` times as large (as the system's text size does), landed. */
async function zoomEditor(app: ElectronApplication, ed: Page, factor: number): Promise<void> {
  const before = await ed.evaluate(() => innerWidth);
  await app.evaluate(({ webContents }, f) => {
    const page = webContents.getAllWebContents().find((w) => w.getURL().includes('slide-editor.html'));
    if (!page) throw new Error('No editor page');
    page.setZoomFactor(f);
  }, factor);
  await expect.poll(() => ed.evaluate(() => innerWidth)).toBeLessThan(before * 0.75);
  await settled(ed);
}

/** The slide's box (the editor's canvas) once the editor has laid it out for the window as it is now. */
async function steadyCanvas(ed: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const canvas = ed.getByTestId('editor-canvas');
  let last = '';
  await expect
    .poll(
      async () => {
        const box = await canvas.boundingBox();
        const now = JSON.stringify(box);
        const steady = box !== null && now === last;
        last = now;
        return steady;
      },
      { intervals: [250, 250, 500, 500, 1000] },
    )
    .toBe(true);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('No canvas');
  return box;
}

const pageSize = (ed: Page) =>
  ed.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollsDown: document.documentElement.scrollHeight > innerHeight + 1,
  }));

for (const mode of ['pro', 'simple'] as const)
  for (const format of ['native', 'PDF'] as const)
    test(`at its least window with 200% text, the ${format} slide in ${mode} mode stays inside the window, at least 100 px each way`, async () => {
      test.setTimeout(120_000);
      const { app, ed, editor } = await openEditor(mode, format);
      try {
        await sizeSlideEditor(app, ed, await smallestContent(app, 'slide-editor.html'));
        await zoomEditor(app, ed, 2);
        const page = await pageSize(ed);
        const box = await steadyCanvas(ed);
        const what = `${format}, ${mode}: the slide ${JSON.stringify(box)} in the page ${JSON.stringify(page)}`;
        expect(box.width, what).toBeGreaterThanOrEqual(100);
        expect(box.height, what).toBeGreaterThanOrEqual(100);
        expect(box.x, what).toBeGreaterThanOrEqual(0);
        expect(box.y, what).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, what).toBeLessThanOrEqual(page.width);
        expect(box.y + box.height, what).toBeLessThanOrEqual(page.height);
        expect(page.scrollsDown, what).toBe(false);

        // The ribbon, folded: its group tabs say so, and a tab drops its group's ribbon over the slide.
        const tabs = editor.getByRole('tablist', { name: 'The editor’s groups' }).getByRole('tab');
        const chosen = editor.getByRole('tab', { selected: true });
        await expect(chosen).toHaveAttribute('aria-expanded', 'false');
        const ribbon = editor.getByRole('tabpanel');
        await expect(ribbon).toBeHidden();
        await chosen.focus();
        await ed.keyboard.press('Enter');
        await expect(ribbon).toBeVisible();
        await expect(chosen).toHaveAttribute('aria-expanded', 'true');
        await expect(ribbon.getByRole('button', { name: 'Show the ribbon' })).toBeVisible();
        await expectNoSeriousA11yIssues(ed, `${format} editor, ${mode}: the dropped ribbon`);
        // Escape folds it again, back on its tab; the arrow keys drop the next group's.
        await ed.keyboard.press('Escape');
        await expect(ribbon).toBeHidden();
        await expect(chosen).toBeFocused();
        await ed.keyboard.press('ArrowRight');
        const next = editor.getByRole('tab', { selected: true });
        await expect(next).toBeFocused();
        await expect(next).toHaveAttribute('aria-expanded', 'true');
        await expect(ribbon).toBeVisible();
        expect(await tabs.count()).toBeGreaterThan(1);
        // A click outside it (the window's title, not covered by it) folds it.
        await editor.getByRole('heading', { level: 1 }).click();
        await expect(ribbon).toBeHidden();
        // Show the ribbon keeps it open, in its place, until Fold the ribbon.
        await next.click();
        await ribbon.getByRole('button', { name: 'Show the ribbon' }).click();
        await expect(ribbon).toBeVisible();
        await expect(next).not.toHaveAttribute('aria-expanded', /./u);
        await editor.getByRole('heading', { level: 1 }).click();
        await expect(ribbon).toBeVisible();
        await ed.getByRole('button', { name: 'Fold the ribbon' }).click();
        await expect(ribbon).toBeHidden();
        // The keyboard goes to what takes the button's place, not to the page (a22-review-ribbonfold R2-S1).
        await expect(editor.getByRole('tab', { selected: true })).toBeFocused();

        // The Inspector, folded behind its button: it opens over the slide and keeps the keyboard.
        const inspector = editor.getByRole('complementary', { name: 'Inspector' });
        const opener = editor.getByRole('button', { name: 'Inspector', exact: true });
        await expect(inspector).toBeHidden();
        await expect(opener).toHaveAttribute('aria-expanded', 'false');
        await opener.focus();
        await ed.keyboard.press('Enter');
        await expect(inspector).toBeVisible();
        await expect(opener).toHaveAttribute('aria-expanded', 'true');
        await expectNoSeriousA11yIssues(ed, `${format} editor, ${mode}: the Inspector over the slide`);
        await ed.keyboard.press('Escape');
        await expect(inspector).toBeHidden();
        await expect(opener).toBeFocused();
        // Keep it open: in its place beside the slide, until Fold the Inspector.
        await opener.click();
        await editor.getByRole('button', { name: 'Keep it open' }).click();
        await expect(inspector).toBeVisible();
        await expect(opener).toBeHidden();
        await expect(editor.getByRole('button', { name: 'Fold the Inspector' })).toBeFocused();
        await editor.getByRole('button', { name: 'Fold the Inspector' }).click();
        await expect(inspector).toBeHidden();
        await expect(opener).toBeVisible();
        await expect(opener).toBeFocused();
      } finally {
        await app.close();
      }
    });

// A PDF's "Source document limits" notes (QA23-X95N-1d, lead 2's A): in a short window they took the room under the
// top (190+ of 260 px at 200%, run 45516285077), so they fold behind a warning-coloured button over the slide's top
// left, opening over the slide; Escape folds them first, as it does the ribbon and the Inspector. Never dropped.
test('at its least window with 200% text, a PDF’s source notes fold behind a button over the slide, opening and closing there', async () => {
  test.setTimeout(120_000);
  const { app, ed, editor } = await openEditor('pro', 'PDF');
  try {
    await sizeSlideEditor(app, ed, await smallestContent(app, 'slide-editor.html'));
    await zoomEditor(app, ed, 2);
    const notes = editor.getByTestId('editor-source-issues');
    const button = editor.getByRole('button', { name: /^Source notes \([1-9][0-9]*\)$/u });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(notes).toBeHidden();
    // Over the slide's area, at its top left, inside the window.
    const area = await editor.getByTestId('editor-canvas-area').boundingBox();
    const place = await button.boundingBox();
    const page = await pageSize(ed);
    if (!area || !place) throw new Error('no slide area or button');
    expect(place.x).toBeGreaterThanOrEqual(area.x);
    expect(place.y).toBeGreaterThanOrEqual(area.y);
    expect(place.x + place.width).toBeLessThanOrEqual(area.x + area.width / 2 + place.width);
    expect(place.y + place.height).toBeLessThanOrEqual(page.height);
    // Enter opens the notes over the slide; Escape folds them first, the keyboard back on the button.
    await button.focus();
    await ed.keyboard.press('Enter');
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('Source document limits');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expectNoSeriousA11yIssues(ed, 'PDF editor: the source notes over the slide');
    await ed.keyboard.press('Escape');
    await expect(notes).toBeHidden();
    await expect(button).toBeFocused();
    await expect(editor.getByTestId('editor-canvas')).toBeVisible();
    // Their close button, and a press elsewhere in the editor, close them too.
    await button.click();
    await expect(notes).toBeVisible();
    await editor.getByRole('button', { name: 'Close the source notes' }).click();
    await expect(notes).toBeHidden();
    await button.click();
    await expect(notes).toBeVisible();
    await editor.getByRole('heading', { level: 1 }).click();
    await expect(notes).toBeHidden();
  } finally {
    await app.close();
  }
});

/** The last control in `box` the keyboard can reach, given the keyboard. */
const focusLast = (box: Locator) =>
  box.evaluate((root) => {
    const reachable = [
      ...root.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]'),
    ].filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.getClientRects().length > 0);
    const last = reachable.at(-1);
    if (!last) throw new Error('nothing to reach');
    last.focus();
  });

/** The control with the keyboard is not covered: at its middle the window shows it, not something over it. */
async function expectFocusUncovered(ed: Page, what: string): Promise<void> {
  const seen = await ed.evaluate(() => {
    const named = (el: Element | null) =>
      el
        ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 40)}"`
        : 'nothing';
    const at = document.activeElement;
    if (!(at instanceof HTMLElement) || at === document.body)
      return { ok: false, why: 'nothing has the keyboard' };
    const r = at.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      ok: hit !== null && (hit === at || at.contains(hit)),
      why: `${named(at)} at ${String(Math.round(x))}, ${String(Math.round(y))} is under ${named(hit)}`,
    };
  });
  expect(seen.ok, `${what}: ${seen.why}`).toBe(true);
}

// The keyboard never stops on a control covered by what is open over the slide (a22-review-ribbonfold M1, WCAG
// 2.4.11): leaving what is open folds it, and what is open never covers its own button.
test('at its least window with 200% text, Tab and Shift+Tab never stop on a control covered by what is open over the slide', async () => {
  test.setTimeout(120_000);
  const { app, ed, editor } = await openEditor('pro', 'PDF');
  try {
    await sizeSlideEditor(app, ed, await smallestContent(app, 'slide-editor.html'));
    await zoomEditor(app, ed, 2);
    await steadyCanvas(ed);
    // Tab past the dropped ribbon's last control: the slides under it.
    await editor.getByRole('tab', { selected: true }).click();
    const ribbon = editor.getByRole('tabpanel');
    await expect(ribbon).toBeVisible();
    await focusLast(ribbon);
    await ed.keyboard.press('Tab');
    await expectFocusUncovered(ed, 'Tab past the dropped ribbon');
    await expect(ribbon).toBeHidden();
    // Shift+Tab from the Inspector's Keep it open: its own button.
    const opener = editor.getByRole('button', { name: 'Inspector', exact: true });
    await opener.click();
    await editor.getByRole('button', { name: 'Keep it open' }).focus();
    await ed.keyboard.press('Shift+Tab');
    await expectFocusUncovered(ed, 'Shift+Tab from Keep it open');
    await ed.keyboard.press('Escape');
    await expect(editor.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
    // Tab out of the source notes: the Inspector's button below them.
    await editor.getByRole('button', { name: /^Source notes/u }).click();
    const notes = editor.getByTestId('editor-source-issues');
    await expect(notes).toBeVisible();
    await editor.getByRole('button', { name: 'Close the source notes' }).focus();
    await ed.keyboard.press('Tab');
    await expectFocusUncovered(ed, 'Tab out of the source notes');
  } finally {
    await app.close();
  }
});

// The dropped ribbon is reached by the keyboard alone (a22-review-ribbonfold R2-M1, WCAG 2.1.1): from the chosen tab,
// Tab goes through the rest of the top into the ribbon, which stays dropped, never covering what has the keyboard.
test('at its least window with 200% text, Tab from the chosen tab reaches the dropped ribbon, which stays dropped', async () => {
  test.setTimeout(120_000);
  const { app, ed, editor } = await openEditor('pro', 'native');
  try {
    await sizeSlideEditor(app, ed, await smallestContent(app, 'slide-editor.html'));
    await zoomEditor(app, ed, 2);
    await steadyCanvas(ed);
    const ribbon = editor.getByRole('tabpanel');
    await editor.getByRole('tab', { selected: true }).focus();
    await ed.keyboard.press('Enter');
    await expect(ribbon).toBeVisible();
    let inside = false;
    for (let n = 1; n <= 12 && !inside; n += 1) {
      await ed.keyboard.press('Tab');
      await expect(ribbon, `after Tab ${String(n)}`).toBeVisible();
      await expectFocusUncovered(ed, `Tab ${String(n)} from the chosen tab`);
      inside = await ribbon.evaluate((panel) => panel.contains(document.activeElement));
    }
    expect(inside, 'the keyboard reached the dropped ribbon by Tab').toBe(true);
    // Shift+Tab from its first control, Show the ribbon, goes back into the top, the ribbon still dropped.
    await ribbon.getByRole('button', { name: 'Show the ribbon' }).focus();
    await ed.keyboard.press('Shift+Tab');
    await expect(ribbon).toBeVisible();
    expect(await editor.locator('header').evaluate((top) => top.contains(document.activeElement))).toBe(true);
    await expectFocusUncovered(ed, 'Shift+Tab from Show the ribbon');
  } finally {
    await app.close();
  }
});

// A field the Inspector keeps only as it lets go of the keyboard (a timer's Length) keeps what was typed when a press
// elsewhere closes the Inspector over the slide (a22-review-ribbonfold S2), as it does beside the slide.
test('at its least window with 200% text, a timer length typed in the Inspector over the slide is kept at a press elsewhere', async () => {
  test.setTimeout(120_000);
  let timerId = '';
  let operator: Page | null = null;
  const { app, ed, editor } = await openEditor('pro', 'native', async (win) => {
    operator = win;
    timerId = await win.evaluate(async () => {
      const made = await (globalThis as PageGlobals).drashti.timers.create({
        name: 'Placeholder small countdown',
        kind: 'countdown',
        durationMs: 90_000,
        targetTime: null,
        allowsOverrun: false,
      });
      if (!made.ok) throw new Error(made.message);
      return made.id;
    });
  });
  try {
    await sizeSlideEditor(app, ed, await smallestContent(app, 'slide-editor.html'));
    await zoomEditor(app, ed, 2);
    // A Timer from the dropped Insert ribbon, then the ribbon folded.
    await editor.getByTestId('editor-tab-insert').click();
    await editor.getByTestId('add-timer').click();
    await ed.getByRole('menuitem', { name: 'Placeholder small countdown (Countdown)' }).click();
    await ed.keyboard.press('Escape');
    await expect(editor.getByRole('tabpanel')).toBeHidden();
    // Its Length typed in the Inspector over the slide, then a press elsewhere.
    await editor.getByRole('button', { name: 'Inspector', exact: true }).click();
    const length = editor.getByTestId('inspector-timer').getByTestId('field-timer-length');
    await length.fill('0:04');
    await editor.getByRole('heading', { level: 1 }).click();
    await expect(editor.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
    const win = operator as Page | null;
    if (!win) throw new Error('no operator window');
    const kept = () =>
      win.evaluate(
        async (id) =>
          (await (globalThis as PageGlobals).drashti.engine.snapshot()).state.timers.find((t) => t.id === id)
            ?.durationMs,
        timerId,
      );
    await expect.poll(kept).toBe(4000);
    // And at Escape, which folds the Inspector first (a22-review-ribbonfold round 2's nit).
    await editor.getByRole('button', { name: 'Inspector', exact: true }).click();
    await length.fill('0:07');
    await ed.keyboard.press('Escape');
    await expect(editor.getByRole('complementary', { name: 'Inspector' })).toBeHidden();
    await expect(editor.getByRole('button', { name: 'Inspector', exact: true })).toBeFocused();
    await expect.poll(kept).toBe(7000);
  } finally {
    await app.close();
  }
});

// At 1024 x 645 and 100% a PDF's source notes are exactly as today: in their place above the slides, no button.
test('at 1024 x 645 and 100% a PDF’s source notes stay in their place above the slides, with no button', async () => {
  const { app, ed, editor } = await openEditor('pro', 'PDF');
  try {
    await sizeSlideEditor(app, ed, CI_WINDOW);
    await settled(ed);
    const notes = editor.getByTestId('editor-source-issues');
    await expect(notes).toBeVisible();
    await expect(editor.getByRole('button', { name: /^Source notes/u })).toHaveCount(0);
    const box = await notes.boundingBox();
    const slides = await editor.getByRole('main', { name: 'The slides' }).boundingBox();
    if (!box || !slides) throw new Error('no notes or slides');
    expect(box.y + box.height).toBeLessThanOrEqual(slides.y + 1);
  } finally {
    await app.close();
  }
});

// At CI's 1024 x 645 and at 100% the editor is as it was: the ribbon and the Inspector in their places, no folding.
test('at 1024 x 645 and 100% nothing folds: the ribbon and the Inspector in their places, as in the guides’ pictures', async () => {
  const { app, ed, editor } = await openEditor('pro', 'native');
  try {
    await sizeSlideEditor(app, ed, CI_WINDOW);
    await settled(ed);
    await expect(editor.getByRole('tabpanel')).toBeVisible();
    await expect(editor.getByRole('complementary', { name: 'Inspector' })).toBeVisible();
    await expect(editor.getByRole('tab', { selected: true })).not.toHaveAttribute('aria-expanded', /./u);
    for (const name of [
      'Show the ribbon',
      'Fold the ribbon',
      'Inspector',
      'Keep it open',
      'Fold the Inspector',
    ])
      await expect(editor.getByRole('button', { name, exact: true }), name).toHaveCount(0);
  } finally {
    await app.close();
  }
});
