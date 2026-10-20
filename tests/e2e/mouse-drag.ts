import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/*
 * Dragging with the mouse in a test (Session 26a): pressed on the source, moved
 * a few pixels in small steps (Chromium starts an HTML5 drag only once the
 * pointer has moved), then to the target and released, as the operator's hand
 * does. Playwright's Electron drag is Chromium's own drag, replayed through
 * the DevTools protocol, not a native macOS or Windows drag session: what it
 * proves is that the page starts the drag, keeps it and takes the drop.
 *
 * When Chromium cancels a drag (the row it started from changed under the
 * pointer as it started), Playwright's next move waits for ever: this fails
 * plainly instead.
 */

export type DropAt = 'top' | 'middle' | 'bottom';

const within = async <T>(work: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(what));
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A drag from the library's sheet (Session 44): the sheet stands aside once the drag is under way, so what it
 * lies over (the playlists) takes the drop. Waited for, so the target is measured and dropped on uncovered.
 */
export async function libraryAside(page: Page, fromSheet: boolean): Promise<void> {
  if (fromSheet) await expect(page.getByTestId('library-sheet')).toHaveAttribute('data-aside', 'true');
}

/** Whether `source` is in the library's sheet: asked before the drag, as the sheet hides once it is under way. */
export const inLibrarySheet = (source: Locator): Promise<boolean> =>
  source.evaluate((el) => el.closest('[data-testid="library-sheet"]') !== null);

/** Drag `source` onto the top, middle or bottom of `target` with the mouse. */
export async function mouseDrag(page: Page, source: Locator, target: Locator, where: DropAt = 'middle') {
  await source.scrollIntoViewIfNeeded();
  const fromSheet = await inLibrarySheet(source);
  const from = await source.boundingBox();
  if (!from) throw new Error('the drag source is not visible');
  const x = from.x + from.width / 2;
  const y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await within(
    (async () => {
      await page.mouse.move(x + 4, y + 4, { steps: 2 });
      await page.mouse.move(x + 10, y + 10, { steps: 2 });
    })(),
    10_000,
    'the drag did not get under way: Chromium cancelled it as it started (its row changed under the pointer)',
  );
  await libraryAside(page, fromSheet);
  // Measured once the drag is under way, with the target in view: on a small screen a list can
  // scroll as the source comes into view.
  await target.evaluate((el) => {
    el.scrollIntoView({ block: 'nearest' });
  });
  const box = await target.boundingBox();
  if (!box) throw new Error('the drop target is not visible');
  const ty = box.y + (where === 'top' ? 3 : where === 'bottom' ? box.height - 3 : box.height / 2);
  await within(
    page.mouse.move(box.x + box.width / 2, ty, { steps: 6 }),
    10_000,
    'the drag stopped on its way to the target',
  );
  await page.mouse.up();
}
