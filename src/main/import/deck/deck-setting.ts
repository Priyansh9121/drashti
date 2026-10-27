import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * File › Decks With Their Animations on This Computer (Session 54, C review): whether a PowerPoint or Keynote deck
 * comes in with its animations here, where PowerPoint or Keynote can make them. On by default on a Mac, where they
 * were tried; off on Windows until the mandir PC has passed C1's try-list (assister/session-54-deck-trial.md), so
 * a Windows deck comes in as pictures, as before, with its videos as real videos. It belongs to the computer, not
 * the library (a library restored elsewhere does not bring it), so it is kept in the data folder, as Run Ahead of
 * Other Programs is. Anyone may change it.
 */

const FILE = 'deck-animations.json';

/** Its name, as File shows it and the guides say it. */
export const DECK_ANIMATIONS_LABEL = 'Decks With Their Animations on This Computer';

/** On a Mac, on until changed; elsewhere off. */
export const deckAnimationsByDefault = (platform: NodeJS.Platform): boolean => platform === 'darwin';

export function readDeckAnimations(userData: string, platform: NodeJS.Platform): boolean {
  try {
    const raw = JSON.parse(readFileSync(join(userData, FILE), 'utf8')) as { on?: unknown };
    return typeof raw.on === 'boolean' ? raw.on : deckAnimationsByDefault(platform);
  } catch {
    return deckAnimationsByDefault(platform);
  }
}

export function writeDeckAnimations(userData: string, on: boolean): void {
  const file = join(userData, FILE);
  writeFileSync(`${file}.writing`, JSON.stringify({ on }, null, 2));
  renameSync(`${file}.writing`, file);
}
