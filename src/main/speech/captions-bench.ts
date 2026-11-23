/*
 * The captions bench (CAP-CI-1; the owner, 24 Nov 2026: "Yes, all three"): caption AI's routes measured on CI's
 * Windows runner held to two cores, as a mandir Main has, alone or alongside the Performance check
 * (scripts/captions-bench.mjs, the Performance workflow's `captions` input). It plays generated placeholder speech
 * (tests/fixtures/captions) to the app's own engines in real time and times what the speech hub passes on. These
 * are its pure parts; captions-bench.run.ts drives the engines. Numbers only leave it: never a word heard.
 */

/** The candidates: Route C's two packs, and today's Standard (the small model) in each language. */
export const BENCH_CANDIDATES = ['rc-gu', 'rc-hi', 'small-gu', 'small-hi', 'small-en'] as const;
export type BenchCandidate = (typeof BENCH_CANDIDATES)[number];
export type BenchMode = 'alone' | 'alongside';
export interface BenchAsk {
  mode: BenchMode;
  candidates: BenchCandidate[];
}

/** The owner's live limit for a caption line (about 3 s), for first words and for the final, at p95. */
export const LIVE_MS = 3_000;
/** A continuous run falls behind when its finals' median grows by more than this from its first third to its last. */
export const GROWTH_MS = 500;

/** The committed clips' list (tests/fixtures/captions/manifest.json). */
export interface BenchManifest {
  format: 'drashti-captions-bench';
  version: 1;
  clips: {
    id: string;
    language: 'gu' | 'hi';
    text: string;
    text_digits: string | null;
    file: string;
    bytes: number;
    sha256: string;
    model: string;
  }[];
  english: { sentences: { id: string; text: string }[] };
}

/** One clip as played: when its speech began and ended (epoch ms), and its words as written. */
export interface BenchPlay {
  id: string;
  onsetAt: number;
  speechEndAt: number;
  references: string[];
}
/** What the speech hub passed on (a Heard's parts that matter here). */
export interface BenchHeard {
  final: boolean;
  text: string;
  startAt: number;
  heardAt: number;
}
/** An engine program the bench's process started, as Windows reported it. */
export interface BenchEngine {
  pid: number;
  name: string;
  /** Its peak working set, in bytes. */
  peak: number;
  /** Its processor mask. */
  affinity: number;
}
export interface CandidateRun {
  candidate: BenchCandidate;
  plays: BenchPlay[];
  heard: BenchHeard[];
  /** How often the hub said held. */
  holds: number;
  /** Phrases the hub dropped as too late. */
  dropped: number;
  /** From the switch on to listening. */
  engineStartMs: number | null;
  engines: BenchEngine[];
  /** False for clips made for timing only (English from the runner's voice): no error rates then. */
  scored: boolean;
}

export function parseCaptionsInput(input: string): BenchAsk | null {
  const text = input.trim();
  if (text === '') return null;
  const m = /^(alone|alongside)(?::(.*))?$/u.exec(text);
  if (!m)
    throw new Error(`captions: "${text}" is not alone or alongside (then, after a colon, the candidates)`);
  const mode = m[1] as BenchMode;
  if (m[2] === undefined) return { mode, candidates: [...BENCH_CANDIDATES] };
  const names = m[2].split(',').map((n) => n.trim());
  const candidates: BenchCandidate[] = [];
  for (const name of names) {
    const known = BENCH_CANDIDATES.find((c) => c === name);
    if (!known)
      throw new Error(`captions: unknown candidate "${name}" (known: ${BENCH_CANDIDATES.join(', ')})`);
    if (candidates.includes(known)) throw new Error(`captions: "${name}" is named twice`);
    candidates.push(known);
  }
  return { mode, candidates };
}

export function candidateLanguage(c: BenchCandidate): 'gu' | 'hi' | 'en' {
  return c.endsWith('-gu') ? 'gu' : c.endsWith('-hi') ? 'hi' : 'en';
}

export function candidateModel(
  c: BenchCandidate,
): 'pack-gu-indicconformer-int8' | 'pack-hi-indicconformer-int8' | 'whisper-small' {
  if (c === 'rc-gu') return 'pack-gu-indicconformer-int8';
  if (c === 'rc-hi') return 'pack-hi-indicconformer-int8';
  return 'whisper-small';
}

/** The zero of each script's digits the clips use: ASCII, Devanagari, Gujarati. */
const DIGIT_ZEROS = [0x30, 0x966, 0xae6];

/** Words for scoring: NFC, case folded, any script's digits as ASCII, punctuation a space (a clock's colon kept). */
export function scoreWords(text: string): string[] {
  let s = '';
  for (const ch of text.normalize('NFC').toLowerCase()) {
    const cp = ch.codePointAt(0) ?? 0;
    const zero = DIGIT_ZEROS.find((z) => cp >= z && cp <= z + 9);
    s += zero === undefined ? ch : String(cp - zero);
  }
  return s
    .replace(/(?<=\d):(?=\d)/gu, '\uE000')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\uE000/gu, ':')
    .split(/\s+/u)
    .filter((w) => w !== '');
}

function editDistance<T>(a: readonly T[], b: readonly T[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1)
      row.push(
        Math.min(
          (prev[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Word and character errors of what was heard, against whichever written form of the speech it matches better. */
export function errorRates(
  references: readonly string[],
  heard: string,
): { words: number; wordErrors: number; chars: number; charErrors: number } {
  const hyp = scoreWords(heard);
  // Characters are code points, as the trial scorer counts them.
  const hypChars = Array.from(hyp.join(' '));
  let best: { words: number; wordErrors: number; chars: number; charErrors: number } | null = null;
  for (const reference of references) {
    const ref = scoreWords(reference);
    const refChars = Array.from(ref.join(' '));
    const r = {
      words: ref.length,
      wordErrors: editDistance(ref, hyp),
      chars: refChars.length,
      charErrors: editDistance(refChars, hypChars),
    };
    if (
      !best ||
      r.wordErrors / Math.max(1, r.words) < best.wordErrors / Math.max(1, best.words) ||
      (r.wordErrors / Math.max(1, r.words) === best.wordErrors / Math.max(1, best.words) &&
        r.charErrors / Math.max(1, r.chars) < best.charErrors / Math.max(1, best.chars))
    )
      best = r;
  }
  return best ?? { words: 0, wordErrors: 0, chars: 0, charErrors: 0 };
}

/** The nearest-rank percentile, or null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

/** Quiet: a 10 ms stretch whose loudest sample is below -50 dBFS. */
const QUIET = Math.round(32_768 * 10 ** (-50 / 20));

/** Where a 16 kHz clip's speech is: from its first to its last 10 ms that is not quiet, or null when all is. */
export function speechSpan(pcm: Int16Array): { fromMs: number; toMs: number } | null {
  const frame = 160;
  let first = -1;
  let last = -1;
  for (let f = 0; f * frame < pcm.length; f += 1) {
    let loud = false;
    for (let i = f * frame; i < Math.min(pcm.length, (f + 1) * frame); i += 1)
      if (Math.abs(pcm[i] ?? 0) > QUIET) {
        loud = true;
        break;
      }
    if (loud) {
      if (first < 0) first = f;
      last = f;
    }
  }
  return first < 0 ? null : { fromMs: first * 10, toMs: (last + 1) * 10 };
}

/** A heard phrase belongs to the clip its words began in (from a quarter second before that clip's onset). */
const EARLY_MS = 250;

/**
 * For each clip: its first words from its onset (any phrase with words, provisional or final), its last final from
 * its speech's end, and the final words in the order spoken. A phrase whose words began before every clip is none's.
 */
export function timingsOf(
  plays: readonly Pick<BenchPlay, 'id' | 'onsetAt' | 'speechEndAt'>[],
  heard: readonly BenchHeard[],
): { id: string; firstWordsMs: number | null; finalMs: number | null; text: string }[] {
  const mine = plays.map(() => [] as BenchHeard[]);
  for (const h of heard) {
    if (h.text.trim() === '') continue;
    const at = h.startAt > 0 ? h.startAt : h.heardAt;
    let k = -1;
    plays.forEach((p, i) => {
      if (p.onsetAt - EARLY_MS <= at) k = i;
    });
    if (k >= 0) mine[k]?.push(h);
  }
  return plays.map((p, i) => {
    const got = mine[i] ?? [];
    const finals = got.filter((h) => h.final).sort((a, b) => a.startAt - b.startAt);
    return {
      id: p.id,
      firstWordsMs: got.length > 0 ? Math.min(...got.map((h) => h.heardAt)) - p.onsetAt : null,
      finalMs: finals.length > 0 ? Math.max(...finals.map((h) => h.heardAt)) - p.speechEndAt : null,
      text: finals.map((h) => h.text.trim()).join(' '),
    };
  });
}

/** The phrases the hub dropped as too late, from its log ("…, N dropped late."). */
export function droppedIn(lines: readonly string[]): number {
  let n = 0;
  for (const line of lines) {
    const m = /, (\d+) dropped late\./u.exec(line);
    if (m) n += Number(m[1]);
  }
  return n;
}

export interface Spread {
  p50: number | null;
  p95: number | null;
  max: number | null;
}
const spread = (values: readonly number[]): Spread => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: values.length > 0 ? Math.max(...values) : null,
});

export interface CandidateSummary {
  candidate: BenchCandidate;
  clips: number;
  /** Corpus-weighted (all word errors over all reference words), or null when not scored. */
  wer: number | null;
  cer: number | null;
  firstWords: Spread;
  final: Spread;
  holds: number;
  dropped: number;
  /** Clips with no final words at all. */
  missed: number;
  /** The finals' median, last third against first third (ms), or null below 9 clips. */
  growthMs: number | null;
  engineStartMs: number | null;
  /** The engines' highest peak working set, MB, or null when not read (not Windows). */
  engineMb: number | null;
  /** The engines' processor masks, as read ("3"), or null when not read. */
  affinity: string | null;
  live: boolean;
  why: string[];
}

export function summarize(run: CandidateRun): CandidateSummary {
  const times = timingsOf(run.plays, run.heard);
  const first = times.flatMap((t) => (t.firstWordsMs === null ? [] : [t.firstWordsMs]));
  const finals = times.flatMap((t) => (t.finalMs === null ? [] : [t.finalMs]));
  const missed = times.filter((t) => t.text === '').length;
  let words = 0;
  let wordErrors = 0;
  let chars = 0;
  let charErrors = 0;
  if (run.scored)
    run.plays.forEach((p, i) => {
      const r = errorRates(p.references, times[i]?.text ?? '');
      words += r.words;
      wordErrors += r.wordErrors;
      chars += r.chars;
      charErrors += r.charErrors;
    });
  const third = Math.floor(times.length / 3);
  const ofPart = (part: typeof times): number[] =>
    part.flatMap((t) => (t.finalMs === null ? [] : [t.finalMs]));
  const early = percentile(ofPart(times.filter((_, i) => i < third)), 50);
  const late = percentile(ofPart(times.filter((_, i) => i >= times.length - third)), 50);
  const growthMs = times.length >= 9 && early !== null && late !== null ? late - early : null;
  const s: CandidateSummary = {
    candidate: run.candidate,
    clips: run.plays.length,
    wer: run.scored && words > 0 ? wordErrors / words : null,
    cer: run.scored && chars > 0 ? charErrors / chars : null,
    firstWords: spread(first),
    final: spread(finals),
    holds: run.holds,
    dropped: run.dropped,
    missed,
    growthMs,
    engineStartMs: run.engineStartMs,
    engineMb:
      run.engines.length > 0 ? Math.round(Math.max(...run.engines.map((e) => e.peak)) / 1_048_576) : null,
    affinity:
      run.engines.length > 0 ? [...new Set(run.engines.map((e) => String(e.affinity)))].join(', ') : null,
    live: false,
    why: [],
  };
  const over = (what: string, v: number | null): void => {
    if (v === null || v > LIVE_MS)
      s.why.push(`${what} ${v === null ? 'none' : `${String(v)} ms`} (limit ${String(LIVE_MS)})`);
  };
  over('first words p95', s.firstWords.p95);
  over('final p95', s.final.p95);
  if (s.holds > 0) s.why.push(`held ${String(s.holds)}`);
  if (s.dropped > 0) s.why.push(`dropped ${String(s.dropped)}`);
  if (s.missed > 0) s.why.push(`missed ${String(s.missed)}`);
  if (s.growthMs !== null && s.growthMs > GROWTH_MS)
    s.why.push(`growth ${String(s.growthMs)} ms (limit ${String(GROWTH_MS)})`);
  s.live = s.why.length === 0;
  return s;
}

const pct = (v: number | null): string => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const sec = (v: number | null): string => (v === null ? '-' : (v / 1000).toFixed(2));
const trio = (s: Spread): string => `${sec(s.p50)} / ${sec(s.p95)} / ${sec(s.max)}`;

/** The bench's table (numbers only, never a word heard), with each candidate's verdict. */
export function benchMarkdown(
  summaries: readonly CandidateSummary[],
  meta: { mode: BenchMode; cores: string; platform: string; show?: string },
): string {
  const lines = [
    `# Captions bench (${meta.mode}${meta.mode === 'alongside' ? ', with the Performance check running' : ''})`,
    '',
    `Platform ${meta.platform}; cores: ${meta.cores}. Live = first words and the final within ${sec(LIVE_MS)} s at p95, nothing held, dropped or missed, no growth over ${sec(GROWTH_MS)} s. Times in seconds (p50 / p95 / max): first words from the speech's onset, the final from its end.`,
    '',
    '| candidate | clips | WER | CER | first words | final | held | dropped | missed | growth | engine start | engine MB | mask | live |',
    '|---|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|',
    ...summaries.map(
      (s) =>
        `| ${s.candidate} | ${String(s.clips)} | ${pct(s.wer)} | ${pct(s.cer)} | ${trio(s.firstWords)} | ${trio(s.final)} | ${String(s.holds)} | ${String(s.dropped)} | ${String(s.missed)} | ${sec(s.growthMs)} | ${sec(s.engineStartMs)} | ${s.engineMb === null ? '-' : String(s.engineMb)} | ${s.affinity ?? '-'} | ${s.live ? 'live' : `NOT live: ${s.why.join('; ')}`} |`,
    ),
    '',
  ];
  if (meta.show) lines.push(meta.show, '');
  return lines.join('\n');
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command'];

/** PowerShell's arguments that set a process's processor mask and read it back (the Performance check's way). */
export function affinityArgs(pid: number, mask: number): string[] {
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(mask) || mask <= 0)
    throw new Error('affinityArgs: a process id and a mask');
  return [
    ...POWERSHELL,
    `$p = Get-Process -Id ${String(pid)}; $p.ProcessorAffinity = ${String(mask)}; $p.ProcessorAffinity`,
  ];
}

/** PowerShell's arguments that list a process's children: id, name, peak working set, processor mask (JSON). */
export function childrenArgs(pid: number): string[] {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('childrenArgs: a process id');
  return [
    ...POWERSHELL,
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(pid)}" | ForEach-Object { $q = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($q) { [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; peak = [int64]$q.PeakWorkingSet64; affinity = [int64]$q.ProcessorAffinity } } } | ConvertTo-Json -Compress`,
  ];
}

export function parseChildren(json: string): BenchEngine[] {
  const text = json.trim();
  if (text === '') return [];
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
  return list.flatMap((e) => {
    if (typeof e !== 'object' || e === null) return [];
    const o = e as Record<string, unknown>;
    return typeof o['pid'] === 'number' && typeof o['name'] === 'string'
      ? [
          {
            pid: o['pid'],
            name: o['name'],
            peak: Number(o['peak'] ?? 0),
            affinity: Number(o['affinity'] ?? 0),
          },
        ]
      : [];
  });
}

/**
 * PowerShell's arguments that speak English with the runner's own Windows voice into a 16 kHz mono 16-bit WAV. The
 * words and the file go in the environment, never into the command.
 */
export function englishSpeechArgs(
  text: string,
  file: string,
): { args: string[]; env: Record<string, string> } {
  return {
    args: [
      ...POWERSHELL,
      'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); $s.SetOutputToWaveFile($env:DRASHTI_BENCH_FILE, $f); $s.Speak($env:DRASHTI_BENCH_TEXT); $s.Dispose()',
    ],
    env: { DRASHTI_BENCH_TEXT: text, DRASHTI_BENCH_FILE: file },
  };
}
