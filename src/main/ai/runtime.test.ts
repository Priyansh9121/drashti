import { describe, expect, it, vi } from 'vitest';
import { AI_MODEL } from '../../shared/ai';
import { MeaningEncoder } from './runtime';

/* Native inference and its pin checks have separate real-model proof. This fixture isolates the public encoder's
 * repeated-work policy: calls still go through embed(), token construction, pooling, normalization and close().
 */
function ready() {
  const run = vi.fn(async () => ({
    output: { dims: [1, 2, AI_MODEL.dimensions], data: new Float32Array(2 * AI_MODEL.dimensions).fill(1) },
  }));
  const release = vi.fn(async () => undefined);
  const resources = {
    session: { inputNames: ['input_ids'], outputNames: ['output'], run, release },
    api: { Tensor: class {} },
    tokenizer: { encode: () => ({ ids: [1, 2] }) },
  };
  const encoder = new MeaningEncoder('/placeholder/verified-model');
  // A verified in-memory session stands in for the costly native boundary; no test can bypass a real model's pins.
  Object.assign(encoder, resources);
  return { encoder, run, resources, release };
}

describe('bounded reuse of encoder work', () => {
  it('does not run the native model again for an unchanged query or candidate', async () => {
    const { encoder, run } = ready();
    const first = await encoder.embed('Placeholder boat', 'query');
    const second = await encoder.embed('Placeholder boat', 'query');
    expect(second).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps the query/passage role and changed source words in the identity', async () => {
    const { encoder, run } = ready();
    await encoder.embed('Placeholder boat', 'query');
    await encoder.embed('Placeholder boat', 'passage');
    await encoder.embed('Placeholder lantern', 'passage');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('returns independent numerical values so a caller cannot poison the next result', async () => {
    const { encoder } = ready();
    const first = await encoder.embed('Placeholder boat', 'query');
    const expected = first[0];
    first[0] = 99;
    expect((await encoder.embed('Placeholder boat', 'query'))[0]).toBe(expected);
  });

  it('forgets the derived values when its model is closed', async () => {
    const { encoder, run, resources, release } = ready();
    await encoder.embed('Placeholder boat', 'query');
    await encoder.close();
    expect(release).toHaveBeenCalledTimes(1);
    Object.assign(encoder, resources);
    await encoder.embed('Placeholder boat', 'query');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('bounds the derived cache and keeps recently used values', async () => {
    const { encoder, run } = ready();
    for (let i = 0; i < 256; i++) await encoder.embed('Placeholder ' + String(i), 'query');
    await encoder.embed('Placeholder 0', 'query');
    await encoder.embed('Placeholder 256', 'query');
    await encoder.embed('Placeholder 0', 'query');
    await encoder.embed('Placeholder 1', 'query');
    expect(run).toHaveBeenCalledTimes(258);
  });
});
