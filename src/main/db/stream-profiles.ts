import { randomUUID } from 'node:crypto';
import type { DeviceChoice, StreamPresetId, StreamProfile, StreamProfileInput } from '../../shared/stream';
import { YOUTUBE_RTMPS_URL } from '../../shared/stream';
import { deviceChoiceSchema } from '../../shared/stream-schema';
import type { Db } from './database';

/*
 * Stream profiles (migration 16): where the stream goes and what it takes
 * in. Never the key: whether a profile has one is asked of the key store.
 */

interface Row {
  id: string;
  name: string;
  rtmp_url: string;
  preset: StreamPresetId;
  camera: string | null;
  sound: string | null;
  sound_delay_ms: number;
  mix_own_sound: number;
}

const COLUMNS = 'id, name, rtmp_url, preset, camera, sound, sound_delay_ms, mix_own_sound';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function device(json: string | null): DeviceChoice | null {
  if (json === null) return null;
  try {
    const parsed = deviceChoiceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class StreamProfileRepo {
  constructor(
    private readonly db: Db,
    /** Whether the key store holds a key for this profile. */
    private readonly hasKey: (id: string) => boolean = () => false,
  ) {}

  private profile(r: Row): StreamProfile {
    return {
      id: r.id,
      name: r.name,
      url: r.rtmp_url,
      preset: r.preset,
      camera: device(r.camera),
      sound: device(r.sound),
      soundDelayMs: r.sound_delay_ms,
      mixOwnSound: r.mix_own_sound === 1,
      hasKey: this.hasKey(r.id),
    };
  }

  list(): StreamProfile[] {
    return (
      this.db
        .prepare(`SELECT ${COLUMNS} FROM stream_profiles ORDER BY position, created_at, rowid`)
        .all() as Row[]
    ).map((r) => this.profile(r));
  }

  get(id: string): StreamProfile | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM stream_profiles WHERE id = ?`).get(id) as
      Row | undefined;
    return row ? this.profile(row) : null;
  }

  create(input: StreamProfileInput): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO stream_profiles (id, name, rtmp_url, preset, camera, sound, sound_delay_ms, mix_own_sound, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM stream_profiles))`,
      )
      .run(
        id,
        input.name,
        input.url,
        input.preset,
        input.camera ? JSON.stringify(input.camera) : null,
        input.sound ? JSON.stringify(input.sound) : null,
        input.soundDelayMs,
        input.mixOwnSound ? 1 : 0,
      );
    return id;
  }

  update(id: string, input: StreamProfileInput): boolean {
    return (
      this.db
        .prepare(
          `UPDATE stream_profiles SET name = ?, rtmp_url = ?, preset = ?, camera = ?, sound = ?, sound_delay_ms = ?,
                  mix_own_sound = ?, updated_at = ${NOW} WHERE id = ?`,
        )
        .run(
          input.name,
          input.url,
          input.preset,
          input.camera ? JSON.stringify(input.camera) : null,
          input.sound ? JSON.stringify(input.sound) : null,
          input.soundDelayMs,
          input.mixOwnSound ? 1 : 0,
          id,
        ).changes > 0
    );
  }

  remove(id: string): boolean {
    return this.db.prepare('DELETE FROM stream_profiles WHERE id = ?').run(id).changes > 0;
  }

  /** The first profile, made (YouTube, good internet, no camera yet) when there is none. */
  ensureOne(): StreamProfile {
    const first = this.list()[0];
    if (first) return first;
    const id = this.create({
      name: 'YouTube',
      url: YOUTUBE_RTMPS_URL,
      preset: 'good',
      camera: null,
      sound: null,
      soundDelayMs: 0,
      mixOwnSound: false,
    });
    const made = this.get(id);
    if (!made) throw new Error('The stream profile was not kept');
    return made;
  }
}
