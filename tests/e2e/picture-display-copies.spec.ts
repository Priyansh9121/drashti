import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { displayUrl } from '../../src/shared/media';
import {
  importAndGetIds,
  launchApp,
  operatorPage,
  operatorReady,
  outputPage,
  setUpScreen,
  type PageGlobals,
} from './helpers';
import { goLive, makeSlides } from './placeholder-slides';

const CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let b = 0; b < 8; b++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(name: string, bytes: Buffer): Buffer {
  const type = Buffer.from(name);
  let crc = 0xffffffff;
  for (const b of Buffer.concat([type, bytes])) crc = (CRC[(crc ^ b) & 255] ?? 0) ^ (crc >>> 8);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const end = Buffer.alloc(4);
  end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, type, bytes, end]);
}
/** Generated colour and alpha only, with a distinct hash per trial; no fixture is downsized to pass. */
function picture(file: string, width = 6144, height = 3456, seed = 0): { file: string; hash: string } {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = row + 1 + x * 4;
      raw[p] = (192 + seed) % 256;
      raw[p + 1] = 48;
      raw[p + 2] = 64;
      raw[p + 3] = x < width / 2 ? 255 : 96;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(file, bytes);
  return { file, hash: createHash('sha256').update(bytes).digest('hex') };
}

test('an oversized imported still is ready with its display source, while the original and alpha remain intact', async () => {
  test.setTimeout(180_000);
  const { app, userData } = await launchApp();
  try {
    const win = await operatorPage(app);
    await operatorReady(win);
    const dir = mkdtempSync(join(tmpdir(), 'drashti-display-pictures-'));
    const large = picture(join(dir, 'Placeholder large alpha.png'));
    const small = picture(join(dir, 'Placeholder small alpha.png'), 640, 360);
    const [id = '', smallId = ''] = await importAndGetIds(win, [large.file, small.file]);
    expect(id).not.toBe('');
    expect(smallId).not.toBe('');
    const looks = await win.evaluate(() => (globalThis as PageGlobals).drashti.media.looks());
    const copy = looks[id]?.display;
    expect(copy).toMatchObject({ width: 1920, height: 1080 });
    if (!copy) throw new Error('The imported picture was announced ready without its display rendition.');
    expect(looks[smallId]?.display).toBeUndefined();
    const source = displayUrl(id, copy.key);
    const drawn = await win.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No CPU canvas.');
      ctx.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        opaque: ctx.getImageData(
          Math.floor(image.naturalWidth / 4),
          Math.floor(image.naturalHeight / 2),
          1,
          1,
        ).data[3],
        alpha: ctx.getImageData(
          Math.floor((image.naturalWidth * 3) / 4),
          Math.floor(image.naturalHeight / 2),
          1,
          1,
        ).data[3],
      };
    }, source);
    expect(drawn).toMatchObject({ width: 1920, height: 1080, opaque: 255 });
    expect(Math.abs((drawn.alpha ?? 0) - 96)).toBeLessThanOrEqual(1);
    const original = join(
      userData,
      'Media',
      /^[a-f0-9]{2}/u.exec(large.hash)?.[0] ?? '',
      `${large.hash}.png`,
    );
    expect(createHash('sha256').update(readFileSync(original)).digest('hex')).toBe(large.hash);
    expect(await importAndGetIds(win, [large.file])).toEqual([id]);
    await setUpScreen(win);
    const out = await outputPage(app);
    await expect(out.getByTestId('output-root')).toHaveAttribute('data-fonts', 'ready', { timeout: 20_000 });
    const presentation = await makeSlides(win, 'Placeholder display source', [{ picture: id }], {
      kind: 'cut',
      durationMs: 0,
    });
    await goLive(win, presentation, 0);
    await expect(out.locator(`[data-layer="slide"] img[src^="${source}"]`)).toHaveCount(1);
    const workers = [
      ...readFileSync(join(userData, 'logs', 'drashti.log'), 'utf8').matchAll(
        /Display copy worker priority: (-?\d+) \((darwin|win32)\)/gu,
      ),
    ].map((match) => ({ priority: Number(match[1]), platform: match[2] }));
    expect(workers.length).toBeGreaterThan(0);
    for (const worker of workers) expect(worker.priority).toBeGreaterThan(0);
    console.log('DISPLAY COPY READY ' + JSON.stringify({ copy, drawn, originalUnchanged: true, workers }));
  } finally {
    await app.close();
  }
});
