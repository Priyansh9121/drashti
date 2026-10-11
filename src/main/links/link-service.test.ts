import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { DEFAULT_LINK_MAX_HEIGHT, type LinkHeight, type LinkView } from '../../shared/links';
import { SIMPLE_MODE_REFUSAL } from '../../shared/mode';
import { ADMIN_REFUSAL, isAdminChannel } from '../../shared/roles';
import { lockAdminChannels, lockChannels, refusalFor, refusedNow } from '../ipc/handle';
import { adminRefusals } from '../roles/admin-lock';
import { SIMPLE_MODE_LOCKED, simpleModeRefusals } from '../simple-mode';
import { toolEnv, toolFolders } from './youtube-tools';
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
/** YouTube's tests: the fake yt-dlp (run by Electron as Node) and Drashti's own FFmpeg for its placeholders. */
const APP = join(__dirname, '..', '..', '..');
const FAKE = join(APP, 'tests', 'e2e', 'fake-yt-dlp.cjs');
const FFMPEG = join(
  APP,
  'vendor',
  'ffmpeg',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
);
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
  /** The library's stored highest video quality. */
  stored: { maxHeight: LinkHeight };
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
  const stored: { maxHeight: LinkHeight } = { maxHeight: DEFAULT_LINK_MAX_HEIGHT };
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
    workDir: join(root, 'Link downloads'),
    maxHeight: {
      get: () => stored.maxHeight,
      set: (height) => {
        stored.maxHeight = height;
      },
    },
    route: { testOrigin: origin, guard: true },
    pollMs: 20,
    ...over,
  });
  return { service, folder, logs, imported, views, air, record, stored };
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

  it('stopping also clears a work folder made the moment before (not yet in the record)', async () => {
    const h = await harness();
    h.service.look('dropbox', FOLDER_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.air.on = true;
    h.service.download();
    await until(() => h.service.view().phase === 'waiting');
    // As the download process makes it, just before Stop: its message never arrives.
    mkdirSync(join(h.folder, '.drashti-unpacking-placeholder'));
    writeFileSync(join(h.folder, '.drashti-unpacking-placeholder', 'half.mp4'), 'x');
    writeFileSync(join(h.folder, 'keep me.mp4'), 'already here');
    h.service.stop();
    await until(() => !existsSync(join(h.folder, '.drashti-unpacking-placeholder')));
    expect(readdirSync(h.folder)).toEqual(['keep me.mp4']);
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

  it('makes a video above 1080p a 1080p copy first (step 4): the copy is imported, the original stays', async () => {
    const asked: string[] = [];
    let waitSaid = false;
    const h = await harness({
      fitVideo: async (path, outDir, maxHeight, report) => {
        asked.push(path);
        expect(maxHeight).toBe(1080);
        report('the stream is on air or recording', null);
        waitSaid = true;
        report(null, 0.5);
        const copy = join(outDir, 'Placeholder 1080p.mp4');
        mkdirSync(outDir, { recursive: true });
        writeFileSync(copy, 'placeholder 1080p copy');
        return Promise.resolve({ ok: true, copy });
      },
    });
    h.service.look('dropbox', FOLDER_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download();
    await until(() => h.service.view().phase === 'done');
    const video = join(h.folder, 'Placeholder folder', 'Videos', 'Placeholder 1080p.mp4');
    expect(asked).toEqual([video]);
    expect(waitSaid).toBe(true);
    expect(h.views.some((v) => v.phase === 'converting' && v.waitingFor !== null)).toBe(true);
    // The PowerPoint as it is; the video's copy, not the original.
    expect(h.imported[0]?.[0]).toBe(join(h.folder, 'Placeholder folder', 'Placeholder deck.pptx'));
    expect(h.imported[0]?.[1]).toMatch(/Link downloads/u);
    expect(h.service.view().fitted).toEqual(['Videos/Placeholder 1080p.mp4']);
    // The original is untouched in the folder, and the copy is gone once the import has taken it.
    expect(readFileSync(video).equals(VIDEO)).toBe(true);
    expect(
      existsSync(join(h.folder, '..', 'Link downloads'))
        ? readdirSync(join(h.folder, '..', 'Link downloads'))
        : [],
    ).toEqual([]);
  });

  it('lists a video it could not make 1080p as not taken, and imports the rest', async () => {
    const h = await harness({
      fitVideo: () => Promise.resolve({ ok: false, message: 'FFmpeg could not make it 1080p.' }),
    });
    h.service.look('dropbox', FOLDER_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download();
    await until(() => h.service.view().phase === 'done');
    expect(h.imported).toEqual([[join(h.folder, 'Placeholder folder', 'Placeholder deck.pptx')]]);
    expect(h.service.view().notTaken.map((n) => n.name)).toEqual([
      'Read me.txt',
      'Videos/Placeholder 1080p.mp4',
    ]);
    expect(h.service.view().notTaken[1]?.reason).toMatch(
      /above 1080p.*could not make it 1080p.*not imported/u,
    );
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

describe('the highest video quality (Session 25c)', () => {
  it('starts at 1080p, is kept with the library’s settings, and is said in the log', async () => {
    const h = await harness();
    expect(h.service.view().maxHeight).toBe(1080);
    const r = h.service.setMaxHeight(2160);
    expect(r.ok).toBe(true);
    expect(h.stored.maxHeight).toBe(2160);
    expect(h.service.view().maxHeight).toBe(2160);
    expect(h.views.at(-1)?.maxHeight).toBe(2160);
    expect(h.logs).toContain('Links: the highest video quality is now 2160p (4K)');
  });

  it('is read back from the library when Drashti starts', async () => {
    const h = await harness({ maxHeight: { get: () => 4320, set: () => undefined } });
    expect(h.service.view().maxHeight).toBe(4320);
  });

  it('refuses a quality that is not offered, and any change while a download is going on', async () => {
    const h = await harness();
    for (const bad of [720, 1081, '2160', null]) {
      const r = h.service.setMaxHeight(bad);
      expect(r.ok).toBe(false);
      expect(r.ok ? '' : r.message).toContain('Choose 1080p, 1440p, 2160p (4K) or 4320p (8K)');
    }
    expect(h.stored.maxHeight).toBe(1080);
    h.air.on = true;
    h.service.look('dropbox', FILE_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download();
    expect(h.service.view().phase).toBe('waiting');
    const busy = h.service.setMaxHeight(1440);
    expect(busy.ok).toBe(false);
    expect(busy.ok ? '' : busy.message).toContain('once the download');
    expect(h.stored.maxHeight).toBe(1080);
    h.service.stop();
  });

  it('is an admin’s request, refused in Simple Mode and while admin is locked', () => {
    expect(isAdminChannel(IPC.links.setMaxHeight)).toBe(true);
    expect(SIMPLE_MODE_LOCKED).toContain(IPC.links.setMaxHeight);
    const sound = () => ({ chosen: null, devices: [], state: 'default' as const, checked: true });
    let simple = true;
    let locked = false;
    lockChannels(() => simple, simpleModeRefusals(sound));
    lockAdminChannels(
      () => locked,
      adminRefusals(sound),
      () => undefined,
    );
    expect(refusedNow(IPC.links.setMaxHeight)).toBe(true);
    expect(refusalFor(IPC.links.setMaxHeight)?.()).toEqual({ ok: false, message: SIMPLE_MODE_REFUSAL });
    simple = false;
    locked = true;
    expect(refusedNow(IPC.links.setMaxHeight)).toBe(true);
    expect(refusalFor(IPC.links.setMaxHeight)?.()).toEqual({ ok: false, message: ADMIN_REFUSAL });
    locked = false;
    expect(refusedNow(IPC.links.setMaxHeight)).toBe(false);
  });

  it('is what a Dropbox video taller than it is made: at 2160p a 2160p video needs no copy', async () => {
    const asked: number[] = [];
    const h = await harness({
      fitVideo: (_path, _outDir, maxHeight) => {
        asked.push(maxHeight);
        // As ConvertService.fitHeight answers: no copy when the video is that tall or less.
        return Promise.resolve({ ok: true, copy: maxHeight >= 2160 ? null : 'unused' });
      },
    });
    h.service.setMaxHeight(2160);
    h.service.look('dropbox', FOLDER_LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download();
    await until(() => h.service.view().phase === 'done');
    expect(asked).toEqual([2160]);
    expect(h.service.view().fitted).toEqual([]);
    expect(h.imported[0]?.[1]).toBe(join(h.folder, 'Placeholder folder', 'Videos', 'Placeholder 1080p.mp4'));
  });
});

describe.skipIf(!existsSync(FFMPEG))('YouTube (Session 25c), with the fake yt-dlp', () => {
  /** The link service with YouTube's programs: the fake yt-dlp, told what to do. */
  async function youtube(config: Record<string, unknown> = {}) {
    const log = join(mkdtempSync(join(tmpdir(), 'drashti-fake-log-')), 'fake.log');
    const h = await harness({
      youtubeLaunch: (work) => ({
        ok: true,
        launch: {
          command: process.execPath,
          prefix: [FAKE],
          env: {
            ...toolEnv(toolFolders(work), process.platform),
            ELECTRON_RUN_AS_NODE: '1',
            DRASHTI_FAKE_YT_DLP_CONFIG: JSON.stringify({ log, steps: 4, stepMs: 20, ...config }),
          },
          deno: 'deno',
          ffmpeg: FFMPEG,
        },
      }),
    });
    return { ...h, fakeLog: log };
  }
  const LINK = 'https://youtu.be/AAAAAAAAAAA?si=placeholderShare';
  const starts = (log: string) =>
    (existsSync(log) ? readFileSync(log, 'utf8') : '')
      .split('\n')
      .filter((l) => l.startsWith('start download'));
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('looks, refuses a download without the tick or above the setting, then saves under the title', async () => {
    const h = await youtube();
    h.service.look('youtube', LINK);
    await until(() => h.service.view().phase === 'looked');
    const look = h.service.view().look;
    expect(look?.name).toBe('Placeholder video');
    expect(look?.video?.heights.map((x) => x.height)).toEqual([4320, 2160, 1440, 1080, 720]);
    // The tick, each time; the qualities offered, never above the setting.
    const say = (r: ReturnType<LinkService['download']>) => (r.ok ? '' : r.message);
    expect(say(h.service.download())).toContain('Tick the box first: This video is the mandir’s own');
    expect(say(h.service.download({ type: 'mp4', height: 1080, permission: false }))).toContain(
      'Tick the box',
    );
    expect(say(h.service.download({ type: 'mp4', height: 2160, permission: true }))).toContain(
      'Above 1080p, the highest video quality an admin allows',
    );
    expect(say(h.service.download({ type: 'mp4', height: 999, permission: true }))).toContain(
      'qualities this video offers',
    );
    expect(h.service.view().phase).toBe('looked');
    expect(h.service.download({ type: 'mp4', height: 1080, permission: true }).ok).toBe(true);
    expect(h.service.view().choice).toEqual({ type: 'mp4', height: 1080 });
    await until(() => h.service.view().phase === 'done', 30_000);
    expect(files(h.folder)).toEqual(['Placeholder video.mp4']);
    expect(h.imported).toEqual([[join(h.folder, 'Placeholder video.mp4')]]);
    // The same video again, as MP3, then MP4: never over a file already there.
    for (const type of ['mp3', 'mp4'] as const) {
      h.service.reset();
      h.service.look('youtube', LINK);
      await until(() => h.service.view().phase === 'looked');
      expect(h.service.download({ type, height: type === 'mp4' ? 720 : null, permission: true }).ok).toBe(
        true,
      );
      await until(() => h.service.view().phase === 'done', 30_000);
    }
    expect(files(h.folder)).toEqual([
      'Placeholder video (2).mp4',
      'Placeholder video.mp3',
      'Placeholder video.mp4',
    ]);
    // No hidden work folder left in the folder, and Drashti's own work folders are empty.
    expect(readdirSync(h.folder).filter((n) => n.startsWith('.'))).toEqual([]);
    expect(readdirSync(join(h.folder, '..', 'Link downloads'))).toEqual([]);
  });

  it('logs the kind, the sizes and the outcome only: never the link, the id, the title or a file name', async () => {
    const h = await youtube({ title: 'Placeholder secret title' });
    h.service.look('youtube', LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download({ type: 'mp4', height: 720, permission: true });
    await until(() => h.service.view().phase === 'done', 30_000);
    const log = h.logs.join('\n');
    expect(log).toContain('Links: looked at a YouTube video link (up to 4320p (8K))');
    expect(log).toMatch(/Links: a YouTube video download starts \(MP4, 720p, about [\d.]+ [KMG]B\)/u);
    for (const secret of [
      'AAAAAAAAAAA',
      'youtu',
      'placeholderShare',
      'Placeholder secret title',
      '.mp4',
      h.folder,
    ])
      expect(log).not.toContain(secret);
  });

  it('waits while on air, never starting yt-dlp; stops one going (its child too), then carries on', async () => {
    const h = await youtube({ steps: 30, stepMs: 60 });
    h.service.look('youtube', LINK);
    await until(() => h.service.view().phase === 'looked');
    h.air.on = true;
    h.service.download({ type: 'mp4', height: 720, permission: true });
    expect(h.service.view().phase).toBe('waiting');
    await new Promise((r) => setTimeout(r, 300));
    expect(starts(h.fakeLog)).toEqual([]);
    h.air.on = false;
    await until(() => (h.service.view().progress?.done ?? 0) > 3000);
    h.air.on = true;
    await until(() => h.service.view().phase === 'waiting');
    const [first] = starts(h.fakeLog).map((l) => l.split(' '));
    const pid = Number(first?.[4]);
    const child = Number(first?.[6]);
    await until(() => !alive(pid) && !alive(child), 10_000);
    h.air.on = false;
    await until(() => h.service.view().phase === 'done', 60_000);
    expect(starts(h.fakeLog)).toHaveLength(2);
    expect(readFileSync(h.fakeLog, 'utf8')).toMatch(/^resume \d+$/mu);
    expect(files(h.folder)).toEqual(['Placeholder video.mp4']);
  });

  it('a quit stops yt-dlp and all it started, and leaves no part-file', async () => {
    const h = await youtube({ steps: 200, stepMs: 60 });
    h.service.look('youtube', LINK);
    await until(() => h.service.view().phase === 'looked');
    h.service.download({ type: 'mp4', height: 720, permission: true });
    await until(() => (h.service.view().progress?.done ?? 0) > 1000);
    expect(readdirSync(h.folder).some((n) => n.startsWith('.drashti-youtube-'))).toBe(true);
    h.service.close();
    const [first] = starts(h.fakeLog).map((l) => l.split(' '));
    await until(() => !alive(Number(first?.[4])) && !alive(Number(first?.[6])), 10_000);
    expect(readdirSync(h.folder)).toEqual([]);
  });

  it('says plainly why a video cannot be had, and when YouTube’s programs are missing', async () => {
    const h = await youtube({ live: 'is_live' });
    h.service.look('youtube', LINK);
    await until(() => h.service.view().phase === 'idle' && h.service.view().message !== null);
    expect(h.service.view().message).toBe('That is a live stream still going. Download it after it ends.');
    const missing = await harness({
      youtubeLaunch: () => ({ ok: false, message: 'Drashti’s copy of yt-dlp or Deno is missing.' }),
    });
    const r = missing.service.look('youtube', LINK);
    expect(r.ok ? '' : r.message).toBe('Drashti’s copy of yt-dlp or Deno is missing.');
  });
});
