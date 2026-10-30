import type { PlaylistItemInfo } from '../../shared/playlists';
import { type ReadyFacts, type ReadyReport, readyLines } from '../../shared/ready';
import { type FocusDeps, readFocus } from './focus';

/*
 * Ready?'s facts (Session 55, Part 8, H), read only when it is pressed. Everything here is in memory or one quick
 * read of the library, but for two slow things, both asynchronous so the main process never waits on them: whether
 * the open playlist's files are still on the disk (fs.promises), and whether notifications are silenced (focus.ts).
 * Nothing touches the keychain or the network.
 */

export interface ReadyDeps extends FocusDeps {
  platform: string;
  now(): number;
  screens(): ReadyFacts['screens'];
  sound(): ReadyFacts['sound'];
  videoInput(): ReadyFacts['videoInput'];
  access(): ReadyFacts['access'];
  /** A playlist's name and rows, or null when there is no such playlist. */
  playlist(id: string): { name: string; rows: PlaylistItemInfo[] } | null;
  /** A media item's file on this computer (a full path), or null when the library has none for it. */
  mediaFile(mediaId: string): string | null;
  /** Whether a file is there (asynchronous). */
  exists(path: string): Promise<boolean>;
  onBattery(): boolean | null;
  keptAwake(): boolean;
}

/** The open playlist's rows whose file or presentation is missing: their names, and the missing files' media ids. */
export async function missingInPlaylist(
  rows: readonly PlaylistItemInfo[],
  deps: Pick<ReadyDeps, 'mediaFile' | 'exists'>,
): Promise<{ problems: string[]; mediaIds: string[] }> {
  const checked = await Promise.all(
    rows.map(async (row): Promise<{ name: string; mediaId: string | null } | null> => {
      if (row.kind === 'media') {
        if (row.missing || row.gone === true) return { name: row.label, mediaId: row.mediaId };
        const file = deps.mediaFile(row.mediaId);
        if (file === null || !(await deps.exists(file))) return { name: row.label, mediaId: row.mediaId };
        return null;
      }
      if (row.kind === 'presentation')
        return row.presentationName === null || row.gone === true ? { name: row.label, mediaId: null } : null;
      if (row.kind === 'shastra') return row.missing ? { name: row.label, mediaId: null } : null;
      if (row.kind === 'placeholder' && row.hint !== null) return { name: row.label, mediaId: null };
      return null;
    }),
  );
  const found = checked.filter((c): c is { name: string; mediaId: string | null } => c !== null);
  return {
    problems: found.map((c) => c.name),
    mediaIds: [...new Set(found.flatMap((c) => (c.mediaId === null ? [] : [c.mediaId])))],
  };
}

/** Ready?'s answer: the facts read now, made into its lines. */
export async function readyReport(deps: ReadyDeps, openPlaylistId: string | null): Promise<ReadyReport> {
  const open = openPlaylistId === null ? null : deps.playlist(openPlaylistId);
  const [missing, quiet] = await Promise.all([
    open === null ? Promise.resolve({ problems: [], mediaIds: [] }) : missingInPlaylist(open.rows, deps),
    readFocus(deps.platform, deps),
  ]);
  const facts: ReadyFacts = {
    platform: deps.platform,
    screens: deps.screens(),
    sound: deps.sound(),
    videoInput: deps.videoInput(),
    access: deps.access(),
    playlist: open === null ? null : { name: open.name, problems: missing.problems },
    power: { onBattery: deps.onBattery(), keptAwake: deps.keptAwake() },
    focus: { quiet },
  };
  return { at: deps.now(), lines: readyLines(facts), missingMediaIds: missing.mediaIds };
}
