/*
 * Help › Show Help (alpha.24, helpmenu): the status bar's Help switch (renderer/src/help/help-store.ts) in the menu bar
 * too, under Guides…, ticked while Help is on, in step with the switch both ways, in Pro and Simple Mode. The operator
 * window keeps the switch and remembers it on this computer, as uihelp made it; it says how the switch stands as it
 * starts and at each change (help/help-menu.ts), and the tick is what it last said. Chosen, the item asks the window to
 * turn the switch the other way: the tick follows the switch, not the click (Electron ticks a checkbox as it is
 * clicked, so the menu is built again at once, as the switch still is, until the window says it changed).
 */

export interface HelpMenu {
  /** The switch as the operator window last said: off until it says (a first start's, too). */
  on: () => boolean;
  /** The window said how its switch stands: false (and nothing changed) for anything but on or off. */
  told: (said: unknown) => boolean;
  /** Help › Show Help chosen. */
  chosen: () => void;
}

/** `rebuild` builds the menu again (reading `on()`); `ask` asks the operator window to turn its switch on or off. */
export function helpMenu(rebuild: () => void, ask: (on: boolean) => void): HelpMenu {
  let on = false;
  return {
    on: () => on,
    told: (said) => {
      if (typeof said !== 'boolean') return false;
      if (said !== on) {
        on = said;
        rebuild();
      }
      return true;
    },
    chosen: () => {
      rebuild();
      ask(!on);
    },
  };
}
