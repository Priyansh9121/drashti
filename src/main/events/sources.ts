import type { AnnouncementsView } from '../../shared/announcements';
import type { ScheduledBackupsView } from '../../shared/backups';
import type { EngineState } from '../../shared/engine/state';
import { EVENT_WORDS_MAX, type EventKind } from '../../shared/events-out';
import type { StreamStatus } from '../../shared/stream';

/*
 * What happens in the show, as events out (Session 28): each source's state before and after a change,
 * turned into the events it makes. Ids and kinds in `data`; anything in words (a slide's lines, an
 * announcement, a screen's name) apart in `words`, which goes only where an admin ticked "Include the
 * words". Engine listeners get the state after a change only, so the caller keeps the one before.
 */

export interface Emitted {
  kind: EventKind;
  data: Record<string, string | number | boolean | null>;
  words?: Record<string, string>;
}

/** A slide's lines, one to a line, cut to EVENT_WORDS_MAX characters. */
function slideWords(state: EngineState): string {
  const slide = state.layers.slide?.slide;
  if (!slide) return '';
  const text = slide.elements
    .map((e) => (e.kind === 'text' ? e.text.trim() : ''))
    .filter((t) => t !== '')
    .join('\n');
  return text.length > EVENT_WORDS_MAX ? text.slice(0, EVENT_WORDS_MAX) : text;
}

export function engineEvents(before: EngineState | null, after: EngineState): Emitted[] {
  if (!before) return [];
  const out: Emitted[] = [];
  const was = before.layers.slide;
  const is = after.layers.slide;
  // A slide went up (the same one again counts: it was shown again), or the slide was taken off.
  if ((is?.shownAt ?? null) !== (was?.shownAt ?? null)) {
    const item = after.live.playlist;
    out.push({
      kind: 'slide.changed',
      data: {
        presentationId: is?.presentationId ?? null,
        slideIndex: is?.slideIndex ?? null,
        slideCount: is ? after.live.slideCount : null,
        playlistId: item?.playlistId ?? null,
        itemId: item?.itemId ?? null,
        // A Repeat Slides playlist going round by itself, not the operator.
        repeat: after.repeat !== null,
      },
      ...(is ? { words: { text: slideWords(after) } } : {}),
    });
  }
  const itemWas = before.live.playlist?.itemId ?? null;
  const itemIs = after.live.playlist?.itemId ?? null;
  if (itemIs !== itemWas)
    out.push({
      kind: 'item.changed',
      data: { playlistId: after.live.playlist?.playlistId ?? null, itemId: itemIs },
    });
  if (after.blackout !== before.blackout)
    out.push({ kind: 'blackout.changed', data: { on: after.blackout } });
  if ((after.logo !== null) !== (before.logo !== null))
    out.push({ kind: 'logo.changed', data: { on: after.logo !== null } });
  return out;
}

const onAir = (s: StreamStatus['live']['state']) => s === 'live' || s === 'reconnecting';

export function streamEvents(before: StreamStatus | null, after: StreamStatus): Emitted[] {
  if (!before) return [];
  const out: Emitted[] = [];
  const was = before.live.state;
  const is = after.live.state;
  const places = { places: Math.max(1, after.live.destinations.length) };
  if (is === 'live' && was !== 'live' && was !== 'reconnecting')
    out.push({ kind: 'stream.started', data: places });
  if (is === 'reconnecting' && was !== 'reconnecting')
    out.push({ kind: 'stream.reconnecting', data: places });
  if (!onAir(is) && is !== 'ending' && (onAir(was) || was === 'ending'))
    out.push({ kind: 'stream.ended', data: {} });
  const recWas = before.recording.state === 'recording';
  const recIs = after.recording.state === 'recording';
  if (recIs && !recWas) out.push({ kind: 'recording.started', data: {} });
  if (!recIs && recWas) out.push({ kind: 'recording.stopped', data: {} });
  return out;
}

/** A hall screen on this computer, as the output manager has it. */
export interface ScreenState {
  screenId: string;
  state: string;
  name: string;
}

export function screenEvents(
  before: readonly ScreenState[] | null,
  after: readonly ScreenState[],
): Emitted[] {
  if (!before) return [];
  const was = new Map(before.map((s) => [s.screenId, s.state]));
  const out: Emitted[] = [];
  for (const s of after) {
    const prev = was.get(s.screenId);
    if (s.state === 'stopped' && prev !== 'stopped')
      out.push({ kind: 'screen.stopped', data: { screenId: s.screenId }, words: { name: s.name } });
    if (s.state === 'showing' && prev === 'stopped')
      out.push({ kind: 'screen.showing', data: { screenId: s.screenId }, words: { name: s.name } });
  }
  return out;
}

export function announcementEvents(before: AnnouncementsView | null, after: AnnouncementsView): Emitted[] {
  if (!before) return [];
  const known = new Set(before.waiting.map((a) => a.id));
  return after.waiting
    .filter((a) => !known.has(a.id))
    .map((a) => ({
      kind: 'announcement.waiting' as const,
      data: { announcementId: a.id },
      words: { text: a.text },
    }));
}

export function backupEvents(before: ScheduledBackupsView | null, after: ScheduledBackupsView): Emitted[] {
  if (!before || !after.last || after.last.endedAt === before.last?.endedAt) return [];
  // The outcome only: its message names folders.
  return [{ kind: 'backup.finished', data: { outcome: after.last.outcome } }];
}
