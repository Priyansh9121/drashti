import { describe, expect, it, vi } from 'vitest';
import { fakeHelper, type FakeChild } from '../testing/fake-translate-helper';
import { HelperError, MAX_LINE, TranslationHelper } from './translation-helper';

const log = { info: vi.fn(), warn: vi.fn() };
const ok = (r: Record<string, unknown>, extra = '') => `{"id":${String(r['id'])},"ok":true${extra}}`;
const make = (child: FakeChild, more: Partial<ConstructorParameters<typeof TranslationHelper>[0]> = {}) =>
  new TranslationHelper({
    program: '/x/drashti-translate',
    log,
    spawn: () => child,
    lowerPriority: () => undefined,
    ...more,
  });

describe('drashti-translate, the translation helper', () => {
  it('starts on its hello, loads a model and translates one prepared sentence', async () => {
    const child = fakeHelper((r) =>
      r['op'] === 'translate' ? ok(r, ',"tokens":["▁ab","c","</s>"],"sourceTokens":5,"ms":12') : ok(r),
    );
    const helper = make(child);
    await helper.start();
    await helper.load('en-indic', '/m/en-indic', '/m/en-indic/source.spm', 2);
    await expect(helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'ab c', 5)).resolves.toEqual([
      '▁ab',
      'c',
      '</s>',
    ]);
    expect(child.requests[0]).toMatchObject({
      op: 'load',
      route: 'en-indic',
      model: '/m/en-indic',
      threads: 2,
    });
    expect(child.requests[1]).toMatchObject({
      op: 'translate',
      src: 'eng_Latn',
      tgt: 'guj_Gujr',
      text: 'ab c',
      beam: 5,
    });
    helper.stop();
    expect(child.killed).toBe(true);
  });

  it('puts the helper below the show’s priority before it loads anything', async () => {
    const child = fakeHelper((r) => ok(r));
    const lowered: number[] = [];
    const helper = make(child, { lowerPriority: (pid) => lowered.push(pid) });
    await helper.start();
    expect(lowered).toEqual([4242]);
    helper.stop();
  });

  it('refuses a program that does not answer as Drashti’s own (another protocol, no hello)', async () => {
    const other = fakeHelper(
      () => null,
      '{"hello":"drashti-translate","protocol":2,"ctranslate2":"x","sentencepiece":"y"}',
    );
    await expect(make(other).start()).rejects.toBeInstanceOf(HelperError);
    expect(other.killed).toBe(true);
    const silent = fakeHelper(() => null, '');
    await expect(make(silent, { helloMs: 50 }).start()).rejects.toBeInstanceOf(HelperError);
    expect(silent.killed).toBe(true);
  });

  it('passes the helper’s own refusals on in plain words', async () => {
    const child = fakeHelper((r) => `{"id":${String(r['id'])},"ok":false,"error":"too-long"}`);
    const helper = make(child);
    await helper.start();
    const error = await helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'too-long' });
    expect((error as Error).message).toMatch(/too long/u);
    expect(helper.running).toBe(true);
    helper.stop();
  });

  it('ends the helper on a line that is not an answer, and refuses what was waiting', async () => {
    const child = fakeHelper(() => 'not json');
    const helper = make(child);
    await helper.start();
    await expect(helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1)).rejects.toMatchObject({
      code: 'ended',
    });
    expect(child.killed).toBe(true);
    expect(helper.running).toBe(false);
  });

  it('ends the helper when it sends too much without a line end', async () => {
    const child = fakeHelper((_r, c) => {
      c.stdout.write('x'.repeat(MAX_LINE + 10));
      return null;
    });
    const helper = make(child);
    await helper.start();
    await expect(helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1)).rejects.toMatchObject({
      code: 'ended',
    });
    expect(child.killed).toBe(true);
  });

  it('ends the helper when a reply is too late, and when it exits mid-request', async () => {
    const slow = fakeHelper(() => null);
    const helper = make(slow, { translateMs: 30 });
    await helper.start();
    await expect(helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1)).rejects.toMatchObject({
      code: 'ended',
    });
    expect(slow.killed).toBe(true);
    const exits = fakeHelper((_r, c) => {
      c.emit('exit', 1);
      return null;
    });
    const second = make(exits);
    await second.start();
    await expect(second.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1)).rejects.toMatchObject({
      code: 'ended',
    });
  });

  it('sends a cancel for the sentence in flight, whose answer is then Stopped', async () => {
    let held: Record<string, unknown> | null = null;
    const child = fakeHelper((r) => {
      if (r['op'] === 'translate') {
        held = r;
        return null;
      }
      if (r['op'] === 'cancel' && held)
        return [ok(r), `{"id":${String(held['id'])},"ok":false,"error":"cancelled"}`];
      return ok(r);
    });
    const helper = make(child);
    await helper.start();
    const waiting = helper.translate('en-indic', 'eng_Latn', 'guj_Gujr', 'x', 1);
    await new Promise((resolve) => setImmediate(resolve));
    helper.cancel();
    await expect(waiting).rejects.toMatchObject({ code: 'cancelled' });
    expect(helper.running).toBe(true);
    helper.stop();
  });

  it('says plainly when the Intel copy runs under Rosetta, where its matrix library cannot run', async () => {
    const child = fakeHelper((r) => `{"id":${String(r['id'])},"ok":false,"error":"translated"}`);
    const helper = make(child);
    await helper.start();
    const error = await helper
      .load('en-indic', '/m/en-indic', '/m/en-indic/source.spm', 2)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'translated' });
    expect((error as Error).message).toMatch(/Apple silicon/u);
    helper.stop();
  });
});
