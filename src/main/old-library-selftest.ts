import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { langSchema } from '../shared/model-schema';
import type { DisplayInfo } from '../shared/screens';
import { LANGS } from '../shared/model';
import { DEFAULT_THEME } from '../shared/themes';
import { openDatabase } from './db/database';
import { MIGRATIONS } from './db/migrate';
import { ThemeRepo } from './db/themes';

/*
 * For the end-to-end tests only (DRASHTI_SELFTEST=old-library, never in a
 * packaged Drashti): a library written as an older Drashti kept it, at the
 * schema version given, with screen groups and screens as that version
 * stored them. The test then starts Drashti on it, so the upgrade runs in the
 * real app (Session 11: each group's languages moving into the Looks).
 *
 * From schema 20 on, each group's languages are in the first Look ("Standard"), as Drashti kept them from Session
 * 11. `held` (schema 49, alpha.13's, and later; Session 55, Part 12) also writes what Part 12 took out of the
 * window, as alpha.13 kept it: a prop marked as the logo, a mask, a quote, the idle rotation's settings, a second
 * Look, and in the first Look the hall's own mask, the idle rotation always, Bold and its ticker left out; and a
 * theme of its own (every language's words orange) as the library's default. Placeholder names and words only.
 */

/** The latest schema Drashti knows. */
const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

const requestSchema = z.object({
  /** The schema version to stop at (19: Session 10, before Looks; 49: alpha.13's). */
  schema: z.number().int().min(12).max(LATEST),
  groups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.enum(['audience', 'stage']),
        languages: z.array(langSchema).min(1).max(4).nullable(),
        /** Which display (by its place in the list) its one screen uses. */
        display: z.number().int().min(0).max(8),
      }),
    )
    .max(8),
  held: z.boolean().optional(),
});

/** The colour every language's words are in the held library's own theme. */
export const HELD_THEME_COLOR = '#ff9900';

export function writeOldLibrary(file: string, raw: string, displays: readonly DisplayInfo[]): void {
  const request = requestSchema.parse(JSON.parse(raw));
  if (request.held && request.schema < 49)
    throw new Error('What Part 12 took out is written at schema 49 or later');
  const looks = request.schema >= 20;
  const db = openDatabase(
    file,
    MIGRATIONS.filter((m) => m.version <= request.schema),
  );
  try {
    db.transaction(() => {
      const languages: Record<string, unknown> = {};
      const ids = request.groups.map((g, position) => {
        const groupId = randomUUID();
        if (looks) {
          db.prepare('INSERT INTO screen_groups (id, name, role, position) VALUES (?, ?, ?, ?)').run(
            groupId,
            g.name,
            g.role,
            position,
          );
          if (g.languages) languages[groupId] = { languages: g.languages };
        } else
          db.prepare(
            'INSERT INTO screen_groups (id, name, role, position, languages) VALUES (?, ?, ?, ?, ?)',
          ).run(groupId, g.name, g.role, position, g.languages ? JSON.stringify(g.languages) : null);
        const display = displays[g.display];
        if (!display) throw new Error(`There is no display ${g.display}`);
        db.prepare(
          'INSERT INTO screens (id, group_id, name, display_key, position) VALUES (?, ?, ?, ?, 0)',
        ).run(randomUUID(), groupId, `${g.name} screen`, JSON.stringify(display.key));
        return groupId;
      });
      if (!looks) return;
      const first = db.prepare('SELECT id FROM looks ORDER BY position, rowid LIMIT 1').get() as
        { id: string } | undefined;
      if (!first) throw new Error('There is no Look');
      if (!request.held) {
        db.prepare('UPDATE looks SET definition = ? WHERE id = ?').run(
          JSON.stringify({ groups: languages }),
          first.id,
        );
        return;
      }
      const setting = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)');
      const propId = randomUUID();
      db.prepare('INSERT INTO props (id, name, definition) VALUES (?, ?, ?)').run(
        propId,
        'Placeholder logo',
        JSON.stringify({ width: 1920, height: 1080, elements: [], imported: false }),
      );
      setting.run('setting.logoPropId', JSON.stringify(propId));
      const maskId = randomUUID();
      db.prepare('INSERT INTO masks (id, name, definition, position) VALUES (?, ?, ?, 0)').run(
        maskId,
        'Placeholder corner',
        JSON.stringify({ width: 1920, height: 1080, shapes: [] }),
      );
      db.prepare('INSERT INTO quotes (id, words, attribution, position) VALUES (?, ?, ?, 0)').run(
        randomUUID(),
        JSON.stringify({ en: 'Placeholder quote of the day' }),
        'Placeholder',
      );
      setting.run(
        'setting.idleRotation',
        JSON.stringify({ pictures: [], secondsEach: 10, quoteOfTheDay: true }),
      );
      // The hall (the first group) with its own mask, the idle rotation always, Bold and no ticker, in the first Look.
      const hall = ids[0];
      const groups: Record<string, unknown> = { ...languages };
      if (hall)
        groups[hall] = {
          ...(languages[hall] as object | undefined),
          layers: ['background', 'slide', 'props', 'messages', 'masks'],
          maskId,
          idle: 'always',
          movement: 'bold',
        };
      db.prepare('UPDATE looks SET definition = ? WHERE id = ?').run(JSON.stringify({ groups }), first.id);
      db.prepare(
        "INSERT INTO looks (id, name, definition, source_kind, position) VALUES (?, 'Placeholder festival', ?, 'drashti', 1)",
      ).run(randomUUID(), JSON.stringify({ groups: hall ? { [hall]: { languages: ['en'] } } : {} }));
      const themes = new ThemeRepo(db);
      const orange = { ...DEFAULT_THEME.langs.en, color: HELD_THEME_COLOR };
      const theme = themes.create({
        ...DEFAULT_THEME,
        name: 'Placeholder warm theme',
        langs: Object.fromEntries(
          LANGS.map((l) => [l, { ...DEFAULT_THEME.langs[l], ...orange, font: null }]),
        ) as typeof DEFAULT_THEME.langs,
      });
      themes.setDefault(theme);
    })();
  } finally {
    db.close();
  }
}
