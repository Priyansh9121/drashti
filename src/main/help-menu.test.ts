import { describe, expect, it } from 'vitest';
import { helpMenu } from './help-menu';

/*
 * Help › Show Help (alpha.24, helpmenu): the status bar's Help switch in the menu bar, ticked while it is on, in step
 * with the switch both ways. The operator window keeps the switch (and remembers it) and says how it stands; the
 * menu's tick is what it last said. Chosen, the item asks the window to turn it the other way, and the tick follows
 * the switch, not the click.
 */

/** A Help item, with the menu's buildings and the window's asks written down. */
function setUp() {
  const built: boolean[] = [];
  const asked: boolean[] = [];
  const help = helpMenu(
    () => {
      built.push(help.on());
    },
    (on) => {
      asked.push(on);
    },
  );
  return { help, built, asked };
}

describe('Help › Show Help: the tick in step with the status bar’s Help switch', () => {
  it('is unticked until the operator window says how its switch stands', () => {
    const { help, built, asked } = setUp();
    expect(help.on()).toBe(false);
    expect(built).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('is ticked as the window says, the menu built again only when that changes', () => {
    const { help, built } = setUp();
    expect(help.told(true)).toBe(true);
    expect(help.on()).toBe(true);
    expect(built).toEqual([true]);
    // Said again (a reload of the window, Simple Mode's status bar): nothing to build.
    expect(help.told(true)).toBe(true);
    expect(built).toEqual([true]);
    expect(help.told(false)).toBe(true);
    expect(help.on()).toBe(false);
    expect(built).toEqual([true, false]);
    // Off at a first start, as said: nothing changed.
    expect(help.told(false)).toBe(true);
    expect(built).toEqual([true, false]);
  });

  it('refuses anything but on or off from the window, and keeps the tick as it was', () => {
    const { help, built } = setUp();
    help.told(true);
    for (const said of ['true', 1, null, undefined, {}])
      expect(help.told(said), `told ${JSON.stringify(said) ?? 'undefined'}`).toBe(false);
    expect(help.on()).toBe(true);
    expect(built).toEqual([true]);
  });

  it('chosen, asks the window to turn the switch the other way, the tick as the switch still is until it says', () => {
    const { help, built, asked } = setUp();
    help.chosen();
    // Electron ticks a checkbox as it is clicked: the menu is built again at once with the switch as it is.
    expect(built).toEqual([false]);
    expect(asked).toEqual([true]);
    expect(help.on()).toBe(false);
    // The window turned it on and says so: ticked.
    help.told(true);
    expect(built).toEqual([false, true]);
    help.chosen();
    expect(asked).toEqual([true, false]);
    expect(built).toEqual([false, true, true]);
    help.told(false);
    expect(help.on()).toBe(false);
    expect(built.at(-1)).toBe(false);
  });

  it('chosen with no window to answer (closed, or still opening), stays as the switch last was', () => {
    const { help, built, asked } = setUp();
    help.told(true);
    help.chosen();
    help.chosen();
    expect(asked).toEqual([false, false]);
    expect(help.on()).toBe(true);
    expect(built).toEqual([true, true, true]);
  });
});
