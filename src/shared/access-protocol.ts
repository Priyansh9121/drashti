/*
 * Access by Gmail (Session 54, E1): what Drashti says to the access list in the owner's Google account (a
 * Google Sheet with an Apps Script web app, access-list/ in the repository) and what the list answers, with
 * the numbers both sides keep to. The list cannot import this file (Apps Script has no modules), so
 * access-list/core.js keeps its own copy of every number and of canonicalJson and gmailKey;
 * src/main/access/list-core.test.ts checks that the two agree. access-list/PROTOCOL.md says it all in words.
 *
 * Every call is an HTTPS POST of JSON text: { v: 1, op, nonce, computer, … }. Every answer is
 * { payload, sig }: the payload is JSON text, signed (RSA-SHA-256, PKCS#1 v1.5) with the list's own key,
 * whose public half is built into Drashti (src/shared/access-config.ts). Drashti believes an answer only
 * when the signature is right and the payload echoes the call's op, nonce and computer id, so a fake
 * server, an old answer or another computer's answer is never believed.
 */

/** The protocol's version: every call carries it, every answer echoes it. */
export const ACCESS_VERSION = 1;

/** Drashti checks its access this often while it is open. */
export const ACCESS_CHECK_EVERY_MS = 15_000;
/** With no answer for this long, Drashti stops (a countdown first). */
export const ACCESS_STOP_AFTER_MS = 2 * 60_000;
/** A token that is not used runs out this long after it is sent: 3 days. */
export const ACCESS_TOKEN_MS = 3 * 24 * 60 * 60_000;
/** An Approve or Reject link runs out this long after the request: 7 days. */
export const ACCESS_LINK_MS = 7 * 24 * 60 * 60_000;

/** The list's limits (named in docs/access-setup.md). */
export const ACCESS_LIMITS = {
  /** Requests a day for one Gmail, from one computer, and in all (each emails the approver). */
  requestsPerGmailPerDay: 3,
  requestsPerComputerPerDay: 10,
  requestsPerDay: 50,
  /** Tries of a token an hour, for one Gmail and from one computer. */
  redeemsPerGmailPerHour: 10,
  redeemsPerComputerPerHour: 10,
  /** A computer's checks closer together than this are all answered; only one counts (is recorded). */
  checkGapMs: 5_000,
  /** A computer's last seen, version and activity are written at most this often. */
  recordGapMs: 60_000,
  /** The list answers checks from what it read of its Sheet at most this long ago. */
  cacheMs: 10_000,
} as const;

/** Any Drashti may make these. */
export const ACCESS_PUBLIC_OPS = ['request', 'status', 'redeem', 'check'] as const;
/** Only the owner's computer (its Gmail is the approver's), signed as a check is. */
export const ACCESS_OWNER_OPS = ['list', 'add', 'approve', 'reject', 'revoke', 'regrant', 'note'] as const;
export type AccessPublicOp = (typeof ACCESS_PUBLIC_OPS)[number];
export type AccessOwnerOp = (typeof ACCESS_OWNER_OPS)[number];
export type AccessOp = AccessPublicOp | AccessOwnerOp;

/** A Gmail's row in the Sheet. */
export const ACCESS_STATUSES = ['requested', 'approved', 'rejected', 'revoked'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];
/** What a check answers: let in, or why not. */
export const ACCESS_CHECK_STATUSES = ['in', 'revoked', 'rejected', 'unknown'] as const;
export type AccessCheckStatus = (typeof ACCESS_CHECK_STATUSES)[number];
/** What became of this computer's request. */
export const ACCESS_REQUEST_STATUSES = ['requested', 'approved', 'rejected', 'revoked', 'unknown'] as const;
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

/** Every refusal the list answers, signed like any answer. */
export const ACCESS_ERRORS = [
  'bad-request',
  'bad-gmail',
  'too-many',
  'busy',
  'not-set-up',
  'already-approved',
  'bad-token',
  'not-owner',
  'owner-row',
  'not-found',
  'wrong-status',
  'mail-limit',
  'mail-failed',
  'server',
] as const;
export type AccessErrorCode = (typeof ACCESS_ERRORS)[number];

/** What a person is told for each refusal (Drashti's own words; the list sends a message too). */
export const ACCESS_ERROR_TEXT: Record<AccessErrorCode, string> = {
  'bad-request': 'Drashti and the access list did not understand each other. Update Drashti, then try again.',
  'bad-gmail': 'That does not look like a Gmail address. Check it, then try again.',
  'too-many': 'Too many tries for now. Wait a while, then try again.',
  busy: 'The access list is busy. Try again in a moment.',
  'not-set-up': 'The access list is not set up yet. Ask the person who approves access.',
  'already-approved':
    'This Gmail is already approved. Use I Have a Token with the token from your email; for another computer, or if the token ran out, ask the person who approves access to give access again.',
  'bad-token':
    'That token does not work. A token works once, only with the Gmail it was sent to, and runs out after 3 days.',
  'not-owner': 'Only the owner’s computer can do that.',
  'owner-row':
    'That is the owner’s own Gmail: it is never asked for, rejected or revoked. The owner lets a computer in from the access list’s Sheet: Drashti › Let me in (the owner)…, then I Have a Token.',
  'not-found': 'That Gmail is not on the access list.',
  'wrong-status': 'That cannot be done to this Gmail as it is now.',
  'mail-limit': 'The access list has sent all the emails it may send today. Try again tomorrow.',
  'mail-failed': 'The access list could not send the email. Try again later.',
  server: 'The access list could not answer just now. Try again in a moment.',
};

/** A computer as each call names it. `id` is the computer id (src/main/access/identity.ts). */
export interface AccessComputer {
  /** SHA-256 (hex) of "drashti-access:" and this computer's own hardware id. */
  id: string;
  name: string;
  version: string;
  platform: string;
}

/** What a computer has done since its token was used: totals, never content, never a file name or a word. */
export interface AccessActivity {
  minutes: number;
  shows: number;
  streams: number;
  recordings: number;
  imports: number;
}

export const NO_ACTIVITY: AccessActivity = { minutes: 0, shows: 0, streams: 0, recordings: 0, imports: 0 };

/** One computer's way in, given once when its token is used. */
export interface AccessGrant {
  gmail: string;
  grantId: string;
  /** HMAC-SHA-256 (hex) the list worked out for this grant and computer: it signs each check. */
  secret: string;
}

/** One Gmail as the owner's list answers it. Dates are ms since 1970, or null. */
export interface AccessPerson {
  gmail: string;
  name: string;
  status: string;
  owner: boolean;
  requestedAt: number | null;
  approvedAt: number | null;
  rejectedAt: number | null;
  revokedAt: number | null;
  lastSeen: number | null;
  version: string;
  minutes: number;
  shows: number;
  streams: number;
  recordings: number;
  imports: number;
  note: string;
  computers: {
    name: string;
    version: string;
    platform: string;
    lastSeen: number | null;
    usedAt: number | null;
    ended: boolean;
    endedWhy: string;
  }[];
  /** A token sent and not used yet, and when it runs out. */
  token: { sentAt: number; runsOut: number } | null;
  /** A request not answered yet: from which computer, and when. */
  request: { computer: string; at: number | null } | null;
}

/** What a signed call's mac is made over: this, then the call's canonical JSON without its mac. */
export const ACCESS_MAC_PREFIX = 'drashti-access-v1\n';

/**
 * JSON with every object's keys in order and every character past ASCII written as \uXXXX, so both sides
 * make the same text from the same call and a mac over it agrees: Drashti here, the list in core.js. Keys
 * whose value is undefined are left out, as JSON.stringify leaves them out.
 */
export function canonicalJson(value: unknown): string {
  return asciiOnly(canonical(value));
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value))
    return `[${value.map((v: unknown) => (v === undefined ? 'null' : canonical(v))).join(',')}]`;
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('A number in a call must be finite.');
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object': {
      const o = value as Record<string, unknown>;
      const keys = Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
    }
    default:
      throw new Error('A call holds only text, numbers, true or false, null, lists and objects.');
  }
}

/**
 * Every UTF-16 unit past ASCII as \uXXXX (no `u` flag on purpose: a letter outside the BMP becomes its two
 * surrogates, as JSON writes them). The text is then the same bytes in any character set.
 */
export const asciiOnly = (text: string): string =>
  text.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * The one form of a Gmail the list matches on: trimmed and lower case; for gmail.com and googlemail.com,
 * the dots and anything after a "+" in the name dropped (one mailbox, one row). Empty when it is not an
 * address. The address as typed is kept for showing and for email.
 */
export function gmailKey(address: string): string {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 1 || at === a.length - 1) return '';
  let local = a.slice(0, at);
  let domain = a.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = (local.split('+')[0] ?? '').replace(/\./gu, '');
  return local === '' ? '' : `${local}@${domain}`;
}

/** An address the list takes: plain ASCII, one @, a dot in the domain, at most 254 characters. */
export const GMAIL_SHAPE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/u;

export function gmailShaped(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a.length <= 254 && GMAIL_SHAPE.test(a) && gmailKey(a) !== '';
}

/**
 * Tokens: Crockford's base32 (the digits, and the capitals without I, L, O or U), 28 letters (140 random
 * bits), shown in groups of four. Written in two parts, so no secret scanner reads the letters as a secret.
 */
export const ACCESS_TOKEN_ALPHABET = '0123456789' + 'ABCDEFGHJKMNPQRSTVWXYZ';
export const ACCESS_TOKEN_LENGTH = 28;

/**
 * A token as typed, in the one form the list hashes: capitals, without spaces or dashes, O read as 0 and
 * I or L as 1. Null when it cannot be one.
 */
export function normaliseToken(typed: string): string | null {
  const t = typed.toUpperCase().replace(/[\s-]/gu, '').replace(/O/gu, '0').replace(/[IL]/gu, '1');
  // The alphabet's own letters: 0-9 and A-Z without I, L, O and U.
  return t.length === ACCESS_TOKEN_LENGTH && /^[0-9A-HJKMNP-TV-Z]+$/u.test(t) ? t : null;
}

/** A token in groups of four, as its email shows it: ABCD-EFGH-…. */
export const formatToken = (token: string): string => (token.match(/.{1,4}/gu) ?? []).join('-');
