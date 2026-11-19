/*
 * Scheduling a YouTube stream from Drashti (x31, alpha.20): the words and shapes the operator window, the main process
 * and the tests share. The admin's own Google project signs in (its client typed into Drashti, never built in), in the
 * computer's own browser; a broadcast scheduled here has its stream key saved into a stream profile by itself, in the
 * main process (no window ever sees a key or a token); going live is the stream's own Go live, which never waits for
 * Google: YouTube starts the broadcast when the stream arrives.
 */

/** A broadcast's privacy on YouTube (status.privacyStatus). */
export type YouTubePrivacy = 'public' | 'unlisted' | 'private';

/** In the order the schedule form offers them. */
export const YOUTUBE_PRIVACIES = [
  'unlisted',
  'public',
  'private',
] as const satisfies readonly YouTubePrivacy[];

export const YOUTUBE_PRIVACY_WORDS: Readonly<Record<YouTubePrivacy, string>> = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Private',
};

/** YouTube's own limits on a broadcast's words (liveBroadcasts.insert: a title of 1 to 100, a description to 5000). */
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX = 5000;

/** The scheduled start must be ahead of now (YouTube refuses one in the past); at least this far ahead. */
export const YOUTUBE_SCHEDULE_AHEAD_MS = 60_000;
/** And no further ahead than this (YouTube: "close enough to the current date to schedule reliably"). */
export const YOUTUBE_SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** Where a broadcast stands on YouTube (status.lifeCycleStatus), in Drashti's words. */
export type YouTubeBroadcastState = 'upcoming' | 'starting' | 'live' | 'ended' | 'removed';

export const YOUTUBE_STATE_WORDS: Readonly<Record<YouTubeBroadcastState, string>> = {
  upcoming: 'Scheduled on YouTube',
  starting: 'Starting on YouTube',
  live: 'Live on YouTube',
  ended: 'Ended on YouTube',
  removed: 'Removed by YouTube',
};

/** A broadcast on the channel, as a window may see it: never its stream key. */
export interface YouTubeBroadcast {
  id: string;
  title: string;
  /** When it is scheduled to start (ms since 1970). */
  startsAt: number;
  privacy: YouTubePrivacy;
  state: YouTubeBroadcastState;
}

/** A profile's broadcast: its key came from it (Stream to this one, or scheduled with the profile). */
export interface YouTubeLink {
  broadcastId: string;
  title: string;
  startsAt: number;
  privacy: YouTubePrivacy;
  /** The address its stream goes to (the profile's own address while the link holds). */
  address: string;
}

export interface YouTubeStatus {
  /** A sign-in client (the admin's own Google project) is kept on this computer. */
  client: boolean;
  /** Signed in, with the channel's name; null when not. */
  signedIn: { channel: string } | null;
  /** Waiting for the person to finish signing in, in the browser. */
  signingIn: boolean;
  /** Whether this computer can keep a sign-in (its secure storage), as last known: never asked to show this. */
  storage: { available: boolean; message: string | null };
  /** The last thing to say (a failure, in plain words), or null. */
  message: string | null;
  /** Each profile's broadcast, by the profile's id (only while the profile still streams to it). */
  links: Record<string, YouTubeLink>;
  /** What YouTube last said of the broadcast of the profile in use, while the stream is on air; else null. */
  linkedState: YouTubeBroadcastState | null;
}

/** What the schedule form sends. */
export interface YouTubeScheduleInput {
  title: string;
  description: string;
  /** ms since 1970. */
  startsAt: number;
  privacy: YouTubePrivacy;
  /** YouTube asks it of every video (status.selfDeclaredMadeForKids). */
  madeForKids: boolean;
  /** Stream to it from this profile (its key saved there), or null to schedule it only. */
  profileId: string | null;
}

export type YouTubeResult = { ok: true; status: YouTubeStatus } | { ok: false; message: string };

export type YouTubeListResult =
  { ok: true; broadcasts: YouTubeBroadcast[]; status: YouTubeStatus } | { ok: false; message: string };

/** Added to every failure of Google's: the stream itself does not depend on it. */
export const YOUTUBE_KEY_STILL_GOES = 'The saved stream key still goes live.';

export const YOUTUBE_WORDS = {
  offline: 'Drashti could not reach YouTube. Check the internet, then try again.',
  signedOut: 'Your YouTube sign-in has run out or was removed. Sign in to YouTube again.',
  notSignedIn: 'Sign in to YouTube first.',
  noClient:
    'Set up the YouTube sign-in first: type the Client ID and Client secret of your own Google project.',
  badClient:
    'Google does not know this sign-in client. Check the Client ID and Client secret in your Google project, then type them again.',
  notEnabled:
    'This YouTube channel cannot stream live yet. Turn live streaming on in YouTube Studio (the first time can take up to 24 hours).',
  tooMany:
    'This YouTube channel has too many live or scheduled broadcasts. End or delete some in YouTube Studio.',
  tooFast: 'YouTube was asked too often just now. Wait a minute, then try again.',
  badTime: 'YouTube refused that time: choose a time ahead of now, within a year.',
  denied: 'Signing in to YouTube was not allowed in the browser, so nothing changed.',
  timedOut: 'Signing in to YouTube was not finished within 5 minutes. Try again.',
  cancelled: 'Signing in to YouTube was cancelled.',
  inUse: 'End the stream and stop recording before giving this profile another broadcast.',
  noProfile: 'That profile no longer exists.',
  noBroadcast: 'That broadcast is no longer on the channel, or has already started or ended.',
  noStorage:
    'This computer’s secure storage for passwords is not available, so Drashti will not keep a YouTube sign-in (it would have to be kept as plain text). Sign in from a computer where it works.',
  testGuard: 'A test reaches only the stand-in for Google on this computer (127.0.0.1).',
  signOutNote:
    'Sign out forgets the sign-in on this computer only. To sign every computer out at once, remove Drashti’s access in your Google Account: go to its linked apps page (myaccount.google.com/linkedapps), choose Access to your Google Account, then your Google project’s app, See details, Remove access and Confirm.',
} as const;

/** YouTube's daily allowance is used up: it comes back at midnight Pacific time (Google's own rule). */
export function quotaWords(backAt: string): string {
  return `YouTube’s daily allowance for your Google project is used up. It starts again at ${backAt}.`;
}

/** Google refused, in its own words (already plain text), or none. */
export function refusedWords(reason: string | null): string {
  return reason ? `YouTube refused this: ${reason}` : 'YouTube refused this.';
}

/**
 * When YouTube's daily allowance comes back: the next midnight in California ("Daily quotas reset at midnight Pacific
 * Time"), as ms since 1970.
 */
export function pacificMidnightAfter(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  // How far California's clock is from UTC now (its summer time included).
  const offset = wall - Math.floor(now / 1000) * 1000;
  return Date.UTC(part('year'), part('month') - 1, part('day') + 1) - offset;
}
