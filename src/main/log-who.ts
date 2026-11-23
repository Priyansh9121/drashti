import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ACCESS_TOKEN_ALPHABET } from '../shared/access-protocol';

/*
 * Who wrote a log or a diagnostics file (alpha.21, logs for 100+ installs (b), the owner's "Yes, that plan"): with
 * more than 100 computers, each file names its computer, its entry on the access list and its role, this install's
 * own id, the version and the system. Never a Gmail address, a token, a key or a secret: the access list's ids are
 * given by their first letters only, enough to find the row.
 */

/** This install's id is kept here, in the data folder (never in the library, so a restore elsewhere never brings it). */
export const INSTALL_ID_FILE = 'install-id.json';
const ID = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u;
const keptSchema = z.object({ id: z.string().regex(ID), made: z.string().max(40) });

/** A new id: 12 of Crockford's base32 letters (60 bits), in threes of four: "7K3P-Q2XM-4H9A". */
function newId(): string {
  const letters = Array.from({ length: 12 }, () => ACCESS_TOKEN_ALPHABET.charAt(randomInt(32)));
  return `${letters.slice(0, 4).join('')}-${letters.slice(4, 8).join('')}-${letters.slice(8).join('')}`;
}

/**
 * This install's own id: read from the data folder, or made once and kept there (a damaged file is replaced). When it
 * cannot be kept, an id for this run is still given, and `kept` says so.
 */
export function installId(dir: string, now: () => Date = () => new Date()): { id: string; kept: boolean } {
  const file = join(dir, INSTALL_ID_FILE);
  try {
    const read = keptSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (read.success) return { id: read.data.id, kept: true };
  } catch {
    // None yet, or damaged: a new one.
  }
  const id = newId();
  try {
    mkdirSync(dir, { recursive: true });
    const part = `${file}.part`;
    writeFileSync(part, `${JSON.stringify({ id, made: now().toISOString() })}\n`, 'utf8');
    renameSync(part, file);
    return { id, kept: true };
  } catch {
    return { id, kept: false };
  }
}

/** Who and what wrote a diagnostics file: never a Gmail address or a private value. */
export interface DiagnosticsWho {
  /** This computer's name, as the Access List shows it. */
  computer: string;
  /** The access list's id of this computer (its Computer id column), or null when it has none. */
  computerId: string | null;
  /** This install's own id (install-id.json). */
  installId: string;
  /** The access list's entry this computer is let in by (its Grant column), or null when there is none. */
  grantId: string | null;
  /** How the list lets this computer in (Pro or Simple, and whether it is the owner's), or null when not let in. */
  role: { mode: 'pro' | 'simple'; owner: boolean } | null;
  /** Where the file was made: Pro Mode, Simple Mode, or a node. */
  made: 'pro' | 'simple' | 'node';
  /** On a node: the Main it follows, by name, or null. */
  main?: string | null;
  /** The log's chosen period, in words ("Today, 2026-11-23"; log-period.ts's periodText). */
  period: string;
}

/** The first letters of an id, enough to find its row: never the whole of it. */
export const idStart = (id: string, letters: number): string =>
  id.length > letters ? `${id.slice(0, letters)}…` : id;

/** This computer's time zone: its name and its offset now, "Australia/Sydney (UTC+11:00)". */
export function timeZoneText(now: Date): string {
  const minutes = -now.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const offset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  let name = '';
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // No name: the offset alone.
  }
  return name ? `${name} (${offset})` : offset;
}

/**
 * The who-and-what lines (each "Name: value", the names fixed: a program may read them): Computer, Computer id,
 * Install id, Access-list entry, Role, Made in, Time zone, Log.
 */
export function whoLines(who: DiagnosticsWho, now: Date): string[] {
  const role = who.role
    ? `${who.role.mode === 'simple' ? 'Simple' : 'Pro'}${who.role.owner ? ', the owner' : ''}`
    : who.made === 'node'
      ? 'a node (it has no entry of its own: Main is let in)'
      : 'not let in';
  let entry: string;
  if (who.grantId) entry = `grant ${idStart(who.grantId, 8)} (the Computers tab’s Grant column starts so)`;
  else if (who.made === 'node')
    entry = who.main ? `none: a node, following Main “${who.main}”` : 'none: a node, not paired';
  else entry = 'none: not let in';
  return [
    `Computer: ${who.computer}`,
    `Computer id: ${who.computerId ? `${idStart(who.computerId, 12)} (the Computers tab’s Computer id column starts so)` : 'none'}`,
    `Install id: ${who.installId}`,
    `Access-list entry: ${entry}`,
    `Role: ${role}`,
    `Made in: ${who.made === 'node' ? 'the node' : who.made === 'simple' ? 'Simple Mode' : 'Pro Mode'}`,
    `Time zone: ${timeZoneText(now)}`,
    `Log: ${who.period}`,
  ];
}
