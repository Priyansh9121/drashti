import { contentTracing } from 'electron';
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { FIRST_BOLD_MARK, WARM_UP_MARK } from '../shared/perf-marks';

/*
 * The performance check's watch on the main process (Session 15). Every
 * slide change passes through the main process's event loop, so the check
 * notes each time the loop went more than 100 ms without a turn (a gap),
 * and when, beside a timeline of what was going on: the audio layer and the
 * music, requests for media files and how long each took to answer and to
 * send, slow requests from the windows, and the import. The worst gap is a
 * figure the check reports.
 *
 * With DRASHTI_PERF_PROFILE=<folder> it also keeps a CPU profile of the main
 * process's JavaScript and a Chromium trace of the processes' main threads,
 * to see what filled a gap that JavaScript did not (the timeline goes there
 * too, as JSON). The trace also has each new kind of drawing the GPU made (a
 * pipeline, with its compile time; Session 27) and the pages' marks, so the
 * check can say what the GPU made during the first Bold transition.
 */

export interface Gap {
  /** When the gap began, ms since the watch started. */
  at: number;
  /** How long the loop went without a turn (ms). */
  ms: number;
}

export interface TimelineEvent {
  at: number;
  what: string;
  /** How long it took, when it is something that took time. */
  ms?: number;
}

/** A gap longer than this is noted. */
export const GAP_MS = 100;
/** How often the loop is asked for a turn. */
const TICK_MS = 10;
/** The timeline keeps at most this many events (the first ones). */
const MAX_EVENTS = 50_000;

const round = (ms: number) => Math.round(ms * 10) / 10;

export class MainWatch {
  private t0 = performance.now();
  private last = this.t0;
  private timer: NodeJS.Timeout | null = null;
  private longest = 0;
  /** When the longest began, ms since the watch (or the measured part) began. */
  private longestAt = 0;
  readonly gaps: Gap[] = [];
  readonly events: TimelineEvent[] = [];

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const gap = now - this.last;
      if (gap - TICK_MS > this.longest) {
        this.longest = gap - TICK_MS;
        this.longestAt = round(this.last - this.t0);
      }
      if (gap > GAP_MS) this.gaps.push({ at: round(this.last - this.t0), ms: round(gap) });
      this.last = now;
    }, TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Start counting afresh (the measured part of the check begins). */
  reset(): void {
    this.t0 = performance.now();
    this.last = this.t0;
    this.longest = 0;
    this.longestAt = 0;
    this.gaps.length = 0;
    this.events.length = 0;
  }

  /** Ms since the watch (or the measured part) began. */
  now(): number {
    return round(performance.now() - this.t0);
  }

  note(what: string, ms?: number): void {
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push(ms === undefined ? { at: this.now(), what } : { at: this.now(), what, ms: round(ms) });
  }

  /** The longest the main process went without a turn, beyond the watch's own tick (ms). */
  worstBlockMs(): number {
    return Math.round(this.longest);
  }

  /** When the longest began (ms since the watch or the measured part began): the start, or later on. */
  worstBlockAt(): number {
    return this.longestAt;
  }

  /** What was going on within `around` ms of each gap, for the summary of a gap. */
  near(gap: Gap, around = 200): TimelineEvent[] {
    return this.events.filter((e) => e.at >= gap.at - around && e.at <= gap.at + gap.ms + around);
  }
}

/** The JavaScript CPU profile and the Chromium trace (DRASHTI_PERF_PROFILE), started and stopped around the check. */
export class PerfProfile {
  private session: Session | null = null;
  private tracing = false;
  private traced = false;

  constructor(private readonly folder: string) {}

  async start(): Promise<void> {
    mkdirSync(this.folder, { recursive: true });
    const session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    // Every half millisecond: enough to see what a 100 ms gap was made of.
    await session.post('Profiler.setSamplingInterval', { interval: 500 });
    await session.post('Profiler.start');
    this.session = session;
    // Tasks on each process's threads (toplevel), with where they were posted from, and IPC; the GPU's new
    // pipelines and Dawn's compiling (Session 26g's way of seeing them), and the pages' marks.
    await contentTracing.startRecording({
      included_categories: [
        'toplevel',
        'toplevel.flow',
        'ipc',
        'mojom',
        'electron',
        'v8.execute',
        'skia.shaders',
        'disabled-by-default-skia.shaders',
        'gpu.dawn',
        'blink.user_timing',
      ],
      excluded_categories: ['*'],
    });
    this.tracing = true;
  }

  /** The GPU's new pipelines in the trace kept (Session 27), or null with none kept. */
  async pipelines(): Promise<GpuPipelines | null> {
    return this.traced ? gpuPipelines(join(this.folder, 'trace.json')) : null;
  }

  /** Keep both, and the watch's timeline, in the folder. */
  async stop(watch: MainWatch | null): Promise<void> {
    if (this.session) {
      const { profile } = await this.session.post('Profiler.stop');
      writeFileSync(join(this.folder, 'main.cpuprofile'), JSON.stringify(profile));
      this.session.disconnect();
      this.session = null;
    }
    if (this.tracing) {
      this.tracing = false;
      await contentTracing.stopRecording(join(this.folder, 'trace.json'));
      this.traced = true;
    }
    if (watch)
      writeFileSync(
        join(this.folder, 'timeline.json'),
        JSON.stringify({ gaps: watch.gaps, events: watch.events }, null, 1),
      );
  }
}

/** A page's GPU warm-up in a trace: the pipelines made while it ran, how long it took (ms), how it ended. */
export interface WarmUpFigures {
  page: string;
  made: number;
  ms: number;
  took: number | null;
  /** 'drawn', 'cap' (at its longest), 'unseen' (a page not seen), 'cut' (taken away first: the LIVE picture), or '' while it ran. */
  how: string;
}

export interface GpuPipelines {
  /** New pipelines the GPU made while the check ran, and how long making them took (ms). */
  made: number;
  ms: number;
  /** Each page's warm-up (render/WarmUp.tsx): the LIVE picture's, the test output's, the stream's page's. */
  warmUps: WarmUpFigures[];
  /** Those made after the test output's warm-up and before the first Bold transition (its pictures drawn late, say). */
  between: number | null;
  /** Those made while a page's first marked transition ran (bold-transitions), or null with no mark. */
  during: string[] | null;
}

/**
 * The GPU's new pipelines in a trace, and those made while each page warmed up and while the first marked
 * transition ran (Session 27). A trace has an event a line, so it is read line by line: a long check's trace
 * is far too big to parse whole.
 */
export async function gpuPipelines(trace: string): Promise<GpuPipelines> {
  const pipes: { ts: number; dur: number; desc: string }[] = [];
  // The first of each of Drashti's marks (µs): each page's warm-up, and a screen's first Bold transition.
  const marks = new Map<string, number>();
  for await (const line of createInterface({ input: createReadStream(trace), crlfDelay: Infinity })) {
    if (!line.includes('createGraphicsPipeline') && !line.includes('drashti-')) continue;
    let e: { name?: string; ts?: number; dur?: number; args?: { desc?: string } };
    try {
      e = JSON.parse(line.replace(/,\s*$/u, '')) as typeof e;
    } catch {
      continue;
    }
    const ts = e.ts ?? 0;
    if (e.name === 'createGraphicsPipeline') pipes.push({ ts, dur: e.dur ?? 0, desc: e.args?.desc ?? '' });
    else if (e.name?.startsWith('drashti-')) marks.set(e.name, Math.min(marks.get(e.name) ?? ts, ts));
  }
  const ms = (list: { dur: number }[]) => Math.round(list.reduce((n, p) => n + p.dur, 0) / 1000);
  // From a mark to its end (or its cut), and a fifth of a second after (µs): the GPU draws a page's last
  // frames a little after the page asks for them.
  const ended = (name: string) => marks.get(`${name}-end`) ?? marks.get(`${name}-cut`);
  const between = (name: string) => {
    const from = marks.get(name);
    if (from === undefined) return null;
    const until = (ended(name) ?? Number.POSITIVE_INFINITY) + 200_000;
    return pipes.filter((p) => p.ts >= from && p.ts <= until);
  };
  const warmUps: WarmUpFigures[] = [];
  for (const page of ['live', 'output', 'stream']) {
    const name = `${WARM_UP_MARK}:${page}`;
    const made = between(name);
    const from = marks.get(name);
    const to = ended(name);
    if (!made || from === undefined) continue;
    const how =
      ['cut', 'cap', 'unseen'].find((h) => marks.has(`${name}-${h}`)) ?? (to === undefined ? '' : 'drawn');
    warmUps.push({
      page,
      made: made.length,
      ms: ms(made),
      took: to === undefined ? null : Math.round((to - from) / 1000),
      how,
    });
  }
  const bold = between(FIRST_BOLD_MARK);
  const outputEnded = ended(`${WARM_UP_MARK}:output`);
  const bolded = marks.get(FIRST_BOLD_MARK);
  return {
    made: pipes.length,
    ms: ms(pipes),
    warmUps,
    between:
      outputEnded === undefined || bolded === undefined
        ? null
        : pipes.filter((p) => p.ts > outputEnded + 200_000 && p.ts < bolded).length,
    during: bold ? bold.map((p) => p.desc) : null,
  };
}

/**
 * A media request's answer, noted on the watch: when it was answered and, once its body has gone,
 * how many bytes and how long it took altogether. Only while the performance check runs.
 */
export function watchedMedia(
  watch: MainWatch,
  request: Request,
  started: number,
  response: Response,
): Response {
  let label = 'media';
  try {
    const url = new URL(request.url);
    label = `media ${url.hostname} ${url.pathname.slice(1, 9)} ${request.headers.get('range') ?? 'whole'}`;
  } catch {
    // Not a URL Drashti makes: the label stays plain.
  }
  watch.note(`${label} answered ${String(response.status)}`, performance.now() - started);
  if (!response.body) return response;
  let bytes = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
      flush() {
        watch.note(`${label} sent ${String(bytes)} bytes`, performance.now() - started);
      },
    }),
  );
  return new Response(counted, { status: response.status, headers: response.headers });
}
