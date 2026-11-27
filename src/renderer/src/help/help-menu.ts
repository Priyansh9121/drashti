import { type HelpState, setHelp, useHelp } from './help-store';

/*
 * Help › Show Help (alpha.24, helpmenu): the menu bar's item (main/help-menu.ts) kept in step with the status bar's Help
 * switch both ways. The switch stays this window's, remembered on this computer as before (help-store.ts); the main
 * process is told how it stands, as the window starts and at each change, and ticks the item; the item chosen turns the
 * switch as the main process asks, as the switch's own click does.
 */

/** What this needs of the main process (the preload's app bridge). */
export interface HelpMenuBridge {
  help(on: boolean): Promise<null>;
  onHelpChosen(listener: (on: boolean) => void): () => void;
}

/** Keep the menu's item in step with the switch until the returned stop. The status bar's Help switch starts it. */
export function connectHelpMenu(bridge: HelpMenuBridge): () => void {
  // What the main process was last told: Alt held for a look at the keys changes the store, never the switch.
  let said: boolean | null = null;
  const say = ({ on }: HelpState) => {
    if (on === said) return;
    said = on;
    // Refused only while Drashti is stopped (not let in), when the menu has no Help item to tick.
    void bridge.help(on).catch(() => null);
  };
  say(useHelp.getState());
  const unsubscribe = useHelp.subscribe(say);
  const off = bridge.onHelpChosen(setHelp);
  return () => {
    unsubscribe();
    off();
  };
}
