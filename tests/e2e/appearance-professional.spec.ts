import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { BLACK, WHITE, BUILT_IN, builtIn } from '../../src/shared/appearance/appearances';
import { settled } from './a11y';
import {
  chooseMenuItem,
  closeLibrary,
  openLibrary,
  launchApp,
  operatorPage,
  operatorReady,
  OWN_APPEARANCE,
  relaunchApp,
} from './helpers';
import type { PageGlobals } from './helpers';
import { PLAYLIST, setUpPlaceholderShow } from './placeholder-show';

const DESKS = [
  ['broadcast', 'Broadcast'],
  ['stage-desk', 'Stage desk'],
  ['daylight', 'Daylight'],
  ['signal', 'Signal'],
] as const;

const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => String(parseInt(hex.slice(at, at + 2), 16))).join(', ')})`;

/** Compare with an existing named appearance: the same flat layout and six-pixel band. */
async function controls(win: Page) {
  await settled(win);
  return win.locator('[data-show-control]:visible').evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-testid'),
        words: el.textContent,
        box: [box.x, box.y, box.width, box.height],
        font: getComputedStyle(el).fontFamily,
      };
    }),
  );
}

const forced = (win: Page) =>
  win.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    return {
      words: getComputedStyle(document.body).color,
      ground: getComputedStyle(document.body).backgroundColor,
      header: header ? getComputedStyle(header).backgroundColor : null,
    };
  });

for (const [id, name] of DESKS) {
  test(`${name}: its own preview, selected by keyboard, flat controls in place, system colours and restart`, async () => {
    const a = builtIn(id);
    if (!a) throw new Error(`Missing professional appearance: ${id}`);
    const { app, userData } = await launchApp(OWN_APPEARANCE);
    const win = await operatorPage(app);
    await win.setViewportSize({ width: 1024, height: 645 });
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await operatorReady(win);
    await setUpPlaceholderShow(win);
    await win.getByTestId('playlist-node').filter({ hasText: PLAYLIST }).click();
    await chooseMenuItem(app, 'appearance-dhaja');
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
    const before = await controls(win);
    expect(before.length).toBeGreaterThan(0);

    await chooseMenuItem(app, 'appearance-window');
    const dialog = win.getByTestId('appearance-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Find an appearance' }).fill('Show tools');
    await expect(dialog.getByTestId('appearance-choice')).toHaveCount(4);
    const choice = dialog.locator(`[data-choice="${id}"]`);
    await expect(choice).toContainText(name);
    const preview = choice.getByTestId('appearance-preview');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('aria-hidden', 'true');
    await expect(preview.locator(':scope > div').first()).toHaveCSS(
      'background-color',
      rgb(a.decoration.header),
    );
    await expect(preview.getByText('Next', { exact: true })).toHaveCSS(
      'background-color',
      rgb(a.colours.primary),
    );
    await choice.focus();
    await win.keyboard.press('Space');
    await expect(choice).toHaveAttribute('aria-checked', 'true');
    await expect(win.locator('html')).toHaveAttribute('data-appearance', id);
    await expect(dialog.getByTestId('appearance-moving-words')).toContainText(`${name} is still.`);
    await win.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await controls(win)).toEqual(before);
    await expect(win.locator('html')).toHaveAttribute('data-window-look', 'flat');
    await expect(win.locator('html')).toHaveAttribute('data-look-motion', '');
    await expect(win.locator('[data-touch-layer]')).toHaveCount(0);

    // Compare each base with the existing system-colour drawing, including the hidden decoration.
    await win.emulateMedia({ forcedColors: 'active' });
    await chooseMenuItem(app, a.base === 'dark' ? 'appearance-black' : 'appearance-white');
    await expect(win.locator('html')).toHaveAttribute(
      'data-appearance',
      a.base === 'dark' ? 'black' : 'white',
    );
    const system = await forced(win);
    await chooseMenuItem(app, `appearance-${id}`);
    await expect(win.locator('[data-band]')).toBeHidden();
    await expect.poll(() => forced(win)).toEqual(system);
    await win.emulateMedia({ forcedColors: 'none' });
    await app.close();

    const again = await relaunchApp(userData, OWN_APPEARANCE);
    const next = await operatorPage(again.app);
    await operatorReady(next);
    await expect(next.locator('html')).toHaveAttribute('data-appearance', id);
    await expect(next.locator('html')).toHaveAttribute('data-window-look', 'flat');
    await again.app.close();
  });
}

/** Read browser colours, including Tailwind's translucent color(srgb ...) values. */
function channels(colour: string): [number, number, number, number] {
  const s = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/u.exec(colour);
  if (s)
    return [
      Number(s[1]) * 255,
      Number(s[2]) * 255,
      Number(s[3]) * 255,
      s[4] === undefined ? 1 : Number(s[4]),
    ];
  const r = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/u.exec(colour);
  if (!r) throw new Error(`Cannot read computed colour: ${colour}`);
  return [Number(r[1]), Number(r[2]), Number(r[3]), r[4] === undefined ? 1 : Number(r[4])];
}

function composite(colour: string, under: readonly number[]): number[] {
  const [r, g, b, alpha] = channels(colour);
  return [r, g, b].map((v, i) => v * alpha + (under[i] ?? 0) * (1 - alpha));
}

function computedRatio(a: readonly number[], b: readonly number[]): number {
  const light = (rgb: readonly number[]) =>
    rgb.reduce((sum, channel, i) => {
      const s = channel / 255;
      return (
        sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * ([0.2126, 0.7152, 0.0722][i] ?? 0)
      );
    }, 0);
  const [hi = 0, lo = 0] = [light(a), light(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Include every ancestor background: idle rows are transparent; hovering and selection supply their own fill. */
async function paints(target: Locator) {
  const drawn = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    const backgrounds: string[] = [];
    for (let up = el.parentElement; up; up = up.parentElement)
      backgrounds.unshift(getComputedStyle(up).backgroundColor);
    return {
      backgrounds,
      fill: s.backgroundColor,
      words: s.color,
      edge: s.borderTopColor,
      width: s.borderTopWidth,
      style: s.borderTopStyle,
    };
  });
  const ground = drawn.backgrounds.reduce((under, top) => composite(top, under), [0, 0, 0]);
  const fill = composite(drawn.fill, ground);
  return { ...drawn, ground, fill, edge: composite(drawn.edge, fill), words: composite(drawn.words, fill) };
}

async function markedWords(win: Page, hit: Locator, where: string): Promise<void> {
  await settled(win);
  const marks = hit.locator('mark');
  await expect(marks, where).toHaveCount(1);
  const p = await paints(marks);
  expect(computedRatio(p.words, p.fill), `${where}: ${JSON.stringify(p)}`).toBeGreaterThanOrEqual(4.5);
}

async function litCovers(win: Page, simple: boolean, live: string, where: string): Promise<void> {
  for (const id of simple
    ? ['simple-blackout', 'simple-wallpaper']
    : ['blackout-button', 'wallpaper-button']) {
    const cover = win.getByTestId(id);
    await expect(cover).toHaveAttribute('data-dimmed', 'true');
    const before = await cover.boundingBox();
    await cover.click();
    await expect(cover).toHaveAttribute('data-lit', 'true');
    await expect(cover).toHaveCSS('background-color', rgb(live));
    await expect(cover).toHaveCSS('color', 'rgb(255, 255, 255)');
    const p = await paints(cover);
    expect(p.width, `${where}: ${id} border width`).toBe('1px');
    expect(p.style, `${where}: ${id} border style`).toBe('solid');
    expect(await cover.boundingBox(), `${where}: ${id} holds its box while lit`).toEqual(before);
    expect(
      computedRatio(p.edge, p.ground),
      `${where}: ${id} lit edge; fill/bar=${computedRatio(p.fill, p.ground)}; ${JSON.stringify(p)}`,
    ).toBeGreaterThanOrEqual(3);
    expect(computedRatio(p.words, p.fill), `${where}: ${id} lit words`).toBeGreaterThanOrEqual(4.5);
    await cover.click();
    await expect(cover).toHaveAttribute('data-dimmed', 'true');
  }
}

// The shared consumers must remain compatible with all 68 named appearances and both Follow bases.
const CONTRAST_LOOKS = [
  ...BUILT_IN.map((a) => ({ a, source: null })),
  ...(['dark', 'light'] as const).map((source) => ({ a: source === 'dark' ? BLACK : WHITE, source })),
];

for (const { a, source } of CONTRAST_LOOKS) {
  const name = source ? `Follow ${source}` : a.name;
  test(`${name}: search marks in all three row states and lit covers in Pro and Simple meet contrast`, async () => {
    const { app } = await launchApp(OWN_APPEARANCE);
    try {
      const win = await operatorPage(app);
      await win.setViewportSize({ width: 1024, height: 645 });
      await win.emulateMedia({ reducedMotion: 'reduce' });
      await operatorReady(win);
      await chooseMenuItem(app, `appearance-${source ? 'follow' : a.id}`);
      if (source)
        await app.evaluate(({ nativeTheme }, value) => {
          nativeTheme.themeSource = value;
        }, source);
      await expect(win.locator('html')).toHaveAttribute('data-appearance', a.id);
      await expect(win.locator('html')).toHaveAttribute('data-window-look', source ? 'depth' : 'flat');
      // Three genuine library results: a title, slide text and a kirtan detail, plus an unrelated selection.
      await win.evaluate(async () => {
        const d = (globalThis as PageGlobals).drashti;
        for (const [title, words] of [
          ['Contrastprobe title', 'Placeholder title words'],
          ['Placeholder text result', 'Contrastprobe line'],
          ['Placeholder detail result', 'Placeholder detail words'],
          ['Placeholder neutral selection', 'Placeholder neutral words'],
        ]) {
          const made = await d.library.newFromWords(title ?? '', words ?? '');
          if (!made.ok) throw new Error(made.message);
          if (title === 'Placeholder detail result') {
            const saved = await d.kirtans.setDetails(made.id, {
              category: 'Kirtan',
              kavi: 'Contrastprobe poet',
              raag: null,
              occasions: [],
              audioMediaId: null,
            });
            if (!saved.ok) throw new Error(saved.message);
          }
        }
      });
      await openLibrary(win);
      await win.getByTestId('presentation-row').filter({ hasText: 'Placeholder neutral selection' }).click();
      await win.getByTestId('library-search').fill('contrastprobe');
      const hits = win.getByTestId('search-hit');
      await expect(hits).toHaveCount(3);
      await expect(hits.getByTestId('search-line')).toHaveCount(1);
      await expect(hits.getByTestId('search-detail')).toHaveCount(1);
      for (const title of ['Contrastprobe title', 'Placeholder text result', 'Placeholder detail result']) {
        const hit = hits.filter({ hasText: title });
        await expect(hit).not.toHaveAttribute('aria-current', 'true');
        await win.mouse.move(0, 0);
        await expect.poll(() => hit.evaluate((el) => el.matches(':hover'))).toBe(false);
        await markedWords(win, hit, `${name}, ${title}, idle`);
        await hit.hover();
        await expect.poll(() => hit.evaluate((el) => el.matches(':hover'))).toBe(true);
        await markedWords(win, hit, `${name}, ${title}, hover`);
        await hit.click();
        await expect(hit).toHaveAttribute('aria-current', 'true');
        await win.mouse.move(0, 0);
        await markedWords(win, hit, `${name}, ${title}, selected`);
      }
      await closeLibrary(win);
      await litCovers(win, false, a.colours.live, `${name}, Pro Mode`);
      expect(
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('simple')),
      ).toMatchObject({ ok: true });
      await expect(win.getByTestId('simple-buttons')).toBeVisible();
      await litCovers(win, true, a.colours.live, `${name}, Simple Mode`);
    } finally {
      await app.close();
    }
  });
}
