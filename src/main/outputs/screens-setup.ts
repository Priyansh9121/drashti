import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { z } from 'zod';
import type { GroupLook } from '../../shared/looks';
import { readGroupLook, storedGroupLook } from '../../shared/looks';
import { idSchema } from '../../shared/model-schema';
import type { ScreenRole } from '../../shared/screens';
import { SCALING_MODES } from '../../shared/screens';
import type { SavedGroup, SavedScreen, SavedScreens } from '../db/screens';

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

const ROLES = ['audience', 'stage', 'stream', 'keyfill', 'other'] as const satisfies readonly ScreenRole[];

/** A setup as written: a Look's settings as the library stores them (only what differs from the defaults). */
const setupSchema = z.object({
  groups: z
    .array(z.object({ id: idSchema, name: z.string().max(500), role: z.enum(ROLES), position: z.number() }))
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
const waitingSchema = z.object({
  version: z.literal(1),
  changes: z
    .array(z.object({ before: setupSchema, after: setupSchema }))
    .min(1)
    .max(1000),
});

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

/**
 * Keep the changes waiting on disk until they are answered (null: answered, or gone back: removed). Written whole
 * to a file of its own and on the disk itself before it is renamed into place, so a power cut leaves it whole or
 * not at all. Throws when it cannot (the question goes on all the same: keep-screens.ts).
 */
export function keepWaiting(file: string, changes: readonly ScreensChange[] | null): void {
  if (changes === null) {
    rmSync(file, { force: true });
    return;
  }
  const partial = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(partial, 'w');
    try {
      writeSync(
        fd,
        JSON.stringify({
          version: 1,
          changes: changes.map((c) => ({ before: written(c.before), after: written(c.after) })),
        }),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, file);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
}

/**
 * The changes the last run left waiting (it stopped before an answer: a crash, a power cut), taken off the disk:
 * null when none, or when what is there cannot be read (it is cleared all the same). Never throws: a start goes on
 * whatever is there.
 */
export function takeWaiting(file: string): ScreensChange[] | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // Read again at the next start: going back a second time changes nothing.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const waiting = waitingSchema.safeParse(parsed);
  return waiting.success
    ? waiting.data.changes.map((c) => ({ before: read(c.before), after: read(c.after) }))
    : null;
}
