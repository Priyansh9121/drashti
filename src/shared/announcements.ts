import { z } from 'zod';
import { idSchema } from './model-schema';

/*
 * Announcements from phones (Session 10): someone on the mandir's Wi-Fi, with
 * an Announcements device (a paired phone, or the poster's link), sends the
 * words, who they are from and how long to show them. Nothing reaches the
 * screens until the operator approves it, in Pro Mode, as a message (from a
 * message template) or in the ticker along the bottom of the audience
 * screens. It comes off by itself when its time is up. Every announcement is
 * kept in the library with what happened to it.
 */

/** The words, at most this long (they have to read at a glance). */
export const ANNOUNCEMENT_TEXT_MAX = 200;
/** Who it is from. */
export const ANNOUNCEMENT_FROM_MAX = 60;
/** How long it may be shown for, at most (minutes). */
export const ANNOUNCEMENT_MINUTES_MAX = 120;
/** The phone's form offers these (minutes). */
export const ANNOUNCEMENT_MINUTES = [2, 5, 10, 15, 30, 60] as const;
/** One phone (a device from one address) has at most this many waiting at a time. */
export const ANNOUNCEMENTS_WAITING_PER_PHONE = 3;
/** The queue holds at most this many waiting; more wait until the operator has caught up. */
export const ANNOUNCEMENTS_WAITING_MAX = 30;
/** The message template made the first time an announcement goes up as a message, if none is chosen. */
export const ANNOUNCEMENT_TEMPLATE = { name: 'Announcement', template: '{announcement}' } as const;

export type AnnouncementStatus = 'waiting' | 'showing' | 'ended' | 'rejected';
export type ShownAs = 'message' | 'ticker';

export interface Announcement {
  id: string;
  /** The words as they go up (the operator may have edited them). */
  text: string;
  /** The words as the phone sent them. */
  sentText: string;
  from: string;
  /** How long to show it, in minutes. */
  minutes: number;
  /** The device it came from, as named when it was sent. */
  deviceName: string;
  status: AnnouncementStatus;
  shownAs: ShownAs | null;
  /** When it was sent, approved or rejected, comes off by itself, and came off (ISO times). */
  sentAt: string;
  decidedAt: string | null;
  until: string | null;
  endedAt: string | null;
}

/** The operator's queue: waiting, on the screens now, and the most recent of the rest. */
export interface AnnouncementsView {
  waiting: Announcement[];
  showing: Announcement[];
  earlier: Announcement[];
}

export type AnnouncementResult = { ok: true; view: AnnouncementsView } | { ok: false; message: string };

/** What a phone sees of one it sent. */
export interface AnnouncementStatusView {
  id: string;
  status: AnnouncementStatus;
  until: string | null;
}

/** Words as they will be shown: one line, spaces tidied. */
export const tidy = (text: string): string => text.replace(/\s+/gu, ' ').trim();

const words = (max: number, what: string) =>
  z
    .string()
    .transform(tidy)
    .pipe(
      z.string().min(1, `${what} cannot be empty.`).max(max, `${what} can be at most ${max} characters.`),
    );

const minutes = z
  .number()
  .int()
  .min(1, 'Show it for at least a minute.')
  .max(ANNOUNCEMENT_MINUTES_MAX, `Show it for at most ${ANNOUNCEMENT_MINUTES_MAX} minutes.`);

/** What a phone sends. */
export const announcementInputSchema = z
  .object({
    text: words(ANNOUNCEMENT_TEXT_MAX, 'The announcement'),
    from: words(ANNOUNCEMENT_FROM_MAX, 'Who it is from'),
    minutes,
  })
  .strict();

/** The operator's edit of one that is waiting. */
export const announcementEditSchema = z
  .object({
    id: idSchema,
    text: words(ANNOUNCEMENT_TEXT_MAX, 'The announcement'),
    minutes,
  })
  .strict();

/** The operator's approval: as a message (from a template; Drashti's own when none is chosen) or in the ticker. */
export const announcementApproveSchema = z
  .object({
    id: idSchema,
    as: z.enum(['message', 'ticker']),
    templateId: idSchema.nullable().optional(),
  })
  .strict();

export const announcementIdSchema = z.object({ id: idSchema }).strict();
