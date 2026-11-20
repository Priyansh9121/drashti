import { expect, it, vi } from 'vitest';
import { readDisplaySource } from './source-blob';

const URL = 'drashti-media://media/p1-generated-job';
const answer = (body: Uint8Array, length = body.length) =>
  new Response(new Uint8Array(body), {
    headers: { 'Content-Length': String(length), 'Content-Type': 'image/png' },
  });

it('reads the identical bounded bytes with the original empty Blob MIME semantics', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const blob = await readDisplaySource(URL, 8, async () => answer(bytes));
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(blob.type).toBe('');
});

it('refuses a non-local source before asking for it', async () => {
  const fetcher = vi.fn(async () => answer(Uint8Array.from([1])));
  await expect(readDisplaySource('https://outside.invalid/source', 8, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([0, -1, NaN, Infinity, 256 * 1024 * 1024 + 1])('refuses an invalid byte cap %s', async (limit) => {
  const fetcher = vi.fn(async () => answer(Uint8Array.from([1])));
  await expect(readDisplaySource(URL, limit, fetcher)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it('refuses a failed response instead of decoding its error body', async () => {
  await expect(
    readDisplaySource(URL, 8, async () => new Response('No source', { status: 404 })),
  ).rejects.toThrow();
});

it('refuses an advertised source over its bound', async () => {
  await expect(readDisplaySource(URL, 8, async () => answer(Uint8Array.from([1]), 9))).rejects.toThrow();
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
    readDisplaySource(URL, 8, async () => new Response(stream, { headers: { 'Content-Length': '4' } })),
  ).rejects.toThrow(/byte limit/);
  expect(cancel).toHaveBeenCalledOnce();
});

it('refuses a truncated response', async () => {
  await expect(readDisplaySource(URL, 8, async () => answer(Uint8Array.from([1, 2]), 4))).rejects.toThrow();
});

it('requires a whole source and a bounded advertised length', async () => {
  await expect(readDisplaySource(URL, 8, async () => new Response(Uint8Array.from([1])))).rejects.toThrow();
  await expect(
    readDisplaySource(URL, 8, async () => new Response(null, { headers: { 'Content-Length': '1' } })),
  ).rejects.toThrow();
  await expect(
    readDisplaySource(
      URL,
      8,
      async () => new Response(Uint8Array.from([1]), { status: 206, headers: { 'Content-Length': '1' } }),
    ),
  ).rejects.toThrow();
});
