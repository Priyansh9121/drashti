import { expect, it, vi } from 'vitest';
import { readDisplaySource } from './source-blob';

const URL = 'drashti-media://media/p1-generated-job';
const answer = (body: Uint8Array, length = body.length) =>
  new Response(new Uint8Array(body), {
    headers: { 'Content-Length': String(length), 'Content-Type': 'image/png' },
  });

it('reads the identical bounded bytes with the original empty Blob MIME semantics', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const blob = await readDisplaySource(URL, 8, () => Promise.resolve(answer(bytes)));
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(blob.type).toBe('');
});

it('refuses a non-local source before asking for it', async () => {
  const fetcher = vi.fn(() => Promise.resolve(answer(Uint8Array.from([1]))));
  await expect(readDisplaySource('https://outside.invalid/source', 8, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([0, -1, NaN, Infinity, 256 * 1024 * 1024 + 1])('refuses an invalid byte cap %s', async (limit) => {
  const fetcher = vi.fn(() => Promise.resolve(answer(Uint8Array.from([1]))));
  await expect(readDisplaySource(URL, limit, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('refuses a failed response instead of decoding its error body', async () => {
  await expect(
    readDisplaySource(URL, 8, () => Promise.resolve(new Response('No source', { status: 404 }))),
  ).rejects.toThrow();
});

it('refuses an advertised source over its bound', async () => {
  await expect(
    readDisplaySource(URL, 8, () => Promise.resolve(answer(Uint8Array.from([1]), 9))),
  ).rejects.toThrow();
});

it('stops and cancels a response whose actual bytes exceed its bound', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
      },
      pull(controller) {
        controller.error(new Error('An unbounded reader asked for more'));
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  await expect(
    readDisplaySource(URL, 8, () =>
      Promise.resolve(new Response(stream, { headers: { 'Content-Length': '4' } })),
    ),
  ).rejects.toThrow(/byte limit/);
  expect(cancel).toHaveBeenCalledOnce();
});

it('refuses a truncated response', async () => {
  await expect(
    readDisplaySource(URL, 8, () => Promise.resolve(answer(Uint8Array.from([1, 2]), 4))),
  ).rejects.toThrow();
});

it('requires a whole source and a bounded advertised length', async () => {
  await expect(
    readDisplaySource(URL, 8, () => Promise.resolve(new Response(Uint8Array.from([1])))),
  ).rejects.toThrow();
  await expect(
    readDisplaySource(URL, 8, () =>
      Promise.resolve(new Response(null, { headers: { 'Content-Length': '1' } })),
    ),
  ).rejects.toThrow();
  await expect(
    readDisplaySource(URL, 8, () =>
      Promise.resolve(
        new Response(Uint8Array.from([1]), { status: 206, headers: { 'Content-Length': '1' } }),
      ),
    ),
  ).rejects.toThrow();
});

it('rejects a non-byte chunk before asking for more or losing the byte bound', async () => {
  let reads = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<unknown>(
    {
      pull(controller) {
        reads++;
        if (reads === 1) controller.enqueue('invalid');
        else controller.error(new Error('Reader asked after a non-byte chunk.'));
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const response = new Response(null, { headers: { 'Content-Length': '4' } });
  Object.defineProperty(response, 'body', { value: body });
  await expect(readDisplaySource(URL, 8, () => Promise.resolve(response))).rejects.toThrow(
    'The picture source did not supply bytes.',
  );
  expect(reads).toBe(1);
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

it('preserves ordered bytes when a multi-chunk producer reuses its view', async () => {
  const view = new Uint8Array(3);
  let produced = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (produced === 4) {
          controller.close();
          return;
        }
        view.fill(++produced);
        controller.enqueue(view);
      },
    },
    { highWaterMark: 0 },
  );
  const blob = await readDisplaySource(URL, 12, () =>
    Promise.resolve(new Response(body, { headers: { 'Content-Length': '12' } })),
  );
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
  expect(blob.type).toBe('');
});

it('cancels and releases the original reader if its native Blob consumer fails', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const blob = vi
    .spyOn(Response.prototype, 'blob')
    .mockRejectedValueOnce(new Error('Native Blob consumer failed.'));
  try {
    await expect(
      readDisplaySource(URL, 8, () =>
        Promise.resolve(new Response(body, { headers: { 'Content-Length': '4' } })),
      ),
    ).rejects.toThrow('Native Blob consumer failed.');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  } finally {
    blob.mockRestore();
  }
});

it('keeps the source failure when the native Blob consumer reports a generic fetch failure', async () => {
  const failure = new Error('Synthetic original source failure.');
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.error(failure);
      },
    },
    { highWaterMark: 0 },
  );
  // Chromium BodyConsumerBase::DidFetchDataLoadFailed rejects with a new generic TypeError.
  const blob = vi.spyOn(Response.prototype, 'blob').mockImplementationOnce(async function (this: Response) {
    const reader = this.body?.getReader();
    if (!reader) throw new Error('The synthetic Blob has no source body.');
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return new Blob([]);
      }
    } catch (cause) {
      throw new TypeError('Failed to fetch', { cause });
    } finally {
      reader.releaseLock();
    }
  });
  try {
    await expect(
      readDisplaySource(URL, 8, () =>
        Promise.resolve(
          new Response(body, {
            headers: { 'Content-Length': '4' },
          }),
        ),
      ),
    ).rejects.toBe(failure);
  } finally {
    blob.mockRestore();
  }
  expect(body.locked).toBe(false);
});
