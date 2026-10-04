import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createWriteStream, statfsSync, type WriteStream } from 'node:fs';
import { setPriority } from 'node:os';
import { dirname } from 'node:path';
import type { StreamPreset } from '../../../shared/stream';
import { redact } from '../redact';
import { audioArgs, type EncoderChoice, encoderCandidates, pickEncoder, videoArgs } from './encoders';
import type { MkvCluster } from './mkv';
import { AUDIO_TRACK, MkvSplitter, MkvWriter, retimeCluster, VIDEO_TRACK } from './mkv';
import { type Progress, ProgressReader } from './progress';
import type { FromProgram, WorkerLive, WorkerRecording, WorkerStatus } from './protocol';

/*
 * The stream's pipeline, in the worker process:
 *
 *   the Program's frames and sound ──► FFmpeg encodes once (H.264 + AAC)
 *                                         │ Matroska, cluster by cluster
 *                       ┌─────────────────┴───────────────┐
 *                the recording file               FFmpeg sends it on
 *                (written here; a dropped         (copying, not encoding)
 *                 connection never touches it)    to YouTube over RTMPS;
 *                                                 started again when it stops
 *
 * Frames are counted against the sound: one frame for every 1/30 s of
 * sound, so pictures and sound share one clock for as long as it runs. When
 * no sound comes (the page stalls), a clock here keeps it going with
 * silence. Nothing waits in memory without a limit: a frame the encoder
 * cannot take is dropped, and so is a cluster the connection cannot take
 * (until the next keyframe), and both are counted.
 */

export interface PipelineHooks {
  status(status: WorkerStatus): void;
  log(level: 'info' | 'warn', message: string): void;
  /** Free bytes on the disk holding this folder (a stand-in in tests; the disk's own figure otherwise). */
  freeBytes?(dir: string): number | null;
}

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
/** The encoder's input may hold this much before frames are dropped (about 10 frames at 1080p). */
const ENCODER_BACKLOG = 32 * 1024 * 1024;
/** The connection may fall this far behind (about 10 s at 6 Mbps) before clusters are dropped. */
const PUSH_BACKLOG = 8 * 1024 * 1024;
/** Behind by more than this is "struggling". */
const PUSH_STRUGGLING = 1.5 * 1024 * 1024;
/** The recording's disk may be this far behind before the recording stops (rather than fill memory). */
const RECORD_BACKLOG = 256 * 1024 * 1024;
/** Waits before connecting again: longer each time, up to about 30 s. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
/** A connection that lasted this long counts as working: the next drop starts the waits again. */
const STEADY_MS = 30_000;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
}

/** Lower priority than the show: streaming must never slow a slide change. */
function belowNormal(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, 10);
  } catch {
    // Not allowed here: it runs at normal priority.
  }
}

/** Something written to a stream, without waiting: how far behind it is. */
const backlog = (s: { writableLength: number } | null | undefined) => s?.writableLength ?? 0;

/** One place the encoded stream goes: it waits for a keyframe, then takes every cluster. */
interface Consumer {
  started: boolean;
  /** The first cluster's time, so it starts at 0. */
  offset: number;
}

const pictureStart = (c: MkvCluster) => c.startsPicture;

/** A plain-language reason the connection stopped, from FFmpeg's last words (already without the key). */
export function connectionMessage(lastLines: readonly string[]): string {
  const text = lastLines.join(' ').toLowerCase();
  if (/(resolve|name or service|getaddrinfo|nodename)/u.test(text))
    return 'This computer cannot find YouTube’s address: the internet may be down.';
  if (/(timed out|timeout)/u.test(text)) return 'The connection to YouTube timed out.';
  if (/(refused)/u.test(text)) return 'YouTube refused the connection.';
  if (/(broken pipe|reset by peer|end of file|i\/o error|input\/output error)/u.test(text))
    return 'The connection to YouTube dropped.';
  if (/(tls|ssl|certificate|handshake)/u.test(text)) return 'The secure connection to YouTube failed.';
  if (/(unauthorized|forbidden|403|401)/u.test(text)) return 'YouTube did not accept the stream key.';
  return 'The connection to YouTube stopped.';
}

export class StreamPipeline {
  private ffmpeg = '';
  private preset: StreamPreset | null = null;
  private encoder: EncoderChoice | null = null;
  private encoderName: string | null = null;
  private encodeProcess: ChildProcessWithoutNullStreams | null = null;
  private writer: MkvWriter | null = null;
  private splitter: MkvSplitter | null = null;
  private header: Buffer | null = null;
  private format: { width: number; height: number; format: 'I420' | 'NV12' | 'BGRA' | 'RGBA' } | null = null;
  private lastFrame: Buffer | null = null;
  private samples = 0;
  private frames = 0;
  private lastAudioAt = 0;
  private silenceTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private encodeProgress: Progress | null = null;
  private dropped = 0;
  private error: string | null = null;
  private keys: string[] = [];

  // ---- going live
  private liveWanted: { url: string; key: string } | null = null;
  private pusher: ChildProcessWithoutNullStreams | null = null;
  private pushConsumer: Consumer | null = null;
  private pushProgress: Progress | null = null;
  private pushStartedAt = 0;
  private pushLines: string[] = [];
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private live: WorkerLive = {
    state: 'off',
    since: null,
    health: 'off',
    bitrateKbps: null,
    speed: null,
    backlogBytes: 0,
    reconnects: 0,
    retryAt: null,
    message: null,
  };

  // ---- recording
  private recordFile: WriteStream | null = null;
  private recordConsumer: Consumer | null = null;
  /**
   * The encoder stopped while recording: the recording goes on in a new file
   * once the encoder is back and has a picture (its new stream has a header
   * of its own), and not before. When Drashti itself goes down, the encoder
   * is often the first to go, and a file made in that moment would be left
   * behind as an empty extra part.
   */
  private rollWaiting = false;
  private keepFree = 2 * 1024 ** 3;
  private recording: WorkerRecording = {
    state: 'off',
    file: null,
    since: null,
    bytes: 0,
    rate: null,
    freeBytes: null,
    message: null,
  };
  private bytesSeen: { at: number; bytes: number }[] = [];

  constructor(private readonly hooks: PipelineHooks) {}

  private log(level: 'info' | 'warn', message: string): void {
    this.hooks.log(level, redact(message, this.keys));
  }

  status(): WorkerStatus {
    return {
      encoder: this.encoder ? { ...this.encoder } : null,
      encoding: this.encodeProcess !== null,
      fps: this.encodeProgress?.fps ?? null,
      droppedFrames: this.dropped + (this.encodeProgress?.dropFrames ?? 0),
      live: { ...this.live, message: this.live.message ? redact(this.live.message, this.keys) : null },
      recording: { ...this.recording },
      error: this.error,
    };
  }

  private report(): void {
    this.hooks.status(this.status());
  }

  /** Get ready: the encoder is found now, and starts with the first frame. */
  async start(options: {
    ffmpeg: string;
    platform: NodeJS.Platform;
    preset: StreamPreset;
    encoder: string | null;
  }): Promise<void> {
    this.ffmpeg = options.ffmpeg;
    this.preset = options.preset;
    this.encoderName = options.encoder;
    this.statusTimer ??= setInterval(() => {
      this.tick();
    }, 1000);
    const known = options.encoder
      ? (encoderCandidates(options.platform).find((c) => c.name === options.encoder) ?? null)
      : null;
    this.encoder = known ?? (await pickEncoder(options.ffmpeg, options.platform, options.preset));
    if (!this.encoder) {
      this.error = 'No H.264 encoder works on this computer, so it cannot stream or record.';
      this.log('warn', this.error);
    } else this.log('info', `Encoder: ${this.encoder.label}`);
    this.report();
    this.maybeStartEncoder();
  }

  // ---- frames and sound in ------------------------------------------------------------

  /** A message from the stream's page. */
  fromProgram(message: FromProgram): void {
    if (this.stopping) return;
    if (message.kind === 'format') {
      const next = { width: message.width, height: message.height, format: message.format };
      if (this.format && JSON.stringify(this.format) !== JSON.stringify(next) && this.encodeProcess) {
        // A new size (another preset): the encoder starts again.
        this.log('info', 'The Program changed size: the encoder starts again');
        this.restartEncoder();
      }
      this.format = next;
      this.maybeStartEncoder();
      return;
    }
    if (message.kind === 'video') {
      // A frame that is not the size announced (a capture being replaced) is not handed on.
      const f = this.format;
      const expected = f ? f.width * f.height * (f.format === 'I420' || f.format === 'NV12' ? 1.5 : 4) : -1;
      if (message.data.byteLength !== expected) return;
      this.lastFrame = Buffer.from(message.data);
      this.maybeStartEncoder();
      return;
    }
    this.lastAudioAt = Date.now();
    this.writeAudio(Buffer.from(message.data), message.frames);
  }

  private maybeStartEncoder(): void {
    if (
      this.encodeProcess ||
      !this.encoder ||
      !this.preset ||
      !this.format ||
      !this.lastFrame ||
      this.stopping
    )
      return;
    if (!this.liveWanted && this.recording.state === 'off') return;
    this.startEncoder();
  }

  private startEncoder(): void {
    const preset = this.preset;
    const format = this.format;
    const encoder = this.encoder;
    if (!preset || !format || !encoder) return;
    this.writer = new MkvWriter(
      { ...format, fps: preset.fps },
      { sampleRate: SAMPLE_RATE, channels: CHANNELS },
    );
    this.samples = 0;
    this.frames = 0;
    this.header = null;
    const args = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostats',
      '-progress',
      'pipe:2',
      '-stats_period',
      '1',
      '-f',
      'matroska',
      '-i',
      'pipe:0',
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      ...videoArgs(encoder.name, preset),
      ...audioArgs(preset),
      '-f',
      'matroska',
      'pipe:1',
    ];
    const child = spawn(this.ffmpeg, args, { stdio: 'pipe', windowsHide: true });
    belowNormal(child.pid);
    this.encodeProcess = child;
    this.log(
      'info',
      `Encoding started (${encoder.label}, ${preset.width}x${preset.height}, ${preset.videoKbps} kbps)`,
    );
    this.splitter = new MkvSplitter(
      (header) => {
        this.header = header;
      },
      (cluster) => {
        this.toConsumers(cluster);
      },
    );
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        this.splitter?.push(chunk);
      } catch (error) {
        this.log('warn', `The encoder's output could not be read: ${String(error)}`);
        this.restartEncoder();
      }
    });
    const lines: string[] = [];
    const reader = new ProgressReader(
      (p) => {
        this.encodeProgress = p;
      },
      (line) => {
        lines.push(line);
        if (lines.length > 20) lines.shift();
        this.log('warn', `[encoder] ${line}`);
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      reader.push(chunk.toString());
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      this.log('warn', `The encoder could not start: ${error.message}`);
    });
    child.on('exit', (code) => {
      if (this.encodeProcess !== child) return;
      this.encodeProcess = null;
      if (this.stopping) return;
      this.log('warn', `The encoder stopped (code ${String(code)}); starting it again`);
      this.holdRecording();
      if (this.pushConsumer) this.pushConsumer = { started: false, offset: 0 };
      setTimeout(() => {
        this.maybeStartEncoder();
      }, 1000);
    });
    child.stdin.write(this.writer.header());
    // Sound keeps the clock; without any for a moment, silence takes its place.
    this.lastAudioAt = Date.now();
    this.silenceTimer ??= setInterval(() => {
      this.fillSilence();
    }, 50);
  }

  private restartEncoder(): void {
    const child = this.encodeProcess;
    this.encodeProcess = null;
    child?.stdin.end();
    child?.kill();
    this.holdRecording();
    if (this.pushConsumer) this.pushConsumer = { started: false, offset: 0 };
    this.maybeStartEncoder();
  }

  private writeAudio(pcm: Buffer, frames: number): void {
    const child = this.encodeProcess;
    const writer = this.writer;
    const preset = this.preset;
    if (!child || !writer || !preset) return;
    if (backlog(child.stdin) > ENCODER_BACKLOG * 2) return;
    for (const part of writer.block(AUDIO_TRACK, this.samples / SAMPLE_RATE, pcm)) child.stdin.write(part);
    this.samples += frames;
    // One frame for every 1/fps s of sound.
    const due = Math.floor((this.samples * preset.fps) / SAMPLE_RATE);
    while (this.frames < due) {
      const frame = this.lastFrame;
      if (frame && backlog(child.stdin) < ENCODER_BACKLOG) {
        for (const part of writer.block(VIDEO_TRACK, this.frames / preset.fps, frame))
          child.stdin.write(part);
      } else if (frame) this.dropped++;
      this.frames++;
    }
  }

  /** No sound for a moment (the page stalled, or has none): silence keeps time. */
  private fillSilence(): void {
    if (!this.encodeProcess) return;
    const quiet = Date.now() - this.lastAudioAt;
    if (quiet < 300) return;
    const frames = Math.round((quiet * SAMPLE_RATE) / 1000);
    this.lastAudioAt = Date.now();
    for (let left = frames; left > 0; left -= 4800) {
      const n = Math.min(4800, left);
      this.writeAudio(Buffer.alloc(n * CHANNELS * 4), n);
    }
  }

  // ---- out ------------------------------------------------------------------------------

  private toConsumers(cluster: MkvCluster): void {
    // A recording held while the encoder was down goes on, in a new file, from the new encoder's first picture.
    if (this.rollWaiting && this.header && pictureStart(cluster)) {
      this.rollWaiting = false;
      this.rollRecording();
    }
    if (this.recordConsumer && this.recordFile) {
      const out = this.take(this.recordConsumer, cluster);
      if (out) this.writeRecording(out);
    }
    if (this.pushConsumer && this.pusher) {
      const stdin = this.pusher.stdin;
      if (backlog(stdin) > PUSH_BACKLOG) {
        // Too far behind: drop until the next keyframe, and count what is lost (a cluster is ~0.1 s).
        this.pushConsumer.started = false;
        this.dropped += Math.max(1, Math.round((this.preset?.fps ?? 30) / 10));
        return;
      }
      const starting = !this.pushConsumer.started;
      const out = this.take(this.pushConsumer, cluster);
      if (out) {
        if (starting) this.log('info', 'Sending, from a keyframe');
        for (const part of out) stdin.write(part);
      }
    }
  }

  /**
   * What to write for this consumer: from a keyframe on (the stream's header
   * first), its times starting at 0; null while it waits for a keyframe.
   */
  private take(consumer: Consumer, cluster: MkvCluster): Buffer[] | null {
    if (!consumer.started) {
      if (!pictureStart(cluster) || !this.header) return null;
      consumer.started = true;
      consumer.offset = cluster.timestamp;
      return [this.header, retimeCluster(cluster, 0)];
    }
    return [retimeCluster(cluster, cluster.timestamp - consumer.offset)];
  }

  // ---- recording -----------------------------------------------------------------------

  record(file: string, keepFreeBytes: number): void {
    this.stopRecording();
    this.keepFree = keepFreeBytes;
    const free = this.freeBytes(file);
    if (free !== null && free < keepFreeBytes) {
      this.recording = { ...this.recording, state: 'off', message: this.lowSpace(free) };
      this.report();
      return;
    }
    this.openRecording(file);
    this.maybeStartEncoder();
    this.report();
  }

  private openRecording(file: string): void {
    const out = createWriteStream(file, { flags: 'wx' });
    out.on('error', (error) => {
      this.log('warn', `The recording could not be written: ${error.message}`);
      this.stopRecording('The recording stopped: the file could not be written.');
    });
    this.recordFile = out;
    this.recordConsumer = { started: false, offset: 0 };
    this.recording = {
      state: 'recording',
      file,
      since: this.recording.state === 'recording' ? this.recording.since : Date.now(),
      bytes: 0,
      rate: null,
      freeBytes: this.freeBytes(file),
      message: null,
    };
    this.bytesSeen = [];
    this.log('info', 'Recording started');
  }

  /** The encoder is down: the recording's file is finished, and the next one waits for the encoder (rollWaiting). */
  private holdRecording(): void {
    if (!this.recordFile) return;
    this.recordFile.end();
    this.recordFile = null;
    this.recordConsumer = null;
    this.rollWaiting = true;
  }

  /** The encoder started again: the recording carries on in a new file beside the old one. */
  private rollRecording(): void {
    const file = this.recording.file;
    if (!file) return;
    this.recordFile?.end();
    const next = file.replace(/( part \d+)?\.mkv$/u, '') + ` part ${Date.now() % 100000}.mkv`;
    this.openRecording(next);
  }

  private writeRecording(parts: Buffer[]): void {
    const out = this.recordFile;
    if (!out) return;
    if (backlog(out) > RECORD_BACKLOG) {
      this.stopRecording('The recording stopped: the disk could not keep up.');
      return;
    }
    for (const part of parts) {
      out.write(part);
      this.recording.bytes += part.length;
    }
  }

  stopRecording(message?: string): void {
    const held = this.rollWaiting;
    this.rollWaiting = false;
    if (!this.recordFile && !held) {
      if (message) this.recording.message = message;
      return;
    }
    this.recordFile?.end();
    this.recordFile = null;
    this.recordConsumer = null;
    this.recording = { ...this.recording, state: 'off', rate: null, message: message ?? null };
    this.log('info', message ? `Recording stopped: ${message}` : 'Recording stopped');
    this.report();
  }

  private freeBytes(file: string): number | null {
    if (this.hooks.freeBytes) return this.hooks.freeBytes(dirname(file));
    try {
      const s = statfsSync(dirname(file));
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }

  private lowSpace(free: number): string {
    const gb = (free / 1024 ** 3).toFixed(1);
    return `The recording stopped: only ${gb} GB is free on that disk, and Drashti keeps 2 GB free. The stream goes on.`;
  }

  // ---- going live -----------------------------------------------------------------------

  goLive(url: string, key: string): void {
    this.liveWanted = { url, key };
    this.keys = [key];
    this.attempts = 0;
    this.live = {
      ...this.live,
      state: 'connecting',
      since: this.live.since,
      health: 'reconnecting',
      reconnects: 0,
      retryAt: null,
      message: 'Connecting to YouTube…',
    };
    this.connect();
    this.maybeStartEncoder();
    this.report();
  }

  private connect(): void {
    const wanted = this.liveWanted;
    if (!wanted || this.stopping) return;
    this.retryTimer = null;
    this.pushLines = [];
    this.pushProgress = null;
    const target = `${wanted.url.replace(/\/+$/u, '')}/${wanted.key}`;
    const child = spawn(
      this.ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-nostats',
        '-progress',
        'pipe:2',
        '-stats_period',
        '1',
        '-f',
        'matroska',
        '-i',
        'pipe:0',
        '-map',
        '0',
        '-c',
        'copy',
        '-f',
        'flv',
        '-flvflags',
        'no_duration_filesize',
        // A connection that goes quiet for 10 s is treated as dropped.
        '-rw_timeout',
        '10000000',
        target,
      ],
      { stdio: 'pipe', windowsHide: true },
    );
    belowNormal(child.pid);
    this.pusher = child;
    this.pushConsumer = { started: false, offset: 0 };
    this.pushStartedAt = Date.now();
    this.log('info', `Connecting (try ${this.attempts + 1})`);
    child.stdout.resume();
    const reader = new ProgressReader(
      (p) => {
        // A connection that has been replaced (or ended) no longer speaks for the stream.
        if (this.pusher !== child) return;
        this.pushProgress = p;
        if ((p.totalSize ?? 0) > 0 && this.live.state !== 'live') {
          this.live = {
            ...this.live,
            state: 'live',
            since: this.live.since ?? Date.now(),
            health: 'good',
            retryAt: null,
            message: null,
          };
          this.log('info', 'On air');
          this.report();
        }
      },
      (line) => {
        const safe = redact(line, this.keys);
        this.pushLines.push(safe);
        if (this.pushLines.length > 20) this.pushLines.shift();
        this.log('warn', `[connection] ${safe}`);
      },
    );
    child.stderr.on('data', (chunk: Buffer) => {
      reader.push(chunk.toString());
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      this.log('warn', `The connection could not start: ${error.message}`);
    });
    child.on('exit', () => {
      if (this.pusher !== child) return;
      this.pusher = null;
      this.pushConsumer = null;
      if (!this.liveWanted || this.stopping) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (Date.now() - this.pushStartedAt > STEADY_MS) this.attempts = 0;
    const wait = reconnectDelay(this.attempts);
    this.attempts++;
    const reason = connectionMessage(this.pushLines);
    const at = Date.now() + wait;
    this.live = {
      ...this.live,
      state: 'reconnecting',
      health: 'reconnecting',
      reconnects: this.live.reconnects + 1,
      retryAt: at,
      message: `${reason} Trying again in ${Math.round(wait / 1000)} s (try ${this.attempts}).`,
      bitrateKbps: null,
      speed: null,
    };
    this.log('warn', `${reason} Trying again in ${Math.round(wait / 1000)} s`);
    this.report();
    this.retryTimer = setTimeout(() => {
      this.live = { ...this.live, retryAt: null, message: 'Connecting to YouTube again…' };
      this.connect();
      this.report();
    }, wait);
  }

  endLive(): void {
    if (!this.liveWanted && !this.pusher) return;
    this.liveWanted = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const child = this.pusher;
    this.pusher = null;
    this.pushConsumer = null;
    if (child) {
      child.stdin.end();
      setTimeout(() => {
        child.kill();
      }, 3000).unref();
    }
    this.live = {
      state: 'off',
      since: null,
      health: 'off',
      bitrateKbps: null,
      speed: null,
      backlogBytes: 0,
      reconnects: 0,
      retryAt: null,
      message: null,
    };
    this.log('info', 'The stream ended');
    this.report();
  }

  // ---- every second ------------------------------------------------------------------------

  private tick(): void {
    // The connection's health, from FFmpeg's progress and what is waiting to go out.
    if (this.live.state === 'live' && this.pusher) {
      const waiting = backlog(this.pusher.stdin);
      const speed = this.pushProgress?.speed ?? null;
      const struggling = waiting > PUSH_STRUGGLING || (speed !== null && speed < 0.9);
      this.live = {
        ...this.live,
        health: struggling ? 'struggling' : 'good',
        bitrateKbps: this.pushProgress?.bitrateKbps ?? null,
        speed,
        backlogBytes: waiting,
        message: struggling
          ? 'The connection is too slow for this preset: try the weak-internet preset.'
          : null,
      };
    }
    // The recording: how fast it grows, the disk's free space, and the time left.
    if (this.recordFile && this.recording.file) {
      const now = Date.now();
      this.bytesSeen.push({ at: now, bytes: this.recording.bytes });
      while ((this.bytesSeen[0]?.at ?? now) < now - 10_000) this.bytesSeen.shift();
      const first = this.bytesSeen[0];
      const rate =
        first && now > first.at ? ((this.recording.bytes - first.bytes) * 1000) / (now - first.at) : null;
      const free = this.freeBytes(this.recording.file);
      this.recording = { ...this.recording, rate, freeBytes: free };
      if (free !== null && free < this.keepFree) this.stopRecording(this.lowSpace(free));
    }
    this.report();
  }

  /** Stop everything (the worker then exits). */
  stop(): void {
    this.stopping = true;
    this.endLive();
    this.stopRecording();
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    const child = this.encodeProcess;
    this.encodeProcess = null;
    child?.stdin.end();
    if (child)
      setTimeout(() => {
        child.kill();
      }, 3000).unref();
  }

  /** The encoder in use (for the main process to remember). */
  get encoderInUse(): string | null {
    return this.encoder?.name ?? this.encoderName;
  }
}
