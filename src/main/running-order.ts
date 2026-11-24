import { formatDuration } from '../shared/format';
import { playlistTotals } from '../shared/playlist-playback';
import { type PlaylistItemInfo, slotCategoryName } from '../shared/playlists';
import { plural } from '../shared/text';

/*
 * A playlist's running order (alpha.22, from PLAN §7's "Print": seen, not added; the owner's "Yes, build them", 24 Nov
 * 2026), for the sanchalak, the anchor and the sound desk before a sabha: copied as plain lines for the team's group
 * chat (Copy running order), or printed and saved as a PDF (Print running order…, Save running order as PDF…). Made
 * from the playlist's rows as the main process reads them; it only reads, and nothing in it touches the show.
 */

/** A playlist's name and its rows, in its order. */
export interface RunningOrderSource {
  name: string;
  items: readonly PlaylistItemInfo[];
}

/** A row of the running order: a header as a section's title, or a numbered row. */
export type RunningOrderRow =
  | { kind: 'header'; title: string }
  | {
      kind: 'row';
      number: number;
      /** What it is, in a word or two (as its card says). */
      what: string;
      /** Its name; for a slot, what the slot asks for. */
      label: string;
      /** A video's or a sound's length between its points ("3:05"); null for any other row, or when not known yet. */
      length: string | null;
      /** A video's or a sound's length, not known yet. */
      lengthUnknown: boolean;
      /** A presentation's slides, when known. */
      slides: number | null;
    };

/** Words on one line: a name never breaks a row in two. */
const oneLine = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** What a row is, in a word or two (the open playlist's cards say the same). */
function whatOf(item: Exclude<PlaylistItemInfo, { kind: 'header' }>): string {
  switch (item.kind) {
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'shastra':
      return 'Passage from a book';
    case 'placeholder':
      return item.hint === null ? 'Slot to fill' : 'Not found at import';
    case 'input':
      return 'Video input';
  }
}

/** The running order's rows: headers as section titles, every other row numbered from 1 in the playlist's order. */
export function runningOrderRows(items: readonly PlaylistItemInfo[]): RunningOrderRow[] {
  let number = 0;
  return items.map((item): RunningOrderRow => {
    if (item.kind === 'header') return { kind: 'header', title: oneLine(item.label) };
    number++;
    const timed = item.kind === 'media' && item.media !== 'image';
    const length = timed ? (item.playingMs ?? item.durationMs ?? null) : null;
    const label =
      item.kind === 'placeholder' && item.hint === null && item.category
        ? `${oneLine(item.label)} (${slotCategoryName(item.category)})`
        : oneLine(item.label);
    return {
      kind: 'row',
      number,
      what: whatOf(item),
      label,
      length: length === null ? null : formatDuration(length),
      lengthUnknown: timed && length === null,
      slides: item.kind === 'presentation' ? (item.slideCount ?? null) : null,
    };
  });
}

/** The videos' and sounds' time in all, between their points, and how many lengths are not known yet; null for none. */
export function runningOrderTotal(items: readonly PlaylistItemInfo[]): string | null {
  const totals = playlistTotals(items);
  const timed = items.some((i) => i.kind === 'media' && i.media !== 'image');
  if (!timed) return null;
  const unknown = totals.unknown ? ` (${plural(totals.unknown, 'length')} not known yet)` : '';
  return `${formatDuration(totals.durationMs)}${unknown}`;
}

/**
 * Copy running order's plain lines: the playlist's name, each header as "— Dhun —", every other row numbered with
 * its length where it has one ("2. Placeholder video, 3:05"), a slot as what it asks for, then the videos' and sounds'
 * time in all.
 */
export function runningOrderLines(source: RunningOrderSource): string {
  const lines = [oneLine(source.name)];
  const rows = runningOrderRows(source.items);
  if (rows.length === 0) lines.push('This playlist is empty.');
  for (const row of rows) {
    if (row.kind === 'header') {
      lines.push(`— ${row.title} —`);
      continue;
    }
    const name =
      row.what === 'Slot to fill' || row.what === 'Not found at import' ? `${row.what}: ${row.label}` : row.label;
    const length = row.lengthUnknown ? 'length not known yet' : row.length;
    lines.push(`${String(row.number)}. ${name}${length ? `, ${length}` : ''}`);
  }
  const total = runningOrderTotal(source.items);
  if (total !== null) lines.push(`Videos and sounds in all: ${total}`);
  return lines.join('\n');
}
