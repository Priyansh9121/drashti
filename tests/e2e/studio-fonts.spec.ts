import { expect, test, type Page } from '@playwright/test';
import { LOWER_THIRD_FONT_CHOICES } from '../../src/shared/lower-third-fonts';
import { launchApp, operatorPage, operatorReady, type PageGlobals } from './helpers';

/*
 * The Lower Thirds studio's fonts in the operator window (a21, source-preparation-responsiveness.spec.ts:101's flake on
 * CI's Mac: the first live Next 306 ms). Two frames after the LIVE picture first draws the show, the window asks for the
 * studio's faces (render/studio-fonts.ts). Asked for all at once, their loads took its main thread for ~0.4 s
 * (a Chromium trace of CI's Mac: the asking 70 ms, then one load after another to +606 ms), right when an operator
 * presses Next after going live, and the live command waited behind them. One face at a time, the next once the last
 * has come and the window is idle, a live command waits for one face at most. LIVE's warm-up is held (a test switch)
 * so the faces are asked for only at the go-live, after this test is watching. Placeholder words only.
 */

const HOLD = { DRASHTI_TEST_HOLD_WARM_UP: '1' };
const STUDIO_FAMILIES = LOWER_THIRD_FONT_CHOICES.filter((c) => c.bundled === 'studio').flatMap(
  (c) => c.families,
);
/** Every face the studio has: each family of each choice in each of its weights. */
const FACES = LOWER_THIRD_FONT_CHOICES.filter((c) => c.bundled === 'studio').reduce(
  (n, c) => n + c.families.length * c.weights.length,
  0,
);

interface Asking {
  inFlight: number;
  most: number;
  asked: number;
}
type FontGlobals = typeof globalThis & { __drashtiStudioAsking?: Asking };

/** How many of the studio's font faces the page has, by how far each has loaded ("unloaded": never asked for). */
const studioFonts = (page: Page) =>
  page.evaluate((families) => {
    const by: Record<string, number> = {};
    for (const face of Array.from(document.fonts))
      if (families.includes(face.family.replace(/["']/gu, ''))) by[face.status] = (by[face.status] ?? 0) + 1;
    return by;
  }, STUDIO_FAMILIES);

test('after LIVE first draws the show, the operator window asks for the Lower Thirds studio’s fonts one face at a time, and every face comes', async () => {
  test.setTimeout(120_000);
  const { app } = await launchApp(HOLD);
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    // Nothing of the studio's is asked for while LIVE warms up (Session 55).
    expect(Object.keys(await studioFonts(win)), 'before the show: the studio’s fonts').toEqual(['unloaded']);
    // Every load of a studio face the window asks for, counted as it is asked for and as it comes.
    await win.evaluate((families) => {
      const asking: Asking = { inFlight: 0, most: 0, asked: 0 };
      (globalThis as FontGlobals).__drashtiStudioAsking = asking;
      const fonts = document.fonts;
      const load = fonts.load.bind(fonts);
      fonts.load = (font: string, text?: string) => {
        const loading = load(font, text);
        if (!families.some((family) => font.includes(`"${family}"`))) return loading;
        asking.asked++;
        asking.inFlight++;
        asking.most = Math.max(asking.most, asking.inFlight);
        const done = () => {
          asking.inFlight--;
        };
        loading.then(done, done);
        return loading;
      };
    }, STUDIO_FAMILIES);
    await win.evaluate(async () => {
      const d = (globalThis as PageGlobals).drashti;
      const made = await d.library.newFromWords('Placeholder studio fonts', 'Placeholder words');
      if (!made.ok) throw new Error(made.message);
      const shown = await d.engine.dispatch({ type: 'goLive', presentationId: made.id, slideIndex: 0 });
      if (!shown.ok) throw new Error('The placeholder slide could not go live.');
    });
    // Every face comes, as before.
    await expect
      .poll(async () => Object.keys(await studioFonts(win)), { timeout: 30_000 })
      .toEqual(['loaded']);
    const asking = await win.evaluate(() => (globalThis as FontGlobals).__drashtiStudioAsking);
    await test.info().attach('studio-font-asking', {
      body: JSON.stringify({ faces: FACES, asking }),
      contentType: 'application/json',
    });
    expect(asking?.asked, 'every face of the studio, asked for once').toBe(FACES);
    expect(asking?.most, 'the studio’s faces loading at once').toBe(1);
  } finally {
    await app.close();
  }
});
