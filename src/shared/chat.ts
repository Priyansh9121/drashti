import { z } from 'zod';
import { ANNOUNCEMENT_FROM_MAX } from './announcements';
import { cleanNameSchema } from './rename-name';

/*
 * The chat (alpha.23, QA23-CHAT-1): one group per Drashti computer, for the people whose phones are paired with it,
 * on the local Wi-Fi only, through Drashti's own phone server. WhatsApp-style: each message carries its sender's
 * name, the time and the words (text and emoji, plain text only).
 *
 * Who is in it: every individually paired Remote (the phone's Simple Mode included) and Announcements device, and
 * the phones that scanned the pairing dialog's "Chat" QR (a chat-only device: it reads and writes the chat and does
 * nothing else). Never the announcements poster link (anyone could hold it) and never a Stage device (a stage screen
 * never shows the chat). The operator writes as "Operator" from the operator window's Chat section.
 *
 * Each person gives their name once on their phone (the phone remembers it and sends it again when the page opens).
 * The chat is kept on the Drashti computer for the day only: in memory and a small file in the data folder (never
 * the library, so never a backup or a Report a Problem), emptied by the operator's Clear chat and at the day's
 * change. Its words and names are NEVER written to a log. The operator can remove a person: their device is
 * unpaired and cut off at once.
 *
 * Text is plain text everywhere: kept as typed (cleaned of control and direction characters below), never HTML,
 * and shown by every page as text (React's own escaping; never innerHTML or dangerouslySetInnerHTML).
 */

// ---- limits (as the announcements' limits: enforced in Main, the pages only help) ------------------------------

/** A message's words, at most (UTF-16 units, as a text box's maxLength and every limit in Drashti count). */
export const CHAT_TEXT_MAX = 500;
/** A person's name, at most (as an announcement's "Who it is from"). */
export const CHAT_NAME_MAX = ANNOUNCEMENT_FROM_MAX;
/** At most this many lines in a message (blank lines beyond one in a row are dropped). */
export const CHAT_LINES_MAX = 20;
/** People with a name in the chat in a day, at most (the operator not counted). */
export const CHAT_PEOPLE_MAX = 50;
/** The day's messages kept, at most: the oldest go first. */
export const CHAT_HISTORY_MAX = 300;
/** One person: a few at once, then one every 2 seconds on average. */
export const CHAT_RATE = { perSecond: 0.5, burst: 5 } as const;
/** The phones together, so a busy chat never slows the show (the operator is never held up by them). */
export const CHAT_RATE_ALL = { perSecond: 5, burst: 20 } as const;
/** A person's name given or changed: a few at once, then one every 10 seconds. */
export const CHAT_NAME_RATE = { perSecond: 0.1, burst: 3 } as const;
/** The "Chat" QR lets phones join for this long after the operator shows it (each phone paired by itself). */
export const CHAT_INVITE_TTL_MS = 10 * 60 * 1000;
/** One phone's reads of the chat (opening, waking, reconnecting): a few at once, then one a second (review M4). */
export const CHAT_READ_RATE = { perSecond: 1, burst: 5 } as const;
/** Phones that join by one Chat QR from one address, at most (one phone scanning again; review M2). */
export const CHAT_JOINS_PER_ADDRESS = 2;
/** Phones joining by the Chat QR together: a few at once, then one a second (review M2). */
export const CHAT_JOIN_RATE = { perSecond: 1, burst: 10 } as const;
/** Feeds that follow only the chat (chat phones', Announcements devices'), at most: the show's devices keep the rest. */
export const CHAT_FEEDS_MAX = 60;

// ---- who ---------------------------------------------------------------------------------------------------------

/** The operator's id in the chat (never a device's: device ids are UUIDs). */
export const CHAT_OPERATOR_ID = 'operator';
/** The operator's name in the chat. */
export const CHAT_OPERATOR_NAME = 'Operator';

/** The kinds of device in the chat (an individually paired one; never the poster link). */
export const CHAT_DEVICE_KINDS = ['remote', 'announcements', 'chat'] as const;
export type ChatDeviceKind = (typeof CHAT_DEVICE_KINDS)[number];

/** A person in the chat: their device's id (or CHAT_OPERATOR_ID) and the name they gave. */
export interface ChatPerson {
  id: string;
  name: string;
}

/** One message. `at`: when Drashti took it (ISO time). `text`: plain text, as cleaned by cleanChatText. */
export interface ChatMessage {
  id: string;
  at: string;
  from: ChatPerson;
  text: string;
}

/** The day's chat: its day (YYYY-MM-DD on the Drashti computer), the messages oldest first, and its people. */
export interface ChatState {
  day: string;
  messages: ChatMessage[];
  /** The operator first, then everyone who gave a name today, in the order they did. */
  people: ChatPerson[];
}

/**
 * What a phone reads (GET /api/v1/chat[?after=<id>]): the day's chat, and who this phone is in it (name null: not
 * given yet). `since`: the message id the answer's messages follow (the phone's `after`, when Drashti still has it:
 * add them to what the phone has), or null (they are the whole day's: show them in its place).
 */
export interface ChatPhoneView extends ChatState {
  you: { id: string; name: string | null };
  since: string | null;
}

/**
 * A person as the operator's Chat section lists them: the kind of device, and whether it is connected now. Every chat
 * phone is listed, named or not (review M3): one with no name yet has its device's name ("Chat 3") and `named` false.
 */
export interface ChatMember extends ChatPerson {
  kind: ChatDeviceKind;
  connected: boolean;
  named: boolean;
}

/**
 * The pairing dialog's "Chat" QR: a code that pairs each phone that scans it as its own chat-only device, while it is
 * shown (until `expiresAt`, Cancel, or CHAT_PEOPLE_MAX chat devices). `url` opens the chat's own page (CHAT_PAGE)
 * with the code in its #fragment (which browsers never send): a phone already paired in the chat joins with its own
 * pairing, any other pairs by the code as the pairing page does (POST /api/v1/pair).
 */
export interface ChatInvite {
  code: string;
  url: string;
  expiresAt: number;
}

/** What the operator's Chat section reads (and hears of on every change). */
export interface ChatOperatorView extends ChatState {
  /** The people as `people` has them, but the operator (whom the section never lists to remove). */
  members: ChatMember[];
  /** The "Chat" QR while it is shown, or null. */
  invite: ChatInvite | null;
  /** The phone server is on and listening: phones can reach the chat. */
  reachable: boolean;
}

/** The operator's requests' answer: the view after it, or why not in plain words. */
export type ChatResult = { ok: true; view: ChatOperatorView } | { ok: false; message: string };

/**
 * What the feed tells a phone in the chat (ToDevice { type: 'chat'; event }), each as it happens: a new message (the
 * sender's own too); the people changed (a name given or changed, someone removed); the chat emptied (Clear chat, or
 * a new day). A removed phone's own feed ends with { type: 'bye', reason: 'revoked' } as any removed device's does.
 */
export type ChatEvent =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'people'; people: ChatPerson[] }
  | { kind: 'cleared'; day: string };

// ---- the phone's requests (docs/api.md) ----------------------------------------------------------------------

/** The chat's requests, each answered as JSON: { ok: true, ... } or { ok: false, message } in plain words. */
export const CHAT_API = {
  /** GET: { ok: true, chat: ChatPhoneView }. */
  read: '/api/v1/chat',
  /** POST { name }: { ok: true, chat: ChatPhoneView }. */
  name: '/api/v1/chat/name',
  /** POST { text }: { ok: true, message: ChatMessage } (the feed brings it to everyone, this phone included). */
  send: '/api/v1/chat/messages',
} as const;

/** A chat-only device's page (the pairing page opens it after a "Chat" QR). */
export const CHAT_PAGE = '/chat';

// ---- refusals, in plain words (Main's; a page may show them as they come) ---------------------------------------

export const CHAT_REFUSAL = {
  empty: 'Write a message first.',
  tooLong: `A message can be at most ${CHAT_TEXT_MAX} characters.`,
  tooManyLines: `A message can have at most ${CHAT_LINES_MAX} lines.`,
  tooFast: 'Too many messages at once: wait a moment, then send again.',
  noName: 'Give your name first, then send.',
  name: `A name needs 1 to ${CHAT_NAME_MAX} characters.`,
  operatorName: 'That name is the operator’s: choose another.',
  nameTaken: 'That name is taken today: choose another.',
  readTooFast: 'Too many reads at once: wait a moment, then try again.',
  badRead: 'Drashti cannot read the chat that way.',
  joinTooMany: 'This phone has joined the chat already. Ask the operator if you need to join again.',
  joinTooFast: 'Many phones are joining at once: wait a moment, then scan the Chat QR again.',
  ended: 'This Chat QR has ended: ask the operator to show it again.',
  nameTooFast: 'Too many name changes: wait a moment, then try again.',
  full: `The chat is full: at most ${CHAT_PEOPLE_MAX} people a day. Ask the operator.`,
  notIn: 'This device is not in the chat.',
  gone: 'That person is no longer in the chat.',
} as const;

// ---- plain text ----------------------------------------------------------------------------------------------

/** A character that shows: not a space, a format character (the joiners among them), a mark alone or a filler. */
const VISIBLE = /[^\p{Z}\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/u;

/**
 * A message's words as kept and shown, the same on the computer and a phone:
 * - every line break (CR LF, CR, U+0085, U+2028, U+2029, a vertical tab or form feed) becomes "\n", a tab a space;
 * - other control characters (C0, DEL, C1) and the direction marks, embeddings and isolates (Bidi_Control) are left
 *   out, so no message can turn the words after it around or hide them, and so is a lone half of an emoji (it would
 *   not come back the same from the chat's file);
 * - spaces at the ends of each line and blank lines at either end are trimmed, and no more than one blank line in a
 *   row is kept;
 * - letters, marks, joiners and emoji sequences stay exactly as typed (Gujarati's and Hindi's ZWJ and ZWNJ too);
 *   nothing is normalized and nothing is HTML: "<b>" stays the three letters it is.
 * Empty when nothing visible is left.
 */
export function cleanChatText(text: string): string {
  const lines = text
    .replace(/\r\n?|[\v\f\u0085\u2028\u2029]/gu, '\n')
    .replace(/\t/gu, ' ')
    .replace(/[\p{Cc}\p{Cs}\p{Bidi_Control}]/gu, (c) => (c === '\n' ? c : ''))
    .split('\n')
    .map((line) => line.replace(/^[\p{Z}]+|[\p{Z}]+$/gu, ''));
  const kept: string[] = [];
  for (const line of lines) {
    const blank = !VISIBLE.test(line);
    if (blank && (kept.length === 0 || kept[kept.length - 1] === '')) continue;
    kept.push(blank ? '' : line);
  }
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n');
}

/** A message a phone (or the operator) sends: its words cleaned, then 1 to CHAT_TEXT_MAX of them. */
export const chatTextSchema = z
  .string()
  // A huge body is refused before it is cleaned.
  .max(CHAT_TEXT_MAX * 4, CHAT_REFUSAL.tooLong)
  .transform(cleanChatText)
  .pipe(
    z
      .string()
      .min(1, CHAT_REFUSAL.empty)
      // UTF-16 units, as a text box's maxLength counts (zod's max counts code points: an emoji would be one).
      .refine((t) => t.length <= CHAT_TEXT_MAX, CHAT_REFUSAL.tooLong)
      .refine((t) => t.split('\n').length <= CHAT_LINES_MAX, CHAT_REFUSAL.tooManyLines),
  );

/** A person's name as they give it: cleaned as Rename… cleans a name, then 1 to CHAT_NAME_MAX characters. */
export const chatNameSchema = cleanNameSchema(CHAT_NAME_MAX);

export const chatSendSchema = z.object({ text: z.string() }).strict();
/** A phone's read: what it has already (the last message id), if anything. */
export const chatReadSchema = z.object({ after: z.string().min(1).max(128).optional() }).strict();

/** Digits that read as letters in a name ("0perator", "Person l"). */
const LOOK_ALIKE: Record<string, string> = { '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/**
 * A name as two names are compared (review S3): full-width and other compatibility forms as their plain letters
 * (NFKC), case folded, only letters, marks and digits kept (spaces, punctuation and emoji left out), digits that read as
 * letters as those letters. "Operator.", "0perator", "Ｏｐｅｒａｔｏｒ" and "O p e r a t o r" all read "operator"; a
 * Gujarati or Hindi vowel sign stays, so names that differ by one stay different.
 */
export function chatNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '')
    .replace(/[013457]/gu, (d) => LOOK_ALIKE[d] ?? d);
}
export const chatNameInputSchema = z.object({ name: z.string() }).strict();

/** The day a moment falls on, on the Drashti computer (its time zone unless given): YYYY-MM-DD. */
export function chatDay(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
