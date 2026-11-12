import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { openDatabase } from '../db/database';
import { ConvertService } from './convert-service';

vi.mock(import('node:child_process'), async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: vi.fn(),
}));

vi.mock('./read-info', () => ({
  PROBE_MS: 30_000,
  readInfo: () =>
    Promise.resolve({
      durationMs: 1000,
      video: null,
      audio: { codec: 'wmav2' },
    }),
}));

it('puts an automatic conversion back in the queue if a show starts as its encoder finishes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drashti-convert-live-'));
  const mediaDir = join(dir, 'Media');
  mkdirSync(mediaDir);
  writeFileSync(join(mediaDir, 'sound.wma'), 'Placeholder source bytes');
  const db = openDatabase(join(dir, 'library.sqlite'));
  db.prepare(
    "INSERT INTO media (id, kind, name, path, playable) VALUES ('m', 'audio', 'Placeholder sound.wma', 'sound.wma', 0)",
  ).run();

  let busy: string | null = null;
  const children: { child: EventEmitter; part: string }[] = [];
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const part: unknown = Array.isArray(args) ? args.at(-1) : undefined;
    if (typeof part !== 'string') throw new Error('The encoder was not given a part-file.');
    const child = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      kill: () => true,
    });
    writeFileSync(part, 'Placeholder encoded bytes');
    children.push({ child, part });
    return child as unknown as ReturnType<typeof spawn>;
  });
  const service = new ConvertService({
    db,
    mediaDir,
    ffmpegPath: () => 'placeholder-ffmpeg',
    busy: () => busy,
    freeBytes: () => 100 * 1024 ** 3,
    changed: () => undefined,
    libraryChanged: () => undefined,
    log: () => undefined,
    limits: { afterImportMs: 0 },
  });

  try {
    expect(
      service.convertImported({
        items: [
          {
            issues: [
              {
                severity: 'info',
                code: 'converting-media',
                message: 'Placeholder conversion.',
                fix: { kind: 'convert-media', mediaId: 'm', advice: 'Placeholder advice.' },
              },
            ],
          },
        ],
      }),
    ).toBe(1);
    await vi.waitFor(() => expect(children).toHaveLength(1));
    const [first] = children;
    if (!first) throw new Error('The encoder did not start.');
    busy = 'Waits while the show is on, then carries on by itself.';
    first.child.emit('exit', 0);

    await vi.waitFor(() => expect(service.list()[0]?.state).not.toBe('converting'));
    expect(service.list()[0]).toMatchObject({ state: 'waiting', note: busy, convertedId: null });
    expect(existsSync(first.part)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) FROM media_conversions').pluck().get()).toBe(0);
  } finally {
    service.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
