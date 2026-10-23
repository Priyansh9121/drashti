import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { GroupLook } from '../../shared/looks';
import { readGroupLook, storedGroupLook } from '../../shared/looks';
import { idSchema } from '../../shared/model-schema';
import type { ScreenRole } from '../../shared/screens';
import { SCALING_MODES } from '../../shared/screens';
import type { SavedGroup, SavedScreen, SavedScreens } from '../db/screens';
import { readState, readStateTwice } from '../state-file';
import { COULD_NOT_GO_BACK } from './keep-screens';

/*
 * The screen setup as Keep these screens? takes it (Session 50), just before and just after each change, so Go
 * back undoes only what the changes changed (Session 51, S3-4): the last change first, each field put back only
 * where it is still as the change left it. Whatever else changed meanwhile stays as it is now: a group made or
 * renamed in Screens, another group's languages, a group's languages in another Look, the live Look switched.
 *
 * The changes waiting for an answer are kept on disk until it comes (S3-2): after a crash or a power cut within
 * the 15 s, the next start goes back, before the outputs open, as nothing pressed would have.
 */

/** Each Look's settings for each group: by Look id, then group id. */
export type LooksSettings = Record<string, Record<string, GroupLook>>;

/**
 * Every group and screen as stored, and each group's settings in every Look: a screen change sets a group's
 * languages in the live Look (the setup wizard), and a key and fill pair's layers in every Look (Screens' Shows).
 */
export interface ScreensSetup extends SavedScreens {
  looks: LooksSettings;
}

/** One change: the setup just before it, and just after. */
export interface ScreensChange {
  before: ScreensSetup;
  after: ScreensSetup;
}

/** A group's fields Go back may put back: all but its id (the compiler asks for one added later). */
const GROUP_FIELDS: Record<Exclude<keyof SavedGroup, 'id'>, true> = {
  name: true,
  role: true,
  position: true,
};
/** A screen's. */
const SCREEN_FIELDS: Record<Exclude<keyof SavedScreen, 'id'>, true> = {
  groupId: true,
  nodeId: true,
  name: true,
  displayKey: true,
  canvasWidth: true,
  canvasHeight: true,
  scaling: true,
  enabled: true,
  feed: true,
  position: true,
};
/** A group's settings in a Look. */
const LOOK_FIELDS: Record<keyof GroupLook, true> = {
  layers: true,
  languages: true,
  slides: true,
  stageLayoutId: true,
  maskId: true,
  idle: true,
  movement: true,
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const isField = <T extends object>(o: T, key: string): key is Extract<keyof T, string> => key in o;

/** `now`, each field the change changed back as it was, where it is still as the change left it. */
function undoFields<T extends object>(now: T, before: T, after: T, fields: object): T {
  const out = { ...now };
  for (const key of Object.keys(fields))
    if (isField(out, key) && !same(before[key], after[key]) && same(now[key], after[key]))
      out[key] = before[key];
  return out;
}

/**
 * A list as it is now with one change undone: what the change made is gone again, what it removed is back as it
 * was, and each field it changed is as it was (undoFields). What it did not touch stays as it is now.
 */
function undoList<T extends { id: string }>(
  now: readonly T[],
  before: readonly T[],
  after: readonly T[],
  fields: object,
): T[] {
  const was = new Map(before.map((x) => [x.id, x]));
  const left = new Map(after.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const x of now) {
    const b = was.get(x.id);
    const a = left.get(x.id);
    if (a && !b) continue;
    out.push(a && b ? undoFields(x, b, a, fields) : x);
  }
  const here = new Set(now.map((x) => x.id));
  for (const b of before) if (!left.has(b.id) && !here.has(b.id)) out.push(b);
  return out;
}

/** The setup now with one change undone. */
export function undoChange(now: ScreensSetup, { before, after }: ScreensChange): ScreensSetup {
  const groups = undoList(now.groups, before.groups, after.groups, GROUP_FIELDS);
  const ids = new Set(groups.map((g) => g.id));
  // A screen is only ever in a group there is. One the change moved out of a group removed meanwhile stays in the
  // group it is in now; one the change removed from such a group went with it.
  const groupNow = new Map(now.screens.map((s) => [s.id, s.groupId]));
  const screens = undoList(now.screens, before.screens, after.screens, SCREEN_FIELDS).flatMap((s) => {
    if (ids.has(s.groupId)) return [s];
    const stays = groupNow.get(s.id);
    return stays !== undefined && ids.has(stays) ? [{ ...s, groupId: stays }] : [];
  });
  // Each Look there is now (one made or removed meanwhile stays so), for each group there will be; a group put
  // back has its settings as they were.
  const looks: LooksSettings = {};
  for (const [lookId, settings] of Object.entries(now.looks)) {
    const out: Record<string, GroupLook> = {};
    for (const id of ids) {
      const n = settings[id];
      const b = before.looks[lookId]?.[id];
      const a = after.looks[lookId]?.[id];
      const put = n && b && a ? undoFields(n, b, a, LOOK_FIELDS) : (n ?? b);
      if (put) out[id] = put;
    }
    looks[lookId] = out;
  }
  return { groups, screens, looks };
}

/** The setup now with every change undone, the last first: what Go back puts back. */
export function undoChanges(now: ScreensSetup, changes: readonly ScreensChange[]): ScreensSetup {
  return changes.reduceRight((setup, change) => undoChange(setup, change), now);
}

// ---- the change waiting, on disk (S3-2) -------------------------------------------------------------------

/** Every role a group can have (the compiler asks for one added later). */
const ROLES: Record<ScreenRole, true> = {
  audience: true,
  stage: true,
  stream: true,
  keyfill: true,
  other: true,
};

/** A setup as written: a Look's settings as the library stores them (only what differs from the defaults). */
const setupSchema = z.object({
  groups: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().max(500),
        role: z.custom<ScreenRole>((role) => typeof role === 'string' && Object.hasOwn(ROLES, role)),
        position: z.number(),
      }),
    )
    .max(1000),
  screens: z
    .array(
      z.object({
        id: idSchema,
        groupId: idSchema,
        nodeId: idSchema.nullable(),
        name: z.string().max(500),
        displayKey: z.string().max(5000).nullable(),
        canvasWidth: z.number().int().min(16).max(16384),
        canvasHeight: z.number().int().min(16).max(16384),
        scaling: z.enum(SCALING_MODES),
        enabled: z.boolean(),
        feed: z.enum(['fill', 'key']).nullable(),
        position: z.number(),
      }),
    )
    .max(1000),
  looks: z.record(idSchema, z.record(idSchema, z.unknown())),
});
/** The changes waiting, under an id of their own (each time they are written): the answered mark names it. */
const waitingSchema = z.object({
  version: z.literal(1),
  id: idSchema,
  changes: z
    .array(z.object({ before: setupSchema, after: setupSchema }))
    .min(1)
    .max(1000),
});
const answeredSchema = z.object({ id: idSchema });

const written = (setup: ScreensSetup) => ({
  groups: setup.groups,
  screens: setup.screens,
  looks: Object.fromEntries(
    Object.entries(setup.looks).map(([lookId, groups]) => [
      lookId,
      Object.fromEntries(Object.entries(groups).map(([groupId, g]) => [groupId, storedGroupLook(g)])),
    ]),
  ),
});

const read = (raw: z.infer<typeof setupSchema>): ScreensSetup => ({
  groups: raw.groups,
  screens: raw.screens,
  looks: Object.fromEntries(
    Object.entries(raw.looks).map(([lookId, groups]) => [
      lookId,
      Object.fromEntries(Object.entries(groups).map(([groupId, g]) => [groupId, readGroupLook(g)])),
    ]),
  ),
});

/** The rename on the disk too: its folder synced (not on Windows, which cannot open a folder for it). */
function syncFolder(folder: string): void {
  if (process.platform === 'win32') return;
  try {
    const fd = openSync(folder, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // The file is in place either way: a folder that cannot be synced leaves the rename to the system.
  }
}

/**
 * Written whole to a file of its own, on the disk itself before it is renamed into place, so a power cut leaves
 * it whole or not at all (`live-state.json` is written the same way, though not synced). Throws when it cannot.
 */
function writeWhole(file: string, text: string): void {
  const partial = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(partial, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, file);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  syncFolder(dirname(file));
}

/** What the last run left in the file, as the next start finds it. */
export type LeftWaiting =
  | { kind: 'none' }
  /** Changes nobody answered: the screens go back. */
  | { kind: 'waiting'; changes: ScreensChange[] }
  /** Answered before Drashti stopped, but still there: it could not be removed then, and the mark says so. */
  | { kind: 'answered' }
  /** Not what this Drashti writes (damaged, or another version's). */
  | { kind: 'damaged'; reason: string }
  /** There, but it cannot be read even a moment later (state-file.ts: locked, say). */
  | { kind: 'unreadable'; reason: string };

export interface WaitingFileOptions {
  /** Remove a file (a test stands in a Windows lock). */
  remove?(path: string): void;
  /** How long before a file that cannot be read is read once more (state-file.ts; a test gives less). */
  retryMs?: number;
}

/**
 * The changes waiting for an answer, kept on disk until it comes (`keep-screens.json` in the user-data folder),
 * so after a crash or a power cut the next start goes back. Each write has an id of its own. Answered, it is
 * removed; one that cannot be removed then (a file held open for a moment on Windows) is named answered in a mark
 * beside it (`keep-screens.json.answered`), so the next start never goes back over a change that was kept.
 */
export class WaitingFile {
  /** The id of the changes on disk, as written or read; null for none. */
  private id: string | null = null;
  private readonly answered: string;

  constructor(
    private readonly file: string,
    private readonly options: WaitingFileOptions = {},
  ) {
    this.answered = `${file}.answered`;
  }

  /** Keep these changes waiting (all of them, the first first). Throws when they cannot be written. */
  keep(changes: readonly ScreensChange[]): void {
    const id = randomUUID();
    writeWhole(
      this.file,
      JSON.stringify({
        version: 1,
        id,
        changes: changes.map((c) => ({ before: written(c.before), after: written(c.after) })),
      }),
    );
    this.id = id;
  }

  /**
   * Nothing waits any more (answered, gone back, or dealt with at the start): removed, or else named answered.
   * Throws only when neither can be done.
   */
  forget(): void {
    const id = this.id;
    this.id = null;
    if (this.remove(this.file)) {
      this.remove(this.answered);
      return;
    }
    if (id === null) throw new Error('it cannot be removed, and what it holds cannot be read to mark it');
    writeWhole(this.answered, JSON.stringify({ id }));
  }

  /** What the last run left (the next start, before the outputs open). */
  read(): LeftWaiting {
    const found = readStateTwice(
      this.file,
      (raw) => {
        const waiting = waitingSchema.safeParse(raw);
        return waiting.success ? waiting.data : null;
      },
      this.options.retryMs,
    );
    if (found.status === 'missing') return { kind: 'none' };
    if (found.status === 'unreadable') return { kind: 'unreadable', reason: found.reason };
    if (found.status === 'invalid') return { kind: 'damaged', reason: found.reason };
    this.id = found.value.id;
    const mark = readState(this.answered, (raw) => {
      const answered = answeredSchema.safeParse(raw);
      return answered.success ? answered.data : null;
    });
    if (mark.status === 'ok' && mark.value.id === found.value.id) return { kind: 'answered' };
    return {
      kind: 'waiting',
      changes: found.value.changes.map((c) => ({ before: read(c.before), after: read(c.after) })),
    };
  }

  /** Whether it is gone (or was never there). */
  private remove(path: string): boolean {
    try {
      if (this.options.remove) this.options.remove(path);
      else rmSync(path, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}

/** What the operator is told when the screens went back at the start. */
export const WENT_BACK_AFTER_STOP =
  'Drashti stopped before the change to the screens was kept, so they went back to how they were before it.';

/**
 * The next start, before the outputs open: changes the last run left unanswered go back (`goBack`, saved only),
 * and only then are they cleared; one that fails to go back stays for the next start. Answered ones, damaged
 * ones and those of the library before a restore (`otherLibrary`: a backup restored and in use at this start)
 * are cleared, nothing going back; one that cannot be read is left. Each is said in the log. Answers what the
 * operator is told, or null.
 */
export function afterStop(
  waiting: WaitingFile,
  deps: {
    goBack(changes: ScreensChange[]): void;
    otherLibrary: boolean;
    log(level: 'info' | 'warn', message: string): void;
  },
): string | null {
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const clear = (level: 'info' | 'warn', said: string) => {
    try {
      waiting.forget();
      deps.log(level, `Keep these screens?: ${said}`);
    } catch (error) {
      deps.log('warn', `Keep these screens?: ${said}, but it could not be cleared (${message(error)})`);
    }
  };
  const left = waiting.read();
  if (left.kind === 'none') return null;
  if (left.kind === 'unreadable') {
    deps.log(
      'warn',
      `Keep these screens?: a change left waiting cannot be read (${left.reason}); left for the next start`,
    );
    return null;
  }
  if (left.kind === 'damaged') {
    clear(
      'warn',
      `a change left waiting was not as this Drashti writes it (${left.reason}), so it was dropped`,
    );
    return null;
  }
  if (left.kind === 'answered') {
    clear('info', 'a change answered before Drashti stopped was still on disk; cleared');
    return null;
  }
  if (deps.otherLibrary) {
    clear('info', 'a change left waiting was made to the library before the restore, so it was dropped');
    return null;
  }
  try {
    deps.goBack(left.changes);
  } catch (error) {
    deps.log(
      'warn',
      `Keep these screens?: could not go back after Drashti stopped (${message(error)}); left for the next start`,
    );
    return COULD_NOT_GO_BACK;
  }
  clear(
    'warn',
    'Drashti stopped before a change was answered, so the screens went back to how they were before it',
  );
  return WENT_BACK_AFTER_STOP;
}
