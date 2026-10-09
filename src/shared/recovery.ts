/**
 * How long after an unexpected stop Drashti still puts the show back (Session 20): a show saved this
 * long or longer before the start is said, never put on the screens. Drashti saves the show again
 * every minute while it runs, so the time counts from the stop.
 */
export const RECOVERY_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** What Drashti put back on the screens at startup, after it stopped unexpectedly. */
export interface RecoveryNotice {
  /** When what was put back was saved (just before the stop). */
  savedAt: string;
  /**
   * False when the stop was RECOVERY_MAX_AGE_MS or more before the start (Session 20): what was live
   * then is only named, and nothing went on the screens. Missing in notices from before (put back).
   */
  putBack?: boolean;
  /** The slide put back, or null. */
  slide: { presentationName: string; slideNumber: number } | null;
  /** A slide was live but is no longer in the library, so it could not be put back. */
  slideGone: boolean;
  background: boolean;
  blackout: boolean;
  /** The logo, shown instead of the picture. */
  logo?: boolean;
  /** The sound, carrying on. */
  audio?: boolean;
  props?: number;
  messages?: number;
  /** Announcements in the ticker. */
  ticker?: number;
  /** A mask on the Masks layer. */
  masks?: boolean;
  stageMessage?: boolean;
  /** Timers, running or paused. */
  timers?: number;
  /** The Look that was live, by name, when it was not the one Drashti starts with. */
  look?: string | null;
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When a show was saved, in the computer's own time: "on Fri 9 Oct at 18:34"; null when it cannot be read. */
export function stoppedWhen(savedAt: string): string | null {
  const at = new Date(savedAt);
  if (Number.isNaN(at.getTime())) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `on ${DAYS[at.getDay()] ?? ''} ${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''} at ${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** The sentence the operator sees. */
export function recoveryText(notice: RecoveryNotice): string {
  const parts: string[] = [];
  if (notice.slide) parts.push(`"${notice.slide.presentationName}", slide ${notice.slide.slideNumber}`);
  if (notice.background) parts.push('the background');
  if (notice.audio) parts.push('the sound');
  const count = (n: number | undefined, one: string, many: string) => {
    if (n && n > 0) parts.push(n === 1 ? one : `${n} ${many}`);
  };
  count(notice.props, 'a prop', 'props');
  count(notice.messages, 'a message', 'messages');
  if (notice.ticker && notice.ticker > 0) parts.push('the ticker');
  if (notice.masks) parts.push('the mask');
  if (notice.stageMessage) parts.push('the stage message');
  count(notice.timers, 'a timer', 'timers');
  if (notice.logo) parts.push('the logo');
  if (notice.blackout) parts.push('black-out');
  if (notice.look) parts.push(`the Look “${notice.look}”`);
  const gone = notice.slideGone ? ' The slide that was live is no longer in the library.' : '';
  if (notice.putBack === false) {
    const when = stoppedWhen(notice.savedAt);
    const hours = String(RECOVERY_MAX_AGE_MS / 3_600_000);
    const live = parts.length > 0 ? ` What was live then: ${joinParts(parts)}.` : '';
    const stopped = when
      ? `${when}, ${hours} hours or more before it started again`
      : 'at a time it cannot tell';
    return `Drashti stopped unexpectedly ${stopped}, so nothing was put back on the screens.${live}${gone}`;
  }
  const put =
    parts.length > 0
      ? `Drashti stopped unexpectedly and has put back what was live: ${joinParts(parts)}.`
      : 'Drashti stopped unexpectedly.';
  return `${put}${gone}`;
}
