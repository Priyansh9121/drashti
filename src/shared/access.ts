import type { AccessRequestStatus } from './access-protocol';

/*
 * The lock and the stop as Drashti's windows show them (Session 54, access by Gmail, E2 and E3). The main
 * process decides everything (src/main/access/service.ts, gate.ts); a window only shows this view and asks the
 * main process to act, which checks every request again. The words a person reads are here, in one place.
 */

export type AccessPhase =
  /** At start, before the list has answered: nothing opens yet. */
  | 'checking'
  /** This computer is not let in: the lock screen (Request Access, or I Have a Token). */
  | 'locked'
  /** Let in, and the last check was answered. */
  | 'in'
  /** Let in, but the list has not answered for a while: the countdown to the stop runs. */
  | 'warning'
  /** Stopped: revoked, rejected, unknown, or 2 minutes with no answer. Only Quit works. */
  | 'stopped';

/** Why this computer is not let in, or why Drashti stopped. */
export type AccessReason =
  /** The list's answers: the Gmail was revoked or rejected, or the list does not know this computer. */
  | 'revoked'
  | 'rejected'
  | 'unknown'
  /** No answer from the list: at start (Try Again), or for 2 minutes while open (the stop). */
  | 'no-answer'
  /** The access kept in the data folder was made on another computer (a copied folder). */
  | 'copied'
  /** The access kept in the data folder could not be read. */
  | 'unreadable'
  /** This computer's own id could not be read. */
  | 'no-computer-id'
  /** This Drashti has no access list to ask (built without its address). */
  | 'no-list'
  /** A self-test (DRASHTI_SELFTEST): it never asks the list, and the controls stay locked. */
  | 'self-test';

/** What the lock screen is waiting for. */
export type AccessBusy = 'checking' | 'requesting' | 'asking' | 'redeeming';

/** What became of the request made from this computer. */
export interface AccessRequestView {
  gmail: string;
  status: AccessRequestStatus;
  /** Approved, and a token sent and not used yet. */
  tokenWaiting: boolean;
}

export interface AccessView {
  phase: AccessPhase;
  /** The Gmail let in (or asking), as it was typed; null before any. */
  gmail: string | null;
  /** This computer's Gmail is the owner's: only then the Access List. */
  owner: boolean;
  reason: AccessReason | null;
  /** While 'warning': how long until the stop, in ms, as of when this view was made. */
  stopsInMs: number | null;
  /** The request made from this computer, while it waits or was answered. */
  request: AccessRequestView | null;
  busy: AccessBusy | null;
  /** What the last thing tried came to, in words; `field` is the field it is about. */
  message: {
    tone: 'info' | 'success' | 'warning' | 'danger';
    text: string;
    field?: 'gmail' | 'token';
  } | null;
  /** Whether Try Again can ask the list again (access is kept here). */
  canRetry: boolean;
  /** This Drashti's version, for the lock screen's foot. */
  version: string;
}

/** How long the screens take to fade to black when Drashti stops (render/StopFade.tsx draws it). */
export const STOP_FADE_MS = 1000;

/** The stop's one plain message (the brief's own words), for revoked, rejected and unknown alike. */
export const ACCESS_REMOVED_TEXT = 'Your access to Drashti has been removed';

/** Why it stopped, under that message. */
export const STOP_REASON_TEXT: Partial<Record<AccessReason, string>> = {
  revoked: 'The person who approves access has removed it.',
  rejected: 'The request for this Gmail was rejected.',
  unknown: 'This computer is no longer on the access list.',
};

/** The stop after 2 minutes with no answer. */
export const NO_ANSWER_STOP_TITLE = 'Drashti stopped: no internet';
export const NO_ANSWER_STOP_TEXT =
  'Drashti could not check your access for 2 minutes, so everything has stopped. Quit, check the internet connection, then start Drashti again.';

/** What has stopped, said on the stop screen. */
export const STOPPED_WHAT_TEXT =
  'The screens, the stream and recording, the nodes and the phones have all stopped. Only Quit works.';

/** m:ss, for the countdown (never below 0:00). */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** The countdown while the list does not answer (the brief's own words). */
export const countdownLine = (ms: number): string =>
  `No internet: Drashti stops in ${countdownText(ms)} unless it can check your access`;

/** What the lock screen says for each reason Drashti is not let in. */
export const LOCK_REASON_TEXT: Record<AccessReason, string> = {
  revoked:
    'Your access to Drashti has been removed. To use it again, ask for access, or ask the person who approves access to give it again.',
  rejected: 'Your request for access was not approved.',
  unknown: 'This computer is not on the access list. Ask for access with your Gmail.',
  'no-answer':
    'No internet: Drashti cannot check your access, so it does not open. Check the connection, then Try Again.',
  copied:
    'This data folder was let in on another computer. Each computer needs its own access: ask for access with your Gmail.',
  unreadable:
    'Drashti could not read this computer’s access in its data folder. Let this computer in again with a new token.',
  'no-computer-id':
    'Drashti could not tell which computer this is, so it cannot be let in here. Restart the computer, then start Drashti again.',
  'no-list':
    'This copy of Drashti was made without its access list, so it cannot be let in. Install Drashti from its own download.',
  'self-test': 'Drashti is running a self-test with placeholder content. Its controls stay locked.',
};

/** Refused while Drashti is stopped or not let in: what a window's request, a phone or a node hears. */
export const STOPPED_REFUSAL =
  'Drashti has stopped: its access was removed or could not be checked. Nothing works until it is let in again.';

/** A phone's page while Drashti is stopped. */
export const PHONE_STOPPED_TITLE = 'Drashti has stopped';
export const PHONE_STOPPED_TEXT =
  'Drashti stopped on the computer it runs on: its access was removed, or it could not check it. Nothing here works until Drashti is started again there and let in.';
