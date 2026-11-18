import { randomUUID, createHash } from 'node:crypto';
import { readFile, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listZip } from './zip';
import { exportKirtanBundle, withKirtanBundle } from './kirtan-bundle';
import { bundleLibrary } from './testing/kirtan-bundle-fixture';

describe('kirtan bundle export', () => {
  it('refuses a media-folder link leading outside its own media pool', async () => {
    const t = await bundleLibrary();
    const outside = join(t.dir, 'Placeholder outside pool');
    await mkdir(outside);
    await writeFile(join(outside, 'Placeholder.wav'), t.wav);
    await symlink(outside, join(t.mediaDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    t.db.prepare("UPDATE media SET path = 'linked/Placeholder.wav'").run();
    await expect(t.exportBundle()).rejects.toThrow(/media|outside|pool/iu);
    await expect(readFile(t.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('writes a versioned ZIP with checksums, tracks, details, arrangements, hidden slides and requested media', async () => {
    const t = await bundleLibrary();
    await t.exportBundle();
    expect((await listZip(t.output)).map((e) => e.name)).toContain('manifest.json');
    await withKirtanBundle(t.output, {}, async (bundle) => {
      expect(bundle.manifest).toMatchObject({ format: 'drashti-kirtans', version: 1 });
      expect(bundle.kirtans).toHaveLength(1);
      const k = bundle.kirtans[0];
      if (!k) throw new Error('Missing bundled kirtan');
      expect(k.name).toBe('Placeholder kirtan');
      expect(k.notes).toBe('Placeholder presentation notes');
      expect(k.content.kirtan?.row).toMatchObject({ kavi: 'Placeholder poet', raag: 'Placeholder raag' });
      expect(k.content.slides[1]?.enabled).toBe(0);
      expect(k.content.arrangementEntries).toHaveLength(3);
      expect(k.content.autoLines[0]?.text).toBe('Placeholder roman');
      expect(k.content.elements[0]?.props).toContain('translit');
      const file = bundle.media[0];
      if (!file?.path) throw new Error('Missing bundled media');
      expect(await readFile(file.path)).toEqual(t.wav);
      expect(file.sha256).toBe(createHash('sha256').update(t.wav).digest('hex'));
      expect(JSON.stringify(bundle.manifest)).not.toContain(t.dir);
      expect(JSON.stringify(k)).not.toContain(t.dir);
    });
  });

  it('keeps each kirtan’s identity across exports, including renamed bundle files', async () => {
    const t = await bundleLibrary();
    const identity = () => withKirtanBundle(t.output, {}, (b) => b.manifest.kirtans[0]?.id);
    await t.exportBundle();
    const first = await identity();
    await t.exportBundle();
    expect(await identity()).toBe(first);
  });

  it('exports words without media bytes when asked, keeping portable missing-media descriptions', async () => {
    const t = await bundleLibrary();
    await t.exportBundle(false);
    await withKirtanBundle(t.output, {}, (b) => {
      expect(b.media).toHaveLength(1);
      expect(b.media[0]).toMatchObject({ name: 'Placeholder.wav', path: null });
      expect(b.kirtans[0]?.content.cues[0]?.media_id).toBe(b.media[0]?.id);
    });
    expect((await listZip(t.output)).every((e) => !e.name.startsWith('media/'))).toBe(true);
  });

  it('refuses a missing requested media file and leaves an existing output intact', async () => {
    const t = await bundleLibrary();
    await writeFile(t.output, 'Earlier finished bundle');
    await rm(t.mediaDir, { recursive: true });
    await expect(t.exportBundle()).rejects.toThrow(/media|missing|found/iu);
    expect(await readFile(t.output, 'utf8')).toBe('Earlier finished bundle');
  });

  it('refuses non-kirtans, unknown ids and a full disk without leaving a partial output', async () => {
    const t = await bundleLibrary();
    await expect(
      exportKirtanBundle({
        db: t.db,
        mediaDir: t.mediaDir,
        output: t.output,
        presentationIds: [randomUUID()],
        includeMedia: false,
      }),
    ).rejects.toThrow(/kirtan/iu);
    await expect(
      exportKirtanBundle({
        db: t.db,
        mediaDir: t.mediaDir,
        output: t.output,
        presentationIds: [t.id],
        includeMedia: true,
        freeBytes: () => 1,
      }),
    ).rejects.toThrow(/space|free/iu);
    await expect(readFile(t.output)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
