import { z } from 'zod';
import { cleanRenameName } from './rename-name';
import {
  YOUTUBE_DESCRIPTION_MAX,
  YOUTUBE_PRIVACIES,
  YOUTUBE_TITLE_MAX,
  type YouTubeScheduleInput,
} from './youtube';

/*
 * What the YouTube section of Stream settings sends (x31), checked in the main process before anything goes to Google
 * or is kept.
 */

/** YouTube refuses < and > in a video's words. */
const NO_ANGLES = /^[^<>]*$/u;

/** A title: cleaned as a name is (one line), 1 to 100 characters, no < or >. */
export const youtubeTitleSchema = z
  .string()
  .max(10_000)
  .transform(cleanRenameName)
  .pipe(
    z
      .string()
      .min(1, 'Give the broadcast a title.')
      .max(YOUTUBE_TITLE_MAX, `A title on YouTube is at most ${YOUTUBE_TITLE_MAX} characters.`)
      .regex(NO_ANGLES, 'A title on YouTube cannot hold < or >.'),
  );

/** A description: its lines kept, other control characters and direction marks left out, at most 5000 characters. */
export const youtubeDescriptionSchema = z
  .string()
  .max(100_000)
  .transform((text) =>
    text
      .replace(/\r\n?/gu, '\n')
      .replace(/(?!\n)[\p{Cc}\p{Bidi_Control}]/gu, '')
      .trim(),
  )
  .pipe(
    z
      .string()
      .max(
        YOUTUBE_DESCRIPTION_MAX,
        `A description on YouTube is at most ${YOUTUBE_DESCRIPTION_MAX.toLocaleString('en')} characters.`,
      )
      .regex(NO_ANGLES, 'A description on YouTube cannot hold < or >.'),
  );

export const youtubeScheduleSchema: z.ZodType<YouTubeScheduleInput> = z.object({
  title: youtubeTitleSchema,
  description: youtubeDescriptionSchema,
  startsAt: z
    .number()
    .int('Choose the date and time it starts.')
    .min(0, 'Choose the date and time it starts.'),
  privacy: z.enum(YOUTUBE_PRIVACIES, 'Choose Public, Unlisted or Private.'),
  madeForKids: z.boolean('Say whether it is made for children.'),
  profileId: z.string().min(1).max(100).nullable(),
});

/** A Google OAuth client's ID, as its Clients page shows it (…apps.googleusercontent.com). */
export const googleClientIdSchema = z
  .string()
  .trim()
  .max(300, 'That is not a Client ID: copy it from your Google project’s Clients page.')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.apps\.googleusercontent\.com$/u,
    'A Client ID ends in .apps.googleusercontent.com: copy it from your Google project’s Clients page.',
  );

/** A Google OAuth client's secret: letters, digits, dashes and underscores. */
export const googleClientSecretSchema = z
  .string()
  .trim()
  .min(8, 'Type the Client secret from your Google project’s Clients page.')
  .max(300, 'That is not a Client secret: copy it from your Google project’s Clients page.')
  .regex(/^[A-Za-z0-9_-]+$/u, 'A Client secret is letters, digits, dashes and underscores.');
