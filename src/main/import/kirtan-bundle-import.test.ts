import { randomUUID, createHash } from 'node:crypto';
import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportRepo } from '../db/imports';
import { PresentationRepo } from '../db/presentations';
import { SettingsRepo } from '../db/settings';
import { MediaRepo } from '../db/media';
import { PLAIN } from '../../shared/picture-look';
import type { ImportOptions } from '../../shared/import';
import type { BundleKirtan, BundleManifest } from './kirtan-bundle-schema';
import { runImport } from './pipeline';
import { exportKirtanBundle, withKirtanBundle, BUNDLE_LIMITS } from './kirtan-bundle';
import { makeZip, type ZipWriterEntry } from './testing/zip-writer';
import { bundleLibrary, must } from './testing/kirtan-bundle-fixture';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function setup() {
  const source = await bundleLibrary();
  const target = await bundleLibrary();
  // Truly fresh receiving library: the helper's seed is removed before importing.
  target.db.prepare('DELETE FROM presentations').run();
  target.db.prepare('DELETE FROM media').run();
  await source.exportBundle();
  const run = async (path = source.output, options: ImportOptions = {}) => {
    const wrote: {
      presentationId: string;
      replaced: boolean;
    }[] = [];
    const summary = await runImport({
      db: target.db,
      media: target.media,
      runId: randomUUID(),
      paths: [path],
      options,
      tempDir: target.dir,
      onWrote: (w) => wrote.push(w),
      freeBytes: () => 1024 ** 4,
    });
    return { summary, report: must(new ImportRepo(target.db).report(summary.id)), wrote };
  };
  const content = () => {
    const id = target.db
      .prepare('SELECT id FROM presentations WHERE deleted_at IS NULL')
      .pluck()
      .get() as string;
    return must(new PresentationRepo(target.db).content(id));
  };
  return { source, target, run, content };
}
describe('kirtan bundle import and re-import', () => {
  it('updates an incoming title when this library has not edited the kirtan', async () => {
    const t = await setup();
    await t.run();
    const id = t.content().presentationId;
    t.source.db
      .prepare("UPDATE presentations SET name = 'Placeholder incoming title' WHERE id = ?")
      .run(t.source.id);
    await t.source.exportBundle();
    expect((await t.run()).report.items[0]?.outcome).toBe('replaced');
    expect(t.target.repo.get(id)?.name).toBe('Placeholder incoming title');
    expect(t.content().presentationId).toBe(id);
  });

  it('reports cancellation during bundle validation without a failed-file notice or library writes', async () => {
    const t = await setup();
    const stopper = new AbortController();
    const summary = await runImport({
      db: t.target.db,
      media: t.target.media,
      runId: randomUUID(),
      paths: [t.source.output],
      options: {},
      signal: stopper.signal,
      isCancelled: () => stopper.signal.aborted,
      tempDir: t.target.dir,
      progressEveryMs: 0,
      onProgress: (p) => {
        if (p.phase === 'importing' && p.current !== null) stopper.abort();
      },
    });
    expect(summary.status).toBe('cancelled');
    expect(summary.totals.failed).toBe(0);
    expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(0);
    expect((await readdir(t.target.dir)).filter((n) => n.startsWith('drashti-kirtan-import-'))).toEqual([]);
  });
  it('keeps attached media points and picture looks, including a generated picture', async () => {
    const t = await setup();
    const bmp = Buffer.alloc(58);
    bmp.write('BM');
    bmp.writeUInt32LE(58, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeUInt32LE(1, 18);
    bmp.writeUInt32LE(1, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    bmp[54] = 68;
    bmp[55] = 85;
    bmp[56] = 102;
    const picture = join(t.source.dir, 'Placeholder pixel.bmp');
    await writeFile(picture, bmp);
    const imported = await t.source.media.importFile(picture, { kind: 'media', path: picture });
    if (!('mediaId' in imported)) throw new Error('Generated pixel was not imported');
    const rows = must(t.source.repo.content(t.source.id));
    rows.elements.push({
      id: randomUUID(),
      slide_id: must(rows.slides[0]).id,
      position: 1,
      kind: 'image',
      x: 10,
      y: 20,
      width: 100,
      height: 100,
      rotation: 0,
      props: JSON.stringify({ mediaId: imported.mediaId, fit: 'fit' }),
    });
    t.source.repo.setContent(rows);
    const look = { ...PLAIN, brightness: 0.2, turn: 90 as const };
    const points = {
      startMs: 0,
      endMs: 1,
      markers: [{ id: 'placeholder-marker', name: 'Placeholder mark', atMs: 0 }],
    };
    new MediaRepo(t.source.db).setLook(imported.mediaId, look);
    new MediaRepo(t.source.db).setMarkers(must(rows.kirtan?.row.audio_media_id), points);
    await t.source.exportBundle();
    await t.run();
    const images = t.target.db.prepare("SELECT id FROM media WHERE kind = 'image'").get() as
      { id: string } | undefined;
    expect(new MediaRepo(t.target.db).look(must(images).id)).toEqual(look);
    expect(new MediaRepo(t.target.db).markersOf(must(t.content().kirtan?.row.audio_media_id))).toEqual(
      points,
    );
  });

  it('can supply media omitted from the first bundle and preserves locally edited notes', async () => {
    const t = await setup();
    await t.source.exportBundle(false);
    await t.run();
    const id = t.content().presentationId;
    await t.source.exportBundle(true);
    expect((await t.run()).report.items[0]?.outcome).toBe('replaced');
    const audioId = t.content().kirtan?.row.audio_media_id;
    expect(t.target.db.prepare('SELECT missing FROM media WHERE id = ?').pluck().get(audioId)).toBe(0);
    t.target.db.prepare("UPDATE presentations SET notes = 'Placeholder local notes' WHERE id = ?").run(id);
    expect((await t.run()).report.items[0]?.issues[0]?.code).toBe('bundle-local-edit');
    expect(t.target.db.prepare('SELECT notes FROM presentations WHERE id = ?').pluck().get(id)).toBe(
      'Placeholder local notes',
    );
  });
  it('imports everything into a fresh library through the normal import pipeline, with one report per kirtan', async () => {
    const t = await setup();
    const { summary, report, wrote } = await t.run();
    expect(summary.totals).toMatchObject({
      presentations: 1,
      groups: 2,
      arrangements: 1,
      media: 1,
      failed: 0,
    });
    expect(report.items).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      format: 'kirtan-bundle',
      outcome: 'imported',
      target: { kind: 'presentation' },
    });
    const rows = t.content();
    expect(rows.kirtan?.row).toMatchObject({ kavi: 'Placeholder poet', raag: 'Placeholder raag' });
    expect(rows.arrangementEntries.map((r) => r.group_id)).toEqual([
      must(rows.groups[0]).id,
      must(rows.groups[1]).id,
      must(rows.groups[0]).id,
    ]);
    expect(rows.selectedArrangementId).toBe(must(rows.arrangements[0]).id);
    expect(rows.slides[1]?.enabled).toBe(0);
    expect(rows.slides[0]?.notes).toBe('Placeholder slide notes');
    expect(rows.autoLines).toEqual([
      { slide_id: must(rows.slides[0]).id, lang: 'translit', text: 'Placeholder roman' },
    ]);
    expect(rows.elements[0]?.props).toContain('translit');
    const media = t.target.db.prepare('SELECT id, path FROM media').get() as {
      id: string;
      path: string;
    };
    expect(await readFile(join(t.target.mediaDir, media.path))).toEqual(t.source.wav);
    expect(rows.kirtan?.row.audio_media_id).toBe(media.id);
    expect(rows.cues[0]?.media_id).toBe(media.id);
    expect(wrote).toEqual([{ presentationId: rows.presentationId, replaced: false }]);
    expect(rows.presentationId).not.toBe(t.source.id);
    expect(must(rows.groups[0]).id).not.toBe(must(must(t.source.repo.content(t.source.id)).groups[0]).id);
    // No live/recovery state is written by an import.
    expect(new SettingsRepo(t.target.db).get('engineState')).toBeUndefined();
  });
  it('recognizes an identical bundle copied and renamed, then updates a changed kirtan in place', async () => {
    const t = await setup();
    await t.run();
    const before = t.content();
    const renamed = join(t.source.dir, 'Renamed.drashti-kirtans');
    await copyFile(t.source.output, renamed);
    expect((await t.run(renamed)).report.items[0]?.outcome).toBe('skipped');
    const rows = must(t.source.repo.content(t.source.id));
    must(rows.kirtan).row.raag = 'Placeholder changed raag';
    t.source.repo.setContent(rows);
    await t.source.exportBundle();
    const replaced = await t.run();
    expect(replaced.report.items[0]?.outcome).toBe('replaced');
    expect(t.content().presentationId).toBe(before.presentationId);
    expect(t.content().groups.map((g) => g.id)).toEqual(before.groups.map((g) => g.id));
    expect(must(t.content().kirtan).row.raag).toBe('Placeholder changed raag');
    expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(1);
  });
  it('keeps a local text/detail edit and reports it even when replace is requested; never duplicates it', async () => {
    const t = await setup();
    await t.run();
    const local = t.content();
    must(local.kirtan).row.kavi = 'Placeholder local poet';
    t.target.repo.setContent(local);
    const remote = must(t.source.repo.content(t.source.id));
    must(remote.kirtan).row.kavi = 'Placeholder incoming poet';
    t.source.repo.setContent(remote);
    await t.source.exportBundle();
    const result = await t.run(t.source.output, { onConflict: 'replace' });
    expect(result.report.items[0]).toMatchObject({
      outcome: 'skipped',
      issues: [{ code: 'bundle-local-edit' }],
    });
    expect(must(t.content().kirtan).row.kavi).toBe('Placeholder local poet');
    expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(1);
  });
  it('leaves a locally deleted kirtan deleted, and keeps unrelated same-name kirtans separate', async () => {
    const t = await setup();
    await t.run();
    t.target.db.prepare("UPDATE presentations SET deleted_at = '2026-01-01T00:00:00Z'").run();
    expect((await t.run()).report.items[0]?.outcome).toBe('skipped');
    expect(
      t.target.db.prepare('SELECT count(*) FROM presentations WHERE deleted_at IS NULL').pluck().get(),
    ).toBe(0);
    const other = await bundleLibrary();
    await other.exportBundle();
    expect((await t.run(other.output)).report.items[0]?.outcome).toBe('imported');
    expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(2);
  });
  it('keeps media omitted from the ZIP as a named missing item, with a useful report', async () => {
    const t = await setup();
    await t.source.exportBundle(false);
    const result = await t.run();
    expect(result.report.items[0]?.issues.some((i) => i.code === 'missing-media')).toBe(true);
    expect(t.target.db.prepare('SELECT name, missing FROM media').get()).toMatchObject({
      name: 'Placeholder.wav',
      missing: 1,
    });
    expect(must(t.content().kirtan).row.audio_media_id).not.toBeNull();
  });
  it('can export the received item and return it to its origin without duplicating that kirtan', async () => {
    const t = await setup();
    await t.run();
    const output = join(t.target.dir, 'Return.drashti-kirtans');
    await exportKirtanBundle({
      db: t.target.db,
      mediaDir: t.target.mediaDir,
      presentationIds: [t.content().presentationId],
      output,
      includeMedia: true,
    });
    const back = await runImport({
      db: t.source.db,
      media: t.source.media,
      runId: randomUUID(),
      paths: [output],
      options: {},
      tempDir: t.source.dir,
    });
    expect(back.totals.failed).toBe(0);
    expect(t.source.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(1);
  });
});
describe('damaged and hostile kirtan bundles', () => {
  async function parts(t: Awaited<ReturnType<typeof setup>>) {
    return withKirtanBundle(t.source.output, {}, async (b) => {
      const k = must(b.manifest.kirtans[0]);
      return [
        { name: 'manifest.json', data: JSON.stringify(b.manifest) },
        { name: k.entry, data: JSON.stringify(b.kirtans[0]) },
        ...(await Promise.all(
          b.media
            .filter((m) => m.path)
            .map(async (m) => ({ name: must(m.entry), data: await readFile(must(m.path)) })),
        )),
      ];
    });
  }

  for (const field of [
    'darken',
    'transition',
    'editor_design',
    'editor_guides',
    'deck',
    'document_page',
    'page_size',
  ] as const)
    it(`refuses invalid nested ${field} JSON with an otherwise matching checksum`, async () => {
      const t = await setup();
      const entries = await parts(t);
      const doc = JSON.parse(String(must(entries[1]).data)) as BundleKirtan;
      must(doc.content.slides[0])[field] = '{damaged';
      const bytes = Buffer.from(JSON.stringify(doc));
      const manifest = JSON.parse(String(must(entries[0]).data)) as BundleManifest;
      must(manifest.kirtans[0]).sha256 = hash(bytes);
      must(manifest.kirtans[0]).bytes = bytes.length;
      const path = join(t.source.dir, 'Nested damaged.drashti-kirtans');
      await writeFile(
        path,
        makeZip([
          { name: 'manifest.json', data: JSON.stringify(manifest) },
          { ...must(entries[1]), data: bytes },
          ...entries.slice(2),
        ]),
      );
      expect((await t.run(path)).summary.totals.failed).toBe(1);
      expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(0);
    });

  it('validates every kirtan before applying a multi-kirtan bundle, including repeated made-line keys', async () => {
    const t = await setup();
    const entries = await parts(t);
    const second = JSON.parse(String(must(entries[1]).data)) as BundleKirtan;
    const id = randomUUID();
    second.content.presentationId = id;
    second.content.autoLines.push(must(second.content.autoLines[0]));
    const bytes = Buffer.from(JSON.stringify(second));
    const manifest = JSON.parse(String(must(entries[0]).data)) as BundleManifest;
    const entry = `kirtans/${id}.json`;
    manifest.kirtans.push({ id, entry, sha256: hash(bytes), bytes: bytes.length });
    const path = join(t.source.dir, 'Two with one damaged.drashti-kirtans');
    await writeFile(
      path,
      makeZip([
        { name: 'manifest.json', data: JSON.stringify(manifest) },
        ...entries.slice(1),
        { name: entry, data: bytes },
      ]),
    );
    expect((await t.run(path)).summary.totals.failed).toBe(1);
    expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(0);
  });
  const attacks: {
    name: string;
    change: (entries: ZipWriterEntry[]) => ZipWriterEntry[] | Buffer;
  }[] = [
    { name: 'truncated archive', change: () => Buffer.from('PK\x03\x04') },
    { name: 'parent path', change: (e) => [...e, { name: '../escape', data: 'Placeholder' }] },
    { name: 'Windows drive path', change: (e) => [...e, { name: 'C:\\escape.txt', data: 'Placeholder' }] },
    { name: 'UNC path', change: (e) => [...e, { name: '\\\\server\\escape.txt', data: 'Placeholder' }] },
    { name: 'backslash path', change: (e) => e.map((r) => ({ ...r, name: r.name.replace('/', '\\') })) },
    { name: 'symbolic link', change: (e) => e.map((r, i) => (i === 1 ? { ...r, unixMode: 0o120777 } : r)) },
    { name: 'repeated entry', change: (e) => [...e, must(e[0])] },
    { name: 'case collision', change: (e) => [...e, { ...must(e[0]), name: 'MANIFEST.JSON' }] },
    { name: 'missing payload', change: (e) => e.filter((_r, i) => i !== 1) },
    {
      name: 'wrong checksum',
      change: (e) =>
        e.map((r, i) =>
          i === 0
            ? {
                ...r,
                data: String(r.data).replace(/"sha256":"[0-9a-f]{64}"/u, `"sha256":"${'0'.repeat(64)}"`),
              }
            : r,
        ),
    },
    {
      name: 'unknown version',
      change: (e) =>
        e.map((r, i) =>
          i === 0 ? { ...r, data: String(r.data).replace('"version":1', '"version":99') } : r,
        ),
    },
    {
      name: 'unknown field',
      change: (e) =>
        e.map((r, i) => (i === 0 ? { ...r, data: String(r.data).replace('{', '{"unexpected":true,') } : r)),
    },
    {
      name: 'zip bomb',
      change: (e) => [
        ...e,
        { name: `media/${'a'.repeat(64)}.wav`, data: Buffer.alloc(2 * 1024 ** 2), deflate: true },
      ],
    },
  ];
  for (const attack of attacks)
    it(`refuses a ${attack.name} before any library rows are written`, async () => {
      const t = await setup();
      const changed = attack.change(await parts(t));
      const path = join(t.source.dir, 'Hostile.drashti-kirtans');
      await writeFile(path, Buffer.isBuffer(changed) ? changed : makeZip(changed));
      const result = await t.run(path);
      expect(result.summary.totals.failed).toBe(1);
      expect(result.report.items[0]?.outcome).toBe('failed');
      expect(t.target.db.prepare('SELECT count(*) FROM presentations').pluck().get()).toBe(0);
      expect(t.target.db.prepare('SELECT count(*) FROM media').pluck().get()).toBe(0);
      expect((await readdir(t.target.dir)).filter((n) => n.startsWith('drashti-kirtan-import-'))).toEqual([]);
    });
  it('checks valid-looking kirtan references after a matching checksum, and enforces disk/size limits', async () => {
    const t = await setup();
    const entries = await parts(t);
    const doc = JSON.parse(String(must(entries[1]).data)) as BundleKirtan;
    must(doc.content.slides[0]).group_id = 'not-a-group';
    const bytes = Buffer.from(JSON.stringify(doc));
    const manifest = JSON.parse(String(must(entries[0]).data)) as BundleManifest;
    must(manifest.kirtans[0]).sha256 = hash(bytes);
    must(manifest.kirtans[0]).bytes = bytes.length;
    const path = join(t.source.dir, 'Broken refs.drashti-kirtans');
    await writeFile(
      path,
      makeZip([
        { name: 'manifest.json', data: JSON.stringify(manifest) },
        { ...must(entries[1]), data: bytes },
        ...entries.slice(2),
      ]),
    );
    expect((await t.run(path)).summary.totals.failed).toBe(1);
    await expect(
      withKirtanBundle(t.source.output, { freeBytes: () => BUNDLE_LIMITS.reserve }, () => null),
    ).rejects.toThrow(/space|free/iu);
    const fake = makeZip(entries);
    const central = fake.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    fake.writeUInt32LE(BUNDLE_LIMITS.entry + 1, central + 24);
    await writeFile(path, fake);
    expect((await t.run(path)).summary.totals.failed).toBe(1);
  });
});
