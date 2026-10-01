/** What Drashti put back on the screens at startup, after it stopped unexpectedly. */
export interface RecoveryNotice {
  /** When what was put back was saved (just before the stop). */
  savedAt: string;
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
  stageMessage?: boolean;
  /** Timers, running or paused. */
  timers?: number;
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
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
  if (notice.stageMessage) parts.push('the stage message');
  count(notice.timers, 'a timer', 'timers');
  if (notice.logo) parts.push('the logo');
  if (notice.blackout) parts.push('black-out');
  const put =
    parts.length > 0
      ? `Drashti stopped unexpectedly and has put back what was live: ${joinParts(parts)}.`
      : 'Drashti stopped unexpectedly.';
  return notice.slideGone ? `${put} The slide that was live is no longer in the library.` : put;
}
