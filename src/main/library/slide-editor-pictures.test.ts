import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSlideEditor, SlideEditorWindow } from './slide-editor-window';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('../ipc/handle', () => ({
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
}));
vi.mock('../windows/app-icon', () => ({ windowIcon: () => ({}) }));
vi.mock('../windows/renderer', () => ({ loadPage: () => Promise.resolve() }));
vi.mock('../windows/web-preferences', () => ({ secureWebPreferences: () => ({}) }));

beforeEach(() => handlers.clear());

const page = { sender: {} };
const otherPage = { sender: {} };
const presentationId = 'placeholder-presentation';

function pictureHandlers() {
  const editor = new SlideEditorWindow({
    workArea: () => ({ x: 0, y: 0, width: 1024, height: 645 }),
    background: () => '#000000',
    track: () => undefined,
    log: () => undefined,
  });
  vi.spyOn(editor, 'isPage').mockImplementation((sender) => sender === page.sender);
  const pictures = {
    allowed: vi.fn(() => true),
    choose: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    importFile: vi.fn().mockResolvedValue({ ok: true, mediaId: 'placeholder-picture' }),
  };
  const options = {
    editor,
    fromOperator: () => false,
    exists: (id: string) => id === presentationId,
    showKey: () => undefined,
    pictures,
  };
  handleSlideEditor(options);
  const add = (event: unknown, id: string, path: unknown) => {
    const handler = handlers.get('slideeditor:add-picture');
    if (!handler) throw new Error('The slide editor has no picture-from-computer request.');
    return handler(event, id, path);
  };
  return { add, pictures };
}

describe('pictures from the computer in Edit slides', () => {
  it('takes a file from the picker or a desktop drop, and cancels without importing', async () => {
    const { add, pictures } = pictureHandlers();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-editor-picture-'));
    try {
      const path = join(dir, 'Placeholder picture.PNG');
      writeFileSync(path, 'Placeholder contents for the stand-in importer');
      await expect(add(page, presentationId, null)).resolves.toEqual({ ok: true, mediaId: null });
      expect(pictures.importFile).not.toHaveBeenCalled();
      pictures.choose.mockResolvedValueOnce(path);
      const added = { ok: true, mediaId: 'placeholder-picture' };
      await expect(add(page, presentationId, null)).resolves.toEqual(added);
      await expect(add(page, presentationId, path)).resolves.toEqual(added);
      expect(pictures.choose).toHaveBeenCalledTimes(2);
      expect(pictures.importFile.mock.calls).toEqual([[path], [path]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses other pages, unlisted presentations, relative paths, non-pictures and folders', async () => {
    const { add, pictures } = pictureHandlers();
    const dir = mkdtempSync(join(tmpdir(), 'drashti-editor-refuse-'));
    try {
      const folder = join(dir, 'Placeholder folder.png');
      const text = join(dir, 'Placeholder words.txt');
      mkdirSync(folder);
      writeFileSync(text, 'Placeholder');
      for (const [event, id, path] of [
        [otherPage, presentationId, null],
        [page, 'outside-playlists', null],
        [page, presentationId, 'relative.png'],
        [page, presentationId, folder],
        [page, presentationId, text],
      ] as const) {
        await expect(add(event, id, path)).resolves.toMatchObject({ ok: false });
      }
      expect(pictures.choose).not.toHaveBeenCalled();
      expect(pictures.importFile).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rechecks access after the picker before it imports', async () => {
    const { add, pictures } = pictureHandlers();
    pictures.choose.mockImplementationOnce(async () => {
      pictures.allowed.mockReturnValue(false);
      return join(tmpdir(), 'Placeholder picture.png');
    });
    await expect(add(page, presentationId, null)).resolves.toMatchObject({ ok: false });
    expect(pictures.importFile).not.toHaveBeenCalled();
  });
});
