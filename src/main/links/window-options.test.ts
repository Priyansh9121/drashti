import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkService, type LinkWorker } from './link-service';
import type { FromWorker, ToWorker } from './protocol';
import { downloadName } from './names';

const LINK = 'https://www.dropbox.com/scl/fi/placeholder/Placeholder.mp4?dl=0';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'drashti-link-window-'));
  const original = join(root, 'Original');
  const chosen = join(root, 'Chosen');
  mkdirSync(original);
  mkdirSync(chosen);
  let remembered = original;
  const workers: { messages: ToWorker[]; send(message: FromWorker): void }[] = [];
  const service = new LinkService({
    spawn: (): LinkWorker => {
      let hear = (_message: FromWorker): void => undefined;
      const messages: ToWorker[] = [];
      workers.push({ messages, send: (message) => hear(message) });
      return {
        post: (message) => messages.push(message),
        onMessage: (fn) => {
          hear = fn;
        },
        onExit: () => undefined,
        kill: () => undefined,
      };
    },
    onAir: () => false,
    freeBytes: () => 100 * 1024 ** 3,
    freeBytesAsync: () => Promise.resolve(100 * 1024 ** 3),
    defaultFolder: join(root, 'Usual'),
    lastFolder: {
      get: () => remembered,
      set: (folder) => {
        remembered = folder;
      },
    },
    pickFolder: () => Promise.resolve(chosen),
    importFiles: () => Promise.resolve({ ok: true, runId: 'placeholder-run' }),
    changed: () => undefined,
    log: () => undefined,
    record: join(root, 'record.json'),
    workDir: join(root, 'work'),
    maxHeight: { get: () => 1080, set: () => undefined },
    route: { testOrigin: null, guard: true },
  });
  return { service, workers, original, chosen, remembered: () => remembered };
}

async function settled(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

describe('the link window', () => {
  it('checks metadata without downloading and reuses it when Download is pressed', async () => {
    const h = setup();
    try {
      expect(h.service.look('dropbox', LINK).ok).toBe(true);
      h.workers[0]?.send({ type: 'looked', name: 'Placeholder.mp4', size: 20, zip: false });
      expect(h.service.view().phase).toBe('looked');
      expect(h.workers).toHaveLength(1);
      expect(readdirSync(h.original)).toEqual([]);
      expect(h.service.start(LINK, false, false, { name: 'Chosen name.mp3' }).ok).toBe(true);
      await settled(() => h.workers.some((w) => w.messages.some((m) => m.type === 'download')));
      expect(h.workers.flatMap((w) => w.messages).filter((m) => m.type === 'look')).toHaveLength(1);
      const worker = h.workers.find((w) => w.messages.some((m) => m.type === 'download'));
      const command = worker?.messages.find((m) => m.type === 'download');
      if (command?.type !== 'download') throw new Error('No download');
      writeFileSync(command.part, 'placeholder video');
      worker?.send({ type: 'downloaded', name: 'Server name.mp4', zip: false, bytes: 17 });
      await settled(() => h.service.view().phase === 'done');
      expect(readFileSync(join(h.original, 'Chosen name.mp4'), 'utf8')).toBe('placeholder video');
    } finally {
      h.service.close();
    }
  });

  it('keeps a chosen folder as a draft until Download, and Cancel restores the remembered folder', async () => {
    const h = setup();
    try {
      await h.service.pickFolder();
      expect(h.service.view().folder).toBe(h.chosen);
      expect(h.remembered()).toBe(h.original);
      h.service.reset();
      expect(h.service.view().folder).toBe(h.original);
      await h.service.pickFolder();
      h.service.look('dropbox', LINK);
      h.workers[0]?.send({ type: 'looked', name: 'Placeholder.mp4', size: 20, zip: false });
      h.service.start(LINK, false, false, { name: 'Changed' });
      await settled(() => h.service.view().phase === 'downloading');
      expect(h.service.view().folder).toBe(h.chosen);
      expect(h.remembered()).toBe(h.chosen);
      expect(existsSync(join(h.chosen, 'Changed.mp4'))).toBe(false);
    } finally {
      h.service.close();
    }
  });
});

describe('the operator’s download name', () => {
  it('makes a safe name, keeps Drashti’s extension and falls back to the checked title', () => {
    expect(downloadName('New: name.mp3', 'Placeholder', '.mp4')).toBe('New_ name.mp4');
    expect(downloadName('..', 'Original title', '.mp3')).toBe('Original title.mp3');
    expect(downloadName('', 'Original title.mp4', '.mp4')).toBe('Original title.mp4');
    expect(downloadName('CON', 'Placeholder', '.mp4')).toBe('_CON.mp4');
    expect(downloadName('../New name', 'Placeholder', '.pptx')).toBe('New name.pptx');
  });
});
