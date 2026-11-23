/*
 * The captions bench's run (CAP-CI-1): run by scripts/captions-bench.mjs through vitest.captions-bench.config.mjs,
 * never in the unit suite (its name is not *.test.ts). On CI's Windows runner (the Performance workflow's `captions`
 * input) this process first limits itself to two cores the way the Performance check does (processor mask 3; the
 * engines it starts take its cores), then plays the committed clips (tests/fixtures/captions) in real time, 100 ms at
 * a time, to each candidate through the app's own engines:
 *   - Route C (rc-gu, rc-hi): alpha.22's pack zip imported by the real ModelPackStore, its known model found as the app
 *     finds it, createIndicRoute on Drashti's helper (vendor/indic), below the show, two threads, as index.ts wires it;
 *   - today's Standard (small-gu, small-hi, small-en): createWhisperEngine on whisper-server (vendor/whisper) with the
 *     small model (models.ts's pin), fallback on, the language chosen, as index.ts wires it.
 * Each through the real speech hub, timed as the hub passes phrases on. English is spoken by the runner's own
 * Windows voice at run time and never kept. Writes compare.md and results.json (numbers only, never a word heard)
 * into CAPTIONS_BENCH_OUT.
 *   CAPTIONS_BENCH        the workflow's input: alone | alongside [:candidates]
 *   CAPTIONS_BENCH_OUT    where its tables go
 *   CAPTIONS_BENCH_STOP   alongside: rounds go on until this file appears (the Performance check is over)
 *   CAPTIONS_BENCH_MINUTES alongside: at most this long (default 40)
 *   CAPTIONS_BENCH_CACHE  the models' cache (default ~/.cache/drashti/caption-models)
 *   CAPTIONS_BENCH_INDIC, CAPTIONS_BENCH_WHISPER  the engine programs, when not in vendor/ (a local try)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { DEFAULT_CACHE, fetchCaptionModel } from '../../../scripts/fetch-caption-models.mjs';
import type { SpeechLanguage } from '../../shared/speech';
import { ModelPackStore } from '../model-packs/store';
import {
  affinityArgs,
  benchMarkdown,
  candidateLanguage,
  candidateModel,
  childrenArgs,
  droppedIn,
  englishSpeechArgs,
  parseCaptionsInput,
  parseChildren,
  speechSpan,
  summarize,
  timingsOf,
  type BenchCandidate,
  type BenchEngine,
  type BenchHeard,
  type BenchManifest,
  type BenchPlay,
  type CandidateRun,
} from './captions-bench';
import { findWhisper } from './engine-place';
import { createSpeechHub, type SpeechEngine } from './hub';
import { findIndic } from './indic-place';
import { createIndicRoute } from './indic-route';
import { LANGUAGE_MODELS } from './language-models';
import { packFileFor } from './pack-language-models';
import { createWhisperEngine } from './whisper-engine';

const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'captions');
const RATE = 16_000;
const BATCH = 1_600;
/** Silence before the first clip (the speech gate learns its floor), before each clip, and after each. */
const LEAD_IN_MS = 1_000;
const BEFORE_MS = 500;
const AFTER_MS = 2_000;
const env = process.env;
const WINDOWS = process.platform === 'win32';
const POWERSHELL = `${env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;

function powershell(args: string[], extra: Record<string, string> = {}): string {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && k !== 'PSModulePath') e[k] = v;
  const r = spawnSync(POWERSHELL, args, { env: { ...e, ...extra }, encoding: 'utf8', timeout: 60_000 });
  if (r.status !== 0) throw new Error(`PowerShell failed (${String(r.status)}): ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** A 16 kHz mono 16-bit WAV's samples. */
function pcmOf(file: string): Int16Array {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`not a WAV: ${file}`);
  let at = 12;
  let format: Buffer | null = null;
  while (at + 8 <= b.length) {
    const id = b.toString('ascii', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') format = b.subarray(at + 8, at + 8 + size);
    if (id === 'data') {
      if (format?.readUInt16LE(2) !== 1 || format.readUInt32LE(4) !== RATE || format.readUInt16LE(14) !== 16)
        throw new Error(`not 16 kHz mono 16-bit: ${file}`);
      const copy = Buffer.from(b.subarray(at + 8, at + 8 + size));
      return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no sound in ${file}`);
}

interface Clip {
  id: string;
  pcm: Int16Array;
  references: string[];
}

/** The clips, one after another with silence around them, and where each one's speech begins and ends. */
function timeline(clips: readonly Clip[]): {
  samples: Int16Array;
  spans: { id: string; from: number; to: number; references: string[] }[];
} {
  const ms = (n: number): number => Math.round((n * RATE) / 1000);
  const total = ms(LEAD_IN_MS) + clips.reduce((n, c) => n + ms(BEFORE_MS) + c.pcm.length + ms(AFTER_MS), 0);
  const samples = new Int16Array(Math.ceil(total / BATCH) * BATCH);
  const spans: { id: string; from: number; to: number; references: string[] }[] = [];
  let at = ms(LEAD_IN_MS);
  for (const c of clips) {
    at += ms(BEFORE_MS);
    samples.set(c.pcm, at);
    const span = speechSpan(c.pcm) ?? { fromMs: 0, toMs: Math.round((c.pcm.length * 1000) / RATE) };
    spans.push({ id: c.id, from: at + ms(span.fromMs), to: at + ms(span.toMs), references: c.references });
    at += c.pcm.length + ms(AFTER_MS);
  }
  return { samples, spans };
}

/** The stream's sound as the engines take it: each 100 ms on time from the first open, to whoever has it open. */
function feeder(samples: Int16Array): {
  sound: { open(chunk: (s: Int16Array, endAt: number, startAt?: number) => void): () => void };
  startedAt(): number | null;
  done: Promise<void>;
  lagMs(): number;
  stop(): void;
} {
  let t0: number | null = null;
  let listener: ((s: Int16Array, endAt: number, startAt?: number) => void) | null = null;
  let next = 0;
  let timer: NodeJS.Timeout | null = null;
  let worstLag = 0;
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  const batches = samples.length / BATCH;
  const tick = (): void => {
    if (t0 === null) return;
    const now = Date.now();
    while (next < batches && t0 + (next + 1) * 100 <= now) {
      const endAt = t0 + (next + 1) * 100;
      worstLag = Math.max(worstLag, now - endAt);
      listener?.(samples.subarray(next * BATCH, (next + 1) * BATCH), endAt, endAt - 100);
      next += 1;
    }
    if (next >= batches) {
      if (timer) clearInterval(timer);
      timer = null;
      finish();
    }
  };
  return {
    sound: {
      open(chunk) {
        listener = chunk;
        if (t0 === null) {
          t0 = Date.now();
          timer = setInterval(tick, 20);
        }
        return () => {
          if (listener === chunk) listener = null;
        };
      },
    },
    startedAt: () => t0,
    done,
    lagMs: () => worstLag,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      listener = null;
      finish();
    },
  };
}

interface Programs {
  indic: string | null;
  whisper: string | null;
  files: Map<string, string>;
}

async function runCandidate(
  candidate: BenchCandidate,
  clips: readonly Clip[],
  p: Programs,
): Promise<CandidateRun & { feedLagMs: number; failed: string | null }> {
  const language = candidateLanguage(candidate) as SpeechLanguage;
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
  const scratch = mkdtempSync(join(tmpdir(), `drashti-captions-bench-${candidate}-`));
  const { samples, spans } = timeline(clips);
  const feed = feeder(samples);
  let store: ModelPackStore | null = null;
  try {
    let engine: SpeechEngine | null;
    if (candidate.startsWith('rc-')) {
      const zip = p.files.get(candidateModel(candidate));
      if (!zip || !p.indic) throw new Error(`${candidate}: no pack or no Route C helper`);
      store = new ModelPackStore({ root: join(scratch, 'model-packs'), log });
      store.start();
      const imported = await store.importPack(zip, 'zip');
      if (!imported.ok) throw new Error(`${candidate}: the pack was refused: ${imported.message}`);
      const entry = LANGUAGE_MODELS.find((e) => e.id === `${language}-indicconformer-ctc-int8`);
      const found = entry ? packFileFor(store, entry) : null;
      const packed = found ? store.model(found.modelId) : null;
      if (!packed) throw new Error(`${candidate}: the pack holds no model Drashti knows`);
      const indic = p.indic;
      engine = createIndicRoute({
        store,
        program: () => indic,
        problem: () => null,
        admission: 'below-show',
        threads: 2,
        sound: feed.sound,
        log,
      }).make(packed, language);
    } else {
      const model = p.files.get('whisper-small');
      const whisper = p.whisper;
      if (!model || !whisper) throw new Error(`${candidate}: no small model or no whisper-server`);
      engine = createWhisperEngine({
        program: () => whisper,
        model: () => model,
        fallback: () => true,
        timestamps: () => true,
        sound: feed.sound,
        log,
      });
    }
    if (!engine) throw new Error(`${candidate}: the route did not take its model`);
    const hub = createSpeechHub({ engine, log, reportEveryMs: 60_000 });
    const heard: BenchHeard[] = [];
    const seen: { holds: number; listeningAt: number | null; failed: string | null } = {
      holds: 0,
      listeningAt: null,
      failed: null,
    };
    const began = Date.now();
    hub.onState((s) => {
      if (s.phase === 'held') seen.holds += 1;
      if (s.phase === 'listening') seen.listeningAt ??= Date.now();
      if (s.phase === 'failed') {
        seen.failed = s.message;
        feed.stop();
      }
    });
    const unlisten = hub.listen('bench', (h) =>
      heard.push({ final: h.final, text: h.text, startAt: h.startAt, heardAt: Date.now() }),
    );
    hub.setLanguage(language);
    hub.setOn(true);
    const limit = (samples.length / RATE) * 1000 + 120_000;
    await Promise.race([feed.done, sleep(limit)]);
    await sleep(4_000);
    let engines: BenchEngine[] = [];
    if (WINDOWS)
      engines = parseChildren(powershell(childrenArgs(process.pid))).filter((e) =>
        /^(ic-ctc|whisper-server)\.exe$/iu.test(e.name),
      );
    unlisten();
    hub.close();
    feed.stop();
    await sleep(1_500);
    const t0 = feed.startedAt() ?? began;
    const plays: BenchPlay[] = spans.map((s) => ({
      id: s.id,
      onsetAt: t0 + Math.round((s.from * 1000) / RATE),
      speechEndAt: t0 + Math.round((s.to * 1000) / RATE),
      references: s.references,
    }));
    return {
      candidate,
      plays,
      heard,
      holds: seen.holds,
      dropped: droppedIn(lines),
      engineStartMs: seen.listeningAt === null ? null : seen.listeningAt - began,
      engines,
      scored: candidate !== 'small-en',
      feedLagMs: feed.lagMs(),
      failed: seen.failed,
    };
  } finally {
    feed.stop();
    store?.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

it('captions bench', async () => {
  const ask = parseCaptionsInput(env['CAPTIONS_BENCH'] ?? '');
  if (!ask) throw new Error('CAPTIONS_BENCH is empty: say alone or alongside (and the candidates)');
  const out = resolve(env['CAPTIONS_BENCH_OUT'] ?? join(ROOT, '.scratch', 'captions-bench'));
  mkdirSync(out, { recursive: true });
  // Two cores, as the Performance check makes them on Windows: this process first, then every engine it starts.
  const cores = WINDOWS
    ? `two (processor mask ${powershell(affinityArgs(process.pid, 3))})`
    : 'all (not Windows)';
  const cacheDir = env['CAPTIONS_BENCH_CACHE'] ?? DEFAULT_CACHE;
  const files = new Map<string, string>();
  for (const id of new Set(ask.candidates.map(candidateModel)))
    files.set(
      id,
      await fetchCaptionModel(id, {
        cacheDir,
        fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(600_000) }),
        pause: (ms) => sleep(ms),
      }),
    );
  const place = {
    packaged: false,
    resourcesPath: '',
    appPath: ROOT,
    platform: process.platform,
    arch: process.arch,
  };
  const programs: Programs = {
    indic: env['CAPTIONS_BENCH_INDIC'] ?? findIndic(place),
    whisper: env['CAPTIONS_BENCH_WHISPER'] ?? findWhisper(place),
    files,
  };
  const manifest = JSON.parse(readFileSync(join(FIXTURE, 'manifest.json'), 'utf8')) as BenchManifest;
  const clipsFor = (language: 'gu' | 'hi' | 'en'): Clip[] => {
    if (language !== 'en')
      return manifest.clips
        .filter((c) => c.language === language)
        .map((c) => ({
          id: c.id,
          pcm: pcmOf(join(FIXTURE, c.file)),
          references: c.text_digits ? [c.text, c.text_digits] : [c.text],
        }));
    if (!WINDOWS)
      throw new Error(
        'small-en: English is spoken by the Windows runner’s own voice, so it runs on Windows only',
      );
    const dir = mkdtempSync(join(tmpdir(), 'drashti-captions-en-'));
    try {
      return manifest.english.sentences.map((s) => {
        const file = join(dir, `${s.id}.wav`);
        const speak = englishSpeechArgs(s.text, file);
        powershell(speak.args, speak.env);
        return { id: s.id, pcm: pcmOf(file), references: [s.text] };
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const clips = new Map<BenchCandidate, Clip[]>();
  const runs = new Map<BenchCandidate, CandidateRun>();
  const notes: string[] = [];
  const failures: string[] = [];
  const stopFile = env['CAPTIONS_BENCH_STOP'] ?? '';
  const until = Date.now() + Number(env['CAPTIONS_BENCH_MINUTES'] ?? '40') * 60_000;
  for (let round = 1; ; round += 1) {
    for (const c of ask.candidates) {
      let r: Awaited<ReturnType<typeof runCandidate>>;
      try {
        if (!clips.has(c)) clips.set(c, clipsFor(candidateLanguage(c)));
        r = await runCandidate(c, clips.get(c) ?? [], programs);
      } catch (error) {
        // Said in the table, and the run fails at the end; the other candidates are still measured.
        const why = error instanceof Error ? error.message : String(error);
        notes.push(`${c} round ${String(round)}: FAILED: ${why}`);
        failures.push(`${c}: ${why}`);
        continue;
      }
      notes.push(
        `${c} round ${String(round)}: feed lag at most ${String(r.feedLagMs)} ms${r.failed ? `; FAILED: ${r.failed}` : ''}`,
      );
      if (r.failed !== null) failures.push(`${c}: the engine failed: ${r.failed}`);
      else if (r.engineStartMs === null) failures.push(`${c}: the engine never listened`);
      const was = runs.get(c);
      runs.set(
        c,
        was
          ? {
              ...was,
              plays: [...was.plays, ...r.plays],
              heard: [...was.heard, ...r.heard],
              holds: was.holds + r.holds,
              dropped: was.dropped + r.dropped,
              engines: [...was.engines, ...r.engines],
            }
          : r,
      );
      if (ask.mode === 'alongside' && (Date.now() > until || (stopFile !== '' && existsSync(stopFile))))
        break;
    }
    if (ask.mode === 'alone' || Date.now() > until || (stopFile !== '' && existsSync(stopFile))) break;
  }
  const summaries = [...runs.values()].map(summarize);
  const md = benchMarkdown(summaries, {
    mode: ask.mode,
    cores,
    platform: `${process.platform}-${process.arch}`,
    show: notes.map((n) => `- ${n}`).join('\n'),
  });
  writeFileSync(join(out, 'compare.md'), md);
  writeFileSync(
    join(out, 'results.json'),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        mode: ask.mode,
        cores,
        platform: `${process.platform}-${process.arch}`,
        summaries,
        // Times only, per clip: never the words.
        clips: [...runs.values()].map((r) => ({
          candidate: r.candidate,
          times: timingsOf(r.plays, r.heard).map((t) => ({
            id: t.id,
            firstWordsMs: t.firstWordsMs,
            finalMs: t.finalMs,
            heardAnything: t.text !== '',
          })),
        })),
        notes,
      },
      null,
      2,
    )}\n`,
  );
  console.log(md);
  expect(failures, 'every candidate measured').toEqual([]);
}, 3_600_000);
