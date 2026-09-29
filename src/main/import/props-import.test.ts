import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TextElement } from '../../shared/model';
import { openDatabase } from '../db/database';
import { ImportRepo } from '../db/imports';
import { PropRepo } from '../db/props';
import { MediaStore } from './media-store';
import { runImport } from './pipeline';
import { cocoaRtf, pp6Presentation } from './testing/pp6-fixtures';
import { pp7Props } from './testing/pp7-fixtures';

/* Props from both formats' props files. Placeholder text and made-up paths only. */

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
  return { db, write, run, props: new PropRepo(db) };
}

const textOf = (el: unknown) => (el as TextElement).text;

describe('importing props', () => {
  it('reads a ProPresenter 6 Props.pro6: one prop per slide, named by its label', async () => {
    const t = setup();
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
              { label: '', text: [{ rtf: cocoaRtf([['Placeholder second prop', 40, [255, 255, 255]]]) }] },
            ],
          },
        ],
      }),
    );
    const report = await t.run([file]);
    expect(report?.items[0]).toMatchObject({ outcome: 'imported', format: 'pp6' });
    expect(t.props.list().map((p) => [p.name, p.imported, p.width, textOf(p.elements[0])])).toEqual([
      ['Placeholder logo line', true, 1920, 'Placeholder Mandir'],
      ['Prop 2', true, 1920, 'Placeholder second prop'],
    ]);
    // Importing the file again replaces its props; props made in Drashti stay.
    t.props.create({ name: 'Mine', width: 1920, height: 1080, elements: t.props.list()[0]?.elements ?? [] });
    await t.run([file]);
    expect(
      t.props
        .list()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Mine', 'Placeholder logo line', 'Prop 2']);
  });

  it('reads a ProPresenter 7 Configuration/Props file', async () => {
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
    expect(report?.items[0]).toMatchObject({ outcome: 'imported', format: 'pp7' });
    const [prop] = t.props.list();
    expect(prop).toMatchObject({ name: 'Placeholder corner line', imported: true });
    expect(textOf(prop?.elements[0])).toBe('Placeholder PP7 prop');
  });

  it('still reports the other settings files as not imported', async () => {
    const t = setup();
    const file = t.write(join('Configuration', 'Timers'), new Uint8Array([8, 1]));
    const report = await t.run([file]);
    expect(report?.items[0]).toMatchObject({ outcome: 'unsupported' });
    expect(t.props.list()).toEqual([]);
  });
});
