import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { letTimePass } from './helpers';

/** Hold one finger for the original 800 ms gesture, then lift without triggering the row. */
export async function longPress(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const fire = (type: string) =>
    target.evaluate((el, type) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 41,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    }, type);
  await fire('pointerdown');
  await letTimePass(target.page(), 800, 'a finger stays down long enough to open its row’s menu');
  await fire('pointerup');
  await expect(target.page().getByTestId('remote-row-menu')).toBeVisible();
}
