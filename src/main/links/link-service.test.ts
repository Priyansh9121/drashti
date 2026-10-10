import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkView } from '../../shared/links';
import { makeZip } from '../import/testing/zip-writer';
import { nodeGet } from './http';
import { LinkService, type LinkServiceDeps, type LinkWorker } from './link-service';
import type { FromWorker, ToWorker } from './protocol';
import { linkWorker } from './worker-logic';

/*
 * Import from a Link, the main process's side (Session 25b), with the real
 * download logic run in this process against a local stand-in for Dropbox.
 * Made-up links and placeholder files only (PLAN §6).
 */

const FILE_LINK =
  'https://www.dropbox.com/scl/fi/abc123placeholder/Placeholder%20clip.mp4?rlkey=placeholderkey&dl=0';
const FOLDER_LINK =
  'https://www.dropbox.com/scl/fo/abc123placeholder/def456placeholder?rlkey=placeholderkey&dl=0';
const VIDEO = Buffer.from('placeholder mp4 bytes '.repeat(5000));
const ZIP = makeZip([
  { name: 'Placeholder deck.pptx', data: 'placeholder pptx' },
  { name: 'Videos/Placeholder 1080p.mp4', data: VIDEO, deflate: true },
  { name: 'Read me.txt', data: 'placeholder words' },
]);

let server: Server | null = null;
let requests = 0;

async function standIn(): Promise<string> {
  requests = 0;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests++;
    const url = req.url ?? '';
    if (url.startsWith('/scl/fi/')) {
      res.writeHead(302, { Location: 'https://uc0placeholder.dl.dropboxusercontent.com/cd/0/get/file' });
      res.end();
    } else if (url.startsWith('/cd/0/get/file')) {
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': String(VIDEO.length),
        'Content-Disposition': 'attachment; filename="Placeholder clip.mp4"',
      });
      res.end(VIDEO);
    } else if (url.startsWith('/scl/fo/')) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="Placeholder folder.zip"',
      });
      res.end(ZIP);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

afterEach(async () => {
  const s = server;
  server = null;
  if (s) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});

/** The download logic in this process, answering a little later as a process would. */
function inProcessWorker(): LinkWorker {
  let listener: ((m: FromWorker) => void) | null = null;
  let exit: ((code: number) => void) | null = null;
  const handle = linkWorker(
    (m) => {
      setImmediate(() => listener?.(m));
    },
    { get: nodeGet, freeBytes: () => 100 * 1024 ** 3 },
  );
  return {
    post: (m: ToWorker) => {
      setImmediate(() => {
        handle(m);
      });
    },
    onMessage: (l) => (listener = l),
    onExit: (l) => (exit = l),
    kill: () => {
      handle({ type: 'stop' });
      exit?.(0);
    },
  };
}

interface Harness {
  service: LinkService;
  folder: string;
  logs: string[];
  imported: string[][];
  views: LinkView[];
  air: { on: boolean };
  record: string;
}

async function harness(over: Partial<LinkServiceDeps> = {}): Promise<Harness> {
  const origin = await standIn();
  const root = mkdtempSync(join(tmpdir(), 'drashti-links-'));
  const folder = join(root, 'Saved here');
  const logs: string[] = [];
  const imported: string[][] = [];
  const views: LinkView[] = [];
  const air = { on: false };
  const record = join(root, 'link-downloads.json');
  const service = new LinkService({
    spawn: inProcessWorker,
    onAir: () => air.on,
    freeBytes: () => 100 * 1024 ** 3,
    defaultFolder: join(root, 'Drashti downloads'),
    lastFolder: { get: () => folder, set: () => undefined },
    pickFolder: () => Promise.resolve(null),
    importFiles: (paths) => {
      imported.push(paths);
      return Promise.resolve({ ok: true, runId: 'run-placeholder' });
    },
    changed: (view) => views.push(view),
    log: (_level, message) => logs.push(message),
    record,
    route: { testOrigin: origin, guard: true },
    pollMs: 20,
    ...over,
  });
  return { service, folder, logs, imported, views, air, record };
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .split(/[\\/]/u)
        .join('/'),
    )
    .sort();

describe('Import from a Link: Dropbox', () => {
  it('saves a folder link’s files in a folder of their own, and imports only the PowerPoint and the MP4', async () => {
    const h = await harness();
    expect(h.service.look('dropbox', FOLDER_LINK).ok).toBe(true);
    await until(() => h.service.view().phase === 'looked');
    expect(h.service.view().look).toEqual({ shape: 'folder', name: 'Placeholder folder', size: null });
    expect(h.service.download().ok).toBe(true);
    await until(() => h.service.view().phase === 'done');
    const view = h.service.view();
    expect(view.saved?.folder).toBe(join(h.folder, 'Placeholder folder'));
    expect(view.saved?.files.sort()).toEqual([
      'Placeholder deck.pptx',
      'Read me.txt',
      'Videos/Placeholder 1080p.mp4',
    ]);
    expect(view.notTaken).toEqual([
      {
        name: 'Read me.txt',
        reason: 'Not a PowerPoint file (.pptx) or an MP4 video, so it was not imported.',
      },
    ]);
    expect(h.imported).toEqual([
      [
        join(h.folder, 'Placeholder folder', 'Placeholder deck.pptx'),
        join(h.folder, 'Placeholder folder', 'Videos', 'Placeholder 1080p.mp4'),
      ],
    ]);
    expect(view.runId).toBe('run-placeholder');
    // Only the unpacked folder is left: no zip, no part-file, no work folder.
    expect(readdirSync(h.folder)).toEqual(['Placeholder folder']);
    expect(files(h.folder)).toEqual([
      'Placeholder folder/Placeholder deck.pptx',
      'Placeholder folder/Read me.txt',
      'Placeholder folder/Videos/Placeholder 1080p.mp4',
    ]);
  });

  it('saves a file link under Dropbox’s name, never over a file already there', async () => {
    const h = await harness();
    mkdirSync(h.folder, { recursive: true });
    writeFileSync(join(h.folder, 'Placeholder clip.mp4'), 'already here');
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    expect(h.service.view().look).toEqual({
      shape: 'file',
      name: 'Placeholder clip.mp4',
      size: VIDEO.length,
    });
    h.service.download();
    await until(() => h.service.view().phase === 'done');
    expect(readFileSync(join(h.folder, 'Placeholder clip.mp4'), 'utf8')).toBe('already here');
    expect(readFileSync(join(h.folder, 'Placeholder clip (2).mp4')).equals(VIDEO)).toBe(true);
    expect(h.service.view().saved).toEqual({ folder: h.folder, files: ['Placeholder clip (2).mp4'] });
    expect(h.imported).toEqual([[join(h.folder, 'Placeholder clip (2).mp4')]]);
  });

  it('waits while the stream is on air or recording, asking nothing of Dropbox, then carries on', async () => {
    const h = await harness();
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    const asked = requests;
    h.air.on = true;
    h.service.download();
    await until(() => h.service.view().phase === 'waiting');
    expect(h.service.view().waitingFor).toMatch(/on air or recording/u);
    await new Promise((r) => setTimeout(r, 200));
    expect(requests).toBe(asked);
    h.air.on = false;
    await until(() => h.service.view().phase === 'done');
    expect(h.imported).toHaveLength(1);
    expect(h.logs.join('\n')).toMatch(/waits while the stream is on air or recording/u);
  });

  it('stops when told, keeping nothing', async () => {
    const h = await harness();
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.air.on = true;
    h.service.download();
    await until(() => h.service.view().phase === 'waiting');
    h.service.stop();
    expect(h.service.view().phase).toBe('stopped');
    expect(h.service.view().message).toMatch(/Nothing was kept/u);
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(h.folder) ? readdirSync(h.folder) : []).toEqual([]);
    expect(h.imported).toEqual([]);
  });

  it('refuses to start when the size known up front would leave less than 2 GB free', async () => {
    const h = await harness({ freeBytes: () => 2 * 1024 ** 3 + 1000 });
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    const r = h.service.download();
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.message).toMatch(/2 GB free/u);
    expect(h.service.view().phase).toBe('looked');
  });

  it('refuses a second link while a download is going on', async () => {
    const h = await harness();
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.air.on = true;
    h.service.download();
    await until(() => h.service.view().phase === 'waiting');
    const r = h.service.look('dropbox', FOLDER_LINK);
    expect(r.ok ? '' : r.message).toMatch(/download is going on/u);
    h.service.stop();
  });

  it('logs the kind, the sizes and the outcome only: never the link, a name or the folder', async () => {
    const h = await harness();
    h.service.look('dropbox', FOLDER_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download();
    await until(() => h.service.view().phase === 'done');
    const log = h.logs.join('\n');
    expect(log).toMatch(/Dropbox/u);
    for (const secret of [
      'abc123placeholder',
      'placeholderkey',
      'Placeholder',
      'Saved here',
      'Read me',
      'dropbox.com',
    ])
      expect(log).not.toContain(secret);
  });

  it('clears part-files and work folders a crash left behind, and nothing else', async () => {
    const root = mkdtempSync(join(tmpdir(), 'drashti-links-'));
    const part = join(root, '.drashti-download-1.part');
    const work = join(root, '.drashti-unpacking-abc');
    const other = join(root, 'keep me.mp4');
    writeFileSync(part, 'x');
    mkdirSync(work);
    writeFileSync(other, 'y');
    const record = join(root, 'link-downloads.json');
    writeFileSync(record, JSON.stringify([part, work, other]));
    await harness({ record });
    expect(readdirSync(root)).toEqual(['keep me.mp4']);
  });
});
