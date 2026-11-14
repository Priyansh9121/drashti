import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { MORE_MOTIONS } from '../../src/shared/lower-third-motions-more';
import { type LowerThirdMotion, motionAt, motionPieces } from '../../src/shared/lower-third-styles';
import { DEFAULT_LOWER_THIRD_LOOK, type LowerThirdLook } from '../../src/shared/lower-thirds';
import type { PageGlobals } from './helpers';
import { launchApp, operatorPage, operatorReady, outputPage, outputReady, setUpScreen } from './helpers';
import { engineState, holdClock } from './placeholder-slides';

/*
 * The Lower Thirds studio's moving backgrounds, part 2 (Session 58, alpha.18, shared/lower-third-motions-more.ts):
 * each of the eleven new ones, up on a hall screen, draws its pieces where its definition says, moved by the engine's
 * clock (held here at two moments of its loop), in the lower third's own second colour. Placeholder words only.
 */

const dispatch = (win: Page, command: unknown) =>
  win.evaluate((c) => (globalThis as PageGlobals).drashti.engine.dispatch(c as never), command);

/** A transform's parts and numbers, to compare what the page kept with what was asked, however it writes them. */
const read = (transform: string) => ({
  parts: [...transform.matchAll(/([a-zA-Z]+)\(/gu)].map((m) => m[1] ?? ''),
  numbers: [...transform.matchAll(/-?\d+(?:\.\d+)?/gu)].map((m) => Number(m[0])),
});

test('each of the eleven new moving backgrounds draws on a hall screen as it is made, moved by the engine’s clock', async () => {
  test.setTimeout(240_000);
  const { app } = await launchApp({ DRASHTI_WINDOWED_OUTPUTS: '1', DRASHTI_TEST_CLOCK_HOLD: '1' });
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    await setUpScreen(win, 'Main Hall', 0);
    const out = await outputPage(app);
    await outputReady(out);
    const layer = out.getByTestId('lower-third-layer');
    for (const motion of Object.keys(MORE_MOTIONS) as (keyof typeof MORE_MOTIONS & LowerThirdMotion)[]) {
      const look: LowerThirdLook = { ...DEFAULT_LOWER_THIRD_LOOK, accent: '#ff9900', motion };
      // Held before it goes up, so it waits at its start; then up, in place of the one before.
      await holdClock(app, Date.now() - 60_000);
      const shown = await dispatch(win, {
        type: 'showLowerThird',
        lowerThird: {
          id: `placeholder-background-${motion}`,
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
      const count = motionPieces(motion, look).length;
      const pieces = layer.locator('[data-lt-piece][data-lt-panel="0"]');
      await expect(pieces).toHaveCount(count);

      // Up and still, at two moments a third of its loop apart: each piece where its definition puts it.
      const seen: string[] = [];
      for (const t of [2000, 2000 + Math.round(MORE_MOTIONS[motion].periodMs / 3)]) {
        await holdClock(app, shownAt + t);
        await expect(layer).toHaveAttribute('data-lt-phase', 'still');
        await expect(layer).toHaveAttribute('data-lt-motion-at', String(t));
        const drawn = await pieces.evaluateAll((elements) =>
          elements.map((e) => {
            const style = (e as HTMLElement).style;
            return { transform: style.transform, opacity: style.opacity };
          }),
        );
        const want = motionAt(motion, t, count);
        expect(drawn, motion).toHaveLength(want.length);
        for (const [i, d] of drawn.entries()) {
          const w = want[i] ?? { transform: '', opacity: 1 };
          const what = `${motion} piece ${String(i)} at ${String(t)} ms: ${d.transform} for ${w.transform}`;
          const [got, asked] = [read(d.transform), read(w.transform)];
          expect(got.parts, what).toEqual(asked.parts);
          expect(got.numbers.length, what).toBe(asked.numbers.length);
          for (const [j, n] of got.numbers.entries())
            expect(n, what).toBeCloseTo(asked.numbers[j] ?? Number.NaN, 2);
          expect(d.opacity === '' ? 1 : Number(d.opacity), what).toBeCloseTo(w.opacity, 2);
        }
        seen.push(JSON.stringify(drawn));
      }
      expect(seen[1], `${motion} moves`).not.toBe(seen[0]);

      // In the lower third's own second colour.
      const colours = await pieces.evaluateAll((elements) =>
        elements.map((e) => {
          const s = getComputedStyle(e);
          return `${s.backgroundColor} ${s.backgroundImage} ${s.borderTopColor}`;
        }),
      );
      expect(
        colours.some((c) => c.includes('255, 153, 0')),
        `${motion}: ${colours.join(' | ')}`,
      ).toBe(true);
    }
    await dispatch(win, { type: 'hideLowerThird' });
  } finally {
    await app.close();
  }
});
