import { z } from 'zod';

/*
 * Events out (Session 28, decision 20): Drashti tells other programs (n8n on the mandir's network, say) what
 * happens in the show, by a signed POST to each address an admin adds. Ids and kinds only, never words
 * unless an admin ticks "Include the words" for that kind at that address; nothing is on until an address
 * ticks it; local addresses only, unless an admin allows one https address on the internet. The secrets and
 * the addresses themselves are kept as stream keys are: never in the library, a backup, the log or a window
 * (a window sees the host only; a secret is shown once, when it is made).
 */

export const EVENT_KINDS = [
  'slide.changed',
  'item.changed',
  'blackout.changed',
  'logo.changed',
  'stream.started',
  'stream.reconnecting',
  'stream.ended',
  'recording.started',
  'recording.stopped',
  'announcement.waiting',
  'screen.stopped',
  'screen.showing',
  'backup.finished',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Each kind as the admin reads it. */
export const EVENT_NAMES: Record<EventKind, string> = {
  'slide.changed': 'A slide goes up',
  'item.changed': 'The playlist moves to another item',
  'blackout.changed': 'Black-out on or off',
  'logo.changed': 'The logo on or off',
  'stream.started': 'The stream goes on air',
  'stream.reconnecting': 'The stream is reconnecting',
  'stream.ended': 'The stream ends',
  'recording.started': 'Recording starts',
  'recording.stopped': 'Recording stops',
  'announcement.waiting': 'An announcement is waiting',
  'screen.stopped': 'A hall screen stopped',
  'screen.showing': 'A stopped screen is back',
  'backup.finished': 'A scheduled backup ends (done, skipped or stopped)',
};

/**
 * The kinds that can carry words, and which: a slide's lines (200 characters at most), an announcement's
 * words, a screen's name. Tokens, keys, PINs, pairing codes, addresses and file paths never.
 */
export const WORDY_KINDS: readonly EventKind[] = [
  'slide.changed',
  'announcement.waiting',
  'screen.stopped',
  'screen.showing',
];

/** A slide's words in an event: at most this many characters. */
export const EVENT_WORDS_MAX = 200;
/** At most this many addresses. */
export const EVENT_ADDRESSES_MAX = 5;

/** How an address stands, as the admin sees it. */
export interface EventAddressStatus {
  lastSuccess: { at: number; status: number } | null;
  lastFailure: { at: number; status: number | null; error: string | null } | null;
  /** A 404, a redirect or another 4xx: an address set up wrongly (a workflow not published, a test URL). */
  setupProblem: boolean;
  /** Events given up after the last retry, since Drashti started. */
  dropped: number;
  /** The receiver's clock is this far from this computer's (ms), when more than a minute. */
  clockOffBy: number | null;
}

/** An address as a window sees it: its host, never its path or its secret. */
export interface EventAddressView {
  id: string;
  host: string;
  secure: boolean;
  kinds: EventKind[];
  /** The kinds it gets with their words. */
  words: EventKind[];
  allowInternet: boolean;
  /** Turned off: a 410 answered, or an admin turned it off. */
  off: boolean;
  status: EventAddressStatus;
}

export interface EventsOutView {
  /** The system's secure storage works (else nothing is kept). */
  available: boolean;
  message: string | null;
  addresses: EventAddressView[];
}

export type EventsOutResult =
  | {
      ok: true;
      view: EventsOutView;
      /** A new or rotated secret: shown once, to copy into the receiver. */
      secret?: string;
    }
  | { ok: false; message: string };

/** An address as an admin types it: http:// or https://, a host, no login in it. */
export const eventAddressSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const url = new URL(u);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname !== '' &&
        url.username === '' &&
        url.password === ''
      );
    } catch {
      return false;
    }
  }, 'An address starting http:// or https://.');

export const eventKindsSchema = z.array(z.enum(EVENT_KINDS)).max(EVENT_KINDS.length);

export const eventAddressPatchSchema = z
  .object({
    kinds: eventKindsSchema.optional(),
    words: eventKindsSchema.optional(),
    allowInternet: z.boolean().optional(),
    on: z.boolean().optional(),
  })
  .strict();
export type EventAddressPatch = z.infer<typeof eventAddressPatchSchema>;
