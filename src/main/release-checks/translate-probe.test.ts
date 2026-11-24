import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeProbe, probeLines } from '../../../scripts/translate-probe.mjs';

/*
 * The packaged check of drashti-translate's own refusals (a22-review-mt A8): scripts/check-ffmpeg.mjs --packaged
 * sends probeLines() to each packaged app's helper, with no model, and judges its answers.
 */

const HELLO = '{"hello":"drashti-translate","protocol":1,"ctranslate2":"4.9.1","sentencepiece":"0.2.1"}';
const good = [
  HELLO,
  '{"id":null,"ok":false,"error":"bad-json"}',
  '{"id":null,"ok":false,"error":"too-large"}',
  '{"id":6,"ok":true}',
  '{"id":3,"ok":false,"error":"unknown-op"}',
  '{"id":4,"ok":false,"error":"not-loaded"}',
  '{"id":5,"ok":false,"error":"tokenizer-unreadable"}',
  '{"id":7,"ok":true}',
].join('\n');

describe('the packaged check of the translation helper’s refusals', () => {
  it('sends a bad line, a line over 64 KiB, an unknown op, a sentence before any model, a missing model, cancel, quit', () => {
    const lines = probeLines();
    expect(lines[0]).toBe('not json');
    expect(Buffer.byteLength(lines[1] ?? '')).toBeGreaterThan(64 * 1024);
    expect(lines.slice(2).map((l) => (JSON.parse(l) as { op: string }).op)).toEqual([
      'dance',
      'translate',
      'load',
      'cancel',
      'quit',
    ]);
  });

  it('passes the helper’s right answers in any order, the Intel copy under Rosetta too', () => {
    expect(judgeProbe(good, 0)).toEqual({ passed: true, problems: [] });
    expect(judgeProbe(good.replace('"tokenizer-unreadable"', '"translated"'), 0).passed).toBe(true);
  });

  it('fails a missing hello, an unread line answered wrongly, a wrong refusal, a crash', () => {
    expect(judgeProbe(good.replace(HELLO, '{"hello":"other"}'), 0).passed).toBe(false);
    expect(judgeProbe(good.replace('"too-large"', '"bad-json"'), 0).passed).toBe(false);
    expect(judgeProbe(good.replace('"not-loaded"', '"translate-failed"'), 0).passed).toBe(false);
    expect(judgeProbe(good.split('\n').slice(0, 5).join('\n'), null).passed).toBe(false);
  });

  it('runs in each packaged app’s check', () => {
    const check = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'check-ffmpeg.mjs'), 'utf8');
    expect(check).toContain("import { probeTranslate } from './translate-probe.mjs';");
    expect(check).toContain('probeTranslate(command, args,');
  });
});
