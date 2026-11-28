import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11yIssues, settled } from './a11y';
import {
  chooseMenuItem,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  outputReady,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';
import { sizeOperatorWindow } from './window-size';

const WITH_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'enabled' };
const WITHOUT_CHIP = { DRASHTI_TEST_GPU_COMPOSITING: 'disabled_software' };
const SIZES = [
  { width: 1024, height: 645 },
  { width: 1280, height: 720 },
  { width: 1410, height: 900 },
];
interface FadeTrace {
  target: string;
  keys: string[];
  ms: number;
}
type Observed = typeof globalThis & {
  motionlooks: {
    lastShow: number;
    captures: number;
    questions: FadeTrace[];
    previews: FadeTrace[];
    running: Animation[];
  };
};

/** Observe actual live animations; hold only the question effect so a real pointer can land during it. */
async function observe(win: Page, hold = false): Promise<void> {
  await win.evaluate((hold) => {
    const state: Observed['motionlooks'] = {
      lastShow: performance.now(),
      captures: 0,
      questions: [],
      previews: [],
      running: [],
    };
    (globalThis as Observed).motionlooks = state;
    (globalThis as PageGlobals).drashti.engine.onMessage(() => {
      state.lastShow = performance.now();
    });
    Object.defineProperty(Document.prototype, 'startViewTransition', {
      configurable: true,
      value: () => {
        state.captures += 1;
        throw new Error('Document capture is forbidden');
      },
    });
    const animate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
      ?.value as Element['animate'];
    Element.prototype.animate = function (frames, options) {
      const animation = animate.call(this, frames, options);
      if (this.matches('[data-what-is-this]')) {
        const effect = animation.effect as KeyframeEffect;
        state.questions.push({
          target: this.textContent.trim(),
          keys: [...new Set(effect.getKeyframes().flatMap(Object.keys))],
          ms: Number(effect.getTiming().duration),
        });
        state.running.push(animation);
        if (hold) {
          animation.pause();
          animation.currentTime = 16;
        }
      }
      return animation;
    };
    document.addEventListener('animationstart', (event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.matches('[data-motion-preview-picture], [data-motion-preview-mark]')
      )
        return;
      for (const animation of target.getAnimations()) {
        const effect = animation.effect as KeyframeEffect;
        state.previews.push({
          target: target.closest('[data-motion-preview]')?.getAttribute('data-motion-preview') ?? '',
          keys: [...new Set(effect.getKeyframes().flatMap(Object.keys))],
          ms: Number(effect.getTiming().duration),
        });
      }
    });
  }, hold);
}

/** Follow actual engine messages rather than sleeping through a guessed quiet window. */
async function quiet(win: Page): Promise<void> {
  await expect
    .poll(() => win.evaluate(() => performance.now() - (globalThis as Observed).motionlooks.lastShow > 800))
    .toBe(true);
}

async function motion(win: Page, value: 'calm' | 'lively' | 'off'): Promise<void> {
  expect(
    await win.evaluate((m) => (globalThis as PageGlobals).drashti.appearance.setMotion(m), value),
  ).toEqual({ ok: true });
  await expect(win.locator('html')).toHaveAttribute('data-interface-motion', value);
}

async function ready(app: ElectronApplication, chip: 'yes' | 'no'): Promise<Page> {
  const win = await operatorPage(app);
  await operatorReady(win);
  await win.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await expect(win.locator('html')).toHaveAttribute('data-opened', '');
  await expect(win.locator('html')).toHaveAttribute('data-chip', chip);
  return win;
}

async function noCapture(win: Page): Promise<void> {
  expect(
    await win.evaluate(() => ({
      calls: (globalThis as Observed).motionlooks.captures,
      names: [...document.querySelectorAll<HTMLElement>('*')].filter((el) => el.style.viewTransitionName)
        .length,
      overlays: document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.includes('view-transition'))
        .length,
    })),
  ).toEqual({ calls: 0, names: 0, overlays: 0 });
}

const engine = (win: Page) => win.evaluate(() => (globalThis as PageGlobals).drashti.engine.snapshot());

for (const kind of ['calm', 'lively'] as const) {
  test(`${kind}: live Help questions fade in; a real Next press and Black-out key arrive once and cancel the effect`, async () => {
    const { app } = await launchApp(WITH_CHIP);
    try {
      const win = await ready(app, 'yes');
      await motion(win, kind);
      await observe(win, true);
      await setUpScreen(win);
      const output = await outputPage(app);
      await outputReady(output);
      await expect(output.locator('[data-warm-up]')).toHaveCount(0);
      const id = await makeSlides(
        win,
        'Placeholder motion safety',
        [{ words: 'Placeholder one' }, { words: 'Placeholder two' }, { words: 'Placeholder three' }],
        { kind: 'cut', durationMs: 0 },
      );
      await win.bringToFront();
      for (const size of SIZES) {
        await sizeOperatorWindow(app, win, size);
        await goLive(win, id, 0);
        await expect(output.getByTestId('scene')).toContainText('Placeholder one');
        await quiet(win);
        const help = win.getByTestId('help-toggle');
        await expect(help).toHaveAttribute('aria-pressed', 'false');
        const before = await win.getByTestId('show-next').boundingBox();
        await win.evaluate(() => {
          (globalThis as Observed).motionlooks.questions = [];
          (globalThis as Observed).motionlooks.running = [];
        });
        await help.click();
        await expect
          .poll(() => win.evaluate(() => (globalThis as Observed).motionlooks.questions.length))
          .toBeGreaterThan(0);
        const records = await win.evaluate(() => (globalThis as Observed).motionlooks.questions);
        for (const record of records) {
          expect(record.target).toBe('?');
          expect(record.ms).toBe(160);
          expect(
            record.keys.filter(
              (key) => !['opacity', 'offset', 'computedOffset', 'easing', 'composite'].includes(key),
            ),
          ).toEqual([]);
          expect(record.keys).toContain('opacity');
        }
        for (const frame of [0, 16, 32, 80, 159]) {
          await win.evaluate((time) => {
            for (const a of (globalThis as Observed).motionlooks.running) a.currentTime = time;
          }, frame);
          expect(await win.getByTestId('show-next').boundingBox()).toEqual(before);
          expect(
            await win.getByTestId('show-next').evaluate((el) => el.getAnimations({ subtree: true }).length),
          ).toBe(0);
        }
        const start = await engine(win);
        const box = await win.getByTestId('show-next').boundingBox();
        if (!box) throw new Error('Next has no pointer target');
        // Native pointer input while the effect is active, without locator animation waiting or synthetic clicks.
        await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(async () => (await engine(win)).state.live.slideIndex).toBe(1);
        expect((await engine(win)).rev).toBe(start.rev + 1);
        await expect(output.getByTestId('scene')).toContainText('Placeholder two');
        await expect
          .poll(() =>
            win.evaluate(() =>
              (globalThis as Observed).motionlooks.running.every((a) => a.playState === 'idle'),
            ),
          )
          .toBe(true);
        const beforeKey = await engine(win);
        await win.keyboard.press('b');
        await expect(output.getByTestId('blackout')).toHaveCount(1);
        expect((await engine(win)).rev).toBe(beforeKey.rev + 1);
        await win.keyboard.press('b');
        await expect(output.getByTestId('blackout')).toHaveCount(0);
        await help.click();
        await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
        await expect(win.locator('[data-leaving-host] [data-what-is-this]')).toHaveCount(0);
        await noCapture(win);
      }
    } finally {
      await app.close();
    }
  });
}

test('chip-enabled dark/light appearance changes keep header words at 4.5:1 in every sampled frame; modes change without capture', async () => {
  const { app } = await launchApp(WITH_CHIP);
  try {
    const win = await ready(app, 'yes');
    await motion(win, 'lively');
    await observe(win);
    for (const size of SIZES) {
      await sizeOperatorWindow(app, win, size);
      for (const look of ['black', 'white', 'black']) {
        // Start before the preload draws; do not wait for animations to finish before reading contrast.
        const samples = win.evaluate(
          (want) =>
            new Promise<{ ratio: number; opacity: number }[]>((resolve) => {
              const seen: { ratio: number; opacity: number }[] = [];
              const rgb = (text: string) => (text.match(/[\d.]+/gu) ?? []).slice(0, 3).map(Number);
              const luminance = (c: number[]) =>
                c
                  .map((v) => {
                    const x = v / 255;
                    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
                  })
                  .reduce((sum, v, i) => sum + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
              let frames = 0;
              const sample = () => {
                const header = document.querySelector('[data-header]');
                if (!header) throw new Error('No header');
                const bg = luminance(rgb(getComputedStyle(header).backgroundColor));
                for (const el of header.querySelectorAll<HTMLElement>("[data-variant='ghost']")) {
                  if (el.getBoundingClientRect().width === 0 || el.matches(':hover, :disabled')) continue;
                  const st = getComputedStyle(el);
                  const fg = luminance(rgb(st.color));
                  let opacity = 1;
                  for (let parent: Element | null = el; parent; parent = parent.parentElement)
                    opacity *= Number(getComputedStyle(parent).opacity);
                  seen.push({ ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), opacity });
                }
                if (document.documentElement.dataset['appearance'] === want) frames += 1;
                if (frames === 20) resolve(seen);
                else requestAnimationFrame(sample);
              };
              requestAnimationFrame(sample);
            }),
          look,
        );
        await chooseMenuItem(app, `appearance-${look}`);
        await expect(win.locator('html')).toHaveAttribute('data-appearance', look);
        const readings = await samples;
        expect(readings.length).toBeGreaterThan(0);
        for (const reading of readings) {
          expect(reading.ratio).toBeGreaterThanOrEqual(4.5);
          expect(reading.opacity).toBe(1);
        }
        await noCapture(win);
      }
      await win.getByRole('button', { name: 'Simple Mode', exact: true }).dblclick();
      await expect(win.getByTestId('simple-mode')).toBeVisible();
      await noCapture(win);
      await win.getByRole('button', { name: 'Pro Mode', exact: true }).dblclick();
      await expect(win.getByTestId('simple-mode')).toHaveCount(0);
      await noCapture(win);
    }
    expect(await win.evaluate(() => (globalThis as Observed).motionlooks.questions)).toEqual([]);
  } finally {
    await app.close();
  }
});

for (const hold of ['off', 'reduced', 'forced', 'chipless'] as const) {
  test(`${hold}: appearance, mode, Help and decorative previews start no retained fade in Pro and Simple`, async () => {
    const { app } = await launchApp(hold === 'chipless' ? WITHOUT_CHIP : WITH_CHIP);
    try {
      const win = await ready(app, hold === 'chipless' ? 'no' : 'yes');
      await motion(win, hold === 'off' ? 'off' : 'calm');
      await win.emulateMedia({
        reducedMotion: hold === 'reduced' ? 'reduce' : 'no-preference',
        forcedColors: hold === 'forced' ? 'active' : 'none',
      });
      await observe(win);
      for (const size of SIZES) {
        await sizeOperatorWindow(app, win, size);
        for (const mode of ['pro', 'simple'] as const) {
          expect(
            await win.evaluate((m) => (globalThis as PageGlobals).drashti.app.setMode(m), mode),
          ).toMatchObject({ ok: true });
          await expect(win.getByTestId('simple-mode')).toHaveCount(mode === 'simple' ? 1 : 0);
          const result = await win.evaluate(() =>
            (globalThis as PageGlobals).drashti.appearance.choose('white'),
          );
          expect(result.ok).toBe(mode === 'pro');
          await win.getByTestId('help-toggle').click();
          await win.getByTestId('help-toggle').click();
          await expect(win.locator('[data-what-is-this]')).toHaveCount(0);
          await noCapture(win);
        }
        await win.evaluate(() => (globalThis as PageGlobals).drashti.app.setMode('pro'));
        await expect(win.getByTestId('simple-mode')).toHaveCount(0);
      }
      await chooseMenuItem(app, 'appearance-window');
      await expect(win.getByTestId('appearance-dialog')).toBeVisible();
      await expect(win.locator('[data-motion-preview]')).toHaveCount(3);
      for (const preview of await win.locator('[data-motion-preview]').all()) {
        await expect(preview).toHaveAttribute('aria-hidden', 'true');
        const choice = win.locator(
          `[data-motion-choice="${await preview.getAttribute('data-motion-preview')}"]`,
        );
        await choice.hover();
        expect(await preview.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
      }
      expect(
        await win.evaluate(() => ({
          questions: (globalThis as Observed).motionlooks.questions,
          previews: (globalThis as Observed).motionlooks.previews,
        })),
      ).toEqual({ questions: [], previews: [] });
      if (hold === 'off') await expectNoSeriousA11yIssues(win, 'motion looks in Appearance');
    } finally {
      await app.close();
    }
  });
}

test('chip-enabled Appearance samples fade decoration unconditionally on hover, with words and geometry unchanged', async () => {
  const { app } = await launchApp(WITH_CHIP);
  try {
    const win = await ready(app, 'yes');
    await motion(win, 'calm');
    await observe(win);
    await chooseMenuItem(app, 'appearance-window');
    await expect(win.getByTestId('appearance-dialog')).toBeVisible();
    await settled(win);
    for (const motion of ['calm', 'lively'] as const) {
      const choice = win.locator(`[data-motion-choice="${motion}"]`);
      const preview = choice.locator('[data-motion-preview]');
      await choice.scrollIntoViewIfNeeded();
      await win.mouse.move(1, 1);
      const before = await preview.boundingBox();
      await choice.hover();
      await expect
        .poll(() =>
          win.evaluate(
            (id) => (globalThis as Observed).motionlooks.previews.some((record) => record.target === id),
            motion,
          ),
        )
        .toBe(true);
      expect(await preview.boundingBox()).toEqual(before);
      expect(await choice.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await win.mouse.down();
      expect(await choice.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      await win.mouse.up();
    }
    for (const record of await win.evaluate(() => (globalThis as Observed).motionlooks.previews)) {
      expect(record.keys).toContain('opacity');
      expect(
        record.keys.filter((key) => /transform|translate|scale|width|height|top|left/iu.test(key)),
      ).toEqual([]);
    }
    await noCapture(win);
  } finally {
    await app.close();
  }
});
