import { describe, expect, it } from 'vitest';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import { openDatabase } from '../db/database';
import { PlaylistRepo } from '../db/playlists';
import { FOLDER_AUDIOS_SETTING, syncFolderAudios } from './folder-audios';

function library() {
  const db = openDatabase(':memory:');
  const playlists = new PlaylistRepo(db);
  const audio = new AudioPlaylistRepo(db);
  const kept = new Map<string, unknown>();
  const settings = { get: (k: string) => kept.get(k), set: (k: string, v: unknown) => kept.set(k, v) };
  const media = (id: string, kind: 'audio' | 'video') =>
    db
      .prepare('INSERT INTO media (id, kind, name, path, playable) VALUES (?, ?, ?, ?, 1)')
      .run(id, kind, `${id}.${kind === 'audio' ? 'mp3' : 'mp4'}`, `x/${id}`);
  media('bhajan', 'audio');
  media('talk', 'audio');
  media('dhun', 'audio');
  media('clip', 'video');
  const deps = { playlists, audio, settings };
  const tracks = (name: string) =>
    audio
      .list()
      .find((p) => p.name === name)
      ?.tracks.map((t) => t.mediaId);
  return { db, playlists, audio, kept, deps, tracks };
}

describe('a folder’s sounds also in Audio, as “<folder> - Audios” (Session 44)', () => {
  it('makes one for a folder playlist that holds sounds, the same sounds in its order, and keeps it in step', () => {
    const { playlists, audio, deps, tracks } = library();
    const smart = playlists.createSmart('Placeholder Sabha', '/placeholder/Sabha');
    playlists.addItems(smart, null, [
      { kind: 'media', mediaId: 'bhajan' },
      { kind: 'header', label: 'Week 1' },
      { kind: 'media', mediaId: 'clip' },
      { kind: 'media', mediaId: 'talk' },
    ]);
    expect(syncFolderAudios(deps)).toBe(true);
    expect(tracks('Placeholder Sabha - Audios')).toEqual(['bhajan', 'talk']);
    // Nothing new: nothing changes.
    expect(syncFolderAudios(deps)).toBe(false);
    // A sound joins the folder's playlist: it joins at the end.
    playlists.addItems(smart, 1, [{ kind: 'media', mediaId: 'dhun' }]);
    syncFolderAudios(deps);
    expect(tracks('Placeholder Sabha - Audios')).toEqual(['bhajan', 'talk', 'dhun']);
    // One leaves the playlist: it leaves the audio playlist.
    const talk = playlists.itemsOf(smart).find((i) => i.kind === 'media' && i.mediaId === 'talk');
    playlists.removeItems([talk?.id ?? '']);
    syncFolderAudios(deps);
    expect(tracks('Placeholder Sabha - Audios')).toEqual(['bhajan', 'dhun']);
    // The operator takes a track out: it is not put back.
    const list = audio.list().find((p) => p.name === 'Placeholder Sabha - Audios');
    audio.removeTrack(list?.tracks[0]?.id ?? '');
    syncFolderAudios(deps);
    expect(tracks('Placeholder Sabha - Audios')).toEqual(['dhun']);
    // Only one, ever.
    expect(audio.list().filter((p) => p.name.endsWith(' - Audios'))).toHaveLength(1);
  });

  it('makes none for a folder playlist without sounds, nor for a playlist of the operator’s own; deleted, it stays deleted', () => {
    const { playlists, audio, deps, kept } = library();
    const pictures = playlists.createSmart('Placeholder Pictures', '/placeholder/Pictures');
    playlists.addItems(pictures, null, [{ kind: 'media', mediaId: 'clip' }]);
    const own = playlists.create('Placeholder Own', null, false) ?? '';
    playlists.addItems(own, null, [{ kind: 'media', mediaId: 'bhajan' }]);
    syncFolderAudios(deps);
    expect(audio.list()).toEqual([]);
    // A sound joins the folder's playlist: now it has one.
    playlists.addItems(pictures, null, [{ kind: 'media', mediaId: 'talk' }]);
    syncFolderAudios(deps);
    const made = audio.list().find((p) => p.name === 'Placeholder Pictures - Audios');
    expect(made?.tracks.map((t) => t.mediaId)).toEqual(['talk']);
    expect(kept.get(FOLDER_AUDIOS_SETTING)).toEqual({ [pictures]: { audio: made?.id, offered: ['talk'] } });
    // Deleted by the operator: not made again, even as more sounds join; Undo brings it back into step.
    audio.remove(made?.id ?? '');
    playlists.addItems(pictures, null, [{ kind: 'media', mediaId: 'dhun' }]);
    syncFolderAudios(deps);
    expect(audio.list()).toEqual([]);
    audio.restore(made?.id ?? '');
    syncFolderAudios(deps);
    expect(audio.list()[0]?.tracks.map((t) => t.mediaId)).toEqual(['talk', 'dhun']);
  });
});
