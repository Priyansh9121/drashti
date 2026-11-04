import { parseCaptionSettings, type CaptionSettings } from '../../shared/captions';
import type { Db } from './database';

/** Live captions' settings in the library (Session 55, Part 10, migration 066): one row. */
export class CaptionSettingsRepo {
  constructor(private readonly db: Db) {}

  get(): CaptionSettings {
    const row = this.db
      .prepare('SELECT language, audience, size, place FROM caption_settings WHERE id = 1')
      .get() as { language: string; audience: number; size: string; place: string } | undefined;
    return parseCaptionSettings(row && { ...row, audience: row.audience === 1 });
  }

  set(settings: CaptionSettings): void {
    const s = parseCaptionSettings(settings);
    this.db
      .prepare(
        `INSERT INTO caption_settings (id, language, audience, size, place) VALUES (1, @language, @audience, @size, @place)
         ON CONFLICT (id) DO UPDATE SET language = @language, audience = @audience, size = @size, place = @place`,
      )
      .run({ language: s.language, audience: s.audience ? 1 : 0, size: s.size, place: s.place });
  }
}
