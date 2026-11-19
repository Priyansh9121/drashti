import { YOUTUBE_PRIVACY_WORDS, type YouTubeLink } from '../../../shared/youtube';

/* How the operator window writes a YouTube broadcast (x31). */

/** The date and time a broadcast starts, as this computer writes them ("Fri 20 Nov, 6:30 pm"). */
export function whenWords(ms: number): string {
  return new Date(ms).toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** A profile's broadcast, in one line: “Title”, when (who can watch). */
export function linkWords(link: YouTubeLink): string {
  return `“${link.title}”, ${whenWords(link.startsAt)} (${YOUTUBE_PRIVACY_WORDS[link.privacy]})`;
}
