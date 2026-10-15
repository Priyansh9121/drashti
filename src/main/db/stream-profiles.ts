import { randomUUID } from 'node:crypto';
import type {
  DeviceChoice,
  StreamDestination,
  StreamPresetId,
  StreamProfile,
  StreamProfileInput,
} from '../../shared/stream';
import { YOUTUBE_RTMPS_URL } from '../../shared/stream';
import { deviceChoiceSchema } from '../../shared/stream-schema';
import type { Db } from './database';

/*
 * Stream profiles (migration 16): where the stream goes and what it takes
 * in. Never the key: whether a profile has one is asked of the key store.
 * Since migration 41 (Session 28), up to two more places beside its own
 * address, each with its own key in the key store, by the place's id.
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

  /** A profile's other places, in order. */
  private more(profileId: string): StreamDestination[] {
    return (
      this.db
        .prepare('SELECT id, url FROM stream_destinations WHERE profile_id = ? ORDER BY position')
        .all(profileId) as { id: string; url: string }[]
    ).map((d) => ({ id: d.id, url: d.url, hasKey: this.hasKey(d.id) }));
  }

  /** The other places as given: kept by their ids (a new one gets one), the rest gone; their ids. */
  private setMore(profileId: string, more: readonly { id?: string; url: string }[]): void {
    const mine = new Set(this.more(profileId).map((d) => d.id));
    this.db.prepare('DELETE FROM stream_destinations WHERE profile_id = ?').run(profileId);
    const insert = this.db.prepare(
      'INSERT INTO stream_destinations (id, profile_id, url, position) VALUES (?, ?, ?, ?)',
    );
    more.slice(0, 2).forEach((d, i) => {
      // An id that is not one of this profile's own is never taken over: a new place.
      insert.run(d.id && mine.has(d.id) ? d.id : randomUUID(), profileId, d.url, i + 1);
    });
  }

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
      more: this.more(r.id),
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
    this.db.transaction(() => {
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
      this.setMore(id, input.more ?? []);
    })();
    return id;
  }

  update(id: string, input: StreamProfileInput): boolean {
    return this.db.transaction(() => {
      const changed =
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
          ).changes > 0;
      // Left out: the other places stay as they are.
      if (changed && input.more) this.setMore(id, input.more);
      return changed;
    })();
  }

  /** The ids of every key a profile has: its own, and its other places'. */
  keyIds(id: string): string[] {
    return [id, ...this.more(id).map((d) => d.id)];
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
