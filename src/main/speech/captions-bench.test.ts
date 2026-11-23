import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BENCH_CANDIDATES,
  GROWTH_MS,
  LIVE_MS,
  affinityArgs,
  benchMarkdown,
  candidateLanguage,
  candidateModel,
  childrenArgs,
  droppedIn,
  englishSpeechArgs,
  errorRates,
  parseCaptionsInput,
  parseChildren,
  percentile,
  scoreWords,
  speechSpan,
  summarize,
  timingsOf,
  type BenchManifest,
  type CandidateRun,
} from './captions-bench';

/*
 * The captions bench (CAP-CI-1; the owner, 24 Nov 2026: "Yes, all three"): caption AI's routes on CI's Windows
 * runner held to two cores, alone or alongside the Performance check, through the app's own engines. These are its
 * pure parts: the workflow input, the scoring, which heard words belong to which clip, the summary and its verdict,
 * the Windows commands, and the committed clips themselves. Placeholder sentences only.
 */

const FIXTURE = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'captions');

describe('the captions input', () => {
  it('is off when empty, so an ordinary performance run is unchanged', () => {
    expect(parseCaptionsInput('')).toBeNull();
    expect(parseCaptionsInput('   ')).toBeNull();
  });

  it('takes alone or alongside, with every candidate when none is named', () => {
    expect(parseCaptionsInput('alone')).toEqual({ mode: 'alone', candidates: [...BENCH_CANDIDATES] });
    expect(parseCaptionsInput(' alongside ')).toEqual({
      mode: 'alongside',
      candidates: [...BENCH_CANDIDATES],
    });
    expect(BENCH_CANDIDATES).toEqual(['rc-gu', 'rc-hi', 'small-gu', 'small-hi', 'small-en']);
  });

  it('takes a candidate list after a colon, in its order', () => {
    expect(parseCaptionsInput('alone:rc-hi, small-hi')).toEqual({
      mode: 'alone',
      candidates: ['rc-hi', 'small-hi'],
    });
    expect(parseCaptionsInput('alongside:rc-gu')).toEqual({ mode: 'alongside', candidates: ['rc-gu'] });
  });

  it.each([
    ['another mode', 'both'],
    ['an unknown candidate', 'alone:turbo-gu'],
    ['a candidate twice', 'alone:rc-gu,rc-gu'],
    ['an empty list', 'alone:'],
    ['an empty name', 'alone:rc-gu,,rc-hi'],
  ])('refuses %s', (_what, input) => {
    expect(() => parseCaptionsInput(input)).toThrow(/captions/u);
  });

  it("names each candidate's language and model", () => {
    expect(BENCH_CANDIDATES.map(candidateLanguage)).toEqual(['gu', 'hi', 'gu', 'hi', 'en']);
    expect(BENCH_CANDIDATES.map(candidateModel)).toEqual([
      'pack-gu-indicconformer-int8',
      'pack-hi-indicconformer-int8',
      'whisper-small',
      'whisper-small',
      'whisper-small',
    ]);
  });
});

describe('scoring (as the trial scorer: NFC, case folded, digits as digits, punctuation a space)', () => {
  it('folds case, digits of any script and punctuation, keeping the clock colon and the vowel signs', () => {
    expect(scoreWords('The Bus, at 8:15.')).toEqual(['the', 'bus', 'at', '8:15']);
    expect(scoreWords('अगली बस सुबह ८:१५ बजे आएगी।')).toEqual(['अगली', 'बस', 'सुबह', '8:15', 'बजे', 'आएगी']);
    expect(scoreWords('રૂમ નંબર ૧૨ બીજા માળે છે.')).toEqual(['રૂમ', 'નંબર', '12', 'બીજા', 'માળે', 'છે']);
    expect(scoreWords('  ')).toEqual([]);
  });

  it('counts word and character errors against whichever written form matches better', () => {
    const r = errorRates(['घड़ी पर पौने पाँच बजे हैं', 'घड़ी पर ४:४५ बजे हैं'], 'घड़ी पर 4:45 बजे हैं');
    expect(r).toMatchObject({ words: 5, wordErrors: 0 });
    const wrong = errorRates(['the bus is ready'], 'the bus was ready now');
    expect(wrong).toMatchObject({ words: 4, wordErrors: 2 });
    expect(wrong.chars).toBe('the bus is ready'.length);
    expect(wrong.charErrors).toBeGreaterThan(0);
    expect(errorRates(['the bus is ready'], '')).toMatchObject({ words: 4, wordErrors: 4 });
  });

  it('takes the nearest-rank percentile', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 95)).toBe(10);
  });
});

describe('a clip and what was heard of it', () => {
  it("finds a clip's speech: from the first to the last 10 ms that is not quiet", () => {
    const pcm = new Int16Array(16_000);
    pcm.fill(8_000, 3_200, 12_800);
    expect(speechSpan(pcm)).toEqual({ fromMs: 200, toMs: 800 });
    expect(speechSpan(new Int16Array(1_600))).toBeNull();
  });

  it('gives each heard phrase to the clip its words began in, timing first words from the onset, the final from the end', () => {
    const plays = [
      { id: 'a', onsetAt: 10_000, speechEndAt: 12_000 },
      { id: 'b', onsetAt: 16_000, speechEndAt: 18_500 },
      { id: 'c', onsetAt: 22_000, speechEndAt: 24_000 },
    ];
    const heard = [
      { final: false, text: 'one', startAt: 10_050, heardAt: 12_400 },
      { final: true, text: 'one two', startAt: 10_050, heardAt: 13_100 },
      // b's final arrives after c's onset; it still belongs to b by its words' time.
      { final: false, text: '', startAt: 16_100, heardAt: 17_000 },
      { final: false, text: 'three', startAt: 16_100, heardAt: 17_600 },
      { final: true, text: 'four', startAt: 17_900, heardAt: 22_300 },
      { final: true, text: 'three', startAt: 16_100, heardAt: 20_100 },
      // Words before the first clip (noise at the start) belong to none.
      { final: true, text: 'noise', startAt: 9_000, heardAt: 9_500 },
    ];
    expect(timingsOf(plays, heard)).toEqual([
      { id: 'a', firstWordsMs: 2_400, finalMs: 1_100, text: 'one two' },
      { id: 'b', firstWordsMs: 1_600, finalMs: 3_800, text: 'three four' },
      { id: 'c', firstWordsMs: null, finalMs: null, text: '' },
    ]);
  });

  it("reads the hub's dropped-late count from its log lines", () => {
    expect(
      droppedIn(['Speech: 12 phrases, 1.4 s behind, 2 dropped late.', 'Speech: 3 phrases, 0.9 s behind.']),
    ).toBe(2);
    expect(droppedIn(['Speech: 1 phrase, 0.5 s behind, 1 dropped late.', 'other'])).toBe(1);
    expect(droppedIn([])).toBe(0);
  });
});

function run(over: Partial<CandidateRun> = {}): CandidateRun {
  const plays = Array.from({ length: 12 }, (_, i) => ({
    id: `hi-${String(i)}`,
    onsetAt: 10_000 * (i + 1),
    speechEndAt: 10_000 * (i + 1) + 2_000,
    references: ['घड़ी पर पौने पाँच बजे हैं'],
  }));
  return {
    candidate: 'rc-hi',
    plays,
    heard: plays.flatMap((p) => [
      { final: false, text: 'घड़ी पर', startAt: p.onsetAt + 50, heardAt: p.onsetAt + 1_200 },
      {
        final: true,
        text: 'घड़ी पर पौने पाँच बजे हैं',
        startAt: p.onsetAt + 50,
        heardAt: p.speechEndAt + 900,
      },
    ]),
    holds: 0,
    dropped: 0,
    engineStartMs: 1_300,
    engines: [{ pid: 4, name: 'ic-ctc.exe', peak: 300 * 1024 * 1024, affinity: 3 }],
    scored: true,
    ...over,
  };
}

describe('the summary and its verdict (live: first words and the final within 3 s at p95, nothing held, dropped or missed, no growth)', () => {
  it('passes a candidate that keeps up', () => {
    const s = summarize(run());
    expect(s).toMatchObject({
      candidate: 'rc-hi',
      clips: 12,
      wer: 0,
      cer: 0,
      firstWords: { p50: 1_200, p95: 1_200, max: 1_200 },
      final: { p50: 900, p95: 900, max: 900 },
      holds: 0,
      dropped: 0,
      missed: 0,
      growthMs: 0,
      engineMb: 300,
      affinity: '3',
      live: true,
      why: [],
    });
    expect(LIVE_MS).toBe(3_000);
    expect(GROWTH_MS).toBe(500);
  });

  it('fails one that is late, held, dropped, misses a clip or falls behind, saying why', () => {
    const slow = run();
    slow.heard = slow.heard.map((h, i) => (h.final ? { ...h, heardAt: h.heardAt + 300 * i } : h));
    const s = summarize({ ...slow, holds: 1, dropped: 2 });
    expect(s.live).toBe(false);
    expect(s.why.join(' ')).toMatch(/final p95/u);
    expect(s.why.join(' ')).toMatch(/held 1/u);
    expect(s.why.join(' ')).toMatch(/dropped 2/u);
    expect(s.why.join(' ')).toMatch(/growth/u);
    const missing = run();
    missing.heard = missing.heard.filter(
      (h) => !(h.final && h.startAt === (missing.plays[3]?.onsetAt ?? 0) + 50),
    );
    const m = summarize(missing);
    expect(m.missed).toBe(1);
    expect(m.why.join(' ')).toMatch(/missed 1/u);
  });

  it('leaves the error rates out where the clips are for timing only (English from the runner)', () => {
    const s = summarize(run({ candidate: 'small-en', scored: false }));
    expect(s.wer).toBeNull();
    expect(s.cer).toBeNull();
    expect(s.live).toBe(true);
  });

  it('writes a table of numbers only (no words heard), with its verdict per candidate', () => {
    const md = benchMarkdown([summarize(run())], {
      mode: 'alone',
      cores: 'two (processor mask 3)',
      platform: 'win32',
    });
    expect(md).toMatch(/\| rc-hi \| 12 \| 0\.0% \| 0\.0% \|/u);
    expect(md).toMatch(/live/u);
    expect(md).not.toMatch(/घड़ी/u);
  });
});

describe('the Windows commands', () => {
  it('limits a process to two cores the way the Performance check does (its processor mask, read back)', () => {
    expect(affinityArgs(1234, 3)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$p = Get-Process -Id 1234; $p.ProcessorAffinity = 3; $p.ProcessorAffinity',
    ]);
    expect(() => affinityArgs(Number.NaN, 3)).toThrow();
  });

  it("lists a process's children with their peak working set and processor mask", () => {
    expect(childrenArgs(77).join(' ')).toMatch(/ParentProcessId=77/u);
    expect(parseChildren('')).toEqual([]);
    expect(parseChildren('{"pid":5,"name":"ic-ctc.exe","peak":1024,"affinity":3}')).toEqual([
      { pid: 5, name: 'ic-ctc.exe', peak: 1024, affinity: 3 },
    ]);
    expect(
      parseChildren(
        '[{"pid":5,"name":"a.exe","peak":1,"affinity":3},{"pid":6,"name":"b.exe","peak":2,"affinity":15}]',
      ),
    ).toHaveLength(2);
  });

  it("speaks English with the runner's own voice, the words and file passed in the environment, never in the command", () => {
    const { args, env } = englishSpeechArgs('Room number 12; is on "the" floor', 'C:\\t\\en-08.wav');
    expect(args.join(' ')).not.toMatch(/Room|en-08/u);
    expect(args.join(' ')).toMatch(/System\.Speech/u);
    expect(args.join(' ')).toMatch(/16000/u);
    expect(env).toEqual({
      DRASHTI_BENCH_TEXT: 'Room number 12; is on "the" floor',
      DRASHTI_BENCH_FILE: 'C:\\t\\en-08.wav',
    });
  });
});

describe('the committed clips (tests/fixtures/captions)', () => {
  const manifest = JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf8')) as BenchManifest;

  it('are 12 sentences by two voices in Gujarati and Hindi, and the same 12 in English as words only', () => {
    expect(manifest.format).toBe('drashti-captions-bench');
    expect(manifest.version).toBe(1);
    for (const lang of ['gu', 'hi'] as const) {
      const mine = manifest.clips.filter((c) => c.language === lang);
      expect(mine).toHaveLength(24);
      expect(new Set(mine.map((c) => c.id)).size).toBe(24);
    }
    expect(manifest.english.sentences).toHaveLength(12);
  });

  it('are each the file listed: its size, SHA-256 and 16 kHz mono 16-bit sound', () => {
    let total = 0;
    for (const c of manifest.clips) {
      const file = join(FIXTURE, c.file);
      const body = readFileSync(file);
      expect(statSync(file).size).toBe(c.bytes);
      expect(createHash('sha256').update(body).digest('hex')).toBe(c.sha256);
      expect(body.toString('ascii', 0, 4)).toBe('RIFF');
      expect(body.readUInt16LE(22)).toBe(1);
      expect(body.readUInt32LE(24)).toBe(16_000);
      expect(body.readUInt16LE(34)).toBe(16);
      total += c.bytes;
    }
    expect(total).toBeLessThan(6_000_000);
  });

  it('credit every voice that made them, with its licence', () => {
    const credits = readFileSync(join(FIXTURE, 'CREDITS.md'), 'utf8');
    for (const model of new Set(manifest.clips.map((c) => c.model))) {
      const [name = '', revision = ''] = model.split('@');
      expect(credits).toContain(`https://huggingface.co/${name}`);
      expect(credits).toContain(revision);
    }
    expect(credits).toMatch(/CC-BY-4\.0/u);
    expect(credits).toMatch(/Rasa/u);
  });
});
