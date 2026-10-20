import type { AudioPlaylistRepo } from '../db/audio-playlists';
import type { PlaylistRepo } from '../db/playlists';

/*
 * A folder's sounds in Audio too (Session 44; Priyansh: "all audios if imported via smart playlist should also
 * come up in audio part under a folder which is created with the same name as master folder-audios"). A
 * playlist made from a folder (a smart playlist, a Dropbox folder link's) that holds sounds has an audio
 * playlist beside it, "<the playlist's name> - Audios", with those sounds in the playlist's order: the same
 * sounds of the library, never copies. It keeps in step with the playlist, as a smart playlist keeps in step
 * with its folder: a sound that joins the playlist joins the audio playlist at its end, and one that leaves
 * the playlist leaves it. The operator may put its tracks in another order, and deleted, it stays deleted.
 */

/** After the playlist's name. */
export const AUDIOS_SUFFIX = ' - Audios';

/**
 * Each folder playlist's audio playlist (by the folder playlist's id), and the sounds already offered to it (so a
 * track the operator took out is not put back), kept with the library's settings.
 */
export const FOLDER_AUDIOS_SETTING = 'folderAudios';

interface Link {
  audio: string;
  offered: string[];
}

export interface FolderAudiosDeps {
  playlists: PlaylistRepo;
  audio: AudioPlaylistRepo;
  settings: { get(key: string): unknown; set(key: string, value: unknown): void };
}

const isLink = (v: unknown): v is Link =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Link).audio === 'string' &&
  Array.isArray((v as Link).offered) &&
  (v as Link).offered.every((m) => typeof m === 'string');

function linksOf(settings: FolderAudiosDeps['settings']): Record<string, Link> {
  const value = settings.get(FOLDER_AUDIOS_SETTING);
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, Link] => isLink(e[1])));
}

/** Bring every folder playlist's audio playlist in step (making one for each that holds sounds). True when one changed. */
export function syncFolderAudios(deps: FolderAudiosDeps): boolean {
  const links = linksOf(deps.settings);
  const before = JSON.stringify(links);
  let changed = false;
  for (const node of deps.playlists.tree()) {
    if (node.fromFolder !== true) continue;
    const sounds = [
      ...new Set(
        deps.playlists
          .itemsOf(node.id)
          .flatMap((i) => (i.kind === 'media' && i.media === 'audio' ? [i.mediaId] : [])),
      ),
    ];
    let link = links[node.id];
    if (link === undefined) {
      if (sounds.length === 0) continue;
      link = { audio: deps.audio.create(`${node.name}${AUDIOS_SUFFIX}`), offered: [] };
      links[node.id] = link;
      changed = true;
    }
    // Deleted by the operator (or gone for good): it stays so; Undo brings it back into step.
    const audio = deps.audio.get(link.audio);
    if (!audio) continue;
    const now = new Set(sounds);
    for (const track of audio.tracks)
      if (!now.has(track.mediaId) && deps.audio.removeTrack(track.id)) changed = true;
    // New to the playlist (a sound that left and came back is new again): at the end, in the playlist's order.
    const offered = new Set(link.offered);
    const have = new Set(audio.tracks.map((t) => t.mediaId));
    const joining = sounds.filter((m) => !offered.has(m) && !have.has(m));
    if (joining.length > 0 && deps.audio.addTracks(link.audio, joining, null) > 0) changed = true;
    link.offered = sounds;
  }
  if (JSON.stringify(links) !== before) deps.settings.set(FOLDER_AUDIOS_SETTING, links);
  return changed;
}
