import type { ElectronApplication } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accessComputer, computerIdOf } from '../../src/main/access/identity';
import { ACCESS_FILE, AccessStore, storedAccess } from '../../src/main/access/store';
import type { AccessComputer, AccessGrant } from '../../src/shared/access-protocol';
import {
  callBody,
  makeTestKeys,
  placeholderComputer,
  readAnswer,
  type AnswerPayload,
  type TestKeys,
} from '../access-core';
import { accessStandIn, type AccessStandIn } from '../access-standin';

/*
 * Every Drashti the end-to-end tests start is let in (Session 54, access by Gmail) through a stand-in access list of
 * its own on 127.0.0.1 (tests/access-standin.ts, the list's own rules), before it starts: its data folder is given
 * this computer's access as a used token leaves it, so it opens at once and every spec runs as before. A spec can
 * start one locked (the lock screen), as the owner (the Access List), or as another Gmail, and can move the list's
 * clock, read its mailbox, revoke a Gmail or make it stop answering. Drashti is pointed at the stand-in by test
 * switches a packaged Drashti never reads. Placeholder addresses only; the tokens and secrets are made at run time
 * and never printed.
 */

/** The person every test Drashti is let in as, unless a spec says otherwise. */
export const PLACEHOLDER_PERSON = 'placeholder.user@example.com';

/** How a Drashti starts: let in as the placeholder person (the default), as the owner, as another Gmail, or locked. */
export type AccessStart = 'person' | 'owner' | 'locked' | { gmail: string };

export interface AccessOptions {
  as?: AccessStart;
  /** The stand-in list to use (two Drashtis on one list); by default one of its own. */
  standIn?: AccessStandIn;
  /** This computer's pretend hardware id (a data folder copied to "another computer" starts with another). */
  hardwareId?: string;
  /** The version this Drashti says it is (a test's DRASHTI_TEST_VERSION); by default the app's own. */
  version?: string;
}

/** The version of the Drashti the tests start (an earlier build's, when DRASHTI_E2E_APP_DIR names one). */
function appVersion(): string {
  const dir = process.env['DRASHTI_E2E_APP_DIR'] ?? process.cwd();
  return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string }).version;
}

/** A data folder's list and computer, so a restart of it asks the same list as the same computer. */
interface Known {
  standIn: AccessStandIn;
  hardwareId: string;
}
const known = new Map<string, Known>();
/** Data folders whose stand-in was closed (an old one): started again, they are let in again on a new one. */
const forgotten = new Map<string, string>();
/** The stand-ins this process made, most recently used last: only the newest few are kept open. */
const made: AccessStandIn[] = [];
const KEEP_OPEN = 40;
/** One signing key for every stand-in this process makes (an RSA key takes a moment to make). */
let keys: TestKeys | null = null;

/** A stand-in list on 127.0.0.1, its clock running with this computer's from the list's own start date. */
export async function newStandIn(): Promise<AccessStandIn> {
  keys ??= makeTestKeys();
  const standIn = await accessStandIn({ keys });
  followTheClock(standIn);
  return standIn;
}

/** Each stand-in's clock, to hold still (holdListClock). */
const clocks = new WeakMap<AccessStandIn, { hold: () => void; release: () => void }>();

/**
 * The list's clock moves as this computer's does (moveListClock moves it further): a check every 15 s is 15 s after
 * the last to the list, as to Google's, so its one recorded check in 5 seconds is as it would be there. A test may
 * hold it still (holdListClock).
 */
function followTheClock(standIn: AccessStandIn): void {
  const list = standIn.list;
  const base = list.t;
  const started = Date.now();
  let moved = 0;
  let held: number | null = null;
  const running = () => base + (Date.now() - started) + moved;
  const now = () => held ?? running();
  Object.defineProperty(list, 't', {
    configurable: true,
    get: now,
    set: (value: number) => {
      if (held === null) moved += value - running();
      else held = value;
    },
  });
  clocks.set(standIn, {
    hold: () => {
      held = now();
    },
    release: () => {
      // It runs on from where it was held.
      if (held !== null) moved += held - running();
      held = null;
    },
  });
}

/**
 * Hold the list's clock still until the answer is called: every call reaches the list at the same moment, as checks
 * closer together than its 5 seconds do (a Drashti quit and started again at once). moveListClock still moves it.
 */
export function holdListClock(standIn: AccessStandIn): () => void {
  const clock = clocks.get(standIn);
  if (!clock) throw new Error('That stand-in was not made by newStandIn.');
  clock.hold();
  return () => {
    clock.release();
  };
}

/** The newest few stand-ins kept open; an older one is closed (a data folder that used it is let in again). */
async function remember(standIn: AccessStandIn): Promise<void> {
  const i = made.indexOf(standIn);
  if (i >= 0) made.splice(i, 1);
  made.push(standIn);
  while (made.length > KEEP_OPEN) {
    const old = made.shift();
    if (!old) break;
    for (const [folder, k] of known)
      if (k.standIn === old) {
        known.delete(folder);
        forgotten.set(folder, k.hardwareId);
      }
    await old.close();
  }
}

/** The Gmail a start lets in. */
const gmailFor = (as: Exclude<AccessStart, 'locked'>, standIn: AccessStandIn): string =>
  as === 'owner' ? standIn.approver : as === 'person' ? PLACEHOLDER_PERSON : as.gmail;

/**
 * Before Drashti starts on this data folder: its list and computer (the same as last time for a restart), and,
 * unless it is to start locked, this computer let in, as a used token leaves it. What it answers are the switches
 * that point Drashti at the stand-in.
 */
export async function letInBeforeStart(
  userData: string,
  o: AccessOptions = {},
): Promise<{ env: Record<string, string>; standIn: AccessStandIn; hardwareId: string }> {
  const had = known.get(userData);
  const wasForgotten = forgotten.get(userData);
  forgotten.delete(userData);
  const standIn = o.standIn ?? had?.standIn ?? (await newStandIn());
  const hardwareId =
    o.hardwareId ??
    had?.hardwareId ??
    wasForgotten ??
    `placeholder-hardware-${randomBytes(6).toString('hex')}`;
  known.set(userData, { standIn, hardwareId });
  if (!o.standIn) await remember(standIn);
  const as = o.as ?? 'person';
  // Let in when nothing is kept there yet, or when the list it was let in through has been closed. Anything else
  // kept there stays as it is: a data folder copied from "another computer" keeps that computer's access, which the
  // list refuses.
  // This computer as the Drashti about to start names itself to the list (its host name, version and system), so
  // the list keeps what a token used in that Drashti would have kept.
  const computer = accessComputer(computerIdOf(hardwareId), o.version ?? appVersion(), process.platform);
  if (as !== 'locked' && (wasForgotten !== undefined || !existsSync(join(userData, ACCESS_FILE))))
    letIn(userData, standIn, computer, gmailFor(as, standIn), as === 'owner');
  return {
    env: {
      DRASHTI_TEST_ACCESS_URL: standIn.url,
      DRASHTI_TEST_ACCESS_KEY: standIn.publicKey,
      DRASHTI_TEST_HARDWARE_ID: hardwareId,
      // The stand-in answers from this test's own process: a test busy in it for a while (a long synchronous
      // step) must never stop a Drashti it is not testing the stop of. 10 minutes, where the specs about the
      // stop give their own.
      DRASHTI_TEST_ACCESS_STOP_MS: String(10 * 60_000),
    },
    standIn,
    hardwareId,
  };
}

/** This computer let in for a Gmail, the real way (asked, approved, its token used), kept in the data folder. */
function letIn(
  userData: string,
  standIn: AccessStandIn,
  computer: AccessComputer,
  gmail: string,
  owner: boolean,
): AccessGrant {
  const grant = standIn.grant(gmail, computer);
  new AccessStore(userData).save(storedAccess({ grant, computerId: computer.id, owner, since: Date.now() }));
  return grant;
}

/** The switches for a data folder already started by launchApp, for a Drashti a test starts by itself (spawn). */
export function accessEnvOf(userData: string): Record<string, string> {
  const k = known.get(userData);
  if (!k) throw new Error('That data folder was never started by launchApp.');
  return {
    DRASHTI_TEST_ACCESS_URL: k.standIn.url,
    DRASHTI_TEST_ACCESS_KEY: k.standIn.publicKey,
    DRASHTI_TEST_HARDWARE_ID: k.hardwareId,
    DRASHTI_TEST_ACCESS_STOP_MS: String(10 * 60_000),
  };
}

/** The stand-in list a data folder's Drashti asks. */
export function standInOf(userData: string): AccessStandIn {
  const k = known.get(userData);
  if (!k) throw new Error('That data folder was never started by launchApp.');
  return k.standIn;
}

/** The pretend hardware id a data folder's Drashti runs on. */
export function hardwareIdOf(userData: string): string {
  const k = known.get(userData);
  if (!k) throw new Error('That data folder was never started by launchApp.');
  return k.hardwareId;
}

/** Move the list's clock on (a token or link running out). Drashti's own clock and its 2 minutes are untouched. */
export function moveListClock(standIn: AccessStandIn, ms: number): void {
  standIn.list.move(ms);
}

/** The list stops answering (as with no internet): every call waits for an answer that never comes. */
export function stopAnswering(standIn: AccessStandIn): void {
  standIn.mode = 'silent';
}

/** The list answers again. */
export function answerAgain(standIn: AccessStandIn): void {
  standIn.mode = 'answer';
}

/** The owner's own computer, for the owner's calls a test makes. */
const OWNER_COMPUTER = placeholderComputer('placeholder-owner-test-computer', 'Placeholder owner computer');
const ownerGrants = new WeakMap<AccessStandIn, AccessGrant>();

/** One of the owner's calls (revoke, reject, regrant, approve, add, note, length), as the Access List makes it. */
export function ownerCall(
  standIn: AccessStandIn,
  op: 'revoke' | 'reject' | 'regrant' | 'approve' | 'add' | 'note' | 'length',
  fields: Record<string, unknown>,
): AnswerPayload {
  let grant = ownerGrants.get(standIn);
  if (!grant) {
    grant = standIn.grant(standIn.approver, OWNER_COMPUTER);
    ownerGrants.set(standIn, grant);
  }
  const { body } = callBody(op, OWNER_COMPUTER, { at: Math.floor(standIn.list.t), ...fields }, grant);
  return readAnswer(standIn.list.handle(JSON.stringify(body)), standIn.publicKey);
}

/** The owner revokes a Gmail: every computer of it stops at its next check. */
export function revoke(standIn: AccessStandIn, gmail: string): void {
  const a = ownerCall(standIn, 'revoke', { target: gmail });
  if (!a.ok) throw new Error(`The stand-in could not revoke: ${String(a.error)}`);
}

/** A Gmail asked for and approved by the approver's link, from a placeholder computer of its own: its token. */
export function approvedToken(standIn: AccessStandIn, gmail: string): string {
  const asker = placeholderComputer(`placeholder-asker-${randomBytes(4).toString('hex')}`);
  const { body } = callBody('request', asker, { gmail });
  const asked = readAnswer(standIn.list.handle(JSON.stringify(body)), standIn.publicKey);
  if (!asked.ok) throw new Error(`The stand-in refused the request: ${String(asked.error)}`);
  const links = standIn.list.linksFor(gmail);
  if (!links) throw new Error('No Approve link was emailed');
  standIn.press(links.approve);
  const token = standIn.list.tokenFor(gmail);
  if (!token) throw new Error('No token was emailed');
  return token;
}

/** What a link's page says: its kind ('ready' with one button; 'done', 'used', 'forged', 'out-of-date'…) and title. */
export interface LinkSays {
  kind: string;
  title: string;
  button: boolean;
}

const linkSays = (html: string): LinkSays => ({
  kind: /data-kind="([^"]*)"/u.exec(html)?.[1] ?? '',
  title: /<h1>([^<]*)<\/h1>/u.exec(html)?.[1] ?? '',
  button: html.includes('<button'),
});

/** An Approve or Reject link opened, as the approver's browser opens it: nothing changes until its button. */
export async function openLink(link: string): Promise<LinkSays> {
  return linkSays(await (await fetch(link)).text());
}

/** The one button on a link's page pressed (its own page's form, as the approver's browser sends it). */
export async function pressLink(link: string): Promise<LinkSays> {
  const u = new URL(link);
  const form = new URL('/macros/s/stand-in/link', u.origin);
  const res = await fetch(form, { method: 'POST', body: new URLSearchParams(u.searchParams) });
  return linkSays(await res.text());
}

/** Whether a Drashti has closed (Quit on its lock or stop screen), as Playwright saw it, on Mac and Windows alike. */
export function closedWatch(app: ElectronApplication): { closed: () => boolean; whenClosed: Promise<void> } {
  let closed = false;
  const whenClosed = new Promise<void>((resolve) => {
    app.once('close', () => {
      closed = true;
      resolve();
    });
  });
  return { closed: () => closed, whenClosed };
}
