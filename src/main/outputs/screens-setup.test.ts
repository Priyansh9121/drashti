import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GroupLook } from '../../shared/looks';
import { DEFAULT_GROUP_LOOK } from '../../shared/looks';
import type { SavedGroup, SavedScreen } from '../db/screens';
import type { ScreensChange, ScreensSetup } from './screens-setup';
import { keepWaiting, takeWaiting, undoChange, undoChanges } from './screens-setup';

/*
 * Keep these screens?'s Go back (Session 51, S3-4): only what the changes changed goes back, the last first, and
 * only where it is still as they left it. And the change waiting, kept on disk until it is answered (S3-2).
 * Placeholder groups and screens only.
 */

const group = (id: string, patch: Partial<SavedGroup> = {}): SavedGroup => ({
  id,
  name: `Group ${id}`,
  role: 'audience',
  position: 0,
  ...patch,
});
const screen = (id: string, groupId: string, patch: Partial<SavedScreen> = {}): SavedScreen => ({
  id,
  groupId,
  nodeId: null,
  name: `Screen ${id}`,
  displayKey: JSON.stringify({ id: 2, label: 'Placeholder TV' }),
  canvasWidth: 1920,
  canvasHeight: 1080,
  scaling: 'fit',
  enabled: true,
  feed: null,
  position: 0,
  ...patch,
});
const look = (patch: Partial<GroupLook> = {}): GroupLook => ({ ...DEFAULT_GROUP_LOOK, ...patch });
/** A setup in an order that does not matter: by id. */
const sorted = (s: ScreensSetup): ScreensSetup => ({
  groups: [...s.groups].sort((a, b) => a.id.localeCompare(b.id)),
  screens: [...s.screens].sort((a, b) => a.id.localeCompare(b.id)),
  looks: s.looks,
});

/** The hall's group on display 2 in Gujarati, in two Looks (L1 live). */
const before: ScreensSetup = {
  groups: [group('hall')],
  screens: [screen('tv', 'hall')],
  looks: { L1: { hall: look({ languages: ['gu'] }) }, L2: { hall: look() } },
};
/** Set Up Screens…'s Done: the hall in English, and a stage group made with a screen on display 3. */
const after: ScreensSetup = {
  groups: [group('hall'), group('stage', { name: 'Stage', role: 'stage', position: 1 })],
  screens: [screen('tv', 'hall'), screen('stv', 'stage', { displayKey: JSON.stringify({ id: 3 }) })],
  looks: {
    L1: { hall: look({ languages: ['en'] }), stage: look() },
    L2: { hall: look(), stage: look() },
  },
};
const change: ScreensChange = { before, after };

describe('Go back undoes only what the change changed (Session 51)', () => {
  it('with nothing else changed meanwhile, the screens are exactly as they were', () => {
    expect(sorted(undoChange(after, change))).toEqual(sorted(before));
    // Going back a second time (a start that could not clear what waited) changes nothing more.
    expect(undoChange(undoChange(after, change), change)).toEqual(undoChange(after, change));
    // Nor does going back over screens the change never reached (a power cut lost the change itself).
    expect(sorted(undoChange(before, change))).toEqual(sorted(before));
  });

  it('what changed meanwhile stays: a group made, a group renamed, other settings, other groups, other Looks', () => {
    const now: ScreensSetup = {
      groups: [group('hall', { name: 'Main Hall' }), after.groups[1] ?? group('x'), group('lobby')],
      screens: [...after.screens, screen('ltv', 'lobby', { enabled: false })],
      looks: {
        L1: {
          hall: look({ languages: ['en'], movement: 'bold' }),
          stage: look(),
          lobby: look({ languages: ['hi'] }),
        },
        // The live Look switched to L2 and changed there: L2 is not the change's.
        L2: { hall: look({ languages: ['translit'] }), stage: look(), lobby: look() },
        // A Look made meanwhile.
        L3: { hall: look({ slides: 'lowerThird' }), stage: look(), lobby: look() },
      },
    };
    expect(sorted(undoChange(now, change))).toEqual({
      groups: [group('hall', { name: 'Main Hall' }), group('lobby')],
      screens: [screen('ltv', 'lobby', { enabled: false }), screen('tv', 'hall')],
      looks: {
        L1: { hall: look({ languages: ['gu'], movement: 'bold' }), lobby: look({ languages: ['hi'] }) },
        L2: { hall: look({ languages: ['translit'] }), lobby: look() },
        L3: { hall: look({ slides: 'lowerThird' }), lobby: look() },
      },
    });
  });

  it('a field changed again since the change stays as it is now', () => {
    const now: ScreensSetup = {
      ...after,
      looks: { ...after.looks, L1: { hall: look({ languages: ['hi'] }), stage: look() } },
    };
    expect(undoChange(now, change).looks['L1']).toEqual({ hall: look({ languages: ['hi'] }) });
  });

  it('what the change removed is back as it was, unless its group went meanwhile', () => {
    // Not used: the stage display's screen removed; the hall's screen moved into the stage group.
    const was: ScreensSetup = {
      groups: [group('hall'), group('stage', { role: 'stage' })],
      screens: [screen('tv', 'hall'), screen('stv', 'stage', { canvasWidth: 1280 })],
      looks: { L1: { hall: look({ languages: ['gu'] }), stage: look() } },
    };
    const made: ScreensSetup = { ...was, screens: [screen('tv', 'stage')] };
    expect(sorted(undoChange(made, { before: was, after: made }))).toEqual(sorted(was));
    // The hall's group removed meanwhile: the screen the change moved out of it stays where it is now, the one
    // the change removed is back.
    const now: ScreensSetup = {
      groups: [group('stage', { role: 'stage' })],
      screens: [screen('tv', 'stage', { enabled: false })],
      looks: { L1: { stage: look() } },
    };
    expect(sorted(undoChange(now, { before: was, after: made }))).toEqual({
      groups: [group('stage', { role: 'stage' })],
      screens: [screen('stv', 'stage', { canvasWidth: 1280 }), screen('tv', 'stage', { enabled: false })],
      looks: { L1: { stage: look() } },
    });
    // A screen the change removed from a group removed meanwhile went with it.
    const gone: ScreensSetup = {
      groups: [group('hall')],
      screens: [screen('tv', 'hall')],
      looks: { L1: { hall: look({ languages: ['gu'] }) } },
    };
    expect(undoChange(gone, { before: was, after: { ...made, screens: [screen('tv', 'hall')] } })).toEqual(
      gone,
    );
  });

  it('a group the change removed comes back with its screens and its settings in each Look', () => {
    const was: ScreensSetup = {
      groups: [group('hall'), group('old', { position: 1 })],
      screens: [screen('tv', 'hall'), screen('otv', 'old')],
      looks: { L1: { hall: look(), old: look({ languages: ['en'], idle: 'always' }) } },
    };
    const made: ScreensSetup = {
      groups: [group('hall')],
      screens: [screen('tv', 'hall')],
      looks: { L1: { hall: look() } },
    };
    expect(sorted(undoChange(made, { before: was, after: made }))).toEqual(sorted(was));
  });

  it('several changes undone, the last first; what changed between them stays', () => {
    const s0: ScreensSetup = {
      groups: [group('hall')],
      screens: [screen('tv', 'hall', { enabled: false })],
      looks: { L1: { hall: look() } },
    };
    // On (it asks), then the hall renamed in Screens, then the canvas changed (taken in).
    const s1: ScreensSetup = { ...s0, screens: [screen('tv', 'hall')] };
    const s1b: ScreensSetup = { ...s1, groups: [group('hall', { name: 'Main Hall' })] };
    const s2: ScreensSetup = { ...s1b, screens: [screen('tv', 'hall', { canvasWidth: 1280 })] };
    expect(
      undoChanges(s2, [
        { before: s0, after: s1 },
        { before: s1b, after: s2 },
      ]),
    ).toEqual({ ...s0, groups: [group('hall', { name: 'Main Hall' })] });
    // None: as it is.
    expect(undoChanges(s2, [])).toEqual(s2);
  });
});

describe('the change waiting, kept on disk until it is answered (Session 51, S3-2)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drashti-keep-screens-'));
    file = join(dir, 'keep-screens.json');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('written whole, then taken back once, exactly: every group, screen and Look setting', () => {
    const wide: ScreensSetup = {
      ...after,
      // Settings as a Look keeps them: a later layer (the box) left out, a layout, a mask.
      looks: {
        L1: {
          hall: look({
            layers: ['slide', 'props', 'messages'],
            languages: ['translit', 'gu'],
            slides: 'lowerThird',
            stageLayoutId: 'layout-1',
            maskId: 'mask-1',
            idle: 'always',
            movement: 'bold',
          }),
          stage: look(),
        },
      },
    };
    const changes: ScreensChange[] = [change, { before: after, after: wide }];
    keepWaiting(file, changes);
    // Only the file: its temporary copy was renamed into place.
    expect(readdirSync(dir)).toEqual(['keep-screens.json']);
    expect(takeWaiting(file)).toEqual(changes);
    // Taken: gone from the disk.
    expect(existsSync(file)).toBe(false);
    expect(takeWaiting(file)).toBeNull();
  });

  it('answered: removed; nothing there, or something unreadable, is nothing (and is cleared)', () => {
    keepWaiting(file, [change]);
    keepWaiting(file, null);
    expect(existsSync(file)).toBe(false);
    keepWaiting(file, null);
    expect(takeWaiting(file)).toBeNull();
    for (const bad of ['{', '{"version":1,"changes":[]}', '{"version":9,"changes":[1]}', 'null']) {
      writeFileSync(file, bad);
      expect(takeWaiting(file)).toBeNull();
      expect(existsSync(file)).toBe(false);
    }
  });
});
