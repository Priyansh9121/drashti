import { keyText } from '../../../shared/keymap';

/**
 * Up's or Down's tooltip on the chosen playlist item, with its key as this computer writes it (keyplat's words, the
 * owner's "shortcuts should be adaptable to mac, mac intel, and windows"): "Up a place (⌥↑)" on a Mac, "(Alt+↑)" on
 * Windows. Its aria-keyshortcuts stays "Alt+ArrowUp": ARIA names the Option key Alt on every computer.
 */
export function moveTitle(step: -1 | 1, platform: string): string {
  return step < 0
    ? `Up a place (${keyText('Alt+ArrowUp', platform)})`
    : `Down a place (${keyText('Alt+ArrowDown', platform)})`;
}
