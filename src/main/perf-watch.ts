import { contentTracing } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join } from 'node:path';

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
 * too, as JSON).
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
  readonly gaps: Gap[] = [];
  readonly events: TimelineEvent[] = [];

  start(): void {
    if (this.timer) return;
    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const gap = now - this.last;
      this.longest = Math.max(this.longest, gap - TICK_MS);
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

  /** What was going on within `around` ms of each gap, for the summary of a gap. */
  near(gap: Gap, around = 200): TimelineEvent[] {
    return this.events.filter((e) => e.at >= gap.at - around && e.at <= gap.at + gap.ms + around);
  }
}

/** The JavaScript CPU profile and the Chromium trace (DRASHTI_PERF_PROFILE), started and stopped around the check. */
export class PerfProfile {
  private session: Session | null = null;
  private tracing = false;

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
    // Tasks on each process's threads (toplevel), with where they were posted from, and IPC.
    await contentTracing.startRecording({
      included_categories: ['toplevel', 'toplevel.flow', 'ipc', 'mojom', 'electron', 'v8.execute'],
      excluded_categories: ['*'],
    });
    this.tracing = true;
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
    }
    if (watch)
      writeFileSync(
        join(this.folder, 'timeline.json'),
        JSON.stringify({ gaps: watch.gaps, events: watch.events }, null, 1),
      );
  }
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
