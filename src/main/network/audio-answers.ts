import { z } from 'zod';
import { idSchema } from '../../shared/model-schema';
import { musicNameSchema, musicOptionsSchema, type MusicResult } from '../../shared/music';
import type { DeviceAnswer } from '../../shared/network-api';
import type { RemoteAudio } from '../../shared/network-mirror';
import type { MusicService } from '../music/music-service';

export interface AudioActs {
  music: Pick<
    MusicService,
    | 'view'
    | 'create'
    | 'rename'
    | 'remove'
    | 'restore'
    | 'setOptions'
    | 'addTracks'
    | 'moveTrack'
    | 'removeTrack'
    | 'restoreTrack'
  >;
  stepsAside(): boolean;
  setStepsAside(on: boolean): void;
}

type AudioOp =
  | 'music.audio'
  | 'music.new'
  | 'music.rename'
  | 'music.remove'
  | 'music.restore'
  | 'music.options'
  | 'music.addTracks'
  | 'music.moveTrack'
  | 'music.removeTrack'
  | 'music.restoreTrack'
  | 'music.stepsAside';

const playlist = z.object({ playlistId: idSchema }).strict();
const track = z.object({ trackId: idSchema }).strict();
const position = z.number().int().min(0).max(100_000);

const newPlaylist = z.object({ name: musicNameSchema }).strict();
const renamed = playlist.extend(newPlaylist.shape);
const options = playlist.extend(musicOptionsSchema.shape);
const addTracks = playlist.extend({
  mediaIds: idSchema.array().min(1).max(500),
  at: position.nullable().default(null),
});
const moveTrack = track.extend({ to: position });
const restoreTrack = track.extend({ at: position });
const stepsAside = z.object({ on: z.boolean() }).strict();

const ok = (audio: RemoteAudio): DeviceAnswer => ({ status: 200, body: { ok: true, ...audio } });
const deny = (status: number, message: string): DeviceAnswer => ({ status, body: { ok: false, message } });

/** Audio requests from paired Remotes, checked by NetworkService before they reach the music service. */
export function audioAnswer(op: AudioOp, args: Record<string, unknown>, acts: AudioActs): DeviceAnswer {
  const music = acts.music;
  const view = () => ok({ view: music.view(), stepsAside: acts.stepsAside() });
  const done = (result: MusicResult) =>
    result.ok
      ? ok({ view: result.view, stepsAside: acts.stepsAside(), ...(result.id ? { id: result.id } : {}) })
      : deny(409, result.message);

  switch (op) {
    case 'music.audio':
      return view();
    case 'music.new': {
      const a = newPlaylist.safeParse(args);
      return a.success
        ? done(music.create(a.data.name))
        : deny(400, 'Give the audio playlist a name (up to 120 characters).');
    }
    case 'music.rename': {
      const a = renamed.safeParse(args);
      return a.success
        ? done(music.rename(a.data.playlistId, a.data.name))
        : deny(400, 'Choose the audio playlist and give it a name (up to 120 characters).');
    }
    case 'music.remove':
    case 'music.restore': {
      const a = playlist.safeParse(args);
      if (!a.success) return deny(400, 'Choose an audio playlist.');
      return done(op === 'music.remove' ? music.remove(a.data.playlistId) : music.restore(a.data.playlistId));
    }
    case 'music.options': {
      const a = options.safeParse(args);
      if (!a.success) return deny(400, 'Choose the audio playlist and whether to loop or shuffle it.');
      const { playlistId, loop, shuffle } = a.data;
      return done(music.setOptions(playlistId, { loop, shuffle }));
    }
    case 'music.addTracks': {
      const a = addTracks.safeParse(args);
      return a.success
        ? done(music.addTracks(a.data.playlistId, a.data.mediaIds, a.data.at))
        : deny(400, 'Choose sounds from the library to add to this audio playlist.');
    }
    case 'music.moveTrack': {
      const a = moveTrack.safeParse(args);
      return a.success
        ? done(music.moveTrack(a.data.trackId, a.data.to))
        : deny(400, 'Choose the track to move and where it goes.');
    }
    case 'music.removeTrack': {
      const a = track.safeParse(args);
      return a.success ? done(music.removeTrack(a.data.trackId)) : deny(400, 'Choose a track to remove.');
    }
    case 'music.restoreTrack': {
      const a = restoreTrack.safeParse(args);
      return a.success
        ? done(music.restoreTrack(a.data.trackId, a.data.at))
        : deny(400, 'Choose the track to put back and where it goes.');
    }
    case 'music.stepsAside': {
      const a = stepsAside.safeParse(args);
      if (!a.success) return deny(400, 'Choose whether music steps aside under a video with sound.');
      acts.setStepsAside(a.data.on);
      return view();
    }
  }
}
