import { basename } from 'node:path';
import {
  ACCESS_LIST_REFRESH_MS,
  ACCESS_NAME_MAX,
  ACCESS_NOTE_MAX,
  accessListCsv,
  EDIT_NO_ANSWER_TEXT,
  formatDay,
  NO_ANSWER_TEXT,
  NO_VIEW,
  ownerErrorText,
  type AccessListAdd,
  type AccessListResult,
  type AccessListSaved,
  type AccessListView,
} from '../../shared/access-list';
import {
  ACCESS_ERROR_TEXT,
  gmailKey,
  gmailShaped,
  type AccessErrorCode,
  type AccessGrant,
  type AccessPerson,
} from '../../shared/access-protocol';
import { cutText, plural } from '../../shared/text';
import { fileProblem } from '../plain-errors';
import type { AccessClient } from './client';

/*
 * View › Access List… (Session 54, E4), its main-process side: the owner's own window onto the access list in
 * their Google account. Only while this computer is the owner's, let in (gate.ts's isOwner), is the list asked
 * or changed, each time as the owner's signed call (access-list/PROTOCOL.md, "The owner's calls"); anyone else
 * is refused here, before anything is sent, and by the list itself. While the window is open the list is asked
 * again a few seconds after each answer, so a change made anywhere (another Drashti's request, an Approve link,
 * a status typed into the Sheet) shows within seconds; after each edit, at once. Revoke and Reject never reach
 * the owner's own row: refused here, and by the list. The CSV is made here, from the list's own answer, of the
 * rows the window shows. The log never names a Gmail.
 */

/** What an owner's call comes back with: client.ts's AccessResult, as far as the Access List needs it. */
export type OwnerResult<T> =
  | { ok: true; value: T }
  /** The list answered, signed, and refused. */
  | { ok: false; kind: 'refused'; error: AccessErrorCode; message: string }
  /** Nothing believable came back. */
  | { ok: false; kind: 'no-answer'; detail: string };

/** The owner's calls, each signed with this computer's grant: what the Access List asks the list. */
export interface OwnerCalls {
  list: () => Promise<OwnerResult<{ people: AccessPerson[] }>>;
  add: (target: string, o: { name?: string; note?: string }) => Promise<OwnerResult<{ mailed: boolean }>>;
  approve: (target: string) => Promise<OwnerResult<{ runsOut: number }>>;
  regrant: (target: string) => Promise<OwnerResult<{ runsOut: number }>>;
  reject: (target: string) => Promise<OwnerResult<{ mailed: boolean }>>;
  revoke: (target: string) => Promise<OwnerResult<unknown>>;
  note: (target: string, note: string) => Promise<OwnerResult<unknown>>;
}

/**
 * The owner's calls through Drashti's client (client.ts), signed with the grant kept now. The client is asked
 * for as each call is made (it is made the first time, once this computer's id is known); with none, or no
 * grant kept, nothing is sent.
 */
export function ownerCalls(
  client: () => Promise<AccessClient | null>,
  grant: () => AccessGrant | null,
): OwnerCalls {
  const signed = async <T>(
    call: (c: AccessClient, g: AccessGrant) => Promise<OwnerResult<T>>,
  ): Promise<OwnerResult<T>> => {
    const g = grant();
    if (!g)
      return { ok: false, kind: 'refused', error: 'not-owner', message: ACCESS_ERROR_TEXT['not-owner'] };
    const c = await client();
    return c
      ? call(c, g)
      : { ok: false, kind: 'no-answer', detail: 'no way to ask the list on this computer' };
  };
  return {
    list: () => signed((c, g) => c.list(g)),
    add: (target, o) => signed((c, g) => c.add(g, target, o)),
    approve: (target) => signed((c, g) => c.approve(g, target)),
    regrant: (target) => signed((c, g) => c.regrant(g, target)),
    reject: (target) => signed((c, g) => c.reject(g, target)),
    revoke: (target) => signed((c, g) => c.revoke(g, target)),
    note: (target, note) => signed((c, g) => c.note(g, target, note)),
  };
}

export interface AccessListDeps {
  /** The owner's calls now; null while this computer is not the owner's, let in. */
  calls(): OwnerCalls | null;
  /** This computer is the owner's, let in (gate.ts). */
  isOwner(): boolean;
  /** The owner's own Gmail, as this computer was let in with it (null when not the owner's). */
  ownerGmail(): string | null;
  /** The window's view changed: tell it. */
  changed(view: AccessListView): void;
  /** This computer's clock (ms): when the list last answered. */
  now(): number;
  /** Where to save the CSV, asked of the owner (null: cancelled). */
  saveAs(defaultName: string): Promise<string | null>;
  /** Write the file the owner chose. */
  write(path: string, text: string): void;
  log(line: string): void;
}

/** What an edit came to: done or not, in words, and why not (for the log: a refusal's code, never a Gmail). */
interface Outcome {
  ok: boolean;
  message: string;
  why: string;
}

/**
 * A call's answer as an edit's outcome: its words when done; the list's refusal (in the edit's own words where
 * it has some) or no answer, in words.
 */
function outcome<T>(
  result: OwnerResult<T>,
  done: (value: T) => string,
  refused: Partial<Record<AccessErrorCode, string>> = {},
): Outcome {
  if (result.ok) return { ok: true, message: done(result.value), why: '' };
  return result.kind === 'refused'
    ? { ok: false, message: refused[result.error] ?? ownerErrorText(result.error), why: result.error }
    : { ok: false, message: EDIT_NO_ANSWER_TEXT, why: 'no answer' };
}

const tokenWords = (runsOut: number) =>
  `their token is on its way by email, and runs out on ${formatDay(runsOut)} if it is not used.`;

const notOwner = (): string => ACCESS_ERROR_TEXT['not-owner'];

/** Words a person typed, as the list keeps them: one line, trimmed, cut at the list's length. */
const typed = (text: string, max: number): string => cutText(text.replace(/\s+/gu, ' ').trim(), max);

/** A day for a file's name: "2026-10-27". */
function dayStamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export class AccessList {
  private people: AccessPerson[] | null = null;
  private updatedAt: number | null = null;
  private problem: string | null = null;
  /** The list being asked now, shared by everyone who asks meanwhile. */
  private asking: Promise<AccessListView> | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** The window is open: the list is asked again after each answer. */
  private open = false;

  constructor(private readonly deps: AccessListDeps) {}

  /** What the window shows: nothing at all while this computer is not the owner's, let in. */
  view(): AccessListView {
    if (!this.deps.isOwner()) return NO_VIEW;
    return { people: this.people, updatedAt: this.updatedAt, problem: this.problem };
  }

  /** The window opened: ask the list now, and again a few seconds after each answer. */
  start(): void {
    this.open = true;
    void this.refresh();
  }

  /** The window closed: ask no more. What the list said is kept for the window's next opening. */
  stop(): void {
    this.open = false;
    this.clearTimer();
  }

  /** This computer's access changed: once it is no longer the owner's, the list is forgotten at once. */
  accessChanged(): void {
    if (this.deps.isOwner()) return;
    this.stop();
    if (this.people === null && this.updatedAt === null && this.problem === null) return;
    this.people = null;
    this.updatedAt = null;
    this.problem = null;
    this.deps.changed(this.view());
  }

  /** Ask the list now (or wait for the asking already under way). */
  refresh(): Promise<AccessListView> {
    this.asking ??= this.ask().finally(() => {
      this.asking = null;
      this.schedule();
    });
    return this.asking;
  }

  /** A Gmail added, as requested (the request emailed to the owner), and approved at once when asked. */
  async add(fields: AccessListAdd): Promise<AccessListResult> {
    const gmail = fields.gmail.trim();
    const refusal = this.refusal(gmail, false);
    if (refusal) return refusal;
    const name = typed(fields.name, ACCESS_NAME_MAX);
    const note = typed(fields.note, ACCESS_NOTE_MAX);
    return this.edit('added a Gmail', async (calls) => {
      const added = await calls.add(gmail, { ...(name ? { name } : {}), ...(note ? { note } : {}) });
      if (!added.ok || !fields.approve)
        return outcome(
          added,
          (v) =>
            v.mailed
              ? `Added ${gmail} as requested: approve it here, or with the Approve link the list has emailed you.`
              : `Added ${gmail} as requested. The access list could not email you its links today: approve it here.`,
          {
            'already-approved':
              'That Gmail is on the list and approved already: choose it in the list to give access again.',
          },
        );
      const approved = await calls.approve(gmail);
      if (approved.ok)
        return {
          ok: true,
          message: `Added and approved ${gmail}: ${tokenWords(approved.value.runsOut)}`,
          why: '',
        };
      const not = outcome(approved, () => '');
      return { ...not, message: `Added ${gmail} as requested, but it is not approved yet. ${not.message}` };
    });
  }

  approve(target: string): Promise<AccessListResult> {
    return this.one('approved a Gmail', target, false, (calls, gmail, shown) =>
      calls.approve(gmail).then((r) => outcome(r, (v) => `Approved ${shown}: ${tokenWords(v.runsOut)}`)),
    );
  }

  /** Give access again: a new token by email, for one more computer (after a revoke, approved again). */
  regrant(target: string): Promise<AccessListResult> {
    return this.one('gave a Gmail access again', target, false, (calls, gmail, shown) =>
      calls
        .regrant(gmail)
        .then((r) =>
          outcome(
            r,
            (v) =>
              `A new token is on its way to ${shown} by email. It runs out on ${formatDay(v.runsOut)} if it is not used; a token sent before and not used no longer works.`,
          ),
        ),
    );
  }

  reject(target: string): Promise<AccessListResult> {
    return this.one('rejected a Gmail', target, true, (calls, gmail, shown) =>
      calls
        .reject(gmail)
        .then((r) =>
          outcome(r, (v) =>
            v.mailed
              ? `Rejected ${shown}: they have been told by email.`
              : `Rejected ${shown}. The access list could not email them today: tell them yourself.`,
          ),
        ),
    );
  }

  /** Every computer of that Gmail stops at its next check (the window asks first). */
  revoke(target: string): Promise<AccessListResult> {
    return this.one('revoked a Gmail', target, true, (calls, gmail, shown) =>
      calls
        .revoke(gmail)
        .then((r) =>
          outcome(
            r,
            () =>
              `Revoked ${shown}: their Drashti stops at its next check, within 15 seconds, screens and stream included.`,
          ),
        ),
    );
  }

  note(target: string, note: string): Promise<AccessListResult> {
    const text = typed(note, ACCESS_NOTE_MAX);
    return this.one('changed a note', target, false, (calls, gmail, shown) =>
      calls
        .note(gmail, text)
        .then((r) =>
          outcome(r, () =>
            text === '' ? `The note for ${shown} is cleared.` : `The note for ${shown} is saved.`,
          ),
        ),
    );
  }

  /**
   * The CSV of the rows the window shows, in its order (by their Gmails): made here, from the list's own last
   * answer, so it holds only the list's columns. Saved where the owner chooses.
   */
  async exportCsv(gmails: readonly string[]): Promise<AccessListSaved> {
    if (!this.deps.isOwner()) return { ok: false, message: notOwner() };
    if (this.people === null)
      return { ok: false, message: 'The list has not come yet: wait for it, then save it again.' };
    const byKey = new Map(this.people.map((p) => [gmailKey(p.gmail), p]));
    const rows = gmails.flatMap((g) => byKey.get(gmailKey(g)) ?? []);
    if (rows.length === 0) return { ok: false, message: 'No Gmail is shown: show some, then save them.' };
    const path = await this.deps.saveAs(`Drashti access list ${dayStamp(this.deps.now())}.csv`);
    if (path === null) return { ok: false, message: null };
    try {
      this.deps.write(path, accessListCsv(rows));
    } catch (error) {
      this.deps.log(`Access List: the CSV could not be saved (${String(error)})`);
      return { ok: false, message: fileProblem(error) };
    }
    this.deps.log(`Access List: saved a CSV of ${plural(rows.length, 'Gmail')}`);
    return { ok: true, message: `Saved ${plural(rows.length, 'Gmail')} to ${basename(path)}.` };
  }

  // ---- inside ----

  private async ask(): Promise<AccessListView> {
    this.clearTimer();
    const calls = this.deps.isOwner() ? this.deps.calls() : null;
    if (!calls) return { ...NO_VIEW, problem: notOwner() };
    const answer = await calls.list();
    // The owner's access may have ended meanwhile: what came is not kept.
    if (!this.deps.isOwner()) return { ...NO_VIEW, problem: notOwner() };
    const was = this.problem;
    if (answer.ok) {
      this.people = answer.value.people;
      this.updatedAt = this.deps.now();
      this.problem = null;
      if (was !== null) this.deps.log('Access List: the list answered again');
    } else {
      this.problem = answer.kind === 'refused' ? ownerErrorText(answer.error) : NO_ANSWER_TEXT;
      if (was === null)
        this.deps.log(
          `Access List: the list could not be asked (${answer.kind === 'refused' ? answer.error : answer.detail}); asking again every few seconds`,
        );
    }
    this.deps.changed(this.view());
    return this.view();
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.open || !this.deps.isOwner()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, ACCESS_LIST_REFRESH_MS);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Why an edit of this Gmail is refused before anything is sent, or null. */
  private refusal(gmail: string, endsAccess: boolean): AccessListResult | null {
    const no = (message: string): AccessListResult => ({ ok: false, message, view: this.view() });
    if (!this.deps.isOwner() || !this.deps.calls()) return no(notOwner());
    if (!gmailShaped(gmail)) return no('That does not look like an email address: check it, then try again.');
    if (endsAccess && this.ownersOwn(gmail)) return no(ACCESS_ERROR_TEXT['owner-row']);
    return null;
  }

  /** The owner's own Gmail (as this computer was let in with it, or as the list marks its row). */
  private ownersOwn(gmail: string): boolean {
    const key = gmailKey(gmail);
    const own = this.deps.ownerGmail();
    if (own !== null && gmailKey(own) === key) return true;
    return this.people?.some((p) => p.owner && gmailKey(p.gmail) === key) ?? false;
  }

  /** An edit of one Gmail: refused here first when it must be, then its call, with the Gmail as the list shows it. */
  private one(
    what: string,
    target: string,
    endsAccess: boolean,
    run: (calls: OwnerCalls, gmail: string, shown: string) => Promise<Outcome>,
  ): Promise<AccessListResult> {
    const gmail = target.trim();
    const refusal = this.refusal(gmail, endsAccess);
    if (refusal) return Promise.resolve(refusal);
    const key = gmailKey(gmail);
    const shown = this.people?.find((p) => gmailKey(p.gmail) === key)?.gmail ?? gmail;
    return this.edit(what, (calls) => run(calls, gmail, shown));
  }

  /** An edit: its call (or calls), then the list asked again at once; what happened, in words. */
  private async edit(what: string, run: (calls: OwnerCalls) => Promise<Outcome>): Promise<AccessListResult> {
    const calls = this.deps.calls();
    if (!calls) return { ok: false, message: notOwner(), view: this.view() };
    const done = await run(calls);
    this.deps.log(`Access List: ${what}${done.ok ? '' : `: not done (${done.why})`}`);
    // Asked after the edit: an asking already under way may have read the list before it.
    if (this.asking) await this.asking.catch(() => undefined);
    const view = await this.refresh();
    return { ok: done.ok, message: done.message, view };
  }
}
