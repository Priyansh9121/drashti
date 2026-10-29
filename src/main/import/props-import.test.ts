import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { cocoaRtf, pp6Presentation } from './testing/pp6-fixtures';
import { pp7Props } from './testing/pp7-fixtures';

/*
 * Props files from both formats (Session 55, Part 12: Props are gone from Drashti): left out, said in the report, never
 * imported; props an earlier import kept stay in the library, unseen. Placeholder text and made-up paths only.
 */

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-props-'));
  const source = join(dir, 'source');
  mkdirSync(source);
  mkdirSync(join(dir, 'Media'));
  mkdirSync(join(dir, 'temp'));
  const db = openDatabase(join(dir, 'drashti.sqlite'));
  const media = new MediaStore(db, { dir: join(dir, 'Media'), freeBytes: () => 1024 ** 4, reserveBytes: 0 });
  const write = (rel: string, content: string | Uint8Array) => {
    const full = join(source, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
    return full;
  };
  const run = async (paths: string[]) => {
    const summary = await runImport({
      db,
      media,
      runId: randomUUID(),
      paths,
      options: {},
      tempDir: join(dir, 'temp'),
      progressEveryMs: 0,
    });
    return new ImportRepo(db).report(summary.id);
  };
  /** The library's props rows, by name (kept, unseen). */
  const props = () =>
    (db.prepare('SELECT name FROM props ORDER BY name').all() as { name: string }[]).map((r) => r.name);
  return { db, write, run, props };
}

describe('importing a props file (Props are gone)', () => {
  it('leaves a ProPresenter 6 Props.pro6 out, saying why; props kept before stay', async () => {
    const t = setup();
    t.db
      .prepare("INSERT INTO props (id, name, definition) VALUES ('kept', 'Placeholder kept prop', '{}')")
      .run();
    const file = t.write(
      'Props.pro6',
      pp6Presentation({
        uuid: 'PROPS',
        groups: [
          {
            name: 'Props',
            slides: [
              {
                label: 'Placeholder logo line',
                text: [{ rtf: cocoaRtf([['Placeholder Mandir', 40, [255, 255, 255]]]) }],
              },
            ],
          },
        ],
      }),
    );
    const report = await t.run([file]);
    expect(report?.items[0]).toMatchObject({
      outcome: 'skipped',
      format: 'pp6',
      message: 'Drashti no longer has props, so this file of props was left out.',
    });
    expect(t.props()).toEqual(['Placeholder kept prop']);
  });

  it('leaves a ProPresenter 7 Configuration/Props file out, saying why', async () => {
    const t = setup();
    const file = t.write(
      join('Configuration', 'Props'),
      pp7Props([
        {
          id: 'prop-1',
          name: 'Placeholder corner line',
          slide: { id: 's1', text: [{ rtf: cocoaRtf([['Placeholder PP7 prop', 36, [255, 255, 255]]]) }] },
        },
      ]),
    );
    const report = await t.run([file]);
    expect(report?.items[0]).toMatchObject({ outcome: 'skipped', format: 'pp7' });
    expect(t.props()).toEqual([]);
  });

  it('still reports the other settings files as not imported', async () => {
    const t = setup();
    const file = t.write(join('Configuration', 'Timers'), new Uint8Array([8, 1]));
    const report = await t.run([file]);
    expect(report?.items[0]).toMatchObject({ outcome: 'unsupported' });
    expect(t.props()).toEqual([]);
  });
});
