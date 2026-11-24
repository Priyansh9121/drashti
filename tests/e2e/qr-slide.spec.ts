import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { decodeQR } from 'qr/decode.js';
import { readPng } from '../../src/main/library/qr-raster';
import { PLACEHOLDER_LOGO_MIDDLE, placeholderLogoPng } from '../../src/main/library/testing/qr-logo';
import { SIMPLE_MODE_REFUSAL } from '../../src/shared/mode';
import { QR_DOWNLOAD_PIXELS, QR_SLIDE_PIXELS } from '../../src/shared/qr-picture';
import { expectNoSeriousA11yIssues } from './a11y';
import type { PageGlobals } from './helpers';
import { closeLibrary, launchApp, openSection, operatorPage, operatorReady } from './helpers';
import { CI_WINDOW, sizeOperatorWindow } from './window-size';

/*
 * The QR-code slide (Session 55, Part 8, the owner's idea G): QR code… (in its own section under LIVE since alpha.22, More tools from alpha.20, and the Tools menu;
 * beside New… in the library before): a link or words pasted,
 * and a slide with a large code and the words under it, made offline (the code a picture in the library). It is
 * chosen in the library, and one click on its row puts it up. Pro Mode's: Simple Mode refuses making one. At CI's
 * 1024 × 645 and at 1280 × 720. Placeholder links only.
 *
 * Since alpha.20 (Q60-28, the owner's words of 20 Nov 2026: "we also want to use a download QR code option here. the
 * QR code generated should consist of akshar deri logo, no text just logo, which can be used as well."): Download…
 * saves the code as a PNG of about 2048 pixels and an SVG where the person chooses (the system's save dialog), only
 * the code and the logo, no words; Logo in the middle: Choose a Picture… keeps a picture for the middle of the code
 * (his "Yes, A": the real logo comes only through the private opening pack or the setup kit; these tests use a
 * generated placeholder logo, never the mandir's) and remembers it; every code is read back by a QR reader first.
 */

const LINK = 'https://example.org/placeholder-sabha';

const state = (win: Page) =>
  win.evaluate(async () => (await (globalThis as PageGlobals).drashti.engine.snapshot()).state);

/** The dialog whole in the window, nothing scrolling sideways, every button's words inside it. */
async function expectFits(win: Page, what: string): Promise<void> {
  const problems = await win.evaluate(() => {
    const out: string[] = [];
    const panel = document.querySelector('[data-testid="qr-dialog"]');
    if (!panel) return ['no dialog'];
    const r = panel.getBoundingClientRect();
    if (
      r.left < -0.5 ||
      r.top < -0.5 ||
      r.right > window.innerWidth + 0.5 ||
      r.bottom > window.innerHeight + 0.5
    )
      out.push(`the dialog (${String(Math.round(r.width))} × ${String(Math.round(r.height))}) is cut off`);
    if (document.documentElement.scrollWidth > window.innerWidth) out.push('the page scrolls sideways');
    for (const b of panel.querySelectorAll('button'))
      if (b.scrollWidth > b.clientWidth + 1) out.push(`${b.textContent.trim()}: its words do not fit`);
    const code = panel.querySelector('[data-testid="qr-code"]')?.getBoundingClientRect();
    if (!code || code.width < 120) out.push('the code is not shown large enough');
    return out;
  });
  expect(problems, what).toEqual([]);
}

test('the QR code section › QR code…: a link pasted becomes one slide with a large code and the words under it, chosen in the library and up with one click, at 1024 × 645 and 1280 × 720', async () => {
  test.setTimeout(150_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);

  // In its own section under LIVE since alpha.22 (More tools from alpha.20, Session 60, x36).
  await openSection(win, 'qr-code');
  await win.getByTestId('qr-code-open').click();
  const dialog = win.getByTestId('qr-dialog');
  await expect(dialog).toBeVisible();
  // Nothing to make yet.
  await expect(dialog.getByRole('button', { name: 'Make the slide' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill(LINK);
  // The code and the words under it, as the slide will have them.
  await expect(dialog.getByTestId('qr-code')).toBeVisible();
  await expect(dialog.getByTestId('qr-words')).toHaveText(LINK);
  await expectFits(win, 'the QR code dialog at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'the QR code dialog', '[data-testid="qr-dialog"]');
  await dialog.getByRole('button', { name: 'Make the slide' }).click();
  await expect(dialog).toHaveCount(0);

  // In the library: one slide, the code (a PNG picture in the library) large in the middle, the words under it.
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const found = (await d.library.listPresentations()).find((p) => p.name.startsWith('QR code: '));
    if (!found) return null;
    const doc = await d.library.getPresentation(found.id);
    const slides = doc?.groups.flatMap((g) => g.slides) ?? [];
    const elements = slides[0]?.slide.elements ?? [];
    const picture = elements.find((e) => e.kind === 'image');
    const words = elements.find((e) => e.kind === 'text');
    const media = await d.library.listMedia();
    return {
      id: found.id,
      name: found.name,
      slides: slides.length,
      pictureName:
        picture?.kind === 'image' ? (media.find((m) => m.id === picture.mediaId)?.kind ?? null) : null,
      pictureSquare: picture ? picture.frame.width === picture.frame.height : false,
      wordsBelow: picture && words ? words.frame.y >= picture.frame.y + picture.frame.height : false,
      words: words?.kind === 'text' ? words.text : null,
    };
  });
  expect(made).toMatchObject({
    name: `QR code: ${LINK}`,
    slides: 1,
    pictureName: 'image',
    pictureSquare: true,
    wordsBelow: true,
    words: LINK,
  });
  await closeLibrary(win);

  // Chosen in the library (no playlist open): its slide's row in the middle; one click puts it up.
  const middle = win.getByTestId('column-middle');
  await expect(middle.getByTestId('slide-thumb')).toHaveCount(1);
  await middle.getByTestId('slide-thumb').first().click();
  await expect.poll(async () => (await state(win)).live.presentationId).toBe(made?.id);

  // At 1280 × 720 the dialog fits too.
  await sizeOperatorWindow(app, win, { width: 1280, height: 720 });
  // In its own section under LIVE since alpha.22 (More tools from alpha.20, Session 60, x36).
  await openSection(win, 'qr-code');
  await win.getByTestId('qr-code-open').click();
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill('Placeholder words for a code');
  await expectFits(win, 'the QR code dialog at 1280 × 720');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await app.close();
});

test('Simple Mode refuses making a QR-code slide; words too long are turned down with why', async () => {
  test.setTimeout(90_000);
  const { app } = await launchApp();
  const win = await operatorPage(app);
  await operatorReady(win);
  const tooLong = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.newQrSlide('x'.repeat(2000)),
  );
  expect(tooLong.ok).toBe(false);
  if (!tooLong.ok) expect(tooLong.message).toContain('too long');
  await win.getByTestId('app-header').getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
  await expect(win.getByTestId('simple-mode')).toBeVisible();
  const refused = await win.evaluate(() =>
    (globalThis as PageGlobals).drashti.library.newQrSlide('https://example.org/placeholder'),
  );
  expect(refused.ok).toBe(false);
  // The QR code… window's logo and Download… too (Q60-28): nothing kept, nothing saved, no dialog asked.
  const others = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti.library;
    return [
      await d.downloadQr('https://example.org/placeholder', { logo: false }),
      await d.pickQrLogo(),
      await d.keepQrLogo('Placeholder logo.png', new Uint8Array([137, 80, 78, 71])),
      await d.setQrChoices({ useLogo: true }),
    ];
  });
  for (const answer of others) expect(answer).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
  const names = await win.evaluate(async () =>
    (await (globalThis as PageGlobals).drashti.library.listPresentations()).map((p) => p.name),
  );
  expect(names.filter((n) => n.startsWith('QR code: '))).toEqual([]);
  await app.close();
});

/** What a QR reader reads from a PNG file (qr 0.7.2, as a phone's camera would read a perfect print of it). */
function readBack(file: string): {
  text: string | null;
  width: number;
  height: number;
  middle: number[];
  corner: number[];
} {
  const img = readPng(readFileSync(file));
  if (!img) return { text: null, width: 0, height: 0, middle: [], corner: [] };
  const pixel = (x: number, y: number) => [
    ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
  ];
  const text = ((): string | null => {
    try {
      return decodeQR({ width: img.width, height: img.height, data: img.data }, { format: 'RGBA' });
    } catch {
      return null;
    }
  })();
  return {
    text,
    width: img.width,
    height: img.height,
    middle: pixel(img.width >> 1, img.height >> 1),
    corner: pixel(2, 2),
  };
}

/** The system's open dialog answers with `logo`, its save dialog with `target` (or Cancel when null); both counted. */
async function answerDialogs(app: ElectronApplication, logo: string, target: string | null): Promise<void> {
  await app.evaluate(
    ({ dialog }, [picture, file]) => {
      const g = globalThis as { drashtiQrAsked?: { open: number; offered: string[] } };
      g.drashtiQrAsked = { open: 0, offered: [] };
      dialog.showOpenDialog = () => {
        if (g.drashtiQrAsked) g.drashtiQrAsked.open += 1;
        return Promise.resolve({ canceled: false, filePaths: [picture] });
      };
      dialog.showSaveDialog = (...args: unknown[]) => {
        const options = args.find(
          (a): a is { defaultPath?: string } => typeof a === 'object' && a !== null && 'defaultPath' in a,
        );
        g.drashtiQrAsked?.offered.push(options?.defaultPath ?? '');
        return Promise.resolve(file ? { canceled: false, filePath: file } : { canceled: true, filePath: '' });
      };
    },
    [logo, target] as const,
  );
}

const asked = (app: ElectronApplication) =>
  app.evaluate(
    () => (globalThis as { drashtiQrAsked?: { open: number; offered: string[] } }).drashtiQrAsked ?? null,
  );

test('QR code…: Logo in the middle: Choose a Picture… keeps a picture and remembers it; Download… saves the code with it as a PNG of about 2048 pixels and an SVG, where you choose and nowhere else, only the code and the logo, read back; the slide can have it too, its words optional', async () => {
  test.setTimeout(240_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-qr-'));
  // A generated placeholder logo, never the mandir's.
  const logoFile = join(folder, 'Placeholder logo.png');
  writeFileSync(logoFile, placeholderLogoPng());
  const downloads = join(folder, 'Downloads');
  const chosen = join(folder, 'Chosen folder');
  mkdirSync(downloads);
  mkdirSync(chosen);
  const { app, userData } = await launchApp({ DRASHTI_TEST_DOWNLOADS_DIR: downloads });
  await answerDialogs(app, logoFile, join(chosen, 'Placeholder code.png'));
  const win = await operatorPage(app);
  await operatorReady(win);
  await sizeOperatorWindow(app, win, CI_WINDOW);
  await openSection(win, 'qr-code');
  await win.getByTestId('qr-code-open').click();
  const dialog = win.getByTestId('qr-dialog');
  await expect(dialog).toBeVisible();
  const logoSwitch = dialog.getByRole('switch', { name: 'Logo in the middle' });
  // No logo chosen yet: the code alone.
  await expect(logoSwitch).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill(LINK);
  await expect(dialog.getByTestId('qr-code')).toHaveAttribute('data-logo', 'false');

  // Logo in the middle: Choose a Picture…, the system's open dialog (answered with the placeholder): kept, and on.
  await dialog.getByRole('button', { name: 'Choose a Picture…' }).click();
  await expect(dialog.getByTestId('qr-logo')).toContainText('Placeholder logo.png');
  await expect(logoSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByTestId('qr-code')).toHaveAttribute('data-logo', 'true');
  expect((await asked(app))?.open).toBe(1);
  // Kept in Drashti's own media folder, so the pack's file can go.
  expect(readdirSync(join(userData, 'Media', 'qr')).filter((f) => f.endsWith('.png'))).toHaveLength(1);
  await expectFits(win, 'the QR code dialog with a logo at 1024 × 645');
  await expectNoSeriousA11yIssues(win, 'the QR code dialog with a logo', '[data-testid="qr-dialog"]');

  // Download…: the system's save dialog (offered in Downloads first), then the PNG and the SVG where it was told.
  await dialog.getByRole('button', { name: 'Download…' }).click();
  await expect(dialog.getByRole('status')).toHaveText(
    'Saved “Placeholder code.png” and “Placeholder code.svg”.',
    {
      timeout: 60_000,
    },
  );
  expect((await asked(app))?.offered).toEqual([join(downloads, 'QR code.png')]);
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder code.png', 'Placeholder code.svg']);
  // Nowhere else: Downloads stays empty.
  expect(readdirSync(downloads)).toEqual([]);
  const png = readBack(join(chosen, 'Placeholder code.png'));
  expect(png.text).toBe(LINK);
  expect(png.width).toBe(png.height);
  expect(png.width).toBeGreaterThan(QR_DOWNLOAD_PIXELS * 0.9);
  expect(png.width).toBeLessThanOrEqual(QR_DOWNLOAD_PIXELS);
  // Only the code and the logo: the quiet border white, the logo's middle in its own colours.
  expect(png.corner).toEqual([255, 255, 255]);
  png.middle.forEach((c, i) => {
    expect(Math.abs(c - (PLACEHOLDER_LOGO_MIDDLE[i] ?? 0))).toBeLessThanOrEqual(3);
  });
  const svg = readFileSync(join(chosen, 'Placeholder code.svg'), 'utf8');
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg).toContain('<image ');
  expect(svg).toContain('href="data:image/png;base64,');
  expect(svg).not.toMatch(/<text|<title|<desc|<foreignObject/u);

  // Cancelled in the save dialog: nothing is written anywhere, and nothing is said but that.
  await answerDialogs(app, logoFile, null);
  await dialog.getByRole('button', { name: 'Download…' }).click();
  await expect.poll(async () => (await asked(app))?.offered.length).toBe(1);
  expect(readdirSync(chosen).sort()).toEqual(['Placeholder code.png', 'Placeholder code.svg']);
  expect(readdirSync(downloads)).toEqual([]);

  // The slide with the logo code, and without its words: one picture, no words; its picture reads back too.
  const words = dialog.getByRole('checkbox', { name: 'Words under the code' });
  await expect(words).toBeChecked();
  await words.click();
  await expect(words).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Make the slide' }).click();
  await expect(dialog).toHaveCount(0);
  const made = await win.evaluate(async () => {
    const d = (globalThis as PageGlobals).drashti;
    const found = (await d.library.listPresentations()).find((p) => p.name.startsWith('QR code: '));
    if (!found) return null;
    const doc = await d.library.getPresentation(found.id);
    const elements = doc?.groups.flatMap((g) => g.slides)[0]?.slide.elements ?? [];
    const picture = elements.find((e) => e.kind === 'image');
    return {
      kinds: elements.map((e) => e.kind),
      mediaId: picture?.kind === 'image' ? picture.mediaId : null,
    };
  });
  expect(made?.kinds).toEqual(['image']);
  const db = new Database(join(userData, 'drashti.sqlite'), { readonly: true });
  const row = db.prepare('SELECT path FROM media WHERE id = ?').get(made?.mediaId ?? '') as
    { path: string } | undefined;
  db.close();
  const slidePicture = readBack(join(userData, 'Media', row?.path ?? 'none'));
  expect(slidePicture.text).toBe(LINK);
  expect(slidePicture.width).toBeLessThanOrEqual(QR_SLIDE_PIXELS);
  png.middle.forEach((c, i) => {
    expect(Math.abs((slidePicture.middle[i] ?? -1) - c)).toBeLessThanOrEqual(3);
  });
  await closeLibrary(win);

  // Remembered: the dialog opened again has the logo, on, and the words left off.
  await openSection(win, 'qr-code');
  await win.getByTestId('qr-code-open').click();
  await expect(dialog.getByTestId('qr-logo')).toContainText('Placeholder logo.png');
  await expect(dialog.getByRole('switch', { name: 'Logo in the middle' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(dialog.getByRole('checkbox', { name: 'Words under the code' })).not.toBeChecked();
  // Off: the code alone, its preview without the logo; remembered too.
  await dialog.getByRole('switch', { name: 'Logo in the middle' }).click();
  await dialog.getByRole('textbox', { name: 'Link or words' }).fill(LINK);
  await expect(dialog.getByTestId('qr-code')).toHaveAttribute('data-logo', 'false');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await app.close();

  // And after a restart on the same library: the logo is still kept, off as it was left.
  const again = await launchApp({ DRASHTI_TEST_DOWNLOADS_DIR: downloads }, userData);
  const win2 = await operatorPage(again.app);
  await operatorReady(win2);
  await openSection(win2, 'qr-code');
  await win2.getByTestId('qr-code-open').click();
  const dialog2 = win2.getByTestId('qr-dialog');
  await expect(dialog2.getByTestId('qr-logo')).toContainText('Placeholder logo.png');
  await expect(dialog2.getByRole('switch', { name: 'Logo in the middle' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await again.app.close();
});

test('Choose a Picture…: a file that is not a PNG or JPEG picture is turned down with why, and nothing is kept', async () => {
  test.setTimeout(120_000);
  const folder = mkdtempSync(join(tmpdir(), 'drashti-qr-'));
  const notPicture = join(folder, 'Placeholder notes.png');
  writeFileSync(notPicture, 'placeholder words, not a picture');
  const { app, userData } = await launchApp();
  await answerDialogs(app, notPicture, join(folder, 'Never.png'));
  const win = await operatorPage(app);
  await operatorReady(win);
  await openSection(win, 'qr-code');
  await win.getByTestId('qr-code-open').click();
  const dialog = win.getByTestId('qr-dialog');
  await dialog.getByRole('button', { name: 'Choose a Picture…' }).click();
  await expect(dialog.getByRole('alert')).toContainText('is not a PNG or JPEG picture');
  await expect(dialog.getByRole('switch', { name: 'Logo in the middle' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  const kept = join(userData, 'Media', 'qr');
  expect(readdirSync(join(userData, 'Media')).includes('qr') ? readdirSync(kept) : []).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await app.close();
});
