import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/database';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import type { CommandResult, EngineCommand } from '../../shared/engine/commands';
import type { MusicService } from './music-service';

/*
 * The performance check only (DRASHTI_PERF_MUSIC=1, Session 14): an audio
 * playlist plays while slides change during the big import, to show the
 * music costs the slides nothing. Two generated tones (placeholder sound),
 * in the check's throwaway library. DRASHTI_PERF_SOUND_CUE=1 (Session 15)
 * plays one long tone on the audio layer instead, as a slide's sound cue
 * would: a sound with none of the music's moving on and fading.
 */

function tone(seconds: number, hz: number): Buffer {
  const rate = 22050;
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 2000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** A generated tone in the check's media folder, as a sound in its library. */
function addTone(db: Db, mediaDir: string, name: string, seconds: number, hz: number): string {
  mkdirSync(join(mediaDir, 'perf'), { recursive: true });
  const path = `perf/${name}.wav`;
  writeFileSync(join(mediaDir, path), tone(seconds, hz));
  const id = randomUUID();
  db.prepare("INSERT INTO media (id, kind, name, path) VALUES (?, 'audio', ?, ?)").run(
    id,
    `Placeholder perf ${name}`,
    path,
  );
  return id;
}

export function startPerfMusic(
  db: Db,
  mediaDir: string,
  music: MusicService,
): { summary(): string; stop(): void } {
  const ids = [330, 440].map((hz, i) => addTone(db, mediaDir, `tone-${String(i + 1)}`, 20, hz));
  const repo = new AudioPlaylistRepo(db);
  const playlistId = repo.create('Placeholder perf music');
  repo.addTracks(playlistId, ids, null);
  const played = music.play(playlistId, 0);
  return {
    summary: () =>
      `music ${played.ok ? 'playing (an audio playlist of two tones)' : `not playing (${played.message})`}`,
    stop: () => undefined,
  };
}

/** One long tone on the audio layer, played once, as a slide's sound cue (DRASHTI_PERF_SOUND_CUE=1). */
export function startPerfSoundCue(
  db: Db,
  mediaDir: string,
  engine: { dispatch(command: EngineCommand): CommandResult },
): { summary(): string; stop(): void } {
  const mediaId = addTone(db, mediaDir, 'sound-cue', 180, 392);
  const played = engine.dispatch({
    type: 'playAudio',
    audio: { id: randomUUID(), title: 'Placeholder perf sound cue', mediaId, volume: 1, loop: false },
  });
  return {
    summary: () =>
      `a sound cue ${played.ok ? 'playing (one tone of 3 minutes)' : `not playing (${played.message})`}`,
    stop: () => undefined,
  };
}
