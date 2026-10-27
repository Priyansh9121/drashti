import { describe, expect, it } from 'vitest';
import type { UploadStatus } from '../../../../shared/phone-files';
import { type Answer, type Sending, sendFile, type Transport } from './upload-client';

/*
 * A file sent from a phone (Session 54, D4), as the page sends it, against a stand-in for Drashti that keeps what
 * it has as the real one does: whole in pieces, each where Drashti has got to; picking up again after the Wi-Fi
 * drops; Cancel at once; refusals said in Drashti's words. Placeholder bytes, and no waiting (the stand-in's clock).
 */

const KB = 1024;
const MB = 1024 * KB;

interface StandIn extends Transport {
  /** The offset and size of each piece sent, and whether it got through. */
  pieces: { at: number; bytes: number; ok: boolean }[];
  cancelled: string[];
  /** Pieces (by their number, from 0) whose connection drops partway. */
  drop: Set<number>;
  received: number;
  forget: boolean;
}

function standIn(size: number, refuse: Answer<never> | null = null, first = 256 * KB): StandIn {
  let state: UploadStatus['state'] = 'receiving';
  const upload = (): UploadStatus => ({
    id: 'u1',
    name: 'Placeholder photo.jpg',
    size,
    received: t.received,
    state,
    message: state === 'added' ? 'Added to Drashti, in Media and the playlist “Added from Phones”.' : null,
    slowed: false,
  });
  let polls = 0;
  const t: StandIn = {
    pieces: [],
    cancelled: [],
    drop: new Set(),
    received: 0,
    forget: false,
    begin: () => Promise.resolve(refuse ?? { ok: true, upload: upload(), pieces: { first, max: 8 * MB } }),
    piece: (_id, at, bytes, sent, signal) => {
      const n = t.pieces.length;
      if (signal.aborted) return Promise.resolve({ ok: false, status: 0, message: 'Cancelled.' });
      sent(Math.floor(bytes.size / 2));
      if (t.drop.has(n)) {
        t.pieces.push({ at, bytes: bytes.size, ok: false });
        return Promise.resolve({ ok: false, status: 0, message: 'Drashti cannot be reached.' });
      }
      if (at !== t.received) {
        t.pieces.push({ at, bytes: bytes.size, ok: false });
        return Promise.resolve({ ok: false, status: 409, message: 'Carry on.', upload: upload() });
      }
      t.pieces.push({ at, bytes: bytes.size, ok: true });
      t.received += bytes.size;
      if (t.received === size) state = 'importing';
      return Promise.resolve({ ok: true, upload: upload() });
    },
    status: () => {
      if (t.forget)
        return Promise.resolve({ ok: false, status: 404, message: 'Drashti no longer has this file.' });
      // Imported a moment after the last piece.
      if (state === 'importing' && ++polls > 1) state = 'added';
      return Promise.resolve({ ok: true, upload: upload() });
    },
    cancel: (id) => {
      t.cancelled.push(id);
      state = 'cancelled';
      return Promise.resolve({ ok: true, upload: upload() });
    },
  };
  return t;
}

const file = (bytes: number) =>
  Object.assign(new Blob([new Uint8Array(bytes)]), { name: 'Placeholder photo.jpg' });

/** A clock that moves only as the test says: each piece takes `pieceMs` (it is read as a piece starts and ends). */
function clock(pieceMs: number) {
  let t = 0;
  return { now: () => (t += pieceMs), wait: () => Promise.resolve() };
}

describe('a file sent from a phone', () => {
  it('goes whole in pieces, its progress heard as it goes, and ends with what Drashti made of it', async () => {
    const t = standIn(300 * KB);
    const seen: Sending[] = [];
    const job = sendFile(file(300 * KB), t, 'f1', (s) => seen.push(s), clock(500));
    const done = await job.done;
    expect(done).toMatchObject({
      state: 'added',
      sent: 300 * KB,
      message: 'Added to Drashti, in Media and the playlist “Added from Phones”.',
    });
    expect(t.pieces.reduce((sum, p) => sum + p.bytes, 0)).toBe(300 * KB);
    // The bar moves within a piece too.
    expect(seen.some((s) => s.state === 'receiving' && s.sent === 128 * KB)).toBe(true);
    expect(seen.map((s) => s.state)).toContain('importing');
  });

  it('larger pieces on a fast Wi-Fi, smaller on a slow one', async () => {
    const fast = standIn(4 * MB);
    await sendFile(file(4 * MB), fast, 'f1', () => undefined, clock(100)).done;
    expect(fast.pieces.map((p) => p.bytes)).toEqual([256 * KB, 512 * KB, 1 * MB, 2 * MB, 256 * KB]);
    const slow = standIn(2 * MB, null, 1 * MB);
    await sendFile(file(2 * MB), slow, 'f1', () => undefined, clock(9000)).done;
    expect(slow.pieces.map((p) => p.bytes)).toEqual([1 * MB, 512 * KB, 256 * KB, 256 * KB]);
  });

  it('picks up again where Drashti has got to after the connection drops, with smaller pieces', async () => {
    const t = standIn(1 * MB, null, 512 * KB);
    t.drop.add(1);
    const seen: Sending[] = [];
    const done = await sendFile(file(1 * MB), t, 'f1', (s) => seen.push(s), clock(2000)).done;
    expect(done.state).toBe('added');
    expect(
      seen.some((s) => s.state === 'waiting' && s.message === 'The connection dropped: picking up again…'),
    ).toBe(true);
    expect(t.pieces.map((p) => [p.at, p.bytes, p.ok])).toEqual([
      [0, 512 * KB, true],
      [512 * KB, 512 * KB, false],
      [512 * KB, 256 * KB, true],
      [768 * KB, 256 * KB, true],
    ]);
  });

  it('Cancel stops it at once: no more pieces, and Drashti is told to remove what came', async () => {
    const t = standIn(1 * MB);
    let job: ReturnType<typeof sendFile> | null = null;
    const original = t.piece.bind(t);
    t.piece = (id, at, bytes, sent, signal) => {
      if (t.pieces.length === 2) job?.cancel();
      return original(id, at, bytes, sent, signal);
    };
    job = sendFile(file(1 * MB), t, 'f1', () => undefined, clock(500));
    const done = await job.done;
    expect(done).toMatchObject({ state: 'cancelled', message: 'Cancelled.' });
    expect(t.pieces).toHaveLength(2);
    expect(t.cancelled).toEqual(['u1']);
  });

  it('a request Drashti cannot take is said at once, never sent again and again; an empty file is never sent', async () => {
    const t = standIn(300 * KB);
    let begun = 0;
    t.begin = () => {
      begun++;
      // Were it sent again, Drashti would say something else.
      return Promise.resolve(
        begun === 1
          ? { ok: false as const, status: 400, message: 'Say the file’s name and how large it is.' }
          : { ok: false as const, status: 403, message: 'Asked again.' },
      );
    };
    expect(await sendFile(file(300 * KB), t, 'f1', () => undefined, clock(500)).done).toMatchObject({
      state: 'failed',
      message: 'Say the file’s name and how large it is.',
    });
    expect(begun).toBe(1);
    const empty = standIn(0);
    expect(await sendFile(file(0), empty, 'f2', () => undefined, clock(500)).done).toMatchObject({
      state: 'failed',
      message: 'This file is empty.',
    });
    expect(empty.pieces).toEqual([]);
  });

  it('a refusal is said in Drashti’s own words; a file Drashti forgot is said so', async () => {
    const tooLarge = standIn(5 * MB, {
      ok: false,
      status: 413,
      message: 'This file is larger than 2 GB: Drashti takes files up to 2 GB from a phone.',
    });
    expect(await sendFile(file(5 * MB), tooLarge, 'f1', () => undefined, clock(500)).done).toMatchObject({
      state: 'failed',
      message: 'This file is larger than 2 GB: Drashti takes files up to 2 GB from a phone.',
    });
    expect(tooLarge.pieces).toEqual([]);
    const forgotten = standIn(256 * KB);
    forgotten.drop.add(0);
    forgotten.forget = true;
    expect(await sendFile(file(256 * KB), forgotten, 'f1', () => undefined, clock(500)).done).toMatchObject({
      state: 'failed',
      message: 'Drashti no longer has this file.',
    });
  });
});
