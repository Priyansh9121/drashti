import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_FILES_WORDS,
  type ArrivedFile,
  noRoomWords,
  tooLargeWords,
  type UploadPolicy,
  type UploadStatus,
} from '../../shared/phone-files';
import { compoundFile } from '../import/testing/compound-file';
import { makeZip } from '../import/testing/zip-writer';
import { Uploads } from './uploads';

/*
 * Files a phone adds (Session 54, D4), as the network worker takes them: in pieces, into a folder of the media
 * folder by names Drashti makes, each piece where the last left off (so a dropped connection picks up again),
 * Cancel at any moment, the size limit and the 2 GB kept free said in words, and the file checked by what it is
 * before the main process hears of it. Placeholder bytes only.
 */

const PHONE = { id: 'd-remote', name: 'Placeholder phone' };
const OTHER = { id: 'd-other', name: 'Placeholder tablet' };
const GiB = 1024 ** 3;
const ON: UploadPolicy = { on: true, maxBytes: 2 * GiB, reserveBytes: 2 * GiB, slowed: false };

let root = '';
let mediaDir = '';
let dir = '';
let free = 100 * GiB;
let arrived: ArrivedFile[] = [];
let uploads: Uploads;
let clock = 0;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'drashti-uploads-'));
  mediaDir = join(root, 'Media');
  dir = join(mediaDir, '.phone-uploads');
  mkdirSync(mediaDir, { recursive: true });
  free = 100 * GiB;
  arrived = [];
  clock = 1_000_000;
  uploads = new Uploads({
    dir,
    mediaDir,
    freeBytes: () => free,
    arrived: (file) => {
      arrived.push(file);
    },
    log: () => undefined,
    now: () => clock,
    wait: () => Promise.resolve(),
  });
  await uploads.start();
  uploads.setPolicy(ON);
});
afterEach(async () => {
  await uploads.stop();
  rmSync(root, { recursive: true, force: true });
});

/** A picture's bytes: a JPEG's header, then placeholder bytes. */
const picture = (bytes: number) => {
  const b = Buffer.alloc(bytes, 0x5a);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

const body = (bytes: Buffer) => ({ length: bytes.length, stream: Readable.from([bytes]) });

const upload = (answer: { body: Record<string, unknown> }) => answer.body['upload'] as UploadStatus;

async function begin(name: string, size: number, device = PHONE) {
  return uploads.begin(device, { name, size });
}

/** Send the whole of `bytes` in pieces of `piece` bytes. */
async function sendAll(id: string, bytes: Buffer, piece: number, device = PHONE) {
  let last: Awaited<ReturnType<Uploads['piece']>> | null = null;
  for (let at = 0; at < bytes.length; at += piece) {
    last = await uploads.piece(device, id, String(at), body(bytes.subarray(at, at + piece)));
    expect(last.status, String(last.body['message'])).toBe(200);
  }
  return last;
}

/** Every file under the root, relative to it. */
function filesUnder(at: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(at);
  return out.sort();
}

describe('a file from a phone, in pieces', () => {
  it('arrives whole, piece after piece, and is handed on with a name Drashti made', async () => {
    const bytes = picture(10_000);
    const started = await begin('IMG_0001.HEIC', bytes.length);
    expect(started.status).toBe(201);
    const id = upload(started).id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    const last = await sendAll(id, bytes, 3000);
    expect(upload(last ?? { body: {} })).toMatchObject({ received: 10_000, state: 'importing' });
    expect(arrived).toEqual([
      {
        id,
        deviceId: PHONE.id,
        name: 'IMG_0001.HEIC',
        file: join(dir, `${id}.jpg`),
        ext: 'jpg',
        kind: 'image',
      },
    ]);
    expect(readFileSync(join(dir, `${id}.jpg`)).equals(bytes)).toBe(true);
  });

  it('picks up again where it left off after a dropped connection: a piece cut short writes nothing', async () => {
    const bytes = picture(9000);
    const id = upload(await begin('Placeholder photo.jpg', bytes.length)).id;
    expect((await uploads.piece(PHONE, id, '0', body(bytes.subarray(0, 4000)))).status).toBe(200);
    // The Wi-Fi drops halfway through the next piece.
    const cut = new PassThrough();
    const sending = uploads.piece(PHONE, id, '4000', { length: 4000, stream: cut });
    cut.write(bytes.subarray(4000, 6000));
    cut.destroy(new Error('connection reset'));
    expect((await sending).status).toBe(400);
    // The phone asks where to carry on from, and sends the rest.
    expect(upload(uploads.status(PHONE, id))).toMatchObject({ received: 4000, state: 'receiving' });
    const rest = await uploads.piece(PHONE, id, '4000', body(bytes.subarray(4000)));
    expect(upload(rest)).toMatchObject({ received: 9000, state: 'importing' });
    expect(readFileSync(join(dir, `${id}.jpg`)).equals(bytes)).toBe(true);
  });

  it('a piece from the wrong place is refused with where to carry on from', async () => {
    const bytes = picture(6000);
    const id = upload(await begin('Placeholder photo.jpg', bytes.length)).id;
    await uploads.piece(PHONE, id, '0', body(bytes.subarray(0, 3000)));
    const again = await uploads.piece(PHONE, id, '0', body(bytes.subarray(0, 3000)));
    expect(again.status).toBe(409);
    expect(upload(again).received).toBe(3000);
    const past = await uploads.piece(PHONE, id, '3000', body(Buffer.alloc(4000)));
    expect(past.status).toBe(413);
    expect(upload(uploads.status(PHONE, id)).received).toBe(3000);
  });

  it('Cancel stops it at once and leaves nothing behind', async () => {
    const bytes = picture(8000);
    const id = upload(await begin('Placeholder clip.mp4', bytes.length)).id;
    await uploads.piece(PHONE, id, '0', body(bytes.subarray(0, 4000)));
    expect(existsSync(join(dir, `${id}.part`))).toBe(true);
    const cancelled = await uploads.cancel(PHONE, id);
    expect(cancelled.status).toBe(200);
    expect(upload(cancelled)).toMatchObject({ state: 'cancelled' });
    expect(readdirSync(dir)).toEqual([]);
    const late = await uploads.piece(PHONE, id, '4000', body(bytes.subarray(4000)));
    expect(late.status).toBe(409);
    expect(arrived).toEqual([]);
  });

  it('Cancel during a piece: the piece writes nothing', async () => {
    const bytes = picture(8000);
    const id = upload(await begin('Placeholder clip.mp4', bytes.length)).id;
    const slow = new PassThrough();
    const sending = uploads.piece(PHONE, id, '0', { length: 4000, stream: slow });
    slow.write(bytes.subarray(0, 1000));
    await uploads.cancel(PHONE, id);
    slow.end(bytes.subarray(1000, 4000));
    expect((await sending).status).toBe(409);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('only the phone that sent it reads, sends or cancels it', async () => {
    const id = upload(await begin('Placeholder photo.jpg', 1000)).id;
    expect(uploads.status(OTHER, id).status).toBe(404);
    expect((await uploads.piece(OTHER, id, '0', body(picture(1000)))).status).toBe(404);
    expect((await uploads.cancel(OTHER, id)).status).toBe(404);
    expect(upload(uploads.status(PHONE, id)).state).toBe('receiving');
  });
});

describe('what a phone may add', () => {
  it('nothing while the switch is off, and what was coming stops when it is turned off', async () => {
    uploads.setPolicy({ ...ON, on: false });
    const refused = await begin('Placeholder photo.jpg', 1000);
    expect(refused.status).toBe(403);
    expect(refused.body['message']).toBe(ADD_FILES_WORDS.off);
    uploads.setPolicy(ON);
    const id = upload(await begin('Placeholder photo.jpg', 2000)).id;
    await uploads.piece(PHONE, id, '0', body(picture(2000).subarray(0, 1000)));
    uploads.setPolicy({ ...ON, on: false });
    expect(upload(uploads.status(PHONE, id))).toMatchObject({
      state: 'failed',
      message: ADD_FILES_WORDS.off,
    });
    expect((await uploads.piece(PHONE, id, '1000', body(Buffer.alloc(1000)))).status).toBe(403);
    await vi.waitFor(() => {
      expect(readdirSync(dir)).toEqual([]);
    });
    expect(arrived).toEqual([]);
  });

  it('a file over the size limit is refused in words before a byte is sent', async () => {
    uploads.setPolicy({ ...ON, maxBytes: 5000 });
    const refused = await begin('Placeholder long video.mov', 5001);
    expect(refused.status).toBe(413);
    expect(refused.body['message']).toBe(tooLargeWords(5000));
    expect(tooLargeWords(2 * GiB)).toBe(
      'This file is larger than 2 GB: Drashti takes files up to 2 GB from a phone.',
    );
    expect((await begin('Placeholder short video.mov', 5000)).status).toBe(201);
  });

  it('keeps 2 GB free on the disk: refused before it starts, and stopped if the disk fills meanwhile', async () => {
    // The file, and the import's copy of it, must leave 2 GB free.
    free = 2 * GiB + 2 * 4000 - 1;
    const refused = await begin('Placeholder photo.jpg', 4000);
    expect(refused.status).toBe(507);
    expect(refused.body['message']).toBe(noRoomWords(2 * GiB));
    expect(noRoomWords(2 * GiB)).toBe(
      'There is not enough free space on Drashti’s computer for this file: Drashti keeps 2 GB free on its disk for the show.',
    );
    free = 2 * GiB + 2 * 4000;
    const id = upload(await begin('Placeholder photo.jpg', 4000)).id;
    await uploads.piece(PHONE, id, '0', body(picture(4000).subarray(0, 2000)));
    // Something else (a recording) fills the disk meanwhile.
    free = 2 * GiB + 1000;
    const stopped = await uploads.piece(PHONE, id, '2000', body(Buffer.alloc(2000)));
    expect(stopped.status).toBe(507);
    expect(upload(uploads.status(PHONE, id))).toMatchObject({
      state: 'failed',
      message: noRoomWords(2 * GiB),
    });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a renamed file is refused by what is inside it, and nothing is kept of it', async () => {
    const words = Buffer.from('Placeholder words, named as a picture.\n'.repeat(20));
    const id = upload(await begin('Placeholder photo.jpg', words.length)).id;
    const last = await uploads.piece(PHONE, id, '0', body(words));
    expect(upload(last)).toMatchObject({ state: 'failed', message: ADD_FILES_WORDS.notTaken });
    expect(arrived).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a PowerPoint 97–2003 file is refused in words, a phone told to send .pptx, and nothing is kept of it', async () => {
    const ppt = compoundFile('PowerPoint Document');
    const id = upload(await begin('Placeholder old deck.ppt', ppt.length)).id;
    const last = await uploads.piece(PHONE, id, '0', body(ppt));
    expect(upload(last)).toMatchObject({ state: 'failed', message: ADD_FILES_WORDS.oldPowerPoint });
    expect(arrived).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a deck is taken by the parts inside it, whatever the phone called it', async () => {
    const pptx = makeZip([{ name: 'ppt/presentation.xml', data: '<p:presentation/>' }]);
    const id = upload(await begin('Placeholder deck.zip', pptx.length)).id;
    await uploads.piece(PHONE, id, '0', body(pptx));
    expect(arrived.map((a) => [a.kind, a.ext, a.file])).toEqual([
      ['powerpoint', 'pptx', join(dir, `${id}.pptx`)],
    ]);
  });

  it('never writes anywhere else: a name or an id with a way out of the folder goes nowhere', async () => {
    const bytes = picture(3000);
    const sneaky = await begin('../../../Placeholder escape.jpg', bytes.length);
    const id = upload(sneaky).id;
    await uploads.piece(PHONE, id, '0', body(bytes));
    expect(upload(uploads.status(PHONE, id)).name).toBe('Placeholder escape.jpg');
    for (const trick of ['../escape', `${id}/../../x`, '..', '/etc/hosts', `${id}.part`])
      expect((await uploads.piece(PHONE, trick, '0', body(bytes))).status).toBe(404);
    expect(filesUnder(root)).toEqual([join('Media', '.phone-uploads', `${id}.jpg`)]);
  });

  it('never writes through a folder that leads out of the media folder', async () => {
    await uploads.stop();
    const outside = join(root, 'Elsewhere');
    mkdirSync(outside);
    const linked = join(mediaDir, '.linked-uploads');
    symlinkSync(outside, linked, 'junction');
    const out = new Uploads({
      dir: linked,
      mediaDir,
      freeBytes: () => free,
      arrived: (file) => {
        arrived.push(file);
      },
      log: () => undefined,
      wait: () => Promise.resolve(),
    });
    await out.start();
    out.setPolicy(ON);
    const refused = await out.begin(PHONE, { name: 'Placeholder photo.jpg', size: 1000 });
    expect(refused.status).toBe(503);
    expect(readdirSync(outside)).toEqual([]);
    await out.stop();
  });

  it('a file that stops coming is let go after half an hour; leftovers of an earlier run are cleared', async () => {
    const id = upload(await begin('Placeholder photo.jpg', 4000)).id;
    await uploads.piece(PHONE, id, '0', body(picture(4000).subarray(0, 1000)));
    clock += 31 * 60 * 1000;
    uploads.sweep();
    expect(upload(uploads.status(PHONE, id))).toMatchObject({
      state: 'failed',
      message: ADD_FILES_WORDS.gone,
    });
    await vi.waitFor(() => {
      expect(readdirSync(dir)).toEqual([]);
    });
    // A part file a stopped worker left: cleared when the next one starts.
    writeFileSync(join(dir, '00000000-0000-4000-8000-000000000000.part'), 'half');
    await uploads.start();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('while the stream is on air or recording, pieces are taken at 2 MB a second at most, and the phone hears so', async () => {
    const waits: number[] = [];
    await uploads.stop();
    uploads = new Uploads({
      dir,
      mediaDir,
      freeBytes: () => free,
      arrived: (file) => {
        arrived.push(file);
      },
      log: () => undefined,
      wait: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await uploads.start();
    uploads.setPolicy({ ...ON, slowed: true });
    const bytes = picture(3 * 1024 * 1024);
    const id = upload(await begin('Placeholder clip.mp4', bytes.length)).id;
    expect(upload(uploads.status(PHONE, id)).slowed).toBe(true);
    await uploads.piece(PHONE, id, '0', body(bytes.subarray(0, 1024 * 1024)));
    await uploads.piece(PHONE, id, String(1024 * 1024), body(bytes.subarray(1024 * 1024)));
    // At 2 MB a second, a quarter of a second's worth at once: 1 MB waits a quarter of a second more, and 2 MB
    // more (with no time passing here) another second and more.
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(240);
    expect(waits[0]).toBeLessThan(260);
    expect(waits[1]).toBeGreaterThan(1000);
    uploads.setPolicy(ON);
    expect(upload(uploads.status(PHONE, id)).slowed).toBe(false);
  });

  it('a phone sends three at a time at most', async () => {
    for (let n = 0; n < 3; n++) expect((await begin(`Placeholder ${String(n)}.jpg`, 1000)).status).toBe(201);
    expect((await begin('Placeholder 4.jpg', 1000)).status).toBe(429);
    expect((await begin('Placeholder tablet.jpg', 1000, OTHER)).status).toBe(201);
  });

  it('what the main process made of it is what the phone hears', async () => {
    const id = upload(await begin('Placeholder photo.jpg', 2000)).id;
    await uploads.piece(PHONE, id, '0', body(picture(2000)));
    // While it waits to be imported (a deck, on air), the phone reads why.
    uploads.note(id, 'Placeholder: waiting for the stream to end.');
    expect(upload(uploads.status(PHONE, id))).toMatchObject({
      state: 'importing',
      message: 'Placeholder: waiting for the stream to end.',
    });
    uploads.outcome(id, { ok: true, message: 'Added to Drashti.' });
    expect(upload(uploads.status(PHONE, id))).toMatchObject({ state: 'added', message: 'Added to Drashti.' });
    const listed = uploads.list(PHONE);
    expect(listed.map((u) => u.id)).toEqual([id]);
    expect(uploads.list(OTHER)).toEqual([]);
  });
});
