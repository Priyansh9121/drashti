import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/database';
import { AudioPlaylistRepo } from '../db/audio-playlists';
import type { MusicService } from './music-service';

/*
 * The performance check only (DRASHTI_PERF_MUSIC=1, Session 14): an audio
 * playlist plays while slides change during the big import, to show the
 * music costs the slides nothing. Two generated tones (placeholder sound),
 * in the check's throwaway library.
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

export function startPerfMusic(
  db: Db,
  mediaDir: string,
  music: MusicService,
): { summary(): string; stop(): void } {
  mkdirSync(join(mediaDir, 'perf'), { recursive: true });
  const ids: string[] = [];
  for (const [i, hz] of [330, 440].entries()) {
    const path = `perf/tone-${String(i + 1)}.wav`;
    writeFileSync(join(mediaDir, path), tone(20, hz));
    const id = randomUUID();
    db.prepare("INSERT INTO media (id, kind, name, path) VALUES (?, 'audio', ?, ?)").run(
      id,
      `Placeholder perf tone ${String(i + 1)}`,
      path,
    );
    ids.push(id);
  }
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
