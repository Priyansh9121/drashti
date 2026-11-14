import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import {
  FIRST_MOTIONS,
  LOWER_THIRD_MOTIONS,
  motionAt,
  MOTION_PERIOD_MS,
  motionPieces,
} from '../../src/shared/lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThirdLook } from '../../src/shared/lower-thirds';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, outputReady, setUpScreen } from './helpers';
import { engineState, holdClock } from './placeholder-slides';

/*
 * The Lower Thirds studio's moving backgrounds added since alpha.17 (Session 58, alpha.18, lower-third-styles.ts):
 * each, up on a hall screen, draws every piece as Chromium reads its CSS (each gradient it asks for, or its colour or
 * ring: nothing dropped as CSS the page cannot read), where its definition puts it at two moments of its loop (the
 * engine's clock held), moving, in the lower third's own colours. Placeholder words only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** A transform's parts and numbers, to compare what the page kept with what was asked, however it writes them. */
const read = (transform: string) => ({
  parts: [...transform.matchAll(/([a-zA-Z]+)\(/gu)].map((m) => m[1] ?? ''),
  numbers: [...transform.matchAll(/-?\d+(?:\.\d+)?/gu)].map((m) => Number(m[0])),
});

/** How many gradients a piece's CSS asks for. */
const gradients = (css: string): number => css.match(/gradient\(/gu)?.length ?? 0;

test('every moving background added since alpha.17 draws on a hall screen as it is made: each piece painted, where its definition puts it, moving by the engine’s clock, in the lower third’s colours', async () => {
  test.setTimeout(300_000);
  const added = LOWER_THIRD_MOTIONS.filter((m) => m !== 'none' && !FIRST_MOTIONS.includes(m));
  expect(added.length).toBeGreaterThanOrEqual(12);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win, 'Main Hall', 0);
    const out = await outputPage(app);
    await outputReady(out);
    const layer = out.getByTestId('lower-third-layer');
    for (const motion of added) {
      const look: LowerThirdLook = { ...DEFAULT_LOWER_THIRD_LOOK, accent: '#ff9900', motion };
      // Held before it goes up, so it waits at its start; then up, in place of the one before.
      await holdClock(app, Date.now() - 60_000);
      const shown = await dispatch(win, {
        type: 'showLowerThird',
        lowerThird: {
          id: `placeholder-new-background-${motion}`,
          lines: ['Placeholder name', 'Placeholder title'],
          look,
          where: 'both',
          animation: 'fade-steady',
        },
      });
      expect(shown, motion).toMatchObject({ ok: true });
      const shownAt = (await engineState(win)).layers.lowerThird?.shownAt ?? 0;
      expect(shownAt, motion).toBeGreaterThan(0);
      await expect(layer).toHaveAttribute('data-lt-motion', motion);
      const asked = motionPieces(motion, look);
      const pieces = layer.locator('[data-lt-piece][data-lt-panel="0"]');
      await expect(pieces).toHaveCount(asked.length);

      // Every piece painted as asked: each gradient read, or a colour, or a ring.
      const painted = await pieces.evaluateAll((elements) =>
        elements.map((e) => {
          const s = getComputedStyle(e);
          return {
            image: s.backgroundImage,
            colour: s.backgroundColor,
            ring: s.borderTopWidth,
            colours: `${s.backgroundColor} ${s.backgroundImage} ${s.borderTopColor}`,
          };
        }),
      );
      for (const [i, p] of painted.entries()) {
        const css = JSON.stringify(asked[i] ?? {});
        const what = `${motion} piece ${String(i)}: ${p.image} | ${p.colour} | ${p.ring}`;
        expect(gradients(p.image), what).toBe(gradients(css));
        expect(p.image !== 'none' || p.colour !== 'rgba(0, 0, 0, 0)' || p.ring !== '0px', what).toBe(true);
      }
      // In the lower third's own colours: its second colour, or white.
      expect(
        painted.some((p) => /255, 153, 0|255, 255, 255/u.test(p.colours)),
        `${motion}: ${painted.map((p) => p.colours).join(' | ')}`,
      ).toBe(true);

      // Up and still, at two moments a third of its loop apart: each piece where its definition puts it.
      const seen: string[] = [];
      for (const t of [2000, 2000 + Math.round(MOTION_PERIOD_MS[motion] / 3)]) {
        await holdClock(app, shownAt + t);
        await expect(layer).toHaveAttribute('data-lt-phase', 'still');
        await expect(layer).toHaveAttribute('data-lt-motion-at', String(t));
        const drawn = await pieces.evaluateAll((elements) =>
          elements.map((e) => {
            const style = (e as HTMLElement).style;
            return { transform: style.transform, opacity: style.opacity };
          }),
        );
        const want = motionAt(motion, t, asked.length);
        expect(drawn, motion).toHaveLength(want.length);
        for (const [i, d] of drawn.entries()) {
          const w = want[i] ?? { transform: '', opacity: 1 };
          const what = `${motion} piece ${String(i)} at ${String(t)} ms: ${d.transform} for ${w.transform}`;
          const [got, wanted] = [read(d.transform), read(w.transform)];
          expect(got.parts, what).toEqual(wanted.parts);
          expect(got.numbers.length, what).toBe(wanted.numbers.length);
          for (const [j, n] of got.numbers.entries())
            expect(n, what).toBeCloseTo(wanted.numbers[j] ?? NaN, 2);
          expect(d.opacity === '' ? 1 : Number(d.opacity), what).toBeCloseTo(w.opacity, 2);
        }
        seen.push(JSON.stringify(drawn));
      }
      expect(seen[1], `${motion} moves`).not.toBe(seen[0]);
    }
    await dispatch(win, { type: 'hideLowerThird' });
  } finally {
    await app.close();
  }
});
